import { HttpException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Groq, { APIConnectionTimeoutError, APIUserAbortError } from 'groq-sdk';

type ChatMsg = { role: string; content: string };

/** Bounded call duration so a hung provider cannot hold API workers/sockets. */
const GROQ_REQUEST_TIMEOUT_MS = 30_000;

/** Safe, stable error codes understood by chat orchestration (see REL-01). */
export type ProviderErrorCode =
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_ABORTED';

export interface ProviderErrorPayload {
  code: ProviderErrorCode;
  message: string;
  retryable: boolean;
  /** True only for caller-requested cancellation, never for provider failures. */
  aborted: boolean;
  statusCode: number;
}

/**
 * Only sanitized fields cross the provider boundary. Provider-supplied text,
 * payloads and stacks are logged server-side and never placed in the response.
 */
export class ProviderException extends HttpException {
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;
  readonly aborted: boolean;

  constructor(payload: ProviderErrorPayload) {
    super(
      {
        code: payload.code,
        message: payload.message,
        retryable: payload.retryable,
        aborted: payload.aborted,
      },
      payload.statusCode,
    );
    this.code = payload.code;
    this.retryable = payload.retryable;
    this.aborted = payload.aborted;
  }

  /** Explicit accessor for SSE orchestration error events. */
  getPayload(): ProviderErrorPayload {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      aborted: this.aborted,
      statusCode: this.getStatus(),
    };
  }
}

export interface ChatStreamOptions {
  /** Cancellation signal supplied by chat orchestration on disconnect. */
  signal?: AbortSignal;
}

/** True when the signal has been cancelled or a cancellation error reached us. */
export function isProviderAbort(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  if (err instanceof APIUserAbortError) return true;
  if (err instanceof Error && err.name === 'AbortError') return true;
  return false;
}

function isProviderTimeout(err: unknown): boolean {
  return (
    err instanceof APIConnectionTimeoutError ||
    (err instanceof Error &&
      (err.name === 'TimeoutError' ||
        err.name === 'APIConnectionTimeoutError' ||
        /timed?\s?out/i.test(err.message)))
  );
}

@Injectable()
export class GroqService {
  private readonly groqClient: Groq;
  private readonly model: string;
  private readonly logger = new Logger(GroqService.name);

  constructor(private config: ConfigService) {
    const apiKey = config.get<string>('GROQ_API_KEY');
    if (!apiKey || !apiKey.trim()) {
      throw new Error(
        'GROQ_API_KEY must be a non-empty value. Set it in your .env file.',
      );
    }
    this.groqClient = new Groq({
      apiKey,
      timeout: GROQ_REQUEST_TIMEOUT_MS,
      // Retrying an LLM request can duplicate token usage; keep it bounded.
      maxRetries: 1,
    });
    this.model = config.get<string>('GROQ_MODEL', 'llama-3.3-70b-versatile');
    this.logger.log(`LLM provider: Groq (${this.model})`);
  }

  async chat(
    messages: ChatMsg[],
    systemPrompt?: string,
  ): Promise<string> {
    const msgs = this._buildMessages(messages, systemPrompt);
    this.logger.log(
      `Chat request: model=${this.model}, messages=${msgs.length}`,
    );
    return this._groqChat(msgs);
  }

  /**
   * Async iterable of text tokens. A caller-supplied signal is propagated to
   * the provider request and checked before every yield, so cancellation stops
   * the generator promptly even if the SDK does not surface an abort error.
   */
  async *chatStream(
    messages: ChatMsg[],
    systemPrompt?: string,
    options: ChatStreamOptions = {},
  ): AsyncGenerator<string> {
    const { signal } = options;
    if (signal?.aborted) return;
    const msgs = this._buildMessages(messages, systemPrompt);
    this.logger.log(`Stream request: model=${this.model}`);
    yield* this._groqStream(msgs, signal);
  }

