import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DecksService } from './decks.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * SEC-02 regression suite: a valid deck id is not an authorization grant.
 * Ownership and visibility are checked at the service layer, not only in the
 * HTTP controller, so non-owners cannot read a private deck or mutate one.
 */
describe('DecksService ownership', () => {
  let service: DecksService;

  const OWNER = 'user-owner';
  const OTHER = 'user-other';
  const DECK_ID = '11111111-1111-4111-8111-111111111111';

  const privateDeck = {
    id: DECK_ID,
    creator_id: OWNER,
    is_public: false,
    title: 'Private deck',
    created_at: new Date(),
  };

  const mockPrisma = {
    decks: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    cards: { findMany: jest.fn() },
    review_sessions: { count: jest.fn() },
    user_card_progress: { count: jest.fn() },
    srs_review_events: { count: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DecksService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<DecksService>(DecksService);
    mockPrisma.decks.findUnique.mockResolvedValue(privateDeck);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('read access', () => {
    it('lets the owner read a private deck', async () => {
      await expect(service.findById(DECK_ID, OWNER)).resolves.toEqual(
        privateDeck,
      );
    });

    it('lets a non-owner read a public deck', async () => {
      const publicDeck = { ...privateDeck, is_public: true };
      mockPrisma.decks.findUnique.mockResolvedValueOnce(publicDeck);

      await expect(service.findById(DECK_ID, OTHER)).resolves.toEqual(
        publicDeck,
      );
    });

    it('hides a private deck from a non-owner even with a valid id', async () => {
      await expect(service.findById(DECK_ID, OTHER)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('hides a private deck when no caller identity is available', async () => {
      // findById's userId is optional for internal existence checks, but a
      // private deck must never be returned without an owner identity.
      await expect(service.findById(DECK_ID, '')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('still reports a missing deck as not found', async () => {
      mockPrisma.decks.findUnique.mockResolvedValueOnce(null);

      await expect(service.findById(DECK_ID, OWNER)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('findAll returns only own decks and public decks', async () => {
      mockPrisma.decks.findMany.mockResolvedValueOnce([]);
      mockPrisma.decks.count.mockResolvedValueOnce(0);

      await service.findAll(OTHER, 1, 20);

      const expectedWhere = {
        OR: [{ creator_id: OTHER }, { is_public: true }],
      };
      expect(mockPrisma.decks.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expectedWhere }),
      );
      expect(mockPrisma.decks.count).toHaveBeenCalledWith({
        where: expectedWhere,
      });
    });
  });

  describe('mutations', () => {
    it('rejects a cross-user update with no database write', async () => {
      // A private deck is hidden as 404; a public one is denied as 403.
      await expect(
        service.update(DECK_ID, OTHER, { title: 'Taken over' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      mockPrisma.decks.findUnique.mockResolvedValueOnce({
        ...privateDeck,
        is_public: true,
      });
      await expect(
        service.update(DECK_ID, OTHER, { title: 'Taken over' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(mockPrisma.decks.update).not.toHaveBeenCalled();
    });

    it('rejects a cross-user delete with no database write', async () => {
      await expect(service.remove(DECK_ID, OTHER)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      mockPrisma.decks.findUnique.mockResolvedValueOnce({
        ...privateDeck,
        is_public: true,
      });
      await expect(service.remove(DECK_ID, OTHER)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(mockPrisma.cards.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.decks.delete).not.toHaveBeenCalled();
      expect(mockPrisma.decks.update).not.toHaveBeenCalled();
    });

    it('allows the owner to update a deck', async () => {
      mockPrisma.decks.update.mockResolvedValueOnce(privateDeck);

      await expect(
        service.update(DECK_ID, OWNER, { title: 'Renamed' }),
      ).resolves.toEqual(privateDeck);
      expect(mockPrisma.decks.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: DECK_ID } }),
      );
    });

    it('rejects a delete of an unknown deck', async () => {
      mockPrisma.decks.findUnique.mockResolvedValueOnce(null);

      await expect(service.remove(DECK_ID, OWNER)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(mockPrisma.decks.delete).not.toHaveBeenCalled();
    });

    it("unlists a public deck instead of deleting other learners' progress", async () => {
      mockPrisma.decks.findUnique.mockResolvedValueOnce({
        ...privateDeck,
        is_public: true,
      });
      mockPrisma.cards.findMany.mockResolvedValueOnce([{ id: 'card-1' }]);
      mockPrisma.review_sessions.count.mockResolvedValueOnce(0);
      mockPrisma.user_card_progress.count.mockResolvedValueOnce(1);
      mockPrisma.srs_review_events.count.mockResolvedValueOnce(0);
      mockPrisma.decks.update.mockResolvedValueOnce({
        id: DECK_ID,
        is_public: false,
      });

      await service.remove(DECK_ID, OWNER);

      expect(mockPrisma.decks.update).toHaveBeenCalledWith({
        where: { id: DECK_ID },
        data: { is_public: false },
      });
      expect(mockPrisma.decks.delete).not.toHaveBeenCalled();
    });
  });
});
