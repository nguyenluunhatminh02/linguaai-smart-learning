import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Outbox event statuses. Application-owned values: PENDING (default), CLAIMED
 * (lease held by a publisher), PUBLISHED (enqueue succeeded), FAILED (terminal
 * after max attempts or unrecoverable error). No PostgreSQL enum: the table is
 * raw-SQL-only and the vocabulary may evolve without another migration.
 */
export const OUTBOX_STATUSES = [
  'PENDING',
  'CLAIMED',
  'PUBLISHED',
  'FAILED',
] as const;

export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

/** Shape of a row in the raw-SQL-only outbox_events table. */
export interface OutboxRecord {
  id: string;
  operation_id: string;
  queue_name: string;
  payload: unknown;
  status: OutboxStatus;
  attempts: number;
  max_attempts: number;
  lease_until: Date | null;
  lease_token: string | null;
  published_at: Date | null;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateOutboxInput {
  operationId: string;
  queueName: string;
  payload: unknown;
  maxAttempts?: number;
}

export interface ClaimPendingInput {
  workerId: string;
  leaseUntil: Date;
  limit?: number;
  now?: Date;
}

export interface MarkPublishedInput {
  id: string;
  leaseToken: string;
  publishedAt?: Date;
}

export interface ReconcilePendingInput {
  now: Date;
  limit?: number;
}

export interface ReleaseLeaseInput {
  id: string;
  leaseToken: string;
}

export interface MarkFailedInput {
  id: string;
  leaseToken: string;
  error: string;
}

/** Default claim batch size; kept small to bound publisher scan cost. */
const DEFAULT_CLAIM_LIMIT = 50;

/** Default reconciliation scan limit. */
const DEFAULT_RECONCILE_LIMIT = 100;

/** Default max attempts before an outbox row is terminalized as FAILED. */
const DEFAULT_MAX_ATTEMPTS = 5;

/**
 * Durable outbox for AI operation jobs. The publisher claims PENDING rows,
 * enqueues with jobId=operationId, and marks PUBLISHED only after enqueue
 * succeeds. Reconciliation finds stale CLAIMED rows (lease expired) and
 * releases them back to PENDING for retry.
 *
 * Design constraints (from REL-03 roadmap):
 * - Reserve + operation + outbox in one DB transaction (orchestrator's job)
 * - Publisher claims pending outbox rows, enqueues, marks published
 * - Reconcile pending rows with expired leases
 * - Payload holds IDs only; no secrets/raw audio
 * - Fenced lease claims: stale worker cannot mark published after lease expired
 *
 * All access goes through tagged raw queries so no generated client changes
 * are required. Every identifier and value is parameterized by Prisma.
 */
@Injectable()
export class OutboxRepository {
  private readonly logger = new Logger(OutboxRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Insert a PENDING outbox row. The orchestrator must call this inside the
   * same prisma.$transaction that reserves credits and creates the operation;
   * this method never opens its own nested transaction.
   */
  async create(
    txOrPrisma: PrismaService | Parameters<PrismaService['$transaction']>[0],
    input: CreateOutboxInput,
  ): Promise<OutboxRecord> {
    const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    const executor = this.resolveExecutor(txOrPrisma);
    const rows = await executor.$queryRaw<OutboxRecord[]>`
      INSERT INTO outbox_events (operation_id, queue_name, payload, status, attempts, max_attempts)
      VALUES (
        ${input.operationId}::uuid,
        ${input.queueName},
        ${JSON.stringify(input.payload)}::jsonb,
        'PENDING',
        0,
        ${maxAttempts}
      )
      RETURNING id, operation_id, queue_name, payload, status, attempts, max_attempts,
                lease_until, lease_token, published_at, last_error, created_at, updated_at
    `;
    return rows[0];
  }

  /**
   * Claim up to `limit` PENDING rows (or CLAIMED rows with expired leases) and
   * mark them CLAIMED with a lease token and deadline. Uses FOR UPDATE SKIP
   * LOCKED so multiple publishers can scan concurrently without blocking.
   *
   * Returns the claimed rows. A stale worker that returns after its lease
   * expired cannot re-claim the same rows because the lease_token check in
   * markPublished will fail.
   */
  async claimPending(input: ClaimPendingInput): Promise<OutboxRecord[]> {
    const now = input.now ?? new Date();
    const limit = Math.min(
      Math.max(Math.trunc(input.limit ?? DEFAULT_CLAIM_LIMIT), 1),
      500,
    );

    // Two-step claim: SELECT ... FOR UPDATE SKIP LOCKED to pick rows, then
    // UPDATE to mark them CLAIMED. This is safer than a single UPDATE because
    // Prisma's $queryRaw does not support RETURNING on UPDATE with SKIP LOCKED
    // in all PostgreSQL versions, and the two-step pattern is explicit.
    return this.prisma.$transaction(async (tx) => {
      // Step 1: select candidate rows with row-level locks.
      const candidates = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM outbox_events
        WHERE status = 'PENDING'
           OR (status = 'CLAIMED' AND lease_until < ${now})
        ORDER BY created_at ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      `;

      if (candidates.length === 0) return [];

      const ids = candidates.map((c) => c.id);

      // Step 2: update the locked rows to CLAIMED.
      await tx.$executeRaw`
        UPDATE outbox_events
        SET status = 'CLAIMED',
            lease_token = ${input.workerId},
            lease_until = ${input.leaseUntil},
            attempts = attempts + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ANY(${ids}::uuid[])
      `;

      // Step 3: re-read the claimed rows to return them.
      const claimed = await tx.$queryRaw<OutboxRecord[]>`
        SELECT id, operation_id, queue_name, payload, status, attempts, max_attempts,
               lease_until, lease_token, published_at, last_error, created_at, updated_at
        FROM outbox_events
        WHERE id = ANY(${ids}::uuid[])
      `;

      return claimed;
    });
  }

  /**
   * Mark a CLAIMED row as PUBLISHED after successful enqueue. Requires the
   * exact lease token held by the worker, so a stale worker that returns after
   * its lease expired cannot mark a row published. Returns null if the lease
   * token does not match (stale worker) or the row is not CLAIMED.
   */
  async markPublished(input: MarkPublishedInput): Promise<OutboxRecord | null> {
    const publishedAt = input.publishedAt ?? new Date();
    const rows = await this.prisma.$queryRaw<OutboxRecord[]>`
      UPDATE outbox_events
      SET status = 'PUBLISHED',
          published_at = ${publishedAt},
          lease_until = NULL,
          lease_token = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ${input.id}::uuid
        AND status = 'CLAIMED'
        AND lease_token = ${input.leaseToken}
      RETURNING id, operation_id, queue_name, payload, status, attempts, max_attempts,
                lease_until, lease_token, published_at, last_error, created_at, updated_at
    `;
    return rows[0] ?? null;
  }

  /**
   * Mark a CLAIMED row as FAILED after a terminal error (max attempts reached
   * or unrecoverable). Requires the exact lease token. Returns null if the
   * lease token does not match or the row is not CLAIMED.
   */
  async markFailed(input: MarkFailedInput): Promise<OutboxRecord | null> {
    const rows = await this.prisma.$queryRaw<OutboxRecord[]>`
      UPDATE outbox_events
      SET status = 'FAILED',
          last_error = ${input.error},
          lease_until = NULL,
          lease_token = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ${input.id}::uuid
        AND status = 'CLAIMED'
        AND lease_token = ${input.leaseToken}
      RETURNING id, operation_id, queue_name, payload, status, attempts, max_attempts,
                lease_until, lease_token, published_at, last_error, created_at, updated_at
    `;
    return rows[0] ?? null;
  }

  /**
   * Find CLAIMED rows with expired leases for reconciliation. These rows were
   * claimed by a worker that crashed or lost its lease before marking them
   * PUBLISHED/FAILED. The reconciler resets them to PENDING for retry.
   */
  async findExpiredClaimed(
    now: Date,
    limit = DEFAULT_RECONCILE_LIMIT,
  ): Promise<OutboxRecord[]> {
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 1000);
    return this.prisma.$queryRaw<OutboxRecord[]>`
      SELECT id, operation_id, queue_name, payload, status, attempts, max_attempts,
             lease_until, lease_token, published_at, last_error, created_at, updated_at
      FROM outbox_events
      WHERE status = 'CLAIMED' AND lease_until < ${now}
      ORDER BY created_at ASC
      LIMIT ${safeLimit}
    `;
  }

  /**
   * Release a lease on a CLAIMED row, resetting it to PENDING for retry.
   * Requires the exact lease token. Returns null if the lease token does not
   * match or the row is not CLAIMED. Used by reconciliation to return expired
   * leases to the pending pool.
   */
  async releaseLease(input: ReleaseLeaseInput): Promise<OutboxRecord | null> {
    const rows = await this.prisma.$queryRaw<OutboxRecord[]>`
      UPDATE outbox_events
      SET status = 'PENDING',
          lease_until = NULL,
          lease_token = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ${input.id}::uuid
        AND status = 'CLAIMED'
        AND lease_token = ${input.leaseToken}
      RETURNING id, operation_id, queue_name, payload, status, attempts, max_attempts,
                lease_until, lease_token, published_at, last_error, created_at, updated_at
    `;
    return rows[0] ?? null;
  }

  /**
   * Reconcile pending rows: find CLAIMED rows with expired leases and reset
   * them to PENDING. Returns the number of rows reconciled. This is a
   * convenience wrapper around findExpiredClaimed + releaseLease for each row.
   *
   * Note: the caller should pass the lease_token from findExpiredClaimed to
   * releaseLease. This method does it in a loop for simplicity; a production
   * reconciler might batch the updates.
   */
  async reconcilePending(input: ReconcilePendingInput): Promise<number> {
    const expired = await this.findExpiredClaimed(
      input.now,
      input.limit ?? DEFAULT_RECONCILE_LIMIT,
    );
    if (expired.length === 0) return 0;

    let reconciled = 0;
    for (const row of expired) {
      if (!row.lease_token) continue;
      const released = await this.releaseLease({
        id: row.id,
        leaseToken: row.lease_token,
      });
      if (released) reconciled++;
    }

    this.logger.log(
      `Reconciled ${reconciled}/${expired.length} expired outbox leases`,
    );
    return reconciled;
  }

  /** Find an outbox row by ID. Returns null if not found. */
  async findById(id: string): Promise<OutboxRecord | null> {
    const rows = await this.prisma.$queryRaw<OutboxRecord[]>`
      SELECT id, operation_id, queue_name, payload, status, attempts, max_attempts,
             lease_until, lease_token, published_at, last_error, created_at, updated_at
      FROM outbox_events
      WHERE id = ${id}::uuid
    `;
    return rows[0] ?? null;
  }

  /** Find an outbox row by operation_id. Returns null if not found. */
  async findByOperationId(operationId: string): Promise<OutboxRecord | null> {
    const rows = await this.prisma.$queryRaw<OutboxRecord[]>`
      SELECT id, operation_id, queue_name, payload, status, attempts, max_attempts,
             lease_until, lease_token, published_at, last_error, created_at, updated_at
      FROM outbox_events
      WHERE operation_id = ${operationId}::uuid
    `;
    return rows[0] ?? null;
  }

  /**
   * Resolve the executor: if the caller passed a transaction callback, use it;
   * otherwise use the prisma client directly. This allows create() to be called
   * inside an orchestrator's transaction or standalone.
   */
  private resolveExecutor(
    txOrPrisma: PrismaService | Parameters<PrismaService['$transaction']>[0],
  ): Pick<PrismaService, '$queryRaw' | '$executeRaw'> {
    // If it's a function, it's a transaction callback; we can't use it directly
    // here because the caller is responsible for wrapping the call in $transaction.
    // The caller must pass the tx object from inside the callback.
    if (typeof txOrPrisma === 'function') {
      throw new Error(
        'OutboxRepository.create() must be called with a PrismaService or a transaction executor, not a callback. Pass the tx object from inside prisma.$transaction(async (tx) => ...).',
      );
    }
    return txOrPrisma;
  }
}
