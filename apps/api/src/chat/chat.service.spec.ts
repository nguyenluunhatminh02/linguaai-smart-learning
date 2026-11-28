import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ChatService } from './chat.service';
import { PrismaService } from '../prisma/prisma.service';
import { GroqService } from '../common/services/groq.service';
import { StreamChatDto } from './dto/chat.dto';

/**
 * SEC-02: a conversation is a private resource of its creator. These tests
 * model two authenticated users hitting the same conversation UUID; the
 * database mock resolves a scoped lookup to null for the non-owner.
 */
const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const CONVERSATION_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('ChatService ownership (SEC-02)', () => {
  let service: ChatService;
  let prisma: PrismaService;
  let groq: GroqService;

  const mockPrisma = {
    $transaction: jest.fn(),
    chat_conversations: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    chat_messages: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
  };

  const mockGroq = {
    chat: jest.fn(),
    chatStream: jest.fn(),
  };

  beforeEach(async () => {
    mockPrisma.$transaction.mockImplementation((callback: any) =>
      callback(mockPrisma),
    );
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: GroqService, useValue: mockGroq },
      ],
    }).compile();

    service = module.get<ChatService>(ChatService);
    prisma = module.get<PrismaService>(PrismaService);
    groq = module.get<GroqService>(GroqService);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  const ownedTurn: StreamChatDto = {
    conversationId: CONVERSATION_A,
    message: 'Hello tutor',
    language: 'english',
  };

  describe('sendMessage', () => {
    it("rejects a turn on user A's conversation for user B without calling the provider or writing messages", async () => {
      // The owner-scoped lookup finds nothing for B even though the UUID exists.
      mockPrisma.chat_conversations.findFirst.mockResolvedValue(null);

      await expect(service.sendMessage(USER_B, ownedTurn)).rejects.toBeInstanceOf(
        NotFoundException,
      );

      expect(prisma.chat_conversations.findFirst).toHaveBeenCalledWith({
        where: { id: CONVERSATION_A, user_id: USER_B },
        select: { id: true },
      });
      expect(groq.chat).not.toHaveBeenCalled();
      expect(prisma.chat_messages.create).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.chat_conversations.create).not.toHaveBeenCalled();
    });

    it('lets user A send a turn in their own conversation', async () => {
      mockPrisma.chat_conversations.findFirst.mockResolvedValue({
        id: CONVERSATION_A,
      });
      mockPrisma.chat_messages.findMany.mockResolvedValue([]);
      mockGroq.chat.mockResolvedValue('Bonjour !');
      mockPrisma.chat_messages.create
        .mockResolvedValueOnce({ id: 'user-message' })
        .mockResolvedValueOnce({ id: 'assistant-message' });

      const result = await service.sendMessage(USER_A, ownedTurn);

      expect(prisma.chat_conversations.findFirst).toHaveBeenCalledWith({
        where: { id: CONVERSATION_A, user_id: USER_A },
        select: { id: true },
      });
      expect(groq.chat).toHaveBeenCalled();
      expect(prisma.chat_messages.create).toHaveBeenCalledTimes(2);
      expect(prisma.chat_messages.create).toHaveBeenCalledWith({
        data: {
          conversation_id: CONVERSATION_A,
          role: 'user',
          content: 'Hello tutor',
        },
        select: { id: true },
      });
      expect(result).toEqual({
        conversationId: CONVERSATION_A,
        messageId: 'assistant-message',
        assistantContent: 'Bonjour !',
      });
    });

    it('attributes a new conversation to the authenticated user, never to another user', async () => {
      mockPrisma.chat_conversations.create.mockResolvedValue({
        id: 'new-conversation',
      });
      mockPrisma.chat_messages.findMany.mockResolvedValue([]);
      mockGroq.chat.mockResolvedValue('Bonjour !');
      mockPrisma.chat_messages.create.mockResolvedValue({ id: 'message' });

      await service.sendMessage(USER_B, { ...ownedTurn, conversationId: null });

      expect(prisma.chat_conversations.create).toHaveBeenCalledWith({
        data: { user_id: USER_B, title: 'Hello tutor' },
        select: { id: true },
      });
      expect(prisma.chat_conversations.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ user_id: USER_A }) }),
      );
    });
  });

  describe('sendStream', () => {
    it("rejects a stream on user A's conversation for user B before opening the provider stream", async () => {
      mockPrisma.chat_conversations.findFirst.mockResolvedValue(null);

      await expect(service.sendStream(USER_B, ownedTurn)).rejects.toBeInstanceOf(
        NotFoundException,
      );

      expect(prisma.chat_conversations.findFirst).toHaveBeenCalledWith({
        where: { id: CONVERSATION_A, user_id: USER_B },
        select: { id: true },
      });
      expect(groq.chatStream).not.toHaveBeenCalled();
      expect(prisma.chat_messages.create).not.toHaveBeenCalled();
    });
  });

  describe('getMessages', () => {
    it("does not return user A's messages to user B", async () => {
      mockPrisma.chat_conversations.findFirst.mockResolvedValue(null);

      await expect(
        service.getMessages(USER_B, CONVERSATION_A),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.chat_conversations.findFirst).toHaveBeenCalledWith({
        where: { id: CONVERSATION_A, user_id: USER_B },
      });
      expect(prisma.chat_messages.findMany).not.toHaveBeenCalled();
    });

    it('returns history to the owner of the conversation', async () => {
      const history = [{ role: 'user', content: 'Hello', created_at: new Date() }];
      mockPrisma.chat_conversations.findFirst.mockResolvedValue({
        id: CONVERSATION_A,
      });
      mockPrisma.chat_messages.findMany.mockResolvedValue(history);

      await expect(service.getMessages(USER_A, CONVERSATION_A)).resolves.toEqual(
        history,
      );
      expect(prisma.chat_messages.findMany).toHaveBeenCalledWith({
        where: { conversation_id: CONVERSATION_A },
        orderBy: { created_at: 'asc' },
      });
    });
  });

  describe('getConversations', () => {
    it('lists only conversations belonging to the authenticated user', async () => {
      mockPrisma.chat_conversations.findMany.mockResolvedValue([]);

      await service.getConversations(USER_B);

      expect(prisma.chat_conversations.findMany).toHaveBeenCalledWith({
        where: { user_id: USER_B },
        orderBy: { created_at: 'desc' },
        take: 50,
      });
      expect(prisma.chat_conversations.findMany).not.toHaveBeenCalledWith(
        expect.objectContaining({ where: { user_id: USER_A } }),
      );
    });
  });

  describe('deleteConversation', () => {
    it("does not let user B delete user A's conversation", async () => {
      mockPrisma.chat_conversations.findFirst.mockResolvedValue(null);

      await expect(
        service.deleteConversation(USER_B, CONVERSATION_A),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.chat_conversations.findFirst).toHaveBeenCalledWith({
        where: { id: CONVERSATION_A, user_id: USER_B },
      });
      expect(prisma.chat_conversations.delete).not.toHaveBeenCalled();
    });

    it('deletes the conversation for its owner', async () => {
      mockPrisma.chat_conversations.findFirst.mockResolvedValue({
        id: CONVERSATION_A,
      });
      mockPrisma.chat_conversations.delete.mockResolvedValue({ id: CONVERSATION_A });

      await service.deleteConversation(USER_A, CONVERSATION_A);

      expect(prisma.chat_conversations.findFirst).toHaveBeenCalledWith({
        where: { id: CONVERSATION_A, user_id: USER_A },
      });
      expect(prisma.chat_conversations.delete).toHaveBeenCalledWith({
        where: { id: CONVERSATION_A },
      });
    });
  });
});
