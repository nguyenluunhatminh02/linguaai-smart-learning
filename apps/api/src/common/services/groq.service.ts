import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Groq from 'groq-sdk';

type ChatMsg = { role: string; content: string };

/** Bounded call duration so a hung provider cannot hold API workers/sockets. */
const GROQ_REQUEST_TIMEOUT_MS = 30_000;

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

  async *chatStream(
    messages: ChatMsg[],
    systemPrompt?: string,
  ): AsyncGenerator<string> {
    const msgs = this._buildMessages(messages, systemPrompt);
    this.logger.log(`Stream request: model=${this.model}`);
    yield* this._groqStream(msgs);
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
   * Convert provider/SDK errors into a generic Nest exception so raw request
   * details (URLs, params, provider payloads) never reach API clients —
   * especially through the SSE stream controller's error serialization.
   */
  private _serviceError(err: unknown): ServiceUnavailableException {
    this.logger.error(`Groq request failed: ${err instanceof Error ? err.message : String(err)}`);
    return new ServiceUnavailableException('AI service is temporarily unavailable');
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
      throw this._serviceError(err);
    }
    const content = completion.choices[0]?.message?.content || '';
    this.logger.log(`Groq response received (${content.length} chars)`);
    return content;
  }

  private async *_groqStream(
    messages: { role: string; content: string }[],
  ): AsyncGenerator<string> {
    let stream;
    try {
      stream = await this.groqClient.chat.completions.create({
        model: this.model,
        messages: messages as Groq.Chat.ChatCompletionMessageParam[],
        temperature: 1,
        max_completion_tokens: 1024,
        top_p: 1,
        stream: true,
      }, { timeout: GROQ_REQUEST_TIMEOUT_MS });
    } catch (err) {
      // The SSE controller serializes thrown errors; only a sanitized Nest
      // exception may cross this boundary.
      throw this._serviceError(err);
    }
    try {
      for await (const chunk of stream) {
        const token = chunk.choices[0]?.delta?.content || '';
        if (token) yield token;
      }
    } catch (err) {
      throw this._serviceError(err);
    }
  }
}
