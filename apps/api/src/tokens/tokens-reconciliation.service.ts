import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Ledger reconciliation service (roadmap BILL-04 / OPS-03).
 *
 * Computes the expected balance from the authoritative opening balance plus
 * the sum of all ledger entries up to a given point in time, compares it to
 * the stored balance, and reports any mismatch without performing silent
 * repair. The service is strictly read-only: it never writes to the database,
 * never touches Redis, and never calls TokensService mutating methods.
 *
 * Ledger semantics respected:
 *  - amount < 0  -> debit / consumption
 *  - amount > 0  -> grant / refund
 *  - amount === 0 -> BILL-04 settle marker (counted, contributes 0)
 *  - balance_after is a historical snapshot, NOT used for recomputation
 *  - idempotency_key is unique per transaction
 */

export interface ReconciliationOptions {
  /**
   * Only ledger entries with created_at <= asOf are included. Defaults to now().
   */
  asOf?: Date;

  /**
   * When set, reconcileAll restricts to this single user (useful for admin UI).
   */
  userId?: string;

  /**
   * Baseline opening balance. May be a fixed number (applied to every user)
   * or a function that resolves the baseline per user (e.g. from a snapshot
   * table or the first ledger entry). When omitted, the service treats the
   * baseline as 0 and records that in the report for auditability.
   */
  openingBalance?: number | ((userId: string) => number | Promise<number>);

  /**
   * Page size for batched iteration in reconcileAll. Clamped to [1, 1000].
   * Defaults to 500.
   */
  pageSize?: number;

  /**
   * Optional callback invoked for every mismatched user. Intended for future
   * metrics/alert wiring (e.g. incrementing token_reconciliation_mismatches_total).
   * Default is a no-op.
   */
  onMismatch?: (m: Mismatch) => void | Promise<void>;
}

export interface Mismatch {
  userId: string;
  expectedBalance: number;
  actualBalance: number;
  difference: number;
  checkedEntries: number;
}

export interface ReconciliationReport {
  asOf: Date;
  checkedUsers: number;
  checkedEntries: number;
  mismatches: Mismatch[];
  /**
   * The baseline used in the computation. When openingBalance was a function,
   * this records the string representation so legacy data remains auditable.
   */
  baseline: string;
}

