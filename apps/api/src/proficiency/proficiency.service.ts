import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma';
import { PrismaService } from '../prisma/prisma.service';
import {
  PROFICIENCY_LANGUAGES,
  PROFICIENCY_SKILLS,
  SubmitPlacementDto,
} from './dto/proficiency.dto';

const CEFR_BANDS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
type CefrBand = (typeof CEFR_BANDS)[number];

export const MIN_EVIDENCE_FOR_CONFIDENT = 5;
const MAX_CONFIDENCE = 0.95;
const DEFAULT_LIMIT = 20;

interface SkillProficiencyRow {
  user_id: string;
  language: string;
  skill: string;
  cefr_estimate: string;
  confidence: number | string;
  evidence_count: number | bigint | string;
  updated_at: Date | string;
}

interface PlacementAttemptRow {
  language: string;
  skill: string;
  score: number | bigint | string;
  total: number | bigint | string;
  cefr_estimate: string;
  created_at: Date | string;
}

export interface ProficiencyItem {
  language: string;
  skill: string;
  cefrEstimate: CefrBand;
  cefrOrdinal: number;
  confidence: number;
  evidenceCount: number;
  needsMoreEvidence: boolean;
  updatedAt: string;
}

export interface PlacementAttempt {
  language: string;
  skill: string;
  score: number;
  total: number;
  cefrEstimate: CefrBand;
  createdAt: string;
}

export interface SkillEvidence {
  language: string;
  skill: string;
  score: number;
  total: number;
  weight?: number;
}

export interface ProficiencyFilters {
  language?: string;
  skill?: string;
  /** Query strings are accepted as well as numbers; HTTP does not coerce @Query values. */
  limit?: number | string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeChoice<T extends string>(
  value: string,
  allowed: readonly T[],
  label: string,
): T {
  if (typeof value !== 'string') {
    throw new BadRequestException(`Unsupported ${label}: ${String(value)}`);
  }
  const normalized = value.trim().toLowerCase();
  if (!allowed.includes(normalized as T)) {
    throw new BadRequestException(`Unsupported ${label}: ${value}`);
  }
  return normalized as T;
}

function validateScoreTotal(score: number, total: number): void {
  if (
    !Number.isInteger(score) ||
    !Number.isInteger(total) ||
    score < 0 ||
    total < 1 ||
    score > 1000 ||
    total > 1000 ||
    score > total
  ) {
    throw new BadRequestException(
      'score and total must be integers with 0 <= score <= total and 1 <= total <= 1000',
    );
  }
}

function clampLimit(
  value: number | string | undefined,
  fallback: number,
): number {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.trunc(clamp(parsed, 1, 50));
}

function cefrOrdinalForRatio(score: number, total: number): number {
  const ratio = total > 0 ? score / total : 0;
  if (ratio < 0.4) return 0;
  if (ratio < 0.55) return 1;
  if (ratio < 0.7) return 2;
  if (ratio < 0.82) return 3;
  if (ratio < 0.92) return 4;
  return 5;
}

function ordinalForBand(band: string): number {
  const index = CEFR_BANDS.indexOf(String(band).toUpperCase() as CefrBand);
  return index < 0 ? 0 : index;
}

function confidenceForCount(count: number): number {
  return Math.min(MAX_CONFIDENCE, count / (count + 2));
}

function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

function toItem(row: SkillProficiencyRow): ProficiencyItem {
  const ordinal = ordinalForBand(row.cefr_estimate);
  const evidenceCount = Number(row.evidence_count);
  const confidence = clamp(Number(row.confidence), 0, 1);
  return {
    language: row.language,
    skill: row.skill,
    cefrEstimate: CEFR_BANDS[ordinal],
    cefrOrdinal: ordinal,
    confidence,
    evidenceCount,
    needsMoreEvidence:
      evidenceCount < MIN_EVIDENCE_FOR_CONFIDENT || confidence < 0.7,
    updatedAt: iso(row.updated_at),
  };
}

function toAttempt(row: PlacementAttemptRow): PlacementAttempt {
  return {
    language: row.language,
    skill: row.skill,
    score: Number(row.score),
    total: Number(row.total),
    cefrEstimate: CEFR_BANDS[ordinalForBand(row.cefr_estimate)],
    createdAt: iso(row.created_at),
  };
}

/**
 * Rule-based CEFR estimates. These numbers are explainable progress signals,
 * not a validated placement instrument; `needsMoreEvidence` intentionally
 * stays true until several observations have accumulated.
 */
@Injectable()
export class ProficiencyService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(userId: string, language?: string) {
    const normalizedLanguage = language
      ? normalizeChoice(language, PROFICIENCY_LANGUAGES, 'language')
      : null;
    const rows = await this.prisma.$queryRaw<SkillProficiencyRow[]>`
      SELECT user_id, language, skill, cefr_estimate, confidence, evidence_count, updated_at
      FROM skill_proficiency
      WHERE user_id = ${userId}::uuid
        AND (${normalizedLanguage}::text IS NULL OR language = ${normalizedLanguage})
      ORDER BY language ASC, skill ASC
    `;
    return {
      userId,
      generatedAt: new Date().toISOString(),
      items: rows.map(toItem),
    };
  }

