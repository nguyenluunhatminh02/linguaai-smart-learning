import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CardsService } from '../cards/cards.service';
import { DecksService } from '../decks/decks.service';

export const CARD_SUGGESTION_STATUSES = [
  'PENDING',
  'ACCEPTED',
  'REJECTED',
] as const;

export const CARD_SUGGESTION_SOURCES = [
  'writing',
  'speaking',
  'reading',
] as const;

export type CardSuggestionStatus = (typeof CARD_SUGGESTION_STATUSES)[number];
export type CardSuggestionSource = (typeof CARD_SUGGESTION_SOURCES)[number];

export interface LearnerErrorInput {
  original: string;
  correction: string;
  explanation?: string;
  type?: string;
  knowledgeCode?: string;
  confidence?: number;
  frontText?: string;
  backText?: string;
  exampleSentence?: string;
}

export interface SuggestCardsFromErrorsInput {
  sourceType: CardSuggestionSource;
  sourceId: string;
  errors: LearnerErrorInput[];
  language: string;
}

export interface SuggestionFilters {
  status?: CardSuggestionStatus | string;
  sourceType?: CardSuggestionSource | string;
  /** Query strings are accepted as well as numbers; HTTP does not coerce @Query values. */
  limit?: number | string;
  offset?: number | string;
}

export interface SuggestionEdits {
  frontText?: string;
  backText?: string;
  exampleSentence?: string;
}

