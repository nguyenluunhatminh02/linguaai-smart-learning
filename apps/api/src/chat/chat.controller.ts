import { Controller, Post, Get, Delete, Body, Param, UseGuards, ParseUUIDPipe, Res, Headers, BadRequestException, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { ChatService } from './chat.service';
import { SendChatDto } from './dto/chat.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { GroqService } from '../common/services/groq.service';
import { TokensService } from '../tokens/tokens.service';

/** Languages that may be interpolated into the tutor system prompt. */
const ALLOWED_LANGUAGES = new Set([
  'english', 'vietnamese', 'japanese', 'korean', 'french', 'spanish',
  'german', 'chinese', 'italian', 'portuguese', 'russian',
]);

/** Maximum number of messages forwarded to the LLM and retained per request. */
const MAX_CHAT_MESSAGES = 50;

/**
 * Resolve a language to an allowlisted value before it reaches the system prompt.
 * Free-text language values would allow instruction injection into the prompt.
 */
function resolveLanguage(language?: string): string {
  const value = (language || 'english').trim().toLowerCase();
  if (!ALLOWED_LANGUAGES.has(value)) {
    throw new BadRequestException(
      `Unsupported language. Supported languages: ${[...ALLOWED_LANGUAGES].join(', ')}`,
    );
  }
  return value;
}

/**
 * Normalize message content: strip markup/control characters and cap length.
 * This is input hygiene only — it does not (and cannot) prevent prompt injection.
 */
function normalizeUserInput(input: string): string {
  if (!input) return '';
  return input
    .replace(/<[^>]*>/g, '') // Remove HTML/XML tags
    .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
    .slice(0, 2000); // Limit length
}

@ApiTags('Chat')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('chat')
export class ChatController {
  constructor(
    private chatService: ChatService,
    private groqService: GroqService,
    private tokensService: TokensService,
  ) {}

  @Post('send')
  @ApiOperation({ summary: 'Send message to AI tutor' })
  async send(
    @CurrentUser('id') userId: string,
    @Body() dto: SendChatDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    // Validate the language before spending tokens so an invalid request cannot
    // consume a user's balance.
    dto.language = resolveLanguage(dto.language);
    // Idempotency keys are globally unique in the DB; scope them per user so
    // one user cannot replay another user's key and skip token deduction.
    const scopedKey = idempotencyKey ? `${userId}:${idempotencyKey}` : undefined;
    await this.tokensService.consumeTokens(userId, 'ai_chat', undefined, scopedKey);
    return this.chatService.sendMessage(userId, dto);
  }

  @Post('stream')
  @ApiOperation({ summary: 'Stream AI response via SSE' })
  async stream(
    @CurrentUser('id') userId: string,
    @Body() dto: SendChatDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    // Validate before opening the stream so an invalid language cannot reach
    // the system prompt and an unbounded history cannot reach Groq.
    const language = resolveLanguage(dto.language);
    const systemPrompt = `You are an expert language tutor helping the user learn ${language}. Provide helpful, clear, and encouraging responses. Use examples when appropriate.`;

    const normalizedMessages = dto.messages
      .slice(-MAX_CHAT_MESSAGES)
      .map(m => ({ role: m.role, content: normalizeUserInput(m.content) }));

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Stop pulling/writing tokens as soon as the client disconnects.
    let clientDisconnected = false;
    const onClose = () => { clientDisconnected = true; };
    req.on('close', onClose);
    req.on('aborted', onClose);

    try {
      for await (const token of this.groqService.chatStream(
        normalizedMessages,
        systemPrompt,
      )) {
        if (clientDisconnected || res.destroyed) break;
        res.write(`data: ${JSON.stringify({ token })}\n\n`);
      }
      if (!clientDisconnected && !res.destroyed) {
        res.write('data: [DONE]\n\n');
      }
    } catch (err) {
      if (!clientDisconnected && !res.destroyed) {
        res.write(`data: ${JSON.stringify({ error: String(err) })}\n\n`);
      }
    } finally {
      req.off('close', onClose);
      req.off('aborted', onClose);
      if (!res.writableEnded) res.end();
    }
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