  private _buildMessages(
    messages: ChatMsg[],
    systemPrompt?: string,
  ): { role: string; content: string }[] {
    const result: { role: string; content: string }[] = [];
    if (systemPrompt) result.push({ role: 'system', content: systemPrompt });
    for (const m of messages) result.push({ role: m.role, content: m.content });
    return result;
  }

  /**
   * Log provider details server-side for operators, then throw only a fixed
   * code/message. Raw err.message, String(err) and SDK payloads never cross
   * this boundary — controllers otherwise serialize them into SSE responses.
   */
  private _providerError(
    err: unknown,
    signal?: AbortSignal,
  ): ProviderException {
    const aborted = isProviderAbort(err, signal);
    const timedOut = !aborted && isProviderTimeout(err);

    this.logger.error(
      `Groq request failed: ${timedOut ? 'timeout' : aborted ? 'aborted' : 'provider error'}` +
        ` | metadata: ${err instanceof Error ? err.name : typeof err}`,
    );

    if (aborted) {
      return new ProviderException({
        code: 'PROVIDER_ABORTED',
        message: 'AI request was cancelled',
        retryable: false,
        aborted: true,
        statusCode: 499,
      });
    }
    if (timedOut) {
      return new ProviderException({
        code: 'PROVIDER_TIMEOUT',
        message: 'AI service timed out',
        retryable: true,
        aborted: false,
        statusCode: 504,
      });
    }
    return new ProviderException({
      code: 'PROVIDER_UNAVAILABLE',
      message: 'AI service is temporarily unavailable',
      retryable: true,
      aborted: false,
      statusCode: 503,
    });
  }

  private async _groqChat(
    messages: { role: string; content: string }[],
  ): Promise<string> {
    let completion;
    try {
      completion = await this.groqClient.chat.completions.create({
        model: this.model,
        messages: messages as Groq.Chat.ChatCompletionMessageParam[],
        temperature: 1,
        max_completion_tokens: 1024,
        top_p: 1,
      }, { timeout: GROQ_REQUEST_TIMEOUT_MS });
    } catch (err) {
      throw this._providerError(err);
    }
    const content = completion.choices[0]?.message?.content || '';
    this.logger.log(`Groq response received (${content.length} chars)`);
    return content;
  }

  private async *_groqStream(
    messages: { role: string; content: string }[],
    signal?: AbortSignal,
  ): AsyncGenerator<string> {
    let stream;
    const requestOptions = {
      timeout: GROQ_REQUEST_TIMEOUT_MS,
      ...(signal ? { signal } : {}),
    };
    try {
      stream = await this.groqClient.chat.completions.create({
        model: this.model,
        messages: messages as Groq.Chat.ChatCompletionMessageParam[],
        temperature: 1,
        max_completion_tokens: 1024,
        top_p: 1,
        stream: true,
      }, requestOptions);
    } catch (err) {
      throw this._providerError(err, signal);
    }

    let streamIterator: AsyncIterator<Groq.Chat.ChatCompletionChunk> | undefined;
    let cancelled = false;
    try {
      streamIterator = stream[Symbol.asyncIterator]();
      while (!cancelled) {
        // Yielding is a suspension point: the client may disconnect while the
        // consumer is busy, so check again immediately before each value.
        if (signal?.aborted) break;
        let next: IteratorResult<Groq.Chat.ChatCompletionChunk>;
        try {
          next = await streamIterator.next();
        } catch (err) {
          // Caller cancellation is a benign end of stream, not a provider
          // failure; any other error is mapped before leaving the adapter.
          if (isProviderAbort(err, signal)) {
            cancelled = true;
            continue;
          }
          throw this._providerError(err, signal);
        }
        if (signal?.aborted) break;
        if (next.done) break;
        const token = next.value.choices[0]?.delta?.content || '';
        if (token) yield token;
      }
    } finally {
      // Explicitly close the SDK stream so a consumer `break` aborts the
      // underlying provider connection instead of leaving it open.
      await streamIterator?.return?.().catch(() => undefined);
    }
  }
}
