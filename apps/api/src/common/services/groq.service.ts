import { HttpException, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, AxiosInstance, AxiosResponse } from 'axios';
import {
  AiClientService,
  AiRequestMeta,
  buildAiRequestMeta,
  mapAiError,
  toAiHeaders,
} from './ai-client.service';
import { requestContextStorage } from '../utils/request-context';

type ChatMsg = { role: string; content: string };

/** Node stream shape accepted by axios `responseType: 'stream'`. */
type DestroyableStream = NodeJS.ReadableStream & {
  destroy?: () => void;
};

/** Bounded call duration so a hung provider cannot hold API workers/sockets. */
const GROQ_REQUEST_TIMEOUT_MS = 30_000;

/** FastAPI paths used by this compatibility adapter. */
const CHAT_PATH = '/ai/chat';
const CHAT_STREAM_PATH = '/ai/chat/stream';

/** Fixed, identity header names asserted by the FastAPI chat routes. */
const HEADER_USER_ID = 'X-User-ID';
const HEADER_USER_ROLES = 'X-User-Roles';

/** Opaque-id shape enforced by the AI service (no header injection). */
const OPAQUE_ID = /^[A-Za-z0-9._:~-]{1,128}$/;
const ROLE = /^[A-Za-z0-9_-]{1,64}$/;
/** Only the gateway-authenticated chat roles are accepted by the service. */
const ALLOWED_ROLES = new Set(['user', 'admin', 'service']);

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
  if (err instanceof Error && err.name === 'AbortError') return true;
  // AiClientService maps transport failures to HttpException; an aborted
  // request is signal-driven, so the signal check above is authoritative.
  return false;
}

function isProviderTimeout(err: unknown): boolean {
  if (err instanceof Error) {
    if (
      err.name === 'TimeoutError' ||
      err.name === 'APIConnectionTimeoutError' ||
      /timed?\s?out/i.test(err.message)
    ) {
      return true;
    }
  }
  const code = (err as { aiError?: { code?: unknown } } | null)?.aiError?.code;
  return code === 'PROVIDER_TIMEOUT';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }
  return undefined;
}

/**
 * A locally constructed request identity, read from the ambient AsyncLocalStorage
 * populated in main.ts. Kept private so identity plumbing can move into
 * AiClientService in a later slice without changing this adapter's callers.
 */
interface AdapterRequestStore {
  requestId?: string;
  operationId?: string;
  userId?: string;
  roles?: string | string[];
}

function adapterStore(): AdapterRequestStore | undefined {
  return requestContextStorage.getStore() as AdapterRequestStore | undefined;
}

/**
 * Derive the gateway-asserted identity headers. Never trusted from the browser:
 * values come from the authenticated request context and are validated against
 * the AI service's own shapes before being sent.
 */
function identityHeaders(store?: AdapterRequestStore): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!store) return headers;

  const userId = firstString(store.userId);
  if (userId && OPAQUE_ID.test(userId)) headers[HEADER_USER_ID] = userId;

  const rawRoles = Array.isArray(store.roles)
    ? store.roles.join(',')
    : firstString(store.roles);
  if (rawRoles) {
    const roles = rawRoles
      .split(',')
      .map((role) => role.trim())
      .filter(
        (role) => ROLE.test(role) && ALLOWED_ROLES.has(role.toLowerCase()),
      );
    if (roles.length > 0) headers[HEADER_USER_ROLES] = roles.join(',');
  }
  return headers;
}

/**
 * @deprecated REL-02: this class is a thin compatibility adapter. New code must
 * use {@link AiClientService} (or the FastAPI client directly); the direct Groq
 * SDK path has been removed. ChatService, chat.module.ts and the billing tests
 * still depend on this class, so its public exports and signatures are kept.
 */
@Injectable()
export class GroqService {
  private readonly logger = new Logger(GroqService.name);
  private readonly streamClient: AxiosInstance;
  private warned = false;

  /**
   * `aiClient` is optional only so legacy unit tests that instantiate the
   * service with a ConfigService mock still work; production wiring supplies
   * it from ChatModule. The fallback client uses the same base URL/API key as
   * AiClientService and never falls back to a direct Groq SDK call.
   */
  constructor(
    private config: ConfigService,
    @Optional() private aiClient?: AiClientService,
  ) {
    const base = config.get<string>('AI_SERVICE_URL', 'http://localhost:8000');
    const keys = (config.get<string>('AI_SERVICE_API_KEYS') || '')
      .split(',')
      .map((key) => key.trim())
      .filter(Boolean);
    this.streamClient = axios.create({
      baseURL: base.endsWith('/v1') ? base : `${base}/v1`,
      timeout: GROQ_REQUEST_TIMEOUT_MS,
      headers: keys[0] ? { 'X-API-Key': keys[0] } : {},
    });
    this._warnDeprecated();
  }

