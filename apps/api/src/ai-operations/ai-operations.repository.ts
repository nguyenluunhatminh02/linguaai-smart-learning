import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * These types describe only the ai_operations columns used by this slice.
 * They intentionally do not depend on the generated Prisma delegate: the
 * schema/migration for `ai_operations` is a separate slice, and the generated
 * client does not expose the model yet. At runtime PrismaService is used for
 * every query; once generated, the delegate satisfies this interface as-is.
 */
export const AI_OPERATION_STATUSES = [
  'RESERVED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'UNKNOWN',
  'CANCELLED',
] as const;

export type AiOperationStatus = (typeof AI_OPERATION_STATUSES)[number];

export interface AiOperationRecord {
  id: string;
  user_id: string;
  feature: string;
  client_operation_id: string;
  request_hash: string;
  pricing_version: string;
  reserved_credits: number;
  charged_credits: number;
  status: AiOperationStatus;
  attempt_count: number;
  lease_until: Date | null;
  lease_token: string | null;
  version: number;
  conversation_id: string | null;
  result_ref: string | null;
  error_code: string | null;
  created_at: Date;
  updated_at: Date;
  finished_at: Date | null;
}

export interface AiOperationScope {
  userId: string;
  feature: string;
  clientOperationId: string;
}

export interface CreateAiOperationInput extends AiOperationScope {
  requestHash: string;
  pricingVersion: string;
  reservedCredits: number;
  conversationId?: string | null;
}

export interface ClaimLeaseInput {
  id: string;
  userId: string;
  expectedVersion: number;
  leaseToken: string;
  leaseUntil: Date;
}

export interface MarkTerminalInput {
  id: string;
  userId: string;
  expectedVersion: number;
  leaseToken: string;
  status: Extract<
    AiOperationStatus,
    'SUCCEEDED' | 'FAILED' | 'UNKNOWN' | 'CANCELLED'
  >;
  chargedCredits?: number;
  resultRef?: string | null;
  errorCode?: string | null;
  finishedAt?: Date;
}

/** Prisma error code for a unique-constraint violation. */
const UNIQUE_VIOLATION = 'P2002';

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}

function isPrismaClientKnownError(error: unknown): boolean {
  return error instanceof Error && 'code' in error;
}

/** Access `prisma.ai_operations` once the generated client includes the model. */
function operationsDelegate(
  prisma: PrismaService,
): Record<string, (...args: any[]) => any> {
  const delegate = (prisma as unknown as Record<string, unknown>)[
    'ai_operations'
  ];
  if (!delegate) {
    throw new Error(
      'Prisma client is missing the ai_operations delegate; run db:generate after the schema migration',
    );
  }
  return delegate as Record<string, (...args: any[]) => any>;
}

