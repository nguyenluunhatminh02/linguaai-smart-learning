import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GroqService } from '../common/services/groq.service';
import {
  CHAT_LANGUAGES,
  MAX_STREAM_MESSAGE_LENGTH,
  SendChatDto,
  StreamChatDto,
} from './dto/chat.dto';

/** History is bounded before it reaches the provider prompt. */
const MAX_HISTORY_MESSAGES = 50;

/** Hard cap on accumulated assistant output, streamed or non-streamed. */
const MAX_ASSISTANT_CONTENT_LENGTH = 16 * 1024;

/** Refresh the cancellation check periodically even for quiet providers. */
const ABORT_CHECK_INTERVAL_MS = 1000;

/** Length of the conversation title derived from the first user turn. */
const TITLE_LENGTH = 50;

type ChatRole = 'user' | 'assistant';
type ProviderMessage = { role: ChatRole; content: string };

export type ChatCompletionMeta = {
  conversationId: string;
  messageId: string;
  assistantContent: string;
  /** Set only by callers that performed a billing debit for this turn. */
  balance?: number;
};

export type ChatStreamResult = {
  conversationId: string;
  messageId: string;
  /** Number of deltas actually forwarded to the sink (before the cap). */
  deltas: number;
  /** True when the output cap was hit and remaining deltas were discarded. */
  truncated: boolean;
  /** Provider error code, set when the run failed after the stream opened. */
  errorCode?: string;
};

export type ChatStreamOptions = {
  /** Receives each bounded delta in order. Must not be shared across turns. */
  onDelta?: (delta: string) => void | Promise<void>;
  /** Called once after the user/assistant messages are committed. */
  onCompleted?: (meta: ChatCompletionMeta) => void | Promise<void>;
  /** Aborts the provider stream; no terminal messages are persisted. */
  signal?: AbortSignal;
};

/**
 * Normalize user text: strip markup/control characters and cap length.
 * This is input hygiene only - it does not prevent prompt injection.
 */
export function normalizeChatInput(input: string): string {
  if (!input) return '';
  return input
    .replace(/<[^>]*>/g, '')
    .replace(/[\x00-\x1F\x7F]/g, '')
    .slice(0, MAX_STREAM_MESSAGE_LENGTH);
}

/** Keep the allowlist in one place shared by validation and the prompt. */
function resolveLanguage(language?: string): string {
  const value = (language || 'english').trim().toLowerCase();
  if (!CHAT_LANGUAGES.includes(value as (typeof CHAT_LANGUAGES)[number])) {
    throw new BadRequestException(
      `Unsupported language. Supported languages: ${CHAT_LANGUAGES.join(', ')}`,
    );
  }
  return value;
}

/** Only allowlisted text is ever interpolated into the tutor system prompt. */
function buildSystemPrompt(language: string): string {
  return `You are an expert language tutor helping the user learn ${language}. Provide helpful, clear, and encouraging responses. Use examples when appropriate.`;
}

function normalizeDbRole(role: string): ChatRole | null {
  return role === 'user' || role === 'assistant' ? role : null;
}

/**
 * Map an error to a stable, sanitized code. Provider/SDK error strings (which
 * can carry URLs, request params or payloads) must never cross the API boundary.
 */
function toChatErrorCode(err: unknown): string {
  if (err instanceof ServiceUnavailableException) return 'AI_UNAVAILABLE';
  if (err instanceof BadRequestException) return 'INVALID_REQUEST';
  return 'AI_FAILED';
}

/**
 * Turn cancellation into an AbortSignal the provider adapter can use. Nest's
 * stream controller only needs to call `abort()` when the client disconnects;
 * a caller-provided signal is propagated unchanged.
 */
function createAbortController(signal?: AbortSignal): AbortController {
  const controller = new AbortController();
  if (!signal) return controller;
  if (signal.aborted) controller.abort(signal.reason);
  else
    signal.addEventListener('abort', () => controller.abort(signal.reason), {
      once: true,
    });
  return controller;
}

/**
 * A quiet provider may stop yielding deltas before the request timeout. Race
 * the next delta against a periodic abort check so a disconnect does not keep
 * an otherwise idle generator - and its DB resources - alive indefinitely.
 */
