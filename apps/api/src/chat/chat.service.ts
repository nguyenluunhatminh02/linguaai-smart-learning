import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GroqService } from '../common/services/groq.service';
import { SendChatDto } from './dto/chat.dto';

const MAX_CHAT_MESSAGES = 50;

/**
 * Sanitize user input to prevent prompt injection attacks
 */
function sanitizeUserInput(input: string): string {
  if (!input) return '';
  return input
    .replace(/<[^>]*>/g, '') // Remove HTML/XML tags
    .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
    .slice(0, 2000); // Limit length
}

@Injectable()
export class ChatService {
  constructor(
    private prisma: PrismaService,
    private groqService: GroqService,
  ) {}

  async sendMessage(userId: string, dto: SendChatDto) {
    // Enforce message limit to prevent unbounded chat
    const messages = dto.messages.slice(-MAX_CHAT_MESSAGES);

    // Sanitize all user messages to prevent prompt injection
    const sanitizedMessages = messages.map(m => ({
      ...m,
      content: sanitizeUserInput(m.content),
    }));

    // Get or create conversation
    let conversationId: string;
    if (dto.conversationId) {
      const found = await this.prisma.chat_conversations.findFirst({
        where: { id: dto.conversationId, user_id: userId },
      });
      if (!found) throw new NotFoundException('Conversation not found');
      conversationId = found.id;
    } else {
      const conv = await this.prisma.chat_conversations.create({
        data: {
          user_id: userId,
          title: sanitizedMessages[0]?.content?.slice(0, 50) || 'New Conversation',
        },
      });
      conversationId = conv.id;
    }

    // Save user message
    const lastUserMsg = sanitizedMessages[sanitizedMessages.length - 1];
    if (lastUserMsg?.role === 'user') {
      await this.prisma.chat_messages.create({
        data: { conversation_id: conversationId, role: 'user', content: lastUserMsg.content },
      });
    }

    // Call Groq directly with sanitized messages
    const systemPrompt = `You are an expert language tutor helping the user learn ${
      sanitizeUserInput(dto.language || 'english')
    }. Provide helpful, clear, and encouraging responses. Use examples when appropriate.`;
    const assistantContent = await this.groqService.chat(
      sanitizedMessages.map((m) => ({ role: m.role, content: m.content })),
      systemPrompt,
    );
    await this.prisma.chat_messages.create({
      data: { conversation_id: conversationId, role: 'assistant', content: assistantContent },
    });

    return { conversationId, response: assistantContent };
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
    await this.prisma.chat_conversations.delete({ where: { id: conversationId } });
  }
}