@Injectable()
export class AiOperationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByScope(scope: AiOperationScope): Promise<AiOperationRecord | null> {
    return operationsDelegate(this.prisma).findFirst({
      where: {
        user_id: scope.userId,
        feature: scope.feature,
        client_operation_id: scope.clientOperationId,
      },
    });
  }

  findByIdForUser(
    id: string,
    userId: string,
  ): Promise<AiOperationRecord | null> {
    return operationsDelegate(this.prisma).findFirst({
      where: { id, user_id: userId },
    });
  }

  /**
   * Insert a RESERVED operation. A concurrent replay that trips the unique
   * constraint is read back instead of retried, so no side effect is repeated.
   */
  async create(
    input: CreateAiOperationInput,
  ): Promise<{ operation: AiOperationRecord; created: boolean }> {
    try {
      const operation = await operationsDelegate(this.prisma).create({
        data: {
          user_id: input.userId,
          feature: input.feature,
          client_operation_id: input.clientOperationId,
          request_hash: input.requestHash,
          pricing_version: input.pricingVersion,
          reserved_credits: input.reservedCredits,
          charged_credits: 0,
          status: 'RESERVED',
          attempt_count: 0,
          conversation_id: input.conversationId ?? null,
        },
      });
      return { operation, created: true };
    } catch (error) {
      if (isUniqueViolation(error)) {
        const existing = await this.findByScope(input);
        if (existing) return { operation: existing, created: false };
      }
      throw error;
    }
  }

  /**
   * Fenced lease claim: only a RESERVED row, or an expired RUNNING/UNKNOWN
   * lease, can be claimed. The version check rejects a stale worker that
   * returns after another worker took over the lease.
   */
  async claimLease(input: ClaimLeaseInput): Promise<AiOperationRecord | null> {
    const now = new Date();
    const updated = await operationsDelegate(this.prisma).updateMany({
      where: {
        id: input.id,
        user_id: input.userId,
        version: input.expectedVersion,
        OR: [
          { status: 'RESERVED' },
          { status: { in: ['RUNNING', 'UNKNOWN'] }, lease_until: { lt: now } },
          // UNKNOWN operations are released for reconciliation after a
          // terminalizing write clears their lease token/deadline.
          { status: 'UNKNOWN', lease_until: null },
        ],
      },
      data: {
        status: 'RUNNING',
        lease_until: input.leaseUntil,
        lease_token: input.leaseToken,
        version: { increment: 1 },
        attempt_count: { increment: 1 },
        updated_at: now,
      },
    });
    if (updated.count !== 1) return null;
    const operation = await this.findByIdForUser(input.id, input.userId);
    return operation && operation.version === input.expectedVersion + 1
      ? operation
      : null;
  }

  /**
   * Fenced terminal transition. `status` is restricted to non-running states
   * and the update requires the exact lease token/version held by the worker,
   * so a stale worker cannot commit a result after its lease expired.
   */
  async markTerminal(
    input: MarkTerminalInput,
  ): Promise<AiOperationRecord | null> {
    const now = input.finishedAt ?? new Date();
    const updated = await operationsDelegate(this.prisma).updateMany({
      where: {
        id: input.id,
        user_id: input.userId,
        version: input.expectedVersion,
        lease_token: input.leaseToken,
        status: { in: ['RUNNING', 'UNKNOWN'] },
      },
      data: {
        status: input.status,
        charged_credits: input.chargedCredits ?? 0,
        result_ref: input.resultRef ?? null,
        error_code: input.errorCode ?? null,
        lease_until: null,
        lease_token: null,
        finished_at: now,
        updated_at: now,
      },
    });
    if (updated.count !== 1) return null;
    return this.findByIdForUser(input.id, input.userId);
  }

  /** Return true only when this worker still owns the current lease. */
  async hasActiveLease(
    id: string,
    userId: string,
    leaseToken: string,
    version: number,
  ): Promise<boolean> {
    const operation = await this.findByIdForUser(id, userId);
    if (!operation) return false;
    return (
      operation.lease_token === leaseToken &&
      operation.version === version &&
      operation.lease_until !== null &&
      operation.lease_until.getTime() > Date.now() &&
      (operation.status === 'RUNNING' || operation.status === 'UNKNOWN')
    );
  }

  /**
   * Explicitly move RUNNING/UNKNOWN back to UNKNOWN for reconciliation.
   * Cancelled/succeeded/failed rows are never touched; terminal is immutable.
   */
  async markUnknown(
    id: string,
    userId: string,
    version: number,
    leaseToken: string,
  ): Promise<AiOperationRecord | null> {
    const now = new Date();
    const updated = await operationsDelegate(this.prisma).updateMany({
      where: {
        id,
        user_id: userId,
        version,
        lease_token: leaseToken,
        status: { in: ['RUNNING', 'UNKNOWN'] },
      },
      data: { status: 'UNKNOWN', lease_until: null, updated_at: now },
    });
    return updated.count === 1 ? this.findByIdForUser(id, userId) : null;
  }

  /** Read every operation whose lease has expired and which is not terminal. */
  findExpired(now: Date, limit = 100): Promise<AiOperationRecord[]> {
    return operationsDelegate(this.prisma).findMany({
      where: {
        status: { in: ['RESERVED', 'RUNNING', 'UNKNOWN'] },
        OR: [{ lease_until: null }, { lease_until: { lt: now } }],
      },
      take: limit,
      orderBy: { created_at: 'asc' },
    });
  }

  /** Keep the Prisma error class factory reachable for callers/tests. */
  isKnownRequestError(error: unknown): boolean {
    return isPrismaClientKnownError(error);
  }
}
