import { Test, TestingModule } from "@nestjs/testing";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { CardsService } from "./cards.service";
import { PrismaService } from "../prisma/prisma.service";
import { DecksService } from "../decks/decks.service";
import { AiClientService } from "../common/services/ai-client.service";
import { TokensService } from "../tokens/tokens.service";

/**
 * SEC-02 regression suite: card writes must enforce deck ownership inside the
 * service. Controller-only checks are not sufficient because a service called
 * from any other path (job, script, future handler) would otherwise mutate
 * another user's deck. Public decks may be read/reviewed by anyone but must
 * never be editable by a non-owner.
 */
describe("CardsService ownership", () => {
  let service: CardsService;

  const OWNER = "user-owner";
  const OTHER = "user-other";
  const DECK_ID = "11111111-1111-4111-8111-111111111111";
  const CARD_ID = "22222222-2222-4222-8222-222222222222";

  const ownedDeck = { id: DECK_ID, creator_id: OWNER, is_public: false };
  const ownedCard = {
    id: CARD_ID,
    deck_id: DECK_ID,
    retired_at: null,
    front_text: "Hello",
    back_text: "Xin chào",
    decks: { creator_id: OWNER, is_public: false },
  };

  const tx = {
    cards: {
      create: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findMany: jest.fn(),
    },
    decks: { update: jest.fn() },
  };

  const mockPrisma = {
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    decks: { findUnique: jest.fn() },
    cards: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    user_card_progress: { count: jest.fn() },
    srs_review_events: { count: jest.fn() },
  };

  // Mirrors the real DecksService.findById: private decks are hidden (404),
  // public decks are readable but still rejected by the ownership guard (403).
  const mockDecksService = {
    findById: jest.fn(async (id: string, userId?: string) => {
      const deck = await mockPrisma.decks.findUnique({ where: { id } });
      if (!deck) throw new NotFoundException("Deck not found");
      if (!userId || !deck.is_public) {
        if (!userId || deck.creator_id !== userId) throw new NotFoundException("Deck not found");
      }
      return deck;
    }),
  };

  const mockAiClient = { post: jest.fn() };
  const mockTokensService = { consumeTokens: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CardsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: DecksService, useValue: mockDecksService },
        { provide: AiClientService, useValue: mockAiClient },
        { provide: TokensService, useValue: mockTokensService },
      ],
    }).compile();
    service = module.get<CardsService>(CardsService);

    mockPrisma.decks.findUnique.mockResolvedValue(ownedDeck);
    mockPrisma.cards.findUnique.mockResolvedValue(ownedCard);
    mockPrisma.cards.findMany.mockResolvedValue([]);
    mockPrisma.cards.update.mockResolvedValue(ownedCard);
    mockPrisma.user_card_progress.count.mockResolvedValue(0);
    mockPrisma.srs_review_events.count.mockResolvedValue(0);
    tx.cards.create.mockResolvedValue(ownedCard);
    tx.cards.createMany.mockResolvedValue({ count: 1 });
    tx.cards.findMany.mockResolvedValue([ownedCard]);
    tx.cards.update.mockResolvedValue(ownedCard);
    mockAiClient.post.mockResolvedValue({
      cards: [{ front: "Hello", back: "Xin chào", example: "", pronunciation: "" }],
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("lets the owner create a card", async () => {
    await expect(
      service.create(DECK_ID, { frontText: "Hello", backText: "Xin chào" } as any, OWNER),
    ).resolves.toEqual(ownedCard);
    expect(mockDecksService.findById).toHaveBeenCalledWith(DECK_ID, OWNER);
    expect(tx.cards.create).toHaveBeenCalled();
  });

  it("rejects a cross-user create with no writes", async () => {
    await expect(
      service.create(DECK_ID, { frontText: "Hello", backText: "Xin chào" } as any, OTHER),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(tx.cards.create).not.toHaveBeenCalled();
    expect(tx.decks.update).not.toHaveBeenCalled();

    // A public deck is visible but still not writable by a non-owner.
    mockPrisma.decks.findUnique.mockResolvedValueOnce({ ...ownedDeck, is_public: true });
    await expect(
      service.create(DECK_ID, { frontText: "Hello", backText: "Xin chào" } as any, OTHER),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a create without a caller identity", async () => {
    await expect(
      service.create(DECK_ID, { frontText: "Hello", backText: "Xin chào" } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a cross-user bulk create with no writes", async () => {
    await expect(
      service.bulkCreate(DECK_ID, [{ frontText: "A", backText: "B" } as any], OTHER),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.cards.createMany).not.toHaveBeenCalled();
    expect(tx.decks.update).not.toHaveBeenCalled();
  });

  it("lets the owner bulk-create cards", async () => {
    await expect(
      service.bulkCreate(DECK_ID, [{ frontText: "A", backText: "B" } as any], OWNER),
    ).resolves.toEqual([ownedCard]);
    expect(tx.cards.createMany).toHaveBeenCalled();
  });

  it("rejects a cross-user update with no writes", async () => {
    await expect(
      service.update(CARD_ID, { frontText: "Changed" } as any, OTHER),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(mockPrisma.cards.update).not.toHaveBeenCalled();
    expect(tx.cards.update).not.toHaveBeenCalled();

    mockPrisma.cards.findUnique.mockResolvedValueOnce({
      ...ownedCard,
      decks: { creator_id: OWNER, is_public: true },
    });
    await expect(
      service.update(CARD_ID, { frontText: "Changed" } as any, OTHER),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(mockPrisma.cards.update).not.toHaveBeenCalled();
  });

  it("lets the owner update a card", async () => {
    await expect(
      service.update(CARD_ID, { frontText: "Changed" } as any, OWNER),
    ).resolves.toEqual(ownedCard);
    expect(mockPrisma.cards.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: CARD_ID } }),
    );
  });

  it("rejects a cross-user delete with no writes", async () => {
    await expect(service.remove(CARD_ID, OTHER)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(tx.cards.delete).not.toHaveBeenCalled();
    expect(tx.cards.update).not.toHaveBeenCalled();
    expect(tx.decks.update).not.toHaveBeenCalled();
  });

  it("lets the owner delete a card", async () => {
    // remove() commits the transaction and returns void; assert the write side
    // effects instead of a returned value.
    await expect(service.remove(CARD_ID, OWNER)).resolves.toBeUndefined();
    expect(tx.cards.delete).toHaveBeenCalledWith({ where: { id: CARD_ID } });
    expect(tx.decks.update).toHaveBeenCalledWith({
      where: { id: DECK_ID },
      data: { card_count: { increment: -1 } },
    });
  });

  it("rejects a cross-user AI generation before calling the AI or charging tokens", async () => {
    await expect(
      service.generateFromText(
        DECK_ID,
        { text: "passage", count: 1 } as any,
        OTHER,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(mockAiClient.post).not.toHaveBeenCalled();
    expect(mockTokensService.consumeTokens).not.toHaveBeenCalled();
    expect(tx.cards.createMany).not.toHaveBeenCalled();
  });

  it("rejects AI generation without a caller identity", async () => {
    await expect(
      service.generateFromText(DECK_ID, { text: "passage", count: 1 } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(mockAiClient.post).not.toHaveBeenCalled();
  });

  it("lets the owner generate cards", async () => {
    const result = await service.generateFromText(
      DECK_ID,
      { text: "passage", count: 1 } as any,
      OWNER,
    );
    expect(result.generated).toBe(1);
    expect(mockTokensService.consumeTokens).toHaveBeenCalledWith(
      OWNER,
      "cards_generate",
      undefined,
      undefined,
    );
  });

  it("hides a private deck's cards from a non-owner", async () => {
    await expect(service.findByDeck(DECK_ID, OTHER)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(mockPrisma.cards.findMany).not.toHaveBeenCalled();
  });

  it("allows review of cards in a public deck by a non-owner", async () => {
    mockPrisma.decks.findUnique.mockResolvedValueOnce({ ...ownedDeck, is_public: true });

    await expect(service.findByDeck(DECK_ID, OTHER)).resolves.toEqual([]);
    expect(mockPrisma.cards.findMany).toHaveBeenCalled();
  });

  it("hides a private deck's card from a non-owner", async () => {
    await expect(service.findById(CARD_ID, OTHER)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