  async getPlacementAttempts(userId: string, filters: ProficiencyFilters = {}) {
    const language = filters.language
      ? normalizeChoice(filters.language, PROFICIENCY_LANGUAGES, 'language')
      : null;
    const skill = filters.skill
      ? normalizeChoice(filters.skill, PROFICIENCY_SKILLS, 'skill')
      : null;
    const limit = clampLimit(filters.limit, DEFAULT_LIMIT);
    const rows = await this.prisma.$queryRaw<PlacementAttemptRow[]>`
      SELECT language, skill, score, total, cefr_estimate, created_at
      FROM placement_attempts
      WHERE user_id = ${userId}::uuid
        AND (${language}::text IS NULL OR language = ${language})
        AND (${skill}::text IS NULL OR skill = ${skill})
      ORDER BY created_at DESC
      LIMIT ${limit}::int
    `;
    return {
      userId,
      generatedAt: new Date().toISOString(),
      items: rows.map(toAttempt),
    };
  }

  async submitPlacement(userId: string, dto: SubmitPlacementDto) {
    const language = normalizeChoice(
      dto.language,
      PROFICIENCY_LANGUAGES,
      'language',
    );
    const skill = normalizeChoice(dto.skill, PROFICIENCY_SKILLS, 'skill');
    validateScoreTotal(dto.score, dto.total);
    const observedBand = CEFR_BANDS[cefrOrdinalForRatio(dto.score, dto.total)];

    return this.prisma.$transaction(async (tx) => {
      const attempts = await tx.$queryRaw<PlacementAttemptRow[]>`
        INSERT INTO placement_attempts (user_id, language, skill, score, total, cefr_estimate)
        VALUES (${userId}::uuid, ${language}, ${skill}, ${dto.score}, ${dto.total}, ${observedBand})
        RETURNING language, skill, score, total, cefr_estimate, created_at
      `;
      const proficiency = await this.applyEvidence(
        tx,
        userId,
        language,
        skill,
        dto.score,
        dto.total,
        1.5,
      );
      return { attempt: toAttempt(attempts[0]), proficiency };
    });
  }

  async recordEvidence(
    userId: string,
    evidence: SkillEvidence,
  ): Promise<ProficiencyItem> {
    const language = normalizeChoice(
      evidence.language,
      PROFICIENCY_LANGUAGES,
      'language',
    );
    const skill = normalizeChoice(evidence.skill, PROFICIENCY_SKILLS, 'skill');
    validateScoreTotal(evidence.score, evidence.total);
    const weight =
      typeof evidence.weight === 'number' && Number.isFinite(evidence.weight)
        ? clamp(evidence.weight, 0.25, 2)
        : 1;
    return this.prisma.$transaction((tx) =>
      this.applyEvidence(
        tx,
        userId,
        language,
        skill,
        evidence.score,
        evidence.total,
        weight,
      ),
    );
  }

  private async applyEvidence(
    tx: Prisma.TransactionClient,
    userId: string,
    language: string,
    skill: string,
    score: number,
    total: number,
    weight: number,
  ): Promise<ProficiencyItem> {
    const lockKey = `proficiency:${userId}:${language}:${skill}`;
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;

    const currentRows = await tx.$queryRaw<SkillProficiencyRow[]>`
      SELECT user_id, language, skill, cefr_estimate, confidence, evidence_count, updated_at
      FROM skill_proficiency
      WHERE user_id = ${userId}::uuid AND language = ${language} AND skill = ${skill}
      LIMIT 1
    `;
    const current = currentRows[0];
    const currentCount = current ? Number(current.evidence_count) : 0;
    const currentOrdinal = current ? ordinalForBand(current.cefr_estimate) : 0;
    const observationOrdinal = cefrOrdinalForRatio(score, total);
    const alpha = clamp(weight / (currentCount + weight + 6), 0.05, 0.25);
    const nextOrdinal = Math.trunc(
      clamp(
        Math.round((1 - alpha) * currentOrdinal + alpha * observationOrdinal),
        0,
        5,
      ),
    );
    const nextCount = currentCount + 1;

    const rows = await tx.$queryRaw<SkillProficiencyRow[]>`
      INSERT INTO skill_proficiency
        (user_id, language, skill, cefr_estimate, confidence, evidence_count, updated_at)
      VALUES
        (${userId}::uuid, ${language}, ${skill}, ${CEFR_BANDS[nextOrdinal]},
         ${confidenceForCount(nextCount)}, ${nextCount}, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id, language, skill) DO UPDATE SET
        cefr_estimate = EXCLUDED.cefr_estimate,
        confidence = EXCLUDED.confidence,
        evidence_count = EXCLUDED.evidence_count,
        updated_at = EXCLUDED.updated_at
      RETURNING user_id, language, skill, cefr_estimate, confidence, evidence_count, updated_at
    `;
    return toItem(rows[0]);
  }
}
