// @ts-nocheck
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { CardsService } from '../cards/cards.service';
import { DecksService } from '../decks/decks.service';
import {
  CARD_SUGGESTION_STATUSES,
  ErrorToCardService,
  canonicalSuggestionKey,
  normalizeCardText,
} from './error-to-card.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222';
const SUGGESTION_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_SUGGESTION_ID = '44444444-4444-4444-8444-444444444444';
const DECK_ID = '55555555-5555-4555-8555-555555555555';
const CARD_ID = '66666666-6666-4666-8666-666666666666';
const NOW = new Date('2026-11-28T00:00:00.000Z');

const suggestionRow = (overrides = {}) => ({
  id: SUGGESTION_ID,
  user_id: USER_ID,
  source_type: 'writing',
  source_id: 'submission-1',
  language: 'english',
  knowledge_code: 'en.grammar.past_simple',
  error_type: 'grammar',
  error_excerpt: 'Yesterday I go to school',
  correction: 'Yesterday I went to school',
  explanation: 'Use the past tense with yesterday',
  confidence: 0.8,
  front_text: 'Yesterday I ___ to school. (go)',
  back_text: 'went',
  example_sentence: 'Yesterday I went to school',
  canonical_key: canonicalSuggestionKey(
    USER_ID,
    'en.grammar.past_simple',
    'Yesterday I ___ to school. (go)',
    'went',
  ),
  status: 'PENDING',
  card_id: null,
  deck_id: null,
  created_at: NOW,
  updated_at: NOW,
  ...overrides,
});

/**
 * PRODUCT-05: raw SQL needs PostgreSQL, so these tests drive the service with
 * a mocked PrismaService and assert query shape, bound values, dedup identity
 * and the accept/edit/reject state machine. No live database is required.
 */
