// @ts-nocheck
/**
 * SEC-02 / SEC-07 regression tests for speaking history and transcription.
 * The service already scopes reads by user_id; these tests pin that behaviour
 * so a future refactor cannot reintroduce cross-user access.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';

jest.mock('groq-sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    audio: { transcriptions: { create: jest.fn() } },
  })),
}));

import Groq from 'groq-sdk';
import { SpeakingService } from './speaking.service';

const OWNER_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_USER_ID = '00000000-0000-4000-8000-000000000002';
const SUBMISSION_ID = '00000000-0000-4000-8000-000000000003';

describe('SpeakingService ownership (SEC-02)', () => {
  let service: SpeakingService;
  let prisma: any;
  let config: any;
  let tokens: any;

  beforeEach(() => {
    (Groq as unknown as jest.Mock).mockClear();
    prisma = {
      speaking_submissions: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn(),
        create: jest.fn(),
      },
    };
    config = {
      get: jest.fn((key: string, fallback?: string) => {
        if (key === 'GROQ_API_KEY') return undefined;
        if (key === 'GROQ_MODEL_STT') return fallback;
        return fallback;
      }),
    };
    tokens = { consumeTokens: jest.fn().mockResolvedValue(undefined) };
    service = new SpeakingService(prisma, config, tokens);
  });

  describe('getHistory', () => {
    it('filters both the page and count by the caller id', async () => {
      await service.getHistory(OWNER_ID, 2, 5);

      expect(prisma.speaking_submissions.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { user_id: OWNER_ID },
          skip: 5,
          take: 5,
        }),
      );
      expect(prisma.speaking_submissions.count).toHaveBeenCalledWith({
        where: { user_id: OWNER_ID },
      });
    });

    it("never returns a foreign user's row even when its id is known", async () => {
      prisma.speaking_submissions.findMany.mockResolvedValue([]);
      const result = await service.getHistory(OTHER_USER_ID);
      expect(result.items).toEqual([]);
      expect(
        prisma.speaking_submissions.findMany.mock.calls[0][0].where,
      ).toEqual({
        user_id: OTHER_USER_ID,
      });
    });
  });

  /**
   * DB-13: the gateway persists scores on a 0-100 scale (parseScores accepts
   * only numbers in [0, 100]) and the service passes the JSON column through
   * unchanged. Pin that contract so a future refactor cannot silently apply
   * the writing module's rawScore * 10 heuristic to speaking — we do not
   * claim speaking shares writing's scale bug, we only verify what it does.
   */
  describe('score scale contract', () => {
    it('getHistory returns stored 0-100 scores without transformation', async () => {
      const scores = { overall: 7, grammar: 5, vocabulary: 9 };
      prisma.speaking_submissions.findMany.mockResolvedValue([
        {
          id: SUBMISSION_ID,
          topic: 'travel',
          transcript: 'hello',
          feedback: 'good',
          scores,
          language: 'english',
          level: 'B1',
          duration_sec: 3,
          created_at: new Date('2026-01-01T00:00:00Z'),
        },
      ]);

      const result = await service.getHistory(OWNER_ID);

      expect(result.items[0].scores).toEqual(scores);
    });

    it('getHistory preserves boundary values 0 and 100', async () => {
      const scores = { overall: 0, grammar: 100, vocabulary: 0 };
      prisma.speaking_submissions.findMany.mockResolvedValue([
        {
          id: SUBMISSION_ID,
          topic: 'travel',
          transcript: 'hello',
          feedback: 'good',
          scores,
          language: 'english',
          level: 'B1',
          duration_sec: 3,
          created_at: new Date('2026-01-01T00:00:00Z'),
        },
      ]);

      const result = await service.getHistory(OWNER_ID);

      expect(result.items[0].scores).toEqual(scores);
    });

    it('getHistory returns null scores as null, not zero', async () => {
      prisma.speaking_submissions.findMany.mockResolvedValue([
        {
          id: SUBMISSION_ID,
          topic: 'travel',
          transcript: 'hello',
          feedback: 'good',
          scores: null,
          language: 'english',
          level: 'B1',
          duration_sec: 3,
          created_at: new Date('2026-01-01T00:00:00Z'),
        },
      ]);

      const result = await service.getHistory(OWNER_ID);

      expect(result.items[0].scores).toBeNull();
    });

    it('getOne returns stored scores without transformation', async () => {
      const scores = { overall: 7, grammar: 5, vocabulary: 9 };
      prisma.speaking_submissions.findFirst.mockResolvedValue({
        id: SUBMISSION_ID,
        user_id: OWNER_ID,
        topic: 'travel',
        transcript: 'hello',
        feedback: 'good',
        scores,
        language: 'english',
        level: 'B1',
        duration_sec: 3,
        audio_url: null,
        created_at: new Date('2026-01-01T00:00:00Z'),
      });

      const result = await service.getOne(OWNER_ID, SUBMISSION_ID);

      expect(result.scores).toEqual(scores);
    });

    it('getOne tolerates the extra basis key the gateway persists', async () => {
      // The gateway stores { ...scores, basis: 'transcript' } (gateway.ts), so
      // the JSON value is not a pure Record<string, number> in practice. The
      // service must not strip or rescale that metadata.
      const scores = {
        overall: 80,
        grammar: 70,
        vocabulary: 90,
        basis: 'transcript',
      };
      prisma.speaking_submissions.findFirst.mockResolvedValue({
        id: SUBMISSION_ID,
        user_id: OWNER_ID,
        topic: 'travel',
        transcript: 'hello',
        feedback: 'good',
        scores,
        language: 'english',
        level: 'B1',
        duration_sec: 3,
        audio_url: null,
        created_at: new Date('2026-01-01T00:00:00Z'),
      });

      const result = await service.getOne(OWNER_ID, SUBMISSION_ID);

      expect(result.scores).toEqual(scores);
      expect((result.scores as any).basis).toBe('transcript');
    });

    it('getHistory never invents a score when the row has none', async () => {
      // Nullable Json? column can come back undefined from a mocked/legacy row;
      // the service's null-coalesce must yield null, never 0 or an empty object.
      prisma.speaking_submissions.findMany.mockResolvedValue([
        {
          id: SUBMISSION_ID,
          topic: 'travel',
          transcript: 'hello',
          feedback: 'good',
          scores: undefined,
          language: 'english',
          level: 'B1',
          duration_sec: 3,
          created_at: new Date('2026-01-01T00:00:00Z'),
        },
      ]);

      const result = await service.getHistory(OWNER_ID);

      expect(result.items[0].scores).toBeNull();
    });
  });

  describe('getOne', () => {
    it('queries with id and owner id together', async () => {
      const row = {
        id: SUBMISSION_ID,
        user_id: OWNER_ID,
        topic: 'travel',
        transcript: 'hello',
        feedback: 'good',
        scores: null,
        language: 'english',
        level: 'B1',
        duration_sec: 3,
        audio_url: null,
        created_at: new Date('2026-01-01T00:00:00Z'),
      };
      prisma.speaking_submissions.findFirst.mockResolvedValue(row);

      const result = await service.getOne(OWNER_ID, SUBMISSION_ID);

      expect(prisma.speaking_submissions.findFirst).toHaveBeenCalledWith({
        where: { id: SUBMISSION_ID, user_id: OWNER_ID },
      });
      expect(result.id).toBe(SUBMISSION_ID);
      expect(prisma.speaking_submissions.findUnique).toBeUndefined();
    });

    it("throws NotFoundException for another user's valid submission id", async () => {
      // Owner-scoped query sees no row for this caller.
      prisma.speaking_submissions.findFirst.mockResolvedValue(null);

      await expect(
        service.getOne(OTHER_USER_ID, SUBMISSION_ID),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.speaking_submissions.findFirst).toHaveBeenCalledWith({
        where: { id: SUBMISSION_ID, user_id: OTHER_USER_ID },
      });
    });
  });

  describe('transcribe', () => {
    it('rejects oversized audio before any token charge', async () => {
      // Strict base64 above the shared decoded-byte budget.
      const payload = Buffer.alloc(10 * 1024 * 1024 + 1, 0x1a).toString(
        'base64',
      );

      await expect(
        service.transcribe(OWNER_ID, payload, 'audio/webm'),
      ).rejects.toThrow(BadRequestException);
      expect(tokens.consumeTokens).not.toHaveBeenCalled();
    });

    it('rejects empty audio before any token charge', async () => {
      await expect(service.transcribe(OWNER_ID, '')).rejects.toThrow(
        BadRequestException,
      );
      expect(tokens.consumeTokens).not.toHaveBeenCalled();
    });

    it('does not charge another user for a dev transcript', async () => {
      // With no Groq key the service returns the deterministic dev transcript
      // and skips billing by design; assert another user's id is not touched.
      // Minimal EBML header accepted by the shared audio validator.
      const validWebmBase64 = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]).toString(
        'base64',
      );
      await expect(
        service.transcribe(OWNER_ID, validWebmBase64, 'audio/webm'),
      ).resolves.toEqual({
        transcript: expect.any(String),
      });
      expect(tokens.consumeTokens).not.toHaveBeenCalled();
      expect(
        tokens.consumeTokens.mock.calls.some(
          (c: any[]) => c[0] === OTHER_USER_ID,
        ),
      ).toBe(false);
    });
  });
});