interface SuggestionRow {
  id: string;
  user_id: string;
  source_type: string;
  source_id: string;
  language: string;
  knowledge_code: string | null;
  error_type: string | null;
  error_excerpt: string | null;
  correction: string | null;
  explanation: string | null;
  confidence: number | string | null;
  front_text: string;
  back_text: string;
  example_sentence: string | null;
  canonical_key: string;
  status: string;
  card_id: string | null;
  deck_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface CardSuggestion {
  id: string;
  userId: string;
  sourceType: string;
  sourceId: string;
  language: string;
  knowledgeCode: string | null;
  errorType: string | null;
  errorExcerpt: string | null;
  correction: string | null;
  explanation: string | null;
  confidence: number;
  frontText: string;
  backText: string;
  exampleSentence: string | null;
  canonicalKey: string;
  status: CardSuggestionStatus;
  cardId: string | null;
  deckId: string | null;
  createdAt: string;
  updatedAt: string;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const FIELD_LIMITS = {
  excerpt: 500,
  correction: 500,
  explanation: 2000,
  front: 500,
  back: 500,
  example: 1000,
  knowledgeCode: 120,
  errorType: 50,
  sourceId: 160,
  sourceType: 30,
  language: 30,
} as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampLimit(value: number | string | undefined): number {
  if (value === undefined || value === null || value === '') return DEFAULT_LIMIT;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.trunc(clamp(parsed, 1, MAX_LIMIT));
}

function clampOffset(value: number | string | undefined): number {
  if (value === undefined || value === null || value === '') return 0;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.trunc(parsed));
}

function boundedText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function optionalText(value: unknown, max: number): string | null {
  const text = boundedText(value, max);
  return text.length > 0 ? text : null;
}

/** Lowercase, trim and collapse all whitespace runs into one space. */
export function normalizeCardText(value: string): string {
  return String(value ?? '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Stable, user-scoped identity for a suggested card. The same learner error
 * phrased with different case/whitespace must map to the same key; a different
 * learner must never collide with it.
 */
export function canonicalSuggestionKey(
  userId: string,
  knowledgeCode: string | null,
  frontText: string,
  backText: string,
): string {
  const basis = [
    userId,
    normalizeCardText(knowledgeCode ?? ''),
    normalizeCardText(frontText),
    normalizeCardText(backText),
  ].join('\u0000');
  return createHash('sha256').update(basis).digest('hex');
}

function clampConfidence(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0.5;
  return clamp(value, 0, 1);
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

function normalizeStatus(value: string | undefined): CardSuggestionStatus | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    throw new BadRequestException(`Unsupported status: ${String(value)}`);
  }
  const normalized = value.trim().toUpperCase();
  if (!CARD_SUGGESTION_STATUSES.includes(normalized as CardSuggestionStatus)) {
    throw new BadRequestException(`Unsupported status: ${value}`);
  }
  return normalized as CardSuggestionStatus;
}

function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

function toSuggestion(row: SuggestionRow): CardSuggestion {
  return {
    id: row.id,
    userId: row.user_id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    language: row.language,
    knowledgeCode: row.knowledge_code,
    errorType: row.error_type,
    errorExcerpt: row.error_excerpt,
    correction: row.correction,
    explanation: row.explanation,
    confidence: clampConfidence(Number(row.confidence)),
    frontText: row.front_text,
    backText: row.back_text,
    exampleSentence: row.example_sentence,
    canonicalKey: row.canonical_key,
    status: row.status as CardSuggestionStatus,
    cardId: row.card_id,
    deckId: row.deck_id,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

/**
 * PRODUCT-05: turn learner errors into *suggestions*. Nothing creates a card
 * until the learner explicitly accepts it. Suggestions are deduplicated by a
 * canonical (user, knowledge, front, back) hash, guarded both by a transaction
 * advisory lock and by a partial unique index on PENDING rows.
 */
@Injectable()
export class ErrorToCardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cards: CardsService,
    private readonly decks: DecksService,
  ) {}

  /** Changing this method name would break other services' call sites. */
  async suggestFromErrors(
    userId: string,
    sourceType: CardSuggestionSource | string,
    sourceId: string,
    errors: LearnerErrorInput[],
    language: string,
  ): Promise<CardSuggestion[]> {
    const source = normalizeChoice(sourceType, CARD_SUGGESTION_SOURCES, 'sourceType');
    const safeSourceId = boundedText(sourceId, FIELD_LIMITS.sourceId);
    const safeLanguage = normalizeChoice(
      boundedText(language, FIELD_LIMITS.language).toLowerCase() || 'english',
      ['english', 'chinese', 'japanese', 'korean', 'french', 'spanish', 'german', 'vietnamese'] as const,
      'language',
    );
    if (!safeSourceId) {
      throw new BadRequestException('sourceId is required');
    }
    if (!Array.isArray(errors) || errors.length === 0) return [];

    return this.prisma.$transaction(async (tx) => {
      // Serialise this learner's suggestions so concurrent requests cannot
      // both pass the PENDING lookup and race on the partial unique index.
      const lockKey = `card-suggestion:${userId}`;
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;

      const suggestions: CardSuggestion[] = [];
      const seen = new Set<string>();
      for (const error of errors) {
        const candidate = this.buildCandidate(error, userId);
        if (seen.has(candidate.canonicalKey)) continue;
        seen.add(candidate.canonicalKey);

        const existing = await tx.$queryRaw<SuggestionRow[]>`
          SELECT id, user_id, source_type, source_id, language, knowledge_code,
             error_type, error_excerpt, correction, explanation, confidence,
             front_text, back_text, example_sentence, canonical_key, status,
             card_id, deck_id, created_at, updated_at FROM card_suggestions
          WHERE user_id = ${userId}::uuid
            AND canonical_key = ${candidate.canonicalKey}
            AND status = 'PENDING'
          LIMIT 1
        `;
        if (existing.length > 0) {
          suggestions.push(toSuggestion(existing[0]));
          continue;
        }

        const rows = await tx.$queryRaw<SuggestionRow[]>`
          INSERT INTO card_suggestions
            (user_id, source_type, source_id, language, knowledge_code, error_type,
             error_excerpt, correction, explanation, confidence, front_text,
             back_text, example_sentence, canonical_key, status, created_at, updated_at)
          VALUES
            (${userId}::uuid, ${source}, ${safeSourceId}, ${safeLanguage},
             ${candidate.knowledgeCode}, ${candidate.errorType}, ${candidate.errorExcerpt},
             ${candidate.correction}, ${candidate.explanation}, ${candidate.confidence},
             ${candidate.frontText}, ${candidate.backText}, ${candidate.exampleSentence},
             ${candidate.canonicalKey}, 'PENDING', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          RETURNING id, user_id, source_type, source_id, language, knowledge_code,
             error_type, error_excerpt, correction, explanation, confidence,
             front_text, back_text, example_sentence, canonical_key, status,
             card_id, deck_id, created_at, updated_at
        `;
        if (rows.length > 0) suggestions.push(toSuggestion(rows[0]));
      }
      return suggestions;
    });
  }

  async listSuggestions(
    userId: string,
    filters: SuggestionFilters = {},
  ): Promise<{ userId: string; items: CardSuggestion[]; limit: number; offset: number }> {
    const status = normalizeStatus(filters.status);
    const sourceType = filters.sourceType
      ? normalizeChoice(
          String(filters.sourceType),
          CARD_SUGGESTION_SOURCES,
          'sourceType',
        )
      : null;
    const limit = clampLimit(filters.limit);
    const offset = clampOffset(filters.offset);
    const rows = await this.prisma.$queryRaw<SuggestionRow[]>`
      SELECT id, user_id, source_type, source_id, language, knowledge_code,
             error_type, error_excerpt, correction, explanation, confidence,
             front_text, back_text, example_sentence, canonical_key, status,
             card_id, deck_id, created_at, updated_at FROM card_suggestions
      WHERE user_id = ${userId}::uuid
        AND (${status}::text IS NULL OR status = ${status})
        AND (${sourceType}::text IS NULL OR source_type = ${sourceType})
      ORDER BY created_at DESC, id DESC
      LIMIT ${limit}::int OFFSET ${offset}::int
    `;
    return {
      userId,
      items: rows.map(toSuggestion),
      limit,
      offset,
    };
  }

  async getSuggestion(
    userId: string,
    suggestionId: string,
  ): Promise<CardSuggestion> {
    const rows = await this.prisma.$queryRaw<SuggestionRow[]>`
      SELECT id, user_id, source_type, source_id, language, knowledge_code,
             error_type, error_excerpt, correction, explanation, confidence,
             front_text, back_text, example_sentence, canonical_key, status,
             card_id, deck_id, created_at, updated_at FROM card_suggestions
      WHERE id = ${suggestionId}::uuid AND user_id = ${userId}::uuid
      LIMIT 1
    `;
    if (rows.length === 0) throw new NotFoundException('Card suggestion not found');
    return toSuggestion(rows[0]);
  }

  async acceptSuggestion(
    userId: string,
    suggestionId: string,
    deckId: string,
  ): Promise<{ suggestion: CardSuggestion; card: unknown }> {
    const suggestion = await this.getSuggestion(userId, suggestionId);
    if (suggestion.status !== 'PENDING') {
      throw new BadRequestException('Suggestion is no longer pending');
    }
    // CardsService.create performs its own deck ownership check, so a learner
    // cannot accept a suggestion into somebody else's deck.
    await this.decks.findById(deckId, userId);
    const card = await this.cards.create(
      deckId,
      {
        frontText: suggestion.frontText,
        backText: suggestion.backText,
        ...(suggestion.exampleSentence
          ? { exampleSentence: suggestion.exampleSentence }
          : {}),
      },
      userId,
    );

    const rows = await this.prisma.$queryRaw<SuggestionRow[]>`
      UPDATE card_suggestions
      SET status = 'ACCEPTED', card_id = ${card.id}::uuid,
          deck_id = ${deckId}::uuid, updated_at = CURRENT_TIMESTAMP
      WHERE id = ${suggestionId}::uuid AND user_id = ${userId}::uuid
        AND status = 'PENDING'
      RETURNING id, user_id, source_type, source_id, language, knowledge_code,
             error_type, error_excerpt, correction, explanation, confidence,
             front_text, back_text, example_sentence, canonical_key, status,
             card_id, deck_id, created_at, updated_at
    `;
    if (rows.length === 0) throw new NotFoundException('Card suggestion not found');
    return { suggestion: toSuggestion(rows[0]), card };
  }

  async rejectSuggestion(
    userId: string,
    suggestionId: string,
  ): Promise<CardSuggestion> {
    const suggestion = await this.getSuggestion(userId, suggestionId);
    if (suggestion.status !== 'PENDING') {
      throw new BadRequestException('Suggestion is no longer pending');
    }
    const rows = await this.prisma.$queryRaw<SuggestionRow[]>`
      UPDATE card_suggestions
      SET status = 'REJECTED', updated_at = CURRENT_TIMESTAMP
      WHERE id = ${suggestionId}::uuid AND user_id = ${userId}::uuid
        AND status = 'PENDING'
      RETURNING id, user_id, source_type, source_id, language, knowledge_code,
             error_type, error_excerpt, correction, explanation, confidence,
             front_text, back_text, example_sentence, canonical_key, status,
             card_id, deck_id, created_at, updated_at
    `;
    if (rows.length === 0) throw new NotFoundException('Card suggestion not found');
    return toSuggestion(rows[0]);
  }

  async editAndAccept(
    userId: string,
    suggestionId: string,
    deckId: string,
    edits: SuggestionEdits,
  ): Promise<{ suggestion: CardSuggestion; card: unknown }> {
    const suggestion = await this.getSuggestion(userId, suggestionId);
    if (suggestion.status !== 'PENDING') {
      throw new BadRequestException('Suggestion is no longer pending');
    }
    const frontText = boundedText(
      edits?.frontText ?? suggestion.frontText,
      FIELD_LIMITS.front,
    );
    const backText = boundedText(
      edits?.backText ?? suggestion.backText,
      FIELD_LIMITS.back,
    );
    if (!frontText || !backText) {
      throw new BadRequestException('frontText and backText are required');
    }
    const exampleSentence = optionalText(
      edits?.exampleSentence ?? suggestion.exampleSentence,
      FIELD_LIMITS.example,
    );

    await this.decks.findById(deckId, userId);
    const card = await this.cards.create(
      deckId,
      {
        frontText,
        backText,
        ...(exampleSentence ? { exampleSentence } : {}),
      },
      userId,
    );

    const canonicalKey = canonicalSuggestionKey(
      userId,
      suggestion.knowledgeCode,
      frontText,
      backText,
    );
    const rows = await this.prisma.$queryRaw<SuggestionRow[]>`
      UPDATE card_suggestions
      SET front_text = ${frontText}, back_text = ${backText},
          example_sentence = ${exampleSentence}, canonical_key = ${canonicalKey},
          status = 'ACCEPTED', card_id = ${card.id}::uuid,
          deck_id = ${deckId}::uuid, updated_at = CURRENT_TIMESTAMP
      WHERE id = ${suggestionId}::uuid AND user_id = ${userId}::uuid
        AND status = 'PENDING'
      RETURNING id, user_id, source_type, source_id, language, knowledge_code,
             error_type, error_excerpt, correction, explanation, confidence,
             front_text, back_text, example_sentence, canonical_key, status,
             card_id, deck_id, created_at, updated_at
    `;
    if (rows.length === 0) throw new NotFoundException('Card suggestion not found');
    return { suggestion: toSuggestion(rows[0]), card };
  }

  private buildCandidate(error: LearnerErrorInput, userId: string) {
    const original = boundedText(error?.original, FIELD_LIMITS.excerpt);
    const correction = boundedText(error?.correction, FIELD_LIMITS.correction);
    const frontText = boundedText(error?.frontText || original, FIELD_LIMITS.front);
    const backText = boundedText(error?.backText || correction, FIELD_LIMITS.back);
    if (!frontText || !backText) {
      throw new BadRequestException(
        'Each error requires a non-empty original/frontText and correction/backText',
      );
    }
    const knowledgeCode = optionalText(error?.knowledgeCode, FIELD_LIMITS.knowledgeCode);
    return {
      knowledgeCode,
      errorType: optionalText(error?.type, FIELD_LIMITS.errorType),
      errorExcerpt: optionalText(original, FIELD_LIMITS.excerpt),
      correction: optionalText(correction, FIELD_LIMITS.correction),
      explanation: optionalText(error?.explanation, FIELD_LIMITS.explanation),
      confidence: clampConfidence(error?.confidence),
      frontText,
      backText,
      exampleSentence: optionalText(error?.exampleSentence, FIELD_LIMITS.example),
      canonicalKey: canonicalSuggestionKey(userId, knowledgeCode, frontText, backText),
    };
  }
}
