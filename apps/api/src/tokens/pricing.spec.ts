import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../common/services/redis.service';
import { TokensService } from './tokens.service';

/**
 * TEST-01: pin the server-owned pricing catalog, its version and the lookup
 * boundaries. These tests only exercise static/catalog paths, so the injected
 * infrastructure is stubbed and must never be touched by a pricing lookup.
 */
describe('TokensService pricing catalog', () => {
  const EXPECTED_COSTS = {
    ai_chat: 5,
    writing_feedback: 10,
    reading_generate: 8,
    grammar_explain: 5,
    listening_generate: 8,
    quiz_generate: 6,
    translation_ai: 3,
    speaking_feedback: 10,
    learning_path: 5,
    cards_generate: 10,
  } as const;

  const EXPECTED_VERSION = '1';
  const FEATURES = Object.keys(
    EXPECTED_COSTS,
  ) as (keyof typeof EXPECTED_COSTS)[];

  const mockPrismaService = {
    user_token_balance: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
    },
    token_transactions: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      aggregate: jest.fn(),
    },
    daily_credit_grants: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockRedisService = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  };

  let service: TokensService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TokensService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: RedisService, useValue: mockRedisService },
      ],
    }).compile();

    service = module.get<TokensService>(TokensService);
  });

  describe('catalog completeness and exact values', () => {
    it('publishes exactly the ten documented features and their prices', () => {
      expect(service.getPricingCatalog().costs).toEqual(EXPECTED_COSTS);
    });

    it('has no extra, legacy, alias, or case-variant keys', () => {
      expect(Object.keys(service.getPricingCatalog().costs).sort()).toEqual(
        [...FEATURES].sort(),
      );

      const costs = service.getPricingCatalog().costs as Record<string, number>;
      for (const legacyKey of [
        'chat',
        'writing',
        'reading',
        'grammar',
        'listening',
        'quiz',
        'translation',
        'speaking',
        'path',
        'cards',
        'AI_CHAT',
        'aiChat',
        'ai-chat',
      ]) {
        expect(Object.prototype.hasOwnProperty.call(costs, legacyKey)).toBe(
          false,
        );
      }
    });

    it('prices every feature as a positive safe integer', () => {
      for (const feature of FEATURES) {
        const cost = service.getFeatureCost(feature);
        expect(Number.isSafeInteger(cost)).toBe(true);
        expect(cost).toBeGreaterThan(0);
      }
    });
  });

  describe('version', () => {
    it('publishes the static PRICING_VERSION as the catalog version', () => {
      expect(TokensService.PRICING_VERSION).toBe(EXPECTED_VERSION);
      expect(service.getPricingCatalog().version).toBe(
        TokensService.PRICING_VERSION,
      );
    });

    it('uses a non-empty string version', () => {
      const { version } = service.getPricingCatalog();
      expect(typeof version).toBe('string');
      expect(version.length).toBeGreaterThan(0);
    });

    it('pins the current version snapshot so a bump requires a deliberate change', () => {
      expect(service.getPricingCatalog().version).toBe(EXPECTED_VERSION);
    });
  });

  describe('immutability and snapshot safety', () => {
    it('freezes the catalog and its costs map', () => {
      const catalog = service.getPricingCatalog();
      expect(Object.isFrozen(catalog)).toBe(true);
      expect(Object.isFrozen(catalog.costs)).toBe(true);
    });

    it('cannot overwrite a price or the version via a cast', () => {
      const catalog = service.getPricingCatalog();
      const mutableCatalog = catalog as {
        version: string;
        costs: Record<string, number>;
      };

      // Strict-mode TS emits a TypeError on a frozen target. Under a
      // non-strict caller the assignment silently fails instead; either way
      // the published catalog and subsequent lookups must stay unchanged.
      try {
        mutableCatalog.version = 'tampered';
        mutableCatalog.costs.ai_chat = 0;
        mutableCatalog.costs.new_feature = 999;
      } catch (error) {
        expect(error).toBeInstanceOf(TypeError);
      }

      expect(catalog.version).toBe(EXPECTED_VERSION);
      expect(catalog.costs).toEqual(EXPECTED_COSTS);
      expect(service.getFeatureCost('ai_chat')).toBe(EXPECTED_COSTS.ai_chat);
    });

    it('returns the same read-only snapshot on consecutive reads', () => {
      const first = service.getPricingCatalog();
      const second = service.getPricingCatalog();

      expect(second).toBe(first);
      expect(second.costs).toBe(first.costs);
    });

    it('serializes to a plain JSON-safe object for UI consumers', () => {
      const catalog = service.getPricingCatalog();
      const serialized = JSON.parse(JSON.stringify(catalog));

      expect(serialized).toEqual({
        version: EXPECTED_VERSION,
        costs: EXPECTED_COSTS,
      });
    });

    it('serves pricing lookups without any database or cache access', () => {
      service.getPricingCatalog();
      service.getFeatureCost('ai_chat');

      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
      expect(
        mockPrismaService.user_token_balance.findUnique,
      ).not.toHaveBeenCalled();
      expect(mockRedisService.get).not.toHaveBeenCalled();
      expect(mockRedisService.set).not.toHaveBeenCalled();
    });
  });

  describe('getFeatureCost boundaries', () => {
    it.each(FEATURES)('returns the catalog price for %s', (feature) => {
      expect(service.getFeatureCost(feature)).toBe(
        service.getPricingCatalog().costs[feature],
      );
      expect(service.getFeatureCost(feature)).toBe(EXPECTED_COSTS[feature]);
    });

    it.each([
      ['an unknown feature', 'not_a_feature'],
      ['an empty feature', ''],
      ['a whitespace-only feature', '   '],
      ['an upper-cased key', 'AI_CHAT'],
      ['a mixed-case key', 'Ai_Chat'],
      ['a legacy alias', 'chat'],
      ['a dotted prototype key', '__proto__'],
      ['a constructor key', 'constructor'],
      ['a prototype property key', 'prototype'],
      ['a toString key', 'toString'],
      ['a valueOf key', 'valueOf'],
      ['a hasOwnProperty key', 'hasOwnProperty'],
    ])('throws BadRequestException for %s', (_label, feature) => {
      expect(() => service.getFeatureCost(feature)).toThrow(
        BadRequestException,
      );
    });

    it.each([undefined, null, 0, 5, {}, []])(
      'throws BadRequestException for a non-string lookup %p',
      (value) => {
        expect(() =>
          service.getFeatureCost(value as unknown as string),
        ).toThrow(BadRequestException);
      },
    );

    it('names the rejected feature in the error message', () => {
      expect(() => service.getFeatureCost('not_a_feature')).toThrow(
        /Unknown feature: not_a_feature/,
      );
    });
  });
});
