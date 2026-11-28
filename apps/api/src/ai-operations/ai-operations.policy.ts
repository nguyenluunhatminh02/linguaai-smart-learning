import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { AiOperationStatus } from './ai-operations.repository';

/** Features accepted by the AI operation module. */
export const AI_OPERATION_FEATURES = [
  'ai_chat',
  'writing_feedback',
  'reading_generate',
  'grammar_explain',
  'listening_generate',
  'quiz_generate',
  'translation_ai',
  'speaking_feedback',
  'learning_path',
  'cards_generate',
] as const;

export type AiOperationFeature = (typeof AI_OPERATION_FEATURES)[number];

/** Languages allowed in the canonical hash input (mirrors chat.controller.ts). */
export const AI_OPERATION_LANGUAGES = [
  'english',
  'vietnamese',
  'japanese',
  'korean',
  'french',
  'spanish',
  'german',
  'chinese',
  'italian',
  'portuguese',
  'russian',
] as const;

/** Server-side catalog snapshot; a client never supplies the price. */
export const AI_OPERATION_PRICING_VERSION = 'v1';

export const AI_OPERATION_COSTS: Record<AiOperationFeature, number> = {
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
};

/**
 * Only validated, stable inputs participate in the request hash. Timestamps,
 * random lease tokens and provider outputs must never be included: a replay
 * with the same key must hash to the same value.
 */
export interface CanonicalOperationPayload {
  feature: string;
  language: string;
  conversationId?: string | null;
  message: string;
}

const TERMINAL_STATUSES: ReadonlySet<AiOperationStatus> = new Set([
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
]);

/** Allowed transitions. Terminal states have no outgoing transition. */
const TRANSITIONS: Record<AiOperationStatus, readonly AiOperationStatus[]> = {
  RESERVED: ['RUNNING', 'CANCELLED'],
  RUNNING: ['SUCCEEDED', 'FAILED', 'UNKNOWN', 'CANCELLED'],
  UNKNOWN: ['SUCCEEDED', 'FAILED'],
  SUCCEEDED: [],
  FAILED: [],
  CANCELLED: [],
};

/**
 * Failures whose outcome is known are refundable; ambiguous or user-caused
 * failures follow the UNKNOWN policy and require explicit reconciliation.
 */
const REFUNDABLE_ERROR_CODES: ReadonlySet<string> = new Set([
  'PROVIDER_UNAVAILABLE',
  'INVALID_AI_OUTPUT',
  'VALIDATION_ERROR',
  'INSUFFICIENT_CREDITS',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
]);

const AMBIGUOUS_ERROR_CODES: ReadonlySet<string> = new Set([
  'PROVIDER_TIMEOUT',
  'OPERATION_UNKNOWN',
]);

export interface RefundDecision {
  refund: boolean;
  reason: 'refund' | 'requires_reconciliation' | 'terminal' | 'not_refundable';
}

@Injectable()
export class AiOperationsPolicy {
  /** Default lease duration in milliseconds (recoverable after a crash). */
  static readonly DEFAULT_LEASE_TTL_MS = 60_000;
  /** A leased operation may not be retried indefinitely. */
  static readonly DEFAULT_MAX_ATTEMPTS = 3;

  getCost(feature: AiOperationFeature): number {
    const cost = AI_OPERATION_COSTS[feature];
    if (cost === undefined) {
      throw new Error(`Unsupported AI operation feature: ${feature}`);
    }
    return cost;
  }

  getPricingVersion(): string {
    return AI_OPERATION_PRICING_VERSION;
  }

  /**
   * Deterministic sha256 of a canonical JSON object. Object keys are sorted
   * recursively so equivalent payloads always produce the same digest.
   */
  computeRequestHash(payload: CanonicalOperationPayload): string {
    return createHash('sha256')
      .update(AI_OPERATION_PRICING_VERSION)
      .update('\0')
      .update(JSON.stringify(canonicalize(payload)))
      .digest('hex');
  }

  /** Generate an unguessable fencing token for a lease. */
  newLeaseToken(): string {
    return randomBytes(24).toString('hex');
  }

  getLeaseDeadline(now: Date = new Date(), ttlMs = AI_OPERATION_POLICY_TTL): Date {
    return new Date(now.getTime() + ttlMs);
  }

  canTransition(from: AiOperationStatus, to: AiOperationStatus): boolean {
    return TRANSITIONS[from].includes(to);
  }

  isTerminal(status: AiOperationStatus): boolean {
    return TERMINAL_STATUSES.has(status);
  }

  /**
   * A worker may finalize only for its own lease, before expiry and before
   * the attempt budget is exhausted. Terminal operations never re-enter work.
   */
  canFinalize(
    operation: {
      status: AiOperationStatus;
      lease_token: string | null;
      lease_until: Date | null;
      attempt_count: number;
    },
    leaseToken: string,
    now: Date = new Date(),
  ): boolean {
    if (this.isTerminal(operation.status)) return false;
    if (operation.lease_token !== leaseToken || !operation.lease_token) return false;
    if (!operation.lease_until || operation.lease_until.getTime() <= now.getTime()) return false;
    return operation.attempt_count <= AI_OPERATION_POLICY_MAX_ATTEMPTS + 1;
  }

  /**
   * Refund policy hook. Failed operations with a known, non-ambiguous error
   * receive exactly one refund (enforced by the deterministic ledger key in
   * the service). UNKNOWN operations need reconciliation before a refund.
   */
  getRefundDecision(status: AiOperationStatus, errorCode?: string | null): RefundDecision {
    // A refund is decided at the moment of transition, when the new status
    // may already be terminal (FAILED/CANCELLED). Replaying the same hook must
    // still be safe: the ledger key makes the second credit a no-op.
    if (status === 'SUCCEEDED' || status === 'CANCELLED') {
      return { refund: false, reason: 'terminal' };
    }
    if (!errorCode) return { refund: false, reason: 'not_refundable' };
    if (AMBIGUOUS_ERROR_CODES.has(errorCode)) {
      return { refund: false, reason: 'requires_reconciliation' };
    }
    if (REFUNDABLE_ERROR_CODES.has(errorCode)) {
      return { refund: true, reason: 'refund' };
    }
    return { refund: false, reason: 'not_refundable' };
  }

  /** Cancellation before or during execution is refundable. */
  getCancellationRefundDecision(status: AiOperationStatus): RefundDecision {
    if (this.isTerminal(status)) return { refund: false, reason: 'terminal' };
    return { refund: true, reason: 'refund' };
  }
}

/** Module-level defaults kept as constants so policy calls stay pure. */
const AI_OPERATION_POLICY_TTL = AiOperationsPolicy.DEFAULT_LEASE_TTL_MS;
const AI_OPERATION_POLICY_MAX_ATTEMPTS = AiOperationsPolicy.DEFAULT_MAX_ATTEMPTS;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      if (source[key] !== undefined) sorted[key] = canonicalize(source[key]);
    }
    return sorted;
  }
  return value;
}