  /** @deprecated Delegate through AiClientService instead. */
  async chat(messages: ChatMsg[], systemPrompt?: string): Promise<string> {
    this._warnDeprecated();
    const msgs = this._buildMessages(messages, systemPrompt);
    const body = {
      language: 'english',
      messages: msgs
        .filter((message) => message.role !== 'system')
        .map((message) => ({ role: message.role, content: message.content })),
    };
    this.logger.log(`Chat request: messages=${body.messages.length}`);
    try {
      const result = await this._post<unknown>(CHAT_PATH, body);
      const response = isRecord(result)
        ? firstString(result.response)
        : undefined;
      if (!response) {
        throw new ProviderException({
          code: 'PROVIDER_UNAVAILABLE',
          message: 'AI service is temporarily unavailable',
          retryable: true,
          aborted: false,
          statusCode: 503,
        });
      }
      this.logger.log(`Chat response received (${response.length} chars)`);
      return response;
    } catch (err) {
      throw this._providerError(err);
    }
  }

  /**
   * @deprecated Delegate through AiClientService instead.
   *
   * Async iterable of text tokens. A caller-supplied signal is propagated to
   * the provider request and checked before every yield, so cancellation stops
   * the generator promptly even if the transport does not surface an abort.
   */
  async *chatStream(
    messages: ChatMsg[],
    systemPrompt?: string,
    options: ChatStreamOptions = {},
  ): AsyncGenerator<string> {
    this._warnDeprecated();
    const { signal } = options;
    if (signal?.aborted) return;

    const msgs = this._buildMessages(messages, systemPrompt);
    const body = {
      language: 'english',
      messages: msgs
        .filter((message) => message.role !== 'system')
        .map((message) => ({ role: message.role, content: message.content })),
    };
    this.logger.log('Stream request');
    yield* this._stream(body, signal);
  }

  private async _post<T>(
    path: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    if (this.aiClient) {
      // AiClientService owns metadata, safe retries and error mapping.
      return this.aiClient.post<T>(path, body);
    }
    const meta = buildAiRequestMeta(path, body, GROQ_REQUEST_TIMEOUT_MS);
    const headers = {
      ...toAiHeaders(meta),
      ...identityHeaders(adapterStore()),
      'X-Operation-ID': meta.operationId ?? meta.requestId,
    };
    try {
      const res = await this.streamClient.post<T>(path, body, { headers });
      return res.data;
    } catch (err) {
      const axiosError = err as AxiosError;
      const status = axiosError.response?.status;
      if (status && status >= 400 && status < 600) {
        const details = mapAiError(status, axiosError.response?.data, meta);
        // Only the mapped, fixed-code error crosses this boundary.
        throw Object.assign(
          new HttpException(
            details.message,
            details.code === 'PROVIDER_TIMEOUT' ? 504 : status,
          ),
          { aiError: details },
        );
      }
      throw err;
    }
  }

  private async *_stream(
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): AsyncGenerator<string> {
    const meta: AiRequestMeta = buildAiRequestMeta(
      CHAT_STREAM_PATH,
      body,
      GROQ_REQUEST_TIMEOUT_MS,
    );
    const store = adapterStore();
    const headers = {
      ...toAiHeaders(meta),
      ...identityHeaders(store),
      'X-Operation-ID': meta.operationId ?? meta.requestId,
    };
    const controller = new AbortController();
    const relayAbort = (): void => controller.abort();
    if (signal?.aborted) return;
    signal?.addEventListener('abort', relayAbort, { once: true });

    let response: AxiosResponse<DestroyableStream> | undefined;
    let iterator: AsyncIterator<string> | undefined;
    try {
      response = await this.streamClient.post<DestroyableStream>(
        CHAT_STREAM_PATH,
        body,
        {
          headers,
          responseType: 'stream',
          signal: controller.signal,
          // Streaming responses must not be retried: re-sending could duplicate
          // tokens. Connection failures are surfaced as unavailable instead.
          timeout: GROQ_REQUEST_TIMEOUT_MS,
        },
      );
      iterator = this._sseDeltas(response.data, signal);
      while (!signal?.aborted) {
        let next: IteratorResult<string>;
        try {
          next = await iterator.next();
        } catch (err) {
          if (isProviderAbort(err, signal)) break;
          throw this._providerError(err, signal);
        }
        if (next.done || signal?.aborted) break;
        if (next.value) yield next.value;
      }
    } catch (err) {
      if (isProviderAbort(err, signal)) return;
      throw this._providerError(err, signal);
    } finally {
      signal?.removeEventListener('abort', relayAbort);
      try {
        await iterator?.return?.();
      } catch {
        // A closed connection is expected on client disconnect.
      }
      // Destroy a half-open response so no provider connection is leaked.
      if (typeof response?.data?.destroy === 'function') {
        response.data.destroy();
      }
    }
  }

