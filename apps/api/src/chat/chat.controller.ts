import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  UseGuards,
  ParseUUIDPipe,
  Res,
  Headers,
  BadRequestException,
  Req,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { ChatService } from './chat.service';
import {
  CHAT_LANGUAGES,
  SendChatDto,
  StreamChatDto,
} from './dto/chat.dto';
import { normalizeChatInput } from './chat.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AiOperationsService } from '../ai-operations/ai-operations.service';
import { AiOperationsPolicy } from '../ai-operations/ai-operations.policy';
import { TokensService } from '../tokens/tokens.service';

/** Operation feature used by the chat transport (server-side pricing only). */
const CHAT_FEATURE = 'ai_chat';

/** Idempotency-Key is a UUID or an opaque key of bounded length. */
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
const UUID_V4_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPAQUE_KEY = /^[A-Za-z0-9._:-]+$/;

/** Hard limits protecting the SSE transport from slow or verbose clients. */
const MAX_STREAM_SECONDS = 120;
const HEARTBEAT_MS = 15_000;
const MAX_QUEUED_BYTES = 1 << 20;
const MAX_DELTA_LENGTH = 16 * 1024;

/** Outcome of reserving a chat operation; handlers branch on this. */
interface ReservedChatOperation {
  operationId: string;
  conversationId: string;
  version: number;
  /** Empty for replayed terminal operations, which must never be finalized. */
  leaseToken: string;
  /** SUCCEEDED means the stored result must be replayed instead of re-running the provider. */
  status: string;
  resultRef: string | null;
  /** True for an existing operation with a live lease held by another request. */
  inProgress: boolean;
}

/** Persisted assistant answer used to replay a completed operation. */
interface ReplayResult {
  messageId: string;
  content: string;
}

/** Safe error codes exposed to clients; provider details are logged only. */
type ChatFailureCode =
  | 'VALIDATION_ERROR'
  | 'INSUFFICIENT_CREDITS'
  | 'OPERATION_CONFLICT'
  | 'RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_TIMEOUT'
  | 'INVALID_AI_OUTPUT'
  | 'INTERNAL_ERROR';

const FAILURE_CODE_SET = new Set<ChatFailureCode>([
  'VALIDATION_ERROR',
  'INSUFFICIENT_CREDITS',
  'OPERATION_CONFLICT',
  'RATE_LIMITED',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_TIMEOUT',
  'INVALID_AI_OUTPUT',
  'INTERNAL_ERROR',
]);

const SAFE_FAILURE_MESSAGES: Record<ChatFailureCode, string> = {
  VALIDATION_ERROR: 'The request could not be validated.',
  INSUFFICIENT_CREDITS: 'Not enough credits to complete this request.',
  OPERATION_CONFLICT: 'The operation key was already used for a different request.',
  RATE_LIMITED: 'Too many requests. Please try again shortly.',
  PROVIDER_UNAVAILABLE: 'The AI service is temporarily unavailable.',
  PROVIDER_TIMEOUT: 'The AI service did not respond in time.',
  INVALID_AI_OUTPUT: 'The AI service returned an invalid response.',
  INTERNAL_ERROR: 'The request could not be completed.',
};

/** Safe code + message; never derived from a provider error string. */
class ChatTransportError extends Error {
  constructor(
    readonly code: ChatFailureCode,
    readonly httpStatus: number,
    message = SAFE_FAILURE_MESSAGES[code],
  ) {
    super(message);
  }

  getStatus(): number {
    return this.httpStatus;
  }
}

/**
 * Normalize an error before it is serialized. Only stable Nest HTTP statuses
 * and an explicit allowlist of codes are exposed; everything else is logged
 * with generic metadata and mapped to INTERNAL_ERROR.
 */
function toTransportError(error: unknown): ChatTransportError {
  if (error instanceof ChatTransportError) return error;

  const status = typeof (error as { getStatus?: () => unknown })?.getStatus === 'function'
    ? (error as { getStatus: () => unknown }).getStatus()
    : (error as { status?: unknown })?.status;

  if (status === 400 || error instanceof BadRequestException) {
    return new ChatTransportError('VALIDATION_ERROR', 400);
  }
  if (status === 403) {
    return new ChatTransportError('INSUFFICIENT_CREDITS', 403);
  }
  if (status === 404) {
    return new ChatTransportError('VALIDATION_ERROR', 404, 'Conversation not found.');
  }
  if (status === 409 || status === 422) {
    return new ChatTransportError('OPERATION_CONFLICT', 409);
  }
  if (status === 429) {
    return new ChatTransportError('RATE_LIMITED', 429);
  }
  if (status === 503) {
    return new ChatTransportError('PROVIDER_UNAVAILABLE', 503);
  }
  return new ChatTransportError('INTERNAL_ERROR', 500);
}

