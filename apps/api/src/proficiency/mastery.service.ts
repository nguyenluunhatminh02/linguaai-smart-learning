import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma';
import { PrismaService } from '../prisma/prisma.service';
import {
  MASTERY_EVIDENCE_TYPES,
  MasteryEvidenceType,
  RecordLearnerErrorDto,
  RecordMasteryEvidenceDto,
} from './dto/mastery.dto';

/**
 * PRODUCT-03: Beta-like explainable mastery model with idempotent evidence.
 *
 * The mastery score is computed from two running accumulators:
 *
 *     mastery = (1 + success_weight) / (2 + success_weight + failure_weight)
 *
 * With zero evidence the prior is 1/2 = 0.5 ("not enough data yet"). Each
 * evidence event contributes `weight * score` to success_weight and
 * `weight * (1 - score)` to failure_weight, so a perfect outcome only grows
 * the numerator while a total failure only grows the denominator. The score
 * is bounded in (0, 1) and moves monotonically toward 1 as success accumulates.
 *
 * Confidence is derived from evidence_count:
 *
 *     confidence = min(0.95, evidence_count / (evidence_count + 3))
 *
 * The divisor 3 is a heuristic constant chosen so that a handful of
 * observations does not yet claim mastery. `needsMoreEvidence` stays true
 * until the learner has at least 5 observations AND confidence >= 0.6.
 *
 * Idempotency is enforced by the UNIQUE constraint
 *   mastery_events(attempt_id, knowledge_id, evidence_type)
 * and by an advisory lock scoped to (user_id, knowledge_id) so concurrent
 * evidence for the same knowledge item serializes. A P2002 conflict on the
 * unique constraint is treated as a replay: the existing event is read back
 * and the current mastery snapshot is returned without re-applying anything.
 *
 * This service is intentionally separate from ProficiencyService:
 * ProficiencyService tracks skill-level CEFR estimates (reading, writing, ...)
 * while MasteryService tracks knowledge-item-level Beta mastery
 * (en.grammar.past_simple, en.vocab.travel, ...). They share the same
 * peer-owned raw-SQL convention and the same advisory-lock pattern.
 */

const MIN_EVIDENCE_FOR_CONFIDENT = 5;
const MAX_CONFIDENCE = 0.95;
const CONFIDENCE_DIVISOR = 3;
const DEFAULT_LIMIT = 20;

interface LearnerMasteryRow {
  user_id: string;
  knowledge_id: string;
  success_weight: number | string;
  failure_weight: number | string;
  evidence_count: number | bigint | string;
  last_practiced_at: Date | string | null;
  updated_at: Date | string;
  // Joined from knowledge_items when requested.
  language?: string;
  skill?: string;
  code?: string;
  title?: string;
}

interface MasteryEventRow {
  id: string;
  user_id: string;
  attempt_id: string;
  knowledge_id: string;
  evidence_type: string;
  score: number | string | null;
  weight: number | string;
  created_at: Date | string;
}

interface LearnerErrorRow {
  id: string;
  user_id: string;
  attempt_id: string | null;
  knowledge_id: string | null;
  error_type: string;
  excerpt: string | null;
  correction: string | null;
  confidence: number | string | null;
  status: string;
  created_at: Date | string;
}

export interface MasteryItem {
  knowledgeId: string;
  language?: string;
  skill?: string;
  code?: string;
  title?: string;
  mastery: number;
  successWeight: number;
  failureWeight: number;
  confidence: number;
  evidenceCount: number;
  needsMoreEvidence: boolean;
  lastPracticedAt: string | null;
  updatedAt: string;
}

export interface MasteryEventView {
  id: string;
  attemptId: string;
  knowledgeId: string;
  evidenceType: string;
  score: number | null;
  weight: number;
  createdAt: string;
}

export interface LearnerErrorView {
  id: string;
  attemptId: string | null;
  knowledgeId: string | null;
  errorType: string;
  excerpt: string | null;
  correction: string | null;
  confidence: number | null;
  status: string;
  createdAt: string;
}