  /**
   * Parse `event: delta` / `data: {"seq":N,"text":"..."}` from an SSE stream.
   * Chunk boundaries are arbitrary: lines and JSON payloads are buffered until
   * complete. Only data from `delta` events yields text; `failed` events map to
   * a fixed provider error and all other events are ignored.
   */
  private async *_sseDeltas(
    source: NodeJS.ReadableStream,
    signal?: AbortSignal,
  ): AsyncGenerator<string> {
    let buffered = '';
    let eventName = '';
    let dataLines: string[] = [];

    const dispatch = (event: string, rawData: string): string | undefined => {
      if (event !== 'delta' && event !== 'failed') return undefined;
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawData);
      } catch {
        return undefined;
      }
      if (!isRecord(parsed)) return undefined;
      if (event === 'delta') {
        const text = parsed.text;
        return typeof text === 'string' ? text : undefined;
      }
      const error = isRecord(parsed.error) ? parsed.error : parsed;
      const code = firstString(error.code);
      const timedOut = code === 'PROVIDER_TIMEOUT';
      throw new ProviderException({
        code: timedOut ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNAVAILABLE',
        message: timedOut
          ? 'AI service timed out'
          : 'AI service is temporarily unavailable',
        retryable: true,
        aborted: false,
        statusCode: timedOut ? 504 : 503,
      });
    };

    const finishEvent = function* (): Generator<string, void, undefined> {
      const event = eventName;
      const rawData = dataLines.join('\n');
      eventName = '';
      dataLines = [];
      if (!rawData) return;
      const delta = dispatch(event, rawData);
      if (delta) yield delta;
    };

    for await (const chunk of source as AsyncIterable<Buffer | string>) {
      if (signal?.aborted) return;
      buffered += Buffer.isBuffer(chunk)
        ? chunk.toString('utf8')
        : String(chunk);
      // SSE delimiters are LF; CRLF streams are handled by trimming '\r'.
      let newline = buffered.indexOf('\n');
      while (newline >= 0) {
        const rawLine = buffered.slice(0, newline).replace(/\r$/, '');
        buffered = buffered.slice(newline + 1);
        if (!rawLine) {
          yield* finishEvent();
        } else if (rawLine.startsWith('event:')) {
          eventName = rawLine.slice(6).trim();
        } else if (rawLine.startsWith('data:')) {
          dataLines.push(rawLine.slice(5).trimStart());
        }
        // `field: value` lines are ignored; comments and heartbeats too.
        newline = buffered.indexOf('\n');
      }
      // Guard against unbounded growth if a peer never terminates a line.
      if (buffered.length > 64 * 1024) buffered = '';
    }
    yield* finishEvent();
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

  private _warnDeprecated(): void {
    if (this.warned) return;
    this.warned = true;
    this.logger.warn(
      'GroqService is deprecated (REL-02); migrate to AiClientService.',
    );
  }

  /**
   * Log provider details server-side for operators, then throw only a fixed
   * code/message. Raw err.message, String(err) and upstream payloads never
   * cross this boundary — controllers otherwise serialize them into responses.
   */
  private _providerError(
    err: unknown,
    signal?: AbortSignal,
  ): ProviderException {
    const aborted = isProviderAbort(err, signal);
    const timedOut = !aborted && isProviderTimeout(err);

    this.logger.error(
      `AI chat request failed: ${timedOut ? 'timeout' : aborted ? 'aborted' : 'provider error'}` +
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
}