@Injectable()
export class TokensReconciliationService {
  private readonly logger = new Logger(TokensReconciliationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Reconcile a single user. Returns the mismatch object when the stored
   * balance diverges from the recomputed balance, or null when they agree.
   * Logs a warning only on mismatch.
   */
  async reconcileUser(
    userId: string,
    options?: ReconciliationOptions,
  ): Promise<Mismatch | null> {
    const asOf = options?.asOf ?? new Date();
    if (!(asOf instanceof Date) || Number.isNaN(asOf.getTime())) {
      throw new Error('Reconciliation asOf must be a valid Date');
    }

    const openingBalance = await this.resolveOpeningBalance(userId, options);

    const balanceRow = await this.prisma.user_token_balance.findUnique({
      where: { user_id: userId },
      select: { balance: true },
    });
    const actualBalance = balanceRow?.balance ?? 0;

    const agg = await this.prisma.token_transactions.aggregate({
      where: {
        user_id: userId,
        created_at: { lte: asOf },
      },
      _sum: { amount: true },
      _count: { _all: true },
    });

    const ledgerSum = agg._sum.amount ?? 0;
    const checkedEntries = agg._count._all ?? 0;
    const expectedBalance = openingBalance + ledgerSum;
    const difference = actualBalance - expectedBalance;

    if (difference !== 0) {
      const mismatch: Mismatch = {
        userId,
        expectedBalance,
        actualBalance,
        difference,
        checkedEntries,
      };
      this.logger.warn(
        `Token reconciliation mismatch for user ${userId}: ` +
          `expected=${expectedBalance}, actual=${actualBalance}, ` +
          `difference=${difference}, entries=${checkedEntries}`,
      );
      if (options?.onMismatch) {
        await options.onMismatch(mismatch);
      }
      return mismatch;
    }

    return null;
  }

  /**
   * Reconcile all users. Iterates user_token_balance rows plus any ledger-only
   * user ids (users with transactions but no balance row). Uses keyset
   * pagination bounded by pageSize to avoid unbounded memory.
   */
  async reconcileAll(
    options?: ReconciliationOptions,
  ): Promise<ReconciliationReport> {
    const asOf = options?.asOf ?? new Date();
    if (!(asOf instanceof Date) || Number.isNaN(asOf.getTime())) {
      throw new Error('Reconciliation asOf must be a valid Date');
    }

    const pageSize = Math.min(1000, Math.max(1, options?.pageSize ?? 500));
    const mismatches: Mismatch[] = [];
    let checkedUsers = 0;
    let checkedEntries = 0;

    const baseline = this.describeBaseline(options?.openingBalance);

    // Collect all distinct user ids from both balance rows and ledger entries
    // using keyset pagination bounded by pageSize. groupBy with a user_id
    // cursor is used for the ledger to avoid skipping users with `distinct`.
    const userIds = new Set<string>();

    if (options?.userId) {
      // Restrict iteration up front so an explicitly requested user is always
      // checked, even without a balance row or any ledger entries.
      userIds.add(options.userId);
    } else {
      let cursor: string | undefined;
      while (true) {
        const rows = await this.prisma.user_token_balance.findMany({
          where: cursor ? { user_id: { gt: cursor } } : undefined,
          select: { user_id: true },
          orderBy: { user_id: 'asc' },
          take: pageSize,
        });
        if (rows.length === 0) break;
        for (const row of rows) userIds.add(row.user_id);
        cursor = rows[rows.length - 1].user_id;
        if (rows.length < pageSize) break;
      }

      cursor = undefined;
      while (true) {
        const ledgerRows = await this.fetchLedgerUsers(cursor, asOf, pageSize);
        if (ledgerRows.length === 0) break;
        for (const row of ledgerRows) userIds.add(row.user_id);
        cursor = ledgerRows[ledgerRows.length - 1].user_id;
        if (ledgerRows.length < pageSize) break;
      }
    }

    for (const uid of userIds) {
      checkedUsers++;
      const mismatch = await this.reconcileUser(uid, options);
      if (mismatch) {
        mismatches.push(mismatch);
        checkedEntries += mismatch.checkedEntries;
      } else {
        // Re-query to count entries for matched users (reconcileUser returns null).
        const agg = await this.prisma.token_transactions.aggregate({
          where: { user_id: uid, created_at: { lte: asOf } },
          _count: { _all: true },
        });
        checkedEntries += agg._count._all ?? 0;
      }
    }

    return {
      asOf,
      checkedUsers,
      checkedEntries,
      mismatches,
      baseline,
    };
  }

  /**
   * Bounded keyset page of distinct user ids present in the ledger.
   */
  private async fetchLedgerUsers(
    cursor: string | undefined,
    asOf: Date,
    pageSize: number,
  ): Promise<Array<{ user_id: string; _count: { _all: number } }>> {
    // Use a narrow view of the delegate: Prisma's generated groupBy overload
    // has deep generic conditions on the where/by types that would otherwise
    // require a large type assertion for this fixed-shape query.
    const delegate = this.prisma.token_transactions as unknown as {
      groupBy(args: {
        by: string[];
        where: Record<string, unknown>;
        orderBy: Record<string, string>;
        take: number;
        _count: { _all: true };
      }): Promise<Array<{ user_id: string; _count: { _all: number } }>>;
    };
    return delegate.groupBy({
      by: ['user_id'],
      where: cursor
        ? { user_id: { gt: cursor }, created_at: { lte: asOf } }
        : { created_at: { lte: asOf } },
      orderBy: { user_id: 'asc' },
      take: pageSize,
      _count: { _all: true },
    });
  }

  private async resolveOpeningBalance(
    userId: string,
    options?: ReconciliationOptions,
  ): Promise<number> {
    if (options?.openingBalance === undefined) return 0;
    if (typeof options.openingBalance === 'number')
      return options.openingBalance;
    return await options.openingBalance(userId);
  }

  private describeBaseline(
    openingBalance?: number | ((userId: string) => number | Promise<number>),
  ): string {
    if (openingBalance === undefined) return '0 (no baseline supplied)';
    if (typeof openingBalance === 'number') return String(openingBalance);
    return 'function (per-user baseline)';
  }
}