export interface RecordEvidenceResult {
  mastery: MasteryItem;
  replay: boolean;
  event: MasteryEventView;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function iso(value: Date | string | null): string | null {
  if (value == null) return null;
  return new Date(value).toISOString();
}

function toNumber(value: number | string | bigint | null | undefined): number {
  if (value == null) return 0;
  return Number(value);
}

/**
 * Beta-like mastery score. With zero evidence returns the prior 0.5.
 * The formula is documented in the roadmap (PRODUCT-03) and is the single
 * source of truth for the mastery value surfaced to callers.
 */
export function computeMastery(
  successWeight: number,
  failureWeight: number,
): number {
  const s = Math.max(0, successWeight);
  const f = Math.max(0, failureWeight);
  return (1 + s) / (2 + s + f);
}

export function computeConfidence(evidenceCount: number): number {
  const n = Math.max(0, Math.trunc(evidenceCount));
  return Math.min(MAX_CONFIDENCE, n / (n + CONFIDENCE_DIVISOR));
}

function needsMoreEvidence(evidenceCount: number, confidence: number): boolean {
  return evidenceCount < MIN_EVIDENCE_FOR_CONFIDENT || confidence < 0.6;
}

function toMasteryItem(row: LearnerMasteryRow): MasteryItem {
  const successWeight = toNumber(row.success_weight);
  const failureWeight = toNumber(row.failure_weight);
  const evidenceCount = toNumber(row.evidence_count);
  const confidence = computeConfidence(evidenceCount);
  return {
    knowledgeId: row.knowledge_id,
    language: row.language,
    skill: row.skill,
    code: row.code,
    title: row.title,
    mastery: computeMastery(successWeight, failureWeight),
    successWeight,
    failureWeight,
    confidence,
    evidenceCount,
    needsMoreEvidence: needsMoreEvidence(evidenceCount, confidence),
    lastPracticedAt: iso(row.last_practiced_at),
    updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
  };
}

function toEventView(row: MasteryEventRow): MasteryEventView {
  return {
    id: row.id,
    attemptId: row.attempt_id,
    knowledgeId: row.knowledge_id,
    evidenceType: row.evidence_type,
    score: row.score == null ? null : toNumber(row.score),
    weight: toNumber(row.weight),
    createdAt: iso(row.created_at) ?? new Date().toISOString(),
  };
}

function toErrorView(row: LearnerErrorRow): LearnerErrorView {
  return {
    id: row.id,
    attemptId: row.attempt_id,
    knowledgeId: row.knowledge_id,
    errorType: row.error_type,
    excerpt: row.excerpt,
    correction: row.correction,
    confidence: row.confidence == null ? null : toNumber(row.confidence),
    status: row.status,
    createdAt: iso(row.created_at) ?? new Date().toISOString(),
  };
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

function normalizeEvidenceType(value: string): MasteryEvidenceType {
  if (typeof value !== 'string') {
    throw new BadRequestException(`Unsupported evidenceType: ${String(value)}`);
  }
  const normalized = value.trim();
  if (!(MASTERY_EVIDENCE_TYPES as readonly string[]).includes(normalized)) {
    throw new BadRequestException(`Unsupported evidenceType: ${value}`);
  }
  return normalized as MasteryEvidenceType;
}

/** True for a Prisma unique-constraint conflict (P2002). */
function isDuplicateKeyError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

@Injectable()
export class MasteryService {
  private readonly logger = new Logger(MasteryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * List the current learner's mastery snapshot, optionally filtered by
   * language/skill. Rows are joined with knowledge_items so the response
   * carries the human-readable code/title alongside the numeric score.
   */
  async getMastery(
    userId: string,
    filters: { language?: string; skill?: string; limit?: number | string } = {},
  ): Promise<{ userId: string; generatedAt: string; items: MasteryItem[] }> {
    const limit = clampLimit(filters.limit, DEFAULT_LIMIT);
    const language = filters.language?.trim() || null;
    const skill = filters.skill?.trim() || null;

    const rows = await this.prisma.$queryRaw<LearnerMasteryRow[]>`
      SELECT m.user_id, m.knowledge_id, m.success_weight, m.failure_weight,
             m.evidence_count, m.last_practiced_at, m.updated_at,
             k.language, k.skill, k.code, k.title
      FROM learner_mastery m
      JOIN knowledge_items k ON k.id = m.knowledge_id
      WHERE m.user_id = ${userId}::uuid
        AND (${language}::text IS NULL OR k.language = ${language})
        AND (${skill}::text IS NULL OR k.skill = ${skill})
      ORDER BY m.updated_at DESC, m.knowledge_id ASC
      LIMIT ${limit}::int
    `;
    return {
      userId,
      generatedAt: new Date().toISOString(),
      items: rows.map(toMasteryItem),
    };
  }

  /**
   * Read a single mastery snapshot. Returns null (wrapped in the envelope)
   * when the learner has no evidence for that knowledge item yet.
   */
  async getMasteryForKnowledge(
    userId: string,
    knowledgeId: string,
  ): Promise<{ userId: string; item: MasteryItem | null }> {
    const rows = await this.prisma.$queryRaw<LearnerMasteryRow[]>`
      SELECT m.user_id, m.knowledge_id, m.success_weight, m.failure_weight,
             m.evidence_count, m.last_practiced_at, m.updated_at,
             k.language, k.skill, k.code, k.title
      FROM learner_mastery m
      JOIN knowledge_items k ON k.id = m.knowledge_id
      WHERE m.user_id = ${userId}::uuid AND m.knowledge_id = ${knowledgeId}::uuid
      LIMIT 1
    `;
    return {
      userId,
      item: rows[0] ? toMasteryItem(rows[0]) : null,
    };
  }

  /**
   * Record one evidence event and update the learner's mastery snapshot.
   *
   * Idempotency: the (attempt_id, knowledge_id, evidence_type) triple is
   * unique. A replay returns the existing event and the current mastery
   * snapshot without re-applying the weight. The advisory lock on
   * (user_id, knowledge_id) serializes concurrent evidence for the same
   * knowledge item so the snapshot update is consistent.
   */
  async recordEvidence(
    userId: string,
    dto: RecordMasteryEvidenceDto,
  ): Promise<RecordEvidenceResult> {
    const evidenceType = normalizeEvidenceType(dto.evidenceType);
    const weight =
      typeof dto.weight === 'number' && Number.isFinite(dto.weight)
        ? clamp(dto.weight, 0.25, 4)
        : 1;
    const score = clamp(dto.score, 0, 1);

    try {
      return await this.prisma.$transaction(async (tx) => {
        return this.applyEvidenceInTx(tx, userId, {
          attemptId: dto.attemptId,
          knowledgeId: dto.knowledgeId,
          evidenceType,
          score,
          weight,
        });
      });
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      // Replay path: read back the existing event and current mastery.
      return this.readReplay(userId, dto.attemptId, dto.knowledgeId, evidenceType);
    }
  }

  /**
   * Inner apply path. Runs inside the caller's transaction so the event
   * insert and the snapshot update are atomic. Throws Prisma P2002 on
   * duplicate; the caller converts that into a replay response.
   */
  private async applyEvidenceInTx(
    tx: Prisma.TransactionClient,
    userId: string,
    params: {
      attemptId: string;
      knowledgeId: string;
      evidenceType: MasteryEvidenceType;
      score: number;
      weight: number;
    },
  ): Promise<RecordEvidenceResult> {
    const lockKey = `mastery:${userId}:${params.knowledgeId}`;
    await tx.$queryRaw`
      SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
    `;

    // Verify the knowledge item exists before writing evidence. The FK on
    // mastery_events would reject unknown ids anyway, but a clear
    // NotFoundException is more useful than a generic FK violation.
    const known = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM knowledge_items WHERE id = ${params.knowledgeId}::uuid LIMIT 1
    `;
    if (!known.length) {
      throw new NotFoundException(
        `Knowledge item not found: ${params.knowledgeId}`,
      );
    }

    // Insert the evidence event. ON CONFLICT DO NOTHING lets us detect a
    // replay via rowCount; the surrounding catch also handles the case where
    // the conflict surfaces as a P2002 from a concurrent writer.
    const inserted = await tx.$queryRaw<MasteryEventRow[]>`
      INSERT INTO mastery_events
        (user_id, attempt_id, knowledge_id, evidence_type, score, weight)
      VALUES
        (${userId}::uuid, ${params.attemptId}, ${params.knowledgeId}::uuid,
         ${params.evidenceType}, ${params.score}, ${params.weight})
      ON CONFLICT (attempt_id, knowledge_id, evidence_type) DO NOTHING
      RETURNING id, user_id, attempt_id, knowledge_id, evidence_type, score, weight, created_at
    `;

    if (!inserted.length) {
      // Concurrent replay: another writer beat us to the unique slot.
      // Read back the existing event and return it as a replay.
      const existing = await tx.$queryRaw<MasteryEventRow[]>`
        SELECT id, user_id, attempt_id, knowledge_id, evidence_type, score, weight, created_at
        FROM mastery_events
        WHERE attempt_id = ${params.attemptId}
          AND knowledge_id = ${params.knowledgeId}::uuid
          AND evidence_type = ${params.evidenceType}
        LIMIT 1
      `;
      if (!existing.length) {
        throw new ConflictException('Mastery event already exists');
      }
      const mastery = await this.readMasteryRow(tx, userId, params.knowledgeId);
      return {
        mastery: toMasteryItem(mastery),
        replay: true,
        event: toEventView(existing[0]),
      };
    }

    const successDelta = params.weight * params.score;
    const failureDelta = params.weight * (1 - params.score);

    // Upsert the snapshot. ON CONFLICT updates the accumulators and bumps
    // evidence_count; the first insert seeds the row with the deltas.
    const updated = await tx.$queryRaw<LearnerMasteryRow[]>`
      INSERT INTO learner_mastery
        (user_id, knowledge_id, success_weight, failure_weight, evidence_count, last_practiced_at)
      VALUES
        (${userId}::uuid, ${params.knowledgeId}::uuid,
         ${successDelta}, ${failureDelta}, 1, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id, knowledge_id) DO UPDATE SET
        success_weight   = learner_mastery.success_weight + EXCLUDED.success_weight,
        failure_weight   = learner_mastery.failure_weight + EXCLUDED.failure_weight,
        evidence_count   = learner_mastery.evidence_count + 1,
        last_practiced_at = CURRENT_TIMESTAMP,
        updated_at       = CURRENT_TIMESTAMP
      RETURNING user_id, knowledge_id, success_weight, failure_weight,
                evidence_count, last_practiced_at, updated_at
    `;

    return {
      mastery: toMasteryItem(updated[0]),
      replay: false,
      event: toEventView(inserted[0]),
    };
  }

  /**
   * Replay path used when the outer transaction surfaces a P2002. Reads the
   * existing event and the current mastery snapshot outside the failed
   * transaction (the conflict already rolled it back).
   */
  private async readReplay(
    userId: string,
    attemptId: string,
    knowledgeId: string,
    evidenceType: MasteryEvidenceType,
  ): Promise<RecordEvidenceResult> {
    const events = await this.prisma.$queryRaw<MasteryEventRow[]>`
      SELECT id, user_id, attempt_id, knowledge_id, evidence_type, score, weight, created_at
      FROM mastery_events
      WHERE attempt_id = ${attemptId}
        AND knowledge_id = ${knowledgeId}::uuid
        AND evidence_type = ${evidenceType}
      LIMIT 1
    `;
    if (!events.length) {
      // The conflict was on a different unique target; surface as a generic
      // conflict rather than inventing data.
      throw new ConflictException('Mastery event already exists');
    }
    const mastery = await this.getMasteryForKnowledge(userId, knowledgeId);
    if (!mastery.item) {
      // Should not happen: an event exists implies a snapshot exists. Return
      // a zero-evidence item rather than throwing so the replay is stable.
      this.logger.warn(
        `Mastery replay: event ${events[0].id} exists but no snapshot for ${knowledgeId}`,
      );
    }
    return {
      mastery: mastery.item ?? {
        knowledgeId,
        mastery: 0.5,
        successWeight: 0,
        failureWeight: 0,
        confidence: 0,
        evidenceCount: 0,
        needsMoreEvidence: true,
        lastPracticedAt: null,
        updatedAt: new Date().toISOString(),
      },
      replay: true,
      event: toEventView(events[0]),
    };
  }

  private async readMasteryRow(
    tx: Prisma.TransactionClient,
    userId: string,
    knowledgeId: string,
  ): Promise<LearnerMasteryRow> {
    const rows = await tx.$queryRaw<LearnerMasteryRow[]>`
      SELECT user_id, knowledge_id, success_weight, failure_weight,
             evidence_count, last_practiced_at, updated_at
      FROM learner_mastery
      WHERE user_id = ${userId}::uuid AND knowledge_id = ${knowledgeId}::uuid
      LIMIT 1
    `;
    if (!rows.length) {
      // No snapshot yet: return a synthetic zero-evidence row so the caller
      // can still render a prior (mastery = 0.5, confidence = 0).
      return {
        user_id: userId,
        knowledge_id: knowledgeId,
        success_weight: 0,
        failure_weight: 0,
        evidence_count: 0,
        last_practiced_at: null,
        updated_at: new Date(),
      };
    }
    return rows[0];
  }

  /**
   * List evidence events for one learner, newest first. Intended for the
   * audit/review UI; not used by the mastery update path.
   */
  async listEvents(
    userId: string,
    filters: { knowledgeId?: string; limit?: number | string } = {},
  ): Promise<{ userId: string; generatedAt: string; items: MasteryEventView[] }> {
    const limit = clampLimit(filters.limit, DEFAULT_LIMIT);
    const knowledgeId = filters.knowledgeId?.trim() || null;
    const rows = await this.prisma.$queryRaw<MasteryEventRow[]>`
      SELECT id, user_id, attempt_id, knowledge_id, evidence_type, score, weight, created_at
      FROM mastery_events
      WHERE user_id = ${userId}::uuid
        AND (${knowledgeId}::uuid IS NULL OR knowledge_id = ${knowledgeId}::uuid)
      ORDER BY created_at DESC, id DESC
      LIMIT ${limit}::int
    `;
    return {
      userId,
      generatedAt: new Date().toISOString(),
      items: rows.map(toEventView),
    };
  }

  /**
   * List learner errors, newest first. The error-to-flashcard pipeline reads
   * from this endpoint; the response shape is intentionally flat so the UI
   * can render one row per error without nested joins.
   */
  async listErrors(
    userId: string,
    filters: { knowledgeId?: string; limit?: number | string } = {},
  ): Promise<{ userId: string; generatedAt: string; items: LearnerErrorView[] }> {
    const limit = clampLimit(filters.limit, DEFAULT_LIMIT);
    const knowledgeId = filters.knowledgeId?.trim() || null;
    const rows = await this.prisma.$queryRaw<LearnerErrorRow[]>`
      SELECT id, user_id, attempt_id, knowledge_id, error_type, excerpt,
             correction, confidence, status, created_at
      FROM learner_errors
      WHERE user_id = ${userId}::uuid
        AND (${knowledgeId}::uuid IS NULL OR knowledge_id = ${knowledgeId}::uuid)
      ORDER BY created_at DESC, id DESC
      LIMIT ${limit}::int
    `;
    return {
      userId,
      generatedAt: new Date().toISOString(),
      items: rows.map(toErrorView),
    };
  }

  /**
   * Record one learner error. Errors are append-only; there is no idempotency
   * key because the same observed mistake may legitimately be logged more
   * than once (each observation is its own row). The caller is expected to
   * commit the AI operation that produced the error before calling this
   * method; no nested transaction with the operation lease is opened here.
   */
  async recordError(
    userId: string,
    dto: RecordLearnerErrorDto,
  ): Promise<LearnerErrorView> {
    if (dto.knowledgeId) {
      const known = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM knowledge_items WHERE id = ${dto.knowledgeId}::uuid LIMIT 1
      `;
      if (!known.length) {
        throw new NotFoundException(
          `Knowledge item not found: ${dto.knowledgeId}`,
        );
      }
    }
    const confidence =
      typeof dto.confidence === 'number' && Number.isFinite(dto.confidence)
        ? clamp(dto.confidence, 0, 1)
        : null;
    const rows = await this.prisma.$queryRaw<LearnerErrorRow[]>`
      INSERT INTO learner_errors
        (user_id, attempt_id, knowledge_id, error_type, excerpt, correction, confidence)
      VALUES
        (${userId}::uuid, ${dto.attemptId ?? null}, ${dto.knowledgeId ?? null},
         ${dto.errorType}, ${dto.excerpt ?? null}, ${dto.correction ?? null},
         ${confidence})
      RETURNING id, user_id, attempt_id, knowledge_id, error_type, excerpt,
                correction, confidence, status, created_at
    `;
    return toErrorView(rows[0]);
  }
}