describe('ErrorToCardService', () => {
  let service: ErrorToCardService;
  let prisma: any;
  let cards: any;
  let decks: any;

  const queries = () =>
    prisma.$queryRaw.mock.calls.map((call) => String(call[0]));
  const values = (call: number) => prisma.$queryRaw.mock.calls[call].slice(1);

  beforeEach(async () => {
    prisma = {
      $queryRaw: jest.fn(),
      $transaction: jest.fn((callback) => callback(prisma)),
    };
    cards = { create: jest.fn().mockResolvedValue({ id: CARD_ID }) };
    decks = { findById: jest.fn().mockResolvedValue({ id: DECK_ID }) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ErrorToCardService,
        { provide: PrismaService, useValue: prisma },
        { provide: CardsService, useValue: cards },
        { provide: DecksService, useValue: decks },
      ],
    }).compile();
    service = module.get<ErrorToCardService>(ErrorToCardService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  describe('canonicalSuggestionKey and normalizeCardText', () => {
    it('normalizes case/whitespace and scopes the key to the learner and knowledge code', () => {
      expect(normalizeCardText('  Yesterday   I\tGO  ')).toBe('yesterday i go');
      const key = canonicalSuggestionKey(
        USER_ID,
        'EN.Grammar.Past_Simple',
        '  Front ',
        'Back',
      );
      expect(key).toBe(
        canonicalSuggestionKey(USER_ID, 'en.grammar.past_simple', 'front', 'back'),
      );
      expect(key).toMatch(/^[0-9a-f]{64}$/);
      expect(
        canonicalSuggestionKey(
          OTHER_USER_ID,
          'en.grammar.past_simple',
          'front',
          'back',
        ),
      ).not.toBe(key);
      expect(
        canonicalSuggestionKey(USER_ID, 'en.grammar.other', 'front', 'back'),
      ).not.toBe(key);
    });
  });

  describe('suggestFromErrors — one error, one suggestion', () => {
    const error = (overrides = {}) => ({
      original: 'Yesterday I go to school',
      correction: 'Yesterday I went to school',
      explanation: 'Use the past tense with yesterday',
      type: 'grammar',
      knowledgeCode: 'en.grammar.past_simple',
      confidence: 0.8,
      frontText: 'Yesterday I ___ to school. (go)',
      backText: 'went',
      ...overrides,
    });

    it('inserts exactly one PENDING row for one error, with bounded fields, canonical key and advisory lock', async () => {
      const row = suggestionRow();
      // lock, SELECT existing, INSERT
      prisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([row]);

      const result = await service.suggestFromErrors(
        USER_ID,
        'writing',
        'submission-1',
        [error()],
        'english',
      );

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(queries()).toHaveLength(3);
      expect(queries()[0]).toContain('pg_advisory_xact_lock');
      expect(values(0)).toContain(`card-suggestion:${USER_ID}`);
      expect(queries()[1]).toContain("status = 'PENDING'");
      expect(queries()[1]).toContain('canonical_key');
      expect(queries()[2]).toContain('INSERT INTO card_suggestions');
      expect(values(2)).toEqual(
        expect.arrayContaining([
          USER_ID,
          'writing',
          'submission-1',
          'english',
          'en.grammar.past_simple',
          0.8,
          row.canonical_key,
        ]),
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        status: 'PENDING',
        frontText: 'Yesterday I ___ to school. (go)',
        backText: 'went',
        confidence: 0.8,
      });
      expect(result[0].createdAt).toBe(NOW.toISOString());
    });

    it('dedupes repeated errors by canonical key inside one batch and does not insert twice', async () => {
      const row = suggestionRow();
      // lock, SELECT existing (none), INSERT; no further calls for the repeat
      prisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([row]);

      const result = await service.suggestFromErrors(
        USER_ID,
        'writing',
        'submission-1',
        [
          error(),
          error({
            original: '  Yesterday   I go to school ',
            frontText: '  yesterday i ___ to school. (go)  ',
          }),
          error({ backText: 'WENT' }),
        ],
        'english',
      );

      expect(result).toHaveLength(1);
      expect(queries()).toHaveLength(3);
      expect(
        queries().filter((q) => q.includes('INSERT INTO card_suggestions')),
      ).toHaveLength(1);
    });

    it('reuses an existing PENDING row for the same user and key instead of creating a duplicate', async () => {
      const row = suggestionRow({ id: OTHER_SUGGESTION_ID });
      // lock, SELECT finds existing row
      prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([row]);

      const result = await service.suggestFromErrors(
        USER_ID,
        'writing',
        'submission-2',
        [error()],
        'english',
      );

      expect(queries()).toHaveLength(2);
      expect(queries()[1]).not.toContain('INSERT INTO');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(OTHER_SUGGESTION_ID);
      expect(result[0].sourceId).toBe('submission-1');
    });

    it('keeps different corrections as distinct suggestions and never keys another learner into the same row', async () => {
      const row = suggestionRow();
      // lock, SELECT (none), INSERT first; SELECT (none), INSERT second
      prisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([row])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          suggestionRow({ id: OTHER_SUGGESTION_ID, back_text: 'did go' }),
        ]);

      const result = await service.suggestFromErrors(
        USER_ID,
        'writing',
        'submission-1',
        [error(), error({ backText: 'did go' })],
        'english',
      );

      expect(result).toHaveLength(2);
      expect(
        queries().filter((q) => q.includes('INSERT INTO card_suggestions')),
      ).toHaveLength(2);
      const secondKey = values(4)[13];
      expect(secondKey).not.toBe(row.canonical_key);
      expect(
        canonicalSuggestionKey(OTHER_USER_ID, null, 'front', 'back'),
      ).not.toBe(row.canonical_key);
    });

    it('returns an empty list without touching the database when there are no errors', async () => {
      await expect(
        service.suggestFromErrors(
          USER_ID,
          'writing',
          'submission-1',
          [],
          'english',
        ),
      ).resolves.toEqual([]);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects bad source types, unsupported languages, missing source ids and incomplete errors before any write', async () => {
      await expect(
        service.suggestFromErrors(USER_ID, 'telepathy', 's1', [error()], 'english'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.suggestFromErrors(USER_ID, 'writing', 's1', [error()], 'klingon'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.suggestFromErrors(USER_ID, 'writing', '   ', [error()], 'english'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.suggestFromErrors(
          USER_ID,
          'writing',
          's1',
          [error({ original: '', frontText: '' })],
          'english',
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.suggestFromErrors(
          USER_ID,
          'writing',
          's1',
          [error({ correction: '', backText: '' })],
          'english',
        ),
      ).rejects.toThrow(BadRequestException);
      // The first three validations happen before the transaction; the last two
      // (empty frontText/backText) happen inside buildCandidate, which is called
      // after the advisory lock query. So $transaction may be called, but the
      // INSERT query should never be reached.
      const insertCalls = queries().filter((q) => q.includes('INSERT INTO card_suggestions'));
      expect(insertCalls).toHaveLength(0);
    });

    it('bounds long excerpts, clamps out-of-range confidence and defaults invalid confidence to 0.5', async () => {
      const row = suggestionRow();
      // Each call: lock, SELECT existing, INSERT (6 calls total).
      prisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([row])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([suggestionRow({ id: OTHER_SUGGESTION_ID })]);

      await service.suggestFromErrors(
        USER_ID,
        'writing',
        's1',
        [error({ original: 'x'.repeat(900), confidence: 9 })],
        'english',
      );
      await service.suggestFromErrors(
        USER_ID,
        'writing',
        's1',
        [error({ confidence: Number.NaN })],
        'english',
      );

      // INSERT bound values: userId, source, sourceId, language, knowledgeCode,
      // errorType, excerpt, correction, explanation, confidence, front, back,
      // example, canonicalKey (indices 0..13).
      expect(values(2)[9]).toBe(1); // confidence clamped to [0, 1]
      expect(values(2)[6]).toHaveLength(500); // excerpt bounded
      expect(values(5)[9]).toBe(0.5); // invalid confidence -> neutral default
    });

    it('propagates transaction failures rather than returning a partial suggestion', async () => {
      prisma.$transaction.mockRejectedValueOnce(new Error('transaction rolled back'));
      await expect(
        service.suggestFromErrors(USER_ID, 'writing', 's1', [error()], 'english'),
      ).rejects.toThrow('transaction rolled back');
    });
  });

  describe('listSuggestions and getSuggestion', () => {
    it('scopes listing to the authenticated user, validates filters and clamps pagination', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([suggestionRow()]);

      const result = await service.listSuggestions(USER_ID, {
        status: 'pending',
        sourceType: 'writing',
        limit: '999',
        offset: '-4',
      });

      expect(queries()[0]).toContain('FROM card_suggestions');
      expect(queries()[0]).toContain('user_id =');
      expect(values(0)).toEqual(
        expect.arrayContaining([USER_ID, 'PENDING', 'writing', 50, 0]),
      );
      expect(result).toMatchObject({ userId: USER_ID, limit: 50, offset: 0 });
      expect(result.items[0].status).toBe('PENDING');

      prisma.$queryRaw.mockClear();
      await expect(
        service.listSuggestions(USER_ID, { status: 'APPROVED' }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.listSuggestions(USER_ID, { sourceType: 'telepathy' }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('returns all three supported statuses and rejects a cross-user lookup', async () => {
      expect(CARD_SUGGESTION_STATUSES).toEqual([
        'PENDING',
        'ACCEPTED',
        'REJECTED',
      ]);
      prisma.$queryRaw.mockResolvedValueOnce([]);
      await expect(service.getSuggestion(USER_ID, SUGGESTION_ID)).rejects.toThrow(
        NotFoundException,
      );
      expect(values(0)).toEqual(expect.arrayContaining([SUGGESTION_ID, USER_ID]));
    });
  });

  describe('acceptSuggestion — explicit card creation only', () => {
    it('creates one card in the learner-owned deck and marks the suggestion ACCEPTED with its card link', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([suggestionRow()])
        .mockResolvedValueOnce([
          suggestionRow({
            status: 'ACCEPTED',
            card_id: CARD_ID,
            deck_id: DECK_ID,
          }),
        ]);
      cards.create.mockResolvedValueOnce({
        id: CARD_ID,
        front_text: 'Yesterday I ___ to school. (go)',
        back_text: 'went',
      });

      const result = await service.acceptSuggestion(
        USER_ID,
        SUGGESTION_ID,
        DECK_ID,
      );

      expect(decks.findById).toHaveBeenCalledWith(DECK_ID, USER_ID);
      expect(cards.create).toHaveBeenCalledTimes(1);
      expect(cards.create).toHaveBeenCalledWith(
        DECK_ID,
        {
          frontText: 'Yesterday I ___ to school. (go)',
          backText: 'went',
          exampleSentence: 'Yesterday I went to school',
        },
        USER_ID,
      );
      expect(queries()[1]).toContain("status = 'ACCEPTED'");
      expect(values(1)).toEqual(
        expect.arrayContaining([CARD_ID, DECK_ID, SUGGESTION_ID, USER_ID]),
      );
      expect(result.suggestion).toMatchObject({
        status: 'ACCEPTED',
        cardId: CARD_ID,
        deckId: DECK_ID,
      });
      expect(result.card).toMatchObject({ id: CARD_ID });
    });

    it('does not create a card when the suggestion is no longer pending or the deck is not owned', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        suggestionRow({ status: 'REJECTED' }),
      ]);
      await expect(
        service.acceptSuggestion(USER_ID, SUGGESTION_ID, DECK_ID),
      ).rejects.toThrow(BadRequestException);
      expect(cards.create).not.toHaveBeenCalled();

      prisma.$queryRaw.mockResolvedValueOnce([suggestionRow()]);
      decks.findById.mockRejectedValueOnce(new ForbiddenException());
      await expect(
        service.acceptSuggestion(USER_ID, SUGGESTION_ID, DECK_ID),
      ).rejects.toThrow(ForbiddenException);
      expect(cards.create).not.toHaveBeenCalled();
    });
  });

  describe('editAndAccept — learner correction wins', () => {
    it('accepts edited front/back text, recomputes the canonical key and creates exactly one card', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([suggestionRow()])
        .mockResolvedValueOnce([
          suggestionRow({
            status: 'ACCEPTED',
            front_text: 'Yesterday I ___ home. (go)',
            back_text: 'went',
            card_id: CARD_ID,
            deck_id: DECK_ID,
            canonical_key: canonicalSuggestionKey(
              USER_ID,
              'en.grammar.past_simple',
              'Yesterday I ___ home. (go)',
              'went',
            ),
            created_at: NOW,
            updated_at: NOW,
          }),
        ]);

      const result = await service.editAndAccept(
        USER_ID,
        SUGGESTION_ID,
        DECK_ID,
        {
          frontText: '  Yesterday I ___ home. (go)  ',
          backText: ' went ',
        },
      );

      expect(cards.create).toHaveBeenCalledWith(
        DECK_ID,
        {
          frontText: 'Yesterday I ___ home. (go)',
          backText: 'went',
          exampleSentence: 'Yesterday I went to school',
        },
        USER_ID,
      );
      expect(queries()[1]).toContain('canonical_key');
      expect(values(1)).toEqual(
        expect.arrayContaining([
          'Yesterday I ___ home. (go)',
          'went',
          canonicalSuggestionKey(
            USER_ID,
            'en.grammar.past_simple',
            'Yesterday I ___ home. (go)',
            'went',
          ),
          CARD_ID,
          DECK_ID,
          SUGGESTION_ID,
          USER_ID,
        ]),
      );
      expect(result.suggestion.frontText).toBe('Yesterday I ___ home. (go)');
      expect(result.suggestion.status).toBe('ACCEPTED');
    });

    it('refuses empty edits and edits to a non-pending suggestion without creating a card', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([suggestionRow()]);
      await expect(
        service.editAndAccept(USER_ID, SUGGESTION_ID, DECK_ID, {
          frontText: '   ',
          backText: 'went',
        }),
      ).rejects.toThrow(BadRequestException);
      prisma.$queryRaw.mockResolvedValueOnce([
        suggestionRow({ status: 'ACCEPTED' }),
      ]);
      await expect(
        service.editAndAccept(USER_ID, SUGGESTION_ID, DECK_ID, {
          backText: 'gone',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(cards.create).not.toHaveBeenCalled();
    });

    it('truncates overlong edits to the field cap before creating a card', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([suggestionRow()])
        .mockResolvedValueOnce([suggestionRow({ status: 'ACCEPTED' })]);

      await service.editAndAccept(USER_ID, SUGGESTION_ID, DECK_ID, {
        frontText: 'f'.repeat(900),
        backText: 'b'.repeat(900),
      });

      expect(cards.create.mock.calls[0][1].frontText).toHaveLength(500);
      expect(cards.create.mock.calls[0][1].backText).toHaveLength(500);
    });
  });

  describe('rejectSuggestion — no card, terminal state', () => {
    it('marks only the pending row REJECTED and never creates a card', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([suggestionRow()])
        .mockResolvedValueOnce([
          suggestionRow({ status: 'REJECTED', card_id: null }),
        ]);

      const result = await service.rejectSuggestion(USER_ID, SUGGESTION_ID);

      expect(queries()[1]).toContain("status = 'REJECTED'");
      expect(values(1)).toEqual(
        expect.arrayContaining([SUGGESTION_ID, USER_ID]),
      );
      expect(result.status).toBe('REJECTED');
      expect(result.cardId).toBeNull();
      expect(cards.create).not.toHaveBeenCalled();
    });

    it('rejects a second rejection of the same suggestion', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        suggestionRow({ status: 'REJECTED' }),
      ]);
      await expect(
        service.rejectSuggestion(USER_ID, SUGGESTION_ID),
      ).rejects.toThrow(BadRequestException);
      expect(queries()).toHaveLength(1);
    });
  });

  describe('wrong corrections and deletion', () => {
    it('reads back a wrong correction without changing it; edits are the only correction path', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        suggestionRow({ back_text: 'goed' }),
      ]);
      const row = await service.getSuggestion(USER_ID, SUGGESTION_ID);
      expect(row.backText).toBe('goed');
      expect(values(0)).toEqual(expect.arrayContaining([SUGGESTION_ID, USER_ID]));
      expect(cards.create).not.toHaveBeenCalled();
    });

    it('scopes lookups by user id so one learner cannot mutate another learner suggestion', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([suggestionRow()]);
      await service.getSuggestion(OTHER_USER_ID, SUGGESTION_ID);
      expect(values(0)).toEqual(
        expect.arrayContaining([SUGGESTION_ID, OTHER_USER_ID]),
      );
      expect(values(0)).not.toEqual(expect.arrayContaining([USER_ID]));

      prisma.$queryRaw.mockResolvedValueOnce([]);
      await expect(
        service.rejectSuggestion(OTHER_USER_ID, SUGGESTION_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('falls back to the neutral confidence and ISO dates when raw columns arrive as strings', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        suggestionRow({
          confidence: '0.65',
          status: 'ACCEPTED',
          created_at: '2026-11-27T00:00:00Z',
        }),
      ]);
      const row = await service.getSuggestion(USER_ID, SUGGESTION_ID);
      expect(row.confidence).toBeCloseTo(0.65);
      expect(row.createdAt).toBe('2026-11-27T00:00:00.000Z');
    });
  });
});