/** Reject free-text languages before they can reach the server prompt. */
function resolveControllerLanguage(language?: string): string {
  const value = (language || 'english').trim().toLowerCase();
  if (!CHAT_LANGUAGES.includes(value as (typeof CHAT_LANGUAGES)[number])) {
    throw new BadRequestException('Unsupported language');
  }
  return value;
}

/** Validate a client idempotency key before it reaches any storage or provider. */
function parseIdempotencyKey(value: string | undefined): string {
  const key = (value ?? '').trim();
  if (!key || key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new BadRequestException('A valid Idempotency-Key header is required');
  }
  if (!UUID_V4_LIKE.test(key) && !OPAQUE_KEY.test(key)) {
    throw new BadRequestException('A valid Idempotency-Key header is required');
  }
  return key;
}

/** Convert an operation error code to the allowlisted SSE code set. */
function operationFailureCode(raw: string | null | undefined): ChatFailureCode {
  if (raw && FAILURE_CODE_SET.has(raw as ChatFailureCode)) return raw as ChatFailureCode;
  // Provider timeout is the only ambiguous case; other provider errors are known.
  return 'INTERNAL_ERROR';
}

@ApiTags('Chat')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('chat')
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(
    private readonly chatService: ChatService,
    private readonly operations: AiOperationsService,
    private readonly policy: AiOperationsPolicy,
    private readonly tokens: TokensService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('send')
  @ApiOperation({ summary: 'Send message to AI tutor (legacy non-stream contract)' })
  async send(
    @CurrentUser('id') userId: string,
    @Body() dto: SendChatDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const candidate = dto as unknown as Partial<StreamChatDto> & SendChatDto;
    const key = parseIdempotencyKey(idempotencyKey ?? candidate.idempotencyKey);
    const lastMessage = Array.isArray(candidate.messages)
      ? candidate.messages[candidate.messages.length - 1]?.content ?? ''
      : '';
    const turn: StreamChatDto = {
      conversationId: candidate.conversationId,
      language: candidate.language,
      message: candidate.message ?? lastMessage,
    };

    let operation: ReservedChatOperation;
    try {
      operation = await this.reserveOperation(userId, key, turn);
    } catch (error) {
      throw toTransportError(error);
    }

    // A completed replay already has a durable assistant message and a single
    // debit. Never call the provider or finalize the operation again.
    if (operation.status === 'SUCCEEDED') {
      const saved = await this.readReplayResult(userId, operation);
      if (!saved) {
        throw new ChatTransportError('OPERATION_CONFLICT', 409,
          'The saved result for this operation is no longer available.');
      }
      const balance = await this.currentBalance(userId);
      return {
        conversationId: operation.conversationId,
        messageId: saved.messageId,
        assistantContent: saved.content,
        operationId: operation.operationId,
        balance,
      };
    }

    const result = await this.chatService.sendMessage(userId, turn);
    const settled = await this.operations.markTerminal(
      userId,
      operation.operationId,
      operation.version,
      operation.leaseToken,
      'SUCCEEDED',
      { resultRef: result.messageId },
    );
    const balance = await this.currentBalance(userId);
    return { ...result, operationId: settled.operation.id, balance };
  }

  @Post('stream')
  @ApiOperation({ summary: 'Stream AI response via SSE with scoped idempotency' })
  async stream(
    @CurrentUser('id') userId: string,
    @Body() dto: StreamChatDto,
    @Headers('idempotency-key') idempotencyHeader: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const key = parseIdempotencyKey(idempotencyHeader ?? dto.idempotencyKey);

    // All validation and ownership checks happen BEFORE a debit or a provider
    // call. A rejected request never opens the SSE stream.
    let operation: ReservedChatOperation;
    try {
      operation = await this.reserveOperation(userId, key, dto);
    } catch (error) {
      const failure = toTransportError(error);
      // Pre-flight failures are ordinary HTTP errors; the SSE contract only
      // applies after headers have been flushed.
      throw new ChatTransportError(failure.code, failure.httpStatus, failure.message);
    }
    const abort = new AbortController();
    const onClientClose = () => {
      if (!res.writableEnded) abort.abort();
    };
    req.on('aborted', onClientClose);
    res.on('close', onClientClose);

    let opened = false;
    let terminalSent = false;
    let heartbeat: NodeJS.Timeout | undefined;
    let deadline: NodeJS.Timeout | undefined;
    let queuedBytes = 0;
    let seq = 0;

    const writeEvent = (event: string, data: Record<string, unknown>): boolean => {
      if (res.destroyed || res.writableEnded || terminalSent) return false;
      const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      queuedBytes += Buffer.byteLength(payload);
      if (queuedBytes > MAX_QUEUED_BYTES) return false;
      const ok = res.write(payload);
      if (!ok || queuedBytes > MAX_QUEUED_BYTES) {
        // Backpressure: stop writing instead of buffering without bound. The
        // operation stays recoverable by key through the status endpoint.
        abort.abort();
        return false;
      }
      return true;
    };

    try {
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();
      opened = true;

      writeEvent('accepted', {
        operationId: operation.operationId,
        conversationId: operation.conversationId,
      });

      // Terminal SUCCEEDED replay: the operation already has one debit and one
      // committed assistant message. Emit the saved answer exactly once and
      // return without starting a second provider stream or finalizing again.
      if (operation.status === 'SUCCEEDED') {
        const saved = await this.readReplayResult(userId, operation);
        if (!saved) {
          writeEvent('failed', {
            operationId: operation.operationId,
            code: 'OPERATION_CONFLICT',
            message: 'The saved result for this operation is no longer available.',
          });
        } else {
          const text = saved.content.slice(0, MAX_DELTA_LENGTH);
          if (text) writeEvent('delta', { seq: (seq += 1), text });
          if (!abort.signal.aborted && !res.destroyed) {
            const balance = await this.currentBalance(userId);
            terminalSent = writeEvent('completed', {
              operationId: operation.operationId,
              messageId: saved.messageId,
              balance,
            });
          }
        }
        return;
      }

      heartbeat = setInterval(() => {
        if (!res.destroyed && !res.writableEnded) res.write(': ping\n\n');
      }, HEARTBEAT_MS);
      deadline = setTimeout(() => {
        this.logger.warn(`Chat stream deadline reached for operation ${operation.operationId}`);
        abort.abort();
      }, MAX_STREAM_SECONDS * 1000);

      const result = await this.chatService.sendStream(userId, dto, {
        signal: abort.signal,
        onDelta: async (delta) => {
          if (abort.signal.aborted || terminalSent || res.destroyed) return;
          const text = delta.slice(0, MAX_DELTA_LENGTH);
          if (text) writeEvent('delta', { seq: (seq += 1), text });
        },
        onCompleted: async (meta) => {
          // The service calls this only after its persistence transaction
          // commits. Finalize and announce completion only post-commit.
          await this.finalizeSuccess(userId, operation, meta.messageId);
          if (!abort.signal.aborted && !res.destroyed) {
            const balance = await this.currentBalance(userId);
            terminalSent = writeEvent('completed', {
              operationId: operation.operationId,
              messageId: meta.messageId,
              balance,
            });
          }
        },
      });

      if (result.errorCode) {
        const code = this.mapServiceError(result.errorCode);
        throw new ChatTransportError(code, 200);
      }

      if (!terminalSent) {
        // EOF without a committed result is never success: no completed event,
        // no assistant message was persisted by the service in that case.
        this.logger.warn(`Chat stream ended without a terminal event for operation ${operation.operationId}`);
        await this.failOperation(userId, operation, 'PROVIDER_TIMEOUT');
        if (!res.destroyed) {
          writeEvent('failed', {
            operationId: operation.operationId,
            code: 'PROVIDER_TIMEOUT',
            message: SAFE_FAILURE_MESSAGES.PROVIDER_TIMEOUT,
          });
          terminalSent = true;
        }
      }
    } catch (error) {
      const failure = toTransportError(error);
      if (!opened) throw failure;
      if (!terminalSent && !res.destroyed) {
        await this.failOperation(userId, operation, failure.code);
        writeEvent('failed', {
          operationId: operation.operationId,
          code: failure.code,
          message: failure.message,
        });
        terminalSent = true;
      }
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      if (deadline) clearTimeout(deadline);
      req.off('aborted', onClientClose);
      res.off('close', onClientClose);
      if (!res.writableEnded) res.end();
    }
  }

  /** Check conversation ownership before a debit or a provider call. */
  private async resolveOwnedConversation(
    userId: string,
    conversationId: string | null | undefined,
  ): Promise<string> {
    if (!conversationId) return '';
    const found = await this.prisma.chat_conversations.findFirst({
      where: { id: conversationId, user_id: userId },
      select: { id: true },
    });
    if (!found) throw new NotFoundException('Conversation not found');
    return found.id;
  }

  /**
   * Reserve credits through the AI operation layer before any provider stream
   * is started. History is read by ChatService from owned DB conversations, so
   * client-supplied messages are never trusted as prompt context.
   */
  private async reserveOperation(
    userId: string,
    key: string,
    dto: StreamChatDto,
  ): Promise<ReservedChatOperation> {
    const { conversationId: requestedConversation, language: requestedLanguage } = dto;
    const message = normalizeChatInput(dto.message);
    if (!message) throw new BadRequestException('A non-empty user message is required');

    const language = resolveControllerLanguage(requestedLanguage);
    const conversationId = await this.resolveOwnedConversation(
      userId,
      requestedConversation,
    );

    let reserved;
    try {
      reserved = await this.operations.findOrCreate(userId, {
        feature: CHAT_FEATURE,
        clientOperationId: key,
        language,
        conversationId,
        message,
      });
    } catch (error) {
      throw toTransportError(error);
    }

    const operation = reserved.operation;
    if (operation.conversation_id && operation.conversation_id !== conversationId) {
      throw new ConflictException('Operation key belongs to another conversation');
    }

    // Only a fresh RESERVED row gets a debit; a replayed operation never
    // charges a second time. The billing key is derived from the operation ID.
    if (reserved.created) {
      try {
        await this.tokens.reserveTokens(userId, {
          operationId: operation.id,
          user: userId,
          feature: CHAT_FEATURE,
          charge: operation.reserved_credits,
          status: operation.status,
        }, CHAT_FEATURE);
      } catch (error) {
        const failure = toTransportError(error);
        await this.operations.markTerminal(
          userId,
          operation.id,
          operation.version,
          this.policy.newLeaseToken(),
          'FAILED',
          { errorCode: failure.code },
        ).catch(() => undefined);
        throw failure;
      }
    }

    if (this.policy.isTerminal(operation.status)) {
      if (operation.status === 'SUCCEEDED') {
        return {
          operationId: operation.id,
          conversationId: operation.conversation_id ?? conversationId,
          version: operation.version,
          leaseToken: '',
          status: operation.status,
          resultRef: operation.result_ref,
          inProgress: false,
        };
      }
      throw new ChatTransportError(operationFailureCode(operation.error_code), 409);
    }

    // A live lease means another request already owns this operation and is
    // driving (or recovering) the single provider call. claimLease is
    // idempotent for the same token, so callers must inspect the row first:
    // a second stream here would run the provider twice under the same key.
    const liveLease =
      operation.lease_token !== null &&
      operation.lease_until !== null &&
      operation.lease_until.getTime() > Date.now() &&
      (operation.status === 'RUNNING' || operation.status === 'UNKNOWN');
    if (liveLease) {
      throw new ChatTransportError(
        'OPERATION_CONFLICT',
        409,
        'The operation is already in progress; retry with the same key after it completes.',
      );
    }

    try {
      const claimed = await this.operations.claimLease(userId, operation.id, operation.version);
      return {
        operationId: operation.id,
        conversationId: operation.conversation_id ?? conversationId,
        version: claimed.operation.version,
        leaseToken: claimed.leaseToken,
        status: claimed.operation.status,
        resultRef: claimed.operation.result_ref,
        inProgress: false,
      };
    } catch (error) {
      throw toTransportError(error);
    }
  }

  /**
   * Read the committed assistant message by the operation's result reference.
   * Ownership is checked through the conversation, and a deleted row degrades
   * to null so the replay handler can surface a safe conflict instead of a
   * provider error.
   */
  private async readReplayResult(
    userId: string,
    operation: ReservedChatOperation,
  ): Promise<ReplayResult | null> {
    if (!operation.resultRef) return null;
    const message = await this.prisma.chat_messages.findFirst({
      where: {
        id: operation.resultRef,
        role: 'assistant',
        chat_conversations: { user_id: userId },
      },
      select: { id: true, content: true },
    });
    if (!message) return null;
    return { messageId: message.id, content: message.content };
  }

  /** Finalize a successful turn; only then may the transport emit completed. */
  private async finalizeSuccess(
    userId: string,
    operation: { operationId: string; version: number; leaseToken: string },
    messageId: string,
  ): Promise<void> {
    if (!operation.leaseToken) return;
    try {
      await this.operations.markTerminal(
        userId,
        operation.operationId,
        operation.version,
        operation.leaseToken,
        'SUCCEEDED',
        { resultRef: messageId || null },
      );
      await this.tokens.settleTokens(userId, {
        operationId: operation.operationId,
        user: userId,
        feature: CHAT_FEATURE,
        charge: this.policy.getCost(CHAT_FEATURE),
        status: 'RUNNING',
      }, CHAT_FEATURE);
    } catch (error) {
      this.logger.warn(`Failed to finalize chat operation ${operation.operationId}`);
      throw new ChatTransportError('INTERNAL_ERROR', 500);
    }
  }

  /** Mark an operation failed with a safe code; refunds follow policy. */
  private async failOperation(
    userId: string,
    operation: { operationId: string; version: number; leaseToken: string },
    code: ChatFailureCode,
  ): Promise<void> {
    if (!operation.leaseToken) return;
    try {
      await this.operations.markTerminal(
        userId,
        operation.operationId,
        operation.version,
        operation.leaseToken,
        code === 'PROVIDER_TIMEOUT' ? 'UNKNOWN' : 'FAILED',
        { errorCode: code },
      );
    } catch (error) {
      this.logger.warn(`Failed to terminalize chat operation ${operation.operationId}`);
    }
  }

  private async currentBalance(userId: string): Promise<number | undefined> {
    try {
      return (await this.tokens.getBalance(userId)).balance;
    } catch {
      return undefined;
    }
  }

  private mapServiceError(code: string): ChatFailureCode {
    if (code === 'AI_UNAVAILABLE') return 'PROVIDER_UNAVAILABLE';
    if (code === 'INVALID_REQUEST') return 'VALIDATION_ERROR';
    if (code === 'AI_FAILED') return 'INTERNAL_ERROR';
    return operationFailureCode(code);
  }

  /**
   * Recover the outcome of a chat operation after a lost SSE connection.
   * Status and result are read only from committed DB state: this endpoint
   * never starts a provider call, charges credits or mutates the operation.
   */
  @Get('operations/:operationId')
  @ApiOperation({ summary: 'Get the persisted status and result of a chat operation' })
  async getOperationStatus(
    @CurrentUser('id') userId: string,
    @Param('operationId', ParseUUIDPipe) operationId: string,
  ) {
    // The ledger delegate is gated behind db:generate, so use the same
    // defensive access as AiOperationsRepository. Reading the row without a
    // user filter is deliberate: an unknown id is 404, another user's id is 403.
    const delegate = (this.prisma as unknown as Record<string, unknown>)['ai_operations'] as
      | {
          findUnique: (args: {
            where: { id: string };
            select: Record<string, boolean>;
          }) => Promise<{
            id: string;
            user_id: string;
            status: string;
            result_ref: string | null;
          } | null>;
        }
      | undefined;
    if (!delegate) throw new NotFoundException('AI operation not found');

    const operation = await delegate.findUnique({
      where: { id: operationId },
      select: { id: true, user_id: true, status: true, result_ref: true },
    });
    if (!operation) throw new NotFoundException('AI operation not found');
    if (operation.user_id !== userId) {
      throw new ForbiddenException('AI operation belongs to another user');
    }

    let result: { messageId: string; role: string; content: string } | null = null;
    if (operation.result_ref) {
      const message = await this.prisma.chat_messages.findUnique({
        where: { id: operation.result_ref },
        select: { id: true, role: true, content: true },
      });
      if (message) {
        result = { messageId: message.id, role: message.role, content: message.content };
      }
    }

    return {
      data: {
        operationId: operation.id,
        status: operation.status,
        result,
      },
    };
  }

  @Get('conversations')
  @ApiOperation({ summary: 'Get all conversations' })
  getConversations(@CurrentUser('id') userId: string) {
    return this.chatService.getConversations(userId);
  }

  @Get('conversations/:id/messages')
  @ApiOperation({ summary: 'Get messages in a conversation' })
  getMessages(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.chatService.getMessages(userId, id);
  }

  @Delete('conversations/:id')
  @ApiOperation({ summary: 'Delete a conversation' })
  delete(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.chatService.deleteConversation(userId, id);
  }
}