async function nextDelta<T>(
  iterator: AsyncIterator<T>,
  signal: AbortSignal,
): Promise<IteratorResult<T>> {
  const steps: Promise<IteratorResult<T>>[] = [iterator.next()];
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (!signal.aborted) {
    timer = setTimeout(() => {
      if (!signal.aborted) signal.dispatchEvent(new Event('abort-check'));
    }, ABORT_CHECK_INTERVAL_MS);
    steps.push(
      new Promise<IteratorResult<T>>((resolve) => {
        const onCheck = () => {
          signal.removeEventListener('abort-check', onCheck);
          resolve({ value: undefined as T, done: false });
        };
        signal.addEventListener('abort-check', onCheck, { once: true });
        signal.addEventListener('abort', onCheck, { once: true });
      }),
    );
  }
  try {
    return await Promise.race(steps);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Owns the chat turn lifecycle for both transport paths. Client-supplied
 * history and client-supplied assistant messages are never accepted as truth:
 * context is read from the database and only the provider's own output is
 * stored as an assistant message.
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private prisma: PrismaService,
    private groqService: GroqService,
  ) {}

  /** Extract the single user turn from either the legacy or new DTO shape. */
  resolveTurn(dto: SendChatDto | StreamChatDto): {
    conversationId?: string | null;
    language?: string;
    message: string;
  } {
    const candidate = dto as StreamChatDto & SendChatDto;
    if (typeof candidate.message === 'string') {
      return {
        conversationId: candidate.conversationId,
        language: candidate.language,
        message: candidate.message,
      };
    }

    // Compatibility path for the legacy { messages: [...] } contract: only a
    // trailing user message can become a new turn; assistant/history entries
    // from the client are discarded and history is re-read from the DB.
    const legacyMessages = Array.isArray(candidate.messages)
      ? candidate.messages
      : [];
    const last = legacyMessages[legacyMessages.length - 1];
    if (!last || last.role !== 'user' || typeof last.content !== 'string') {
      throw new BadRequestException('A user message is required');
    }
    return {
      conversationId: candidate.conversationId,
      language: candidate.language,
      message: last.content,
    };
  }

  /** Validate ownership and resolve (or create) the conversation for a turn. */
  async resolveOwnedConversation(
    userId: string,
    conversationId: string | null | undefined,
    title: string,
  ): Promise<string> {
    if (conversationId) {
      const found = await this.prisma.chat_conversations.findFirst({
        where: { id: conversationId, user_id: userId },
        select: { id: true },
      });
      if (!found) throw new NotFoundException('Conversation not found');
      return found.id;
    }

    const conv = await this.prisma.chat_conversations.create({
      data: {
        user_id: userId,
        title: title.slice(0, TITLE_LENGTH) || 'New Conversation',
      },
      select: { id: true },
    });
    return conv.id;
  }

  /** Read a bounded, ordered history from the database for this conversation. */
  private async loadHistory(
    conversationId: string,
  ): Promise<ProviderMessage[]> {
    const rows = await this.prisma.chat_messages.findMany({
      where: { conversation_id: conversationId },
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
      take: MAX_HISTORY_MESSAGES,
      select: { role: true, content: true },
    });
    return rows
      .map((row) => ({ role: normalizeDbRole(row.role), content: row.content }))
      .filter((row): row is ProviderMessage => row.role !== null);
  }

  /**
   * Persist the user turn and the provider-produced assistant turn once, with
   * both messages visible only after the transaction commits. The assistant
   * ID is returned so callers can finalize operation state against it.
   */
  private async persistTurn(
    conversationId: string,
    userContent: string,
    assistantContent: string,
  ): Promise<{ userMessageId: string; assistantMessageId: string }> {
    return this.prisma.$transaction(async (tx) => {
      const userMessage = await tx.chat_messages.create({
        data: {
          conversation_id: conversationId,
          role: 'user',
          content: userContent,
        },
        select: { id: true },
      });
      const assistantMessage = await tx.chat_messages.create({
        data: {
          conversation_id: conversationId,
          role: 'assistant',
          content: assistantContent,
        },
        select: { id: true },
      });
      return {
        userMessageId: userMessage.id,
        assistantMessageId: assistantMessage.id,
      };
    });
  }

  private async runTurn(
    userId: string,
    dto: SendChatDto | StreamChatDto,
    collect: (
      messages: ProviderMessage[],
      systemPrompt: string,
    ) => Promise<string>,
  ): Promise<{
    conversationId: string;
    messageId: string;
    assistantContent: string;
  }> {
    const turn = this.resolveTurn(dto);
    const message = normalizeChatInput(turn.message);
    if (!message)
      throw new BadRequestException('A non-empty user message is required');
    const language = resolveLanguage(turn.language);

    const conversationId = await this.resolveOwnedConversation(
      userId,
      turn.conversationId,
      message,
    );
    const history = await this.loadHistory(conversationId);
    const assistantContent = await collect(
      history,
      buildSystemPrompt(language),
    );

    // The user turn is durable only once the provider has returned a usable
    // answer; a failed stream leaves the conversation unchanged.
    const { assistantMessageId } = await this.persistTurn(
      conversationId,
      message,
      assistantContent.slice(0, MAX_ASSISTANT_CONTENT_LENGTH),
    );
    return { conversationId, messageId: assistantMessageId, assistantContent };
  }

  /**
   * Non-streaming entry point. Kept under the original name for callers that
   * already invoke `sendMessage`, with `sendNonStream` as the explicit alias.
   */
  async sendMessage(
    userId: string,
    dto: SendChatDto | StreamChatDto,
  ): Promise<ChatCompletionMeta> {
    return this.sendNonStream(userId, dto);
  }

  /** Collect the full provider answer, then commit the turn. */
  async sendNonStream(
    userId: string,
    dto: SendChatDto | StreamChatDto,
  ): Promise<ChatCompletionMeta> {
    return this.runTurn(userId, dto, async (messages, systemPrompt) => {
      const content = await this.groqService.chat(messages, systemPrompt);
      if (typeof content !== 'string') {
        throw new ServiceUnavailableException(
          'AI service returned an invalid response',
        );
      }
      return content.slice(0, MAX_ASSISTANT_CONTENT_LENGTH);
    });
  }

  /**
   * Streaming entry point. Deltas come from the same provider response that is
   * persisted, are bounded by a hard output cap, and may be cancelled via the
   * supplied signal. Persistence happens only after a clean provider finish;
   * `onCompleted` fires only after the transaction commits.
   */
  async sendStream(
    userId: string,
    dto: SendChatDto | StreamChatDto,
    options: ChatStreamOptions = {},
  ): Promise<ChatStreamResult> {
    const { onDelta, onCompleted } = options;
    const controller = createAbortController(options.signal);
    const signal = controller.signal;
    if (signal.aborted) throw new BadRequestException('Request was cancelled');

    const turn = this.resolveTurn(dto);
    const message = normalizeChatInput(turn.message);
    if (!message)
      throw new BadRequestException('A non-empty user message is required');
    const language = resolveLanguage(turn.language);

    const conversationId = await this.resolveOwnedConversation(
      userId,
      turn.conversationId,
      message,
    );
    if (signal?.aborted) throw new BadRequestException('Request was cancelled');
    const history = await this.loadHistory(conversationId);

    let content = '';
    let truncated = false;
    let deltas = 0;
    // Pass the signal to provider adapters that support cancellation. Older
    // adapters accept only (messages, systemPrompt); the local abort loop
    // still stops consumption and persistence in that case.
    const chatStream = this.groqService.chatStream as (
      messages: ProviderMessage[],
      prompt: string,
      options?: { signal?: AbortSignal },
    ) => AsyncGenerator<string>;
    const stream = chatStream(history, buildSystemPrompt(language), { signal });
    const iterator = stream[Symbol.asyncIterator]();

    try {
      while (true) {
        if (signal.aborted)
          throw new BadRequestException('Request was cancelled');
        const next = await nextDelta(iterator, signal);
        if (next.done) break;
        if (next.value === undefined) continue; // periodic cancellation poll
        const delta = next.value;
        if (signal.aborted)
          throw new BadRequestException('Request was cancelled');
        if (!delta) continue;
        deltas += 1;
        let forwarded = delta;
        if (content.length >= MAX_ASSISTANT_CONTENT_LENGTH) {
          truncated = true;
          forwarded = '';
        } else {
          const room = MAX_ASSISTANT_CONTENT_LENGTH - content.length;
          if (delta.length > room) {
            forwarded = delta.slice(0, room);
            truncated = true;
          }
          content += forwarded;
        }
        if (forwarded) await onDelta?.(forwarded);
      }

      if (!content)
        throw new ServiceUnavailableException(
          'AI service returned an empty response',
        );

      const { assistantMessageId } = await this.persistTurn(
        conversationId,
        message,
        content,
      );
      const meta: ChatCompletionMeta = {
        conversationId,
        messageId: assistantMessageId,
        assistantContent: content,
      };
      if (!signal.aborted) await onCompleted?.(meta);
      return {
        conversationId,
        messageId: assistantMessageId,
        deltas,
        truncated,
      };
    } catch (err) {
      const errorCode = toChatErrorCode(err);
      this.logger.warn(`Chat stream failed: ${errorCode}`);
      return { conversationId, messageId: '', deltas, truncated, errorCode };
    } finally {
      // A cancelled or failed run must not leave a half-open provider request.
      const close = (
        iterator as { return?: (value?: unknown) => Promise<unknown> }
      ).return;
      if (close)
        await Promise.resolve(close.call(iterator)).catch(() => undefined);
      controller.abort();
    }
  }

  async getConversations(userId: string) {
    return this.prisma.chat_conversations.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      take: 50,
    });
  }

  async getMessages(userId: string, conversationId: string) {
    const conv = await this.prisma.chat_conversations.findFirst({
      where: { id: conversationId, user_id: userId },
    });
    if (!conv) throw new NotFoundException('Conversation not found');

    return this.prisma.chat_messages.findMany({
      where: { conversation_id: conversationId },
      orderBy: { created_at: 'asc' },
    });
  }

  async deleteConversation(userId: string, conversationId: string) {
    const conv = await this.prisma.chat_conversations.findFirst({
      where: { id: conversationId, user_id: userId },
    });
    if (!conv) throw new NotFoundException('Conversation not found');
    await this.prisma.chat_conversations.delete({
      where: { id: conversationId },
    });
  }
}
