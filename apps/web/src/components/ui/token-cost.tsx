'use client';

import { AlertCircle, AlertTriangle, CheckCircle2, Coins, Loader2, RotateCcw, Wallet } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useTokenStore, TOKEN_COSTS, type AIFeature } from '@/stores/token-store';
import { useLanguageStore } from '@/stores/language-store';
import { cn } from '@/lib/utils';
import Link from 'next/link';

/**
 * Verified charge lifecycle of a server-side AI operation. This is a view of
 * committed server state only: the client never derives a charge from a local
 * price label or optimistic guess.
 *
 * - `unknown`: the server has not supplied usable credit fields yet.
 * - `idle`: no operation is in flight.
 * - `reserved`: credits were debited up front; the operation may still run.
 * - `running`: in flight, but only the caller knows that (never a billing fact).
 * - `charged`: the operation settled and the debit was kept.
 * - `refunded`: the server confirmed a compensating refund ledger entry.
 * - `failed` / `cancelled`: terminal without a confirmed charge.
 * - `needs-reconciliation`: the operation outcome is indeterminate; never
 *   present it as a refund.
 */
export type TokenChargeStatus =
  | 'unknown'
  | 'idle'
  | 'reserved'
  | 'running'
  | 'charged'
  | 'refunded'
  | 'failed'
  | 'cancelled'
  | 'needs-reconciliation';

/** Raw operation facts as supplied by the server (camelCase or snake_case). */
export interface TokenChargeInput {
  status?: unknown;
  reservedCredits?: unknown;
  reserved_credits?: unknown;
  chargedCredits?: unknown;
  charged_credits?: unknown;
  refunded?: unknown;
  errorCode?: unknown;
  error_code?: unknown;
}

const OPERATION_STATUSES = new Set([
  'PENDING',
  'RESERVED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'UNKNOWN',
]);

/** Accept only finite, non-negative server amounts; never default or guess. */
function serverAmount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

/**
 * Map validated server operation fields to a charge status.
 *
 * Missing, non-finite or negative credit fields yield `unknown`; an `UNKNOWN`
 * operation is always `needs-reconciliation`, never `refunded`. A confirmed
 * `refunded` flag takes precedence over amounts, while a successful settlement
 * with a positive charged amount is `charged` and otherwise remains `unknown`.
 */
export function mapOperationChargeStatus(input: TokenChargeInput | null | undefined): TokenChargeStatus {
  if (!input || typeof input !== 'object') return 'unknown';

  const opStatus = typeof input.status === 'string' ? input.status.toUpperCase() : '';
  if (!OPERATION_STATUSES.has(opStatus)) return 'unknown';

  const errorCode =
    typeof input.errorCode === 'string'
      ? input.errorCode.toUpperCase()
      : typeof input.error_code === 'string'
        ? input.error_code.toUpperCase()
        : '';
  if (
    opStatus === 'UNKNOWN' ||
    errorCode === 'OPERATION_UNKNOWN' ||
    errorCode === 'UNKNOWN'
  ) {
    return 'needs-reconciliation';
  }

  // A confirmed compensating ledger entry is authoritative on its own; the
  // amount is optional display detail, not a precondition for the status.
  if (input.refunded === true) return 'refunded';

  const reserved = serverAmount(input.reservedCredits ?? input.reserved_credits);
  const charged = serverAmount(input.chargedCredits ?? input.charged_credits);
  if (reserved === null && charged === null) return 'unknown';

  if (charged !== null && charged > 0) return 'charged';
  if (opStatus === 'SUCCEEDED') return 'unknown';

  return opStatus === 'RUNNING' && reserved !== null
    ? 'reserved'
    : opStatus === 'FAILED'
      ? 'failed'
      : opStatus === 'CANCELLED'
        ? 'cancelled'
        : 'reserved';
}

/** Labels are shown verbatim; amounts come only from server-supplied fields. */
type StaticChargeStatus = Exclude<TokenChargeStatus, 'reserved' | 'charged' | 'refunded'>;

const STATUS_LABELS: Record<StaticChargeStatus, string> = {
  unknown: 'Charge status unavailable',
  idle: 'No charge in progress',
  running: 'Processing — charge not confirmed',
  failed: 'Operation failed — charge status not confirmed',
  cancelled: 'Operation cancelled — charge status not confirmed',
  'needs-reconciliation': 'Refund pending reconciliation',
};

function chargeStatusLabel(
  status: TokenChargeStatus,
  reservedCredits?: number,
  chargedCredits?: number,
): string {
  if (status === 'reserved') {
    return reservedCredits !== undefined
      ? `${reservedCredits} credits held (deducted)`
      : 'Credits held (deducted)';
  }
  if (status === 'charged') {
    return chargedCredits !== undefined
      ? `${chargedCredits} credits charged`
      : 'Credits charged';
  }
  if (status === 'refunded') {
    const amount = chargedCredits ?? reservedCredits;
    return amount !== undefined
      ? `${amount} credits returned`
      : 'Credits returned';
  }
  return STATUS_LABELS[status];
}

const STATUS_ICON_STYLES: Record<TokenChargeStatus, string> = {
  unknown: 'text-muted-foreground',
  idle: 'text-muted-foreground',
  reserved: 'text-amber-600 dark:text-amber-400',
  running: 'text-blue-600 dark:text-blue-400',
  charged: 'text-emerald-600 dark:text-emerald-400',
  refunded: 'text-emerald-600 dark:text-emerald-400',
  failed: 'text-red-600 dark:text-red-400',
  cancelled: 'text-red-600 dark:text-red-400',
  'needs-reconciliation': 'text-amber-700 dark:text-amber-300',
};

function ChargeStatusIcon({ status, className }: { status: TokenChargeStatus; className?: string }) {
  const iconClass = cn('h-3.5 w-3.5 shrink-0', STATUS_ICON_STYLES[status], className);
  switch (status) {
    case 'reserved':
      return <Wallet className={iconClass} aria-hidden="true" />;
    case 'running':
      return <Loader2 className={cn(iconClass, 'animate-spin')} aria-hidden="true" />;
    case 'charged':
    case 'refunded':
      return <CheckCircle2 className={iconClass} aria-hidden="true" />;
    case 'failed':
    case 'cancelled':
    case 'needs-reconciliation':
      return <AlertCircle className={iconClass} aria-hidden="true" />;
    default:
      return <RotateCcw className={iconClass} aria-hidden="true" />;
  }
}

/**
 * Separated, server-verified charge status. `key` on the text node keeps the
 * live region stable for delta-by-delta streaming: only a real status change
 * is announced, not every repeated render of the same status.
 */
export function TokenChargeStatus({
  status = 'unknown',
  reservedCredits,
  chargedCredits,
  className,
}: {
  status?: TokenChargeStatus;
  reservedCredits?: number;
  chargedCredits?: number;
  className?: string;
}) {
  if (status === 'unknown' || status === 'idle') return null;

  const label = chargeStatusLabel(status, reservedCredits, chargedCredits);
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 text-xs', className)}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-charge-status={status}
    >
      <ChargeStatusIcon status={status} />
      <span key={`${status}:${label}`} className="font-medium tabular-nums">
        {label}
      </span>
    </span>
  );
}

interface TokenCostProps {
  feature: AIFeature;
  className?: string;
  showWarning?: boolean;
  variant?: 'badge' | 'inline' | 'button-label';
  /** Verified server charge status; never inferred from TOKEN_COSTS. */
  chargeStatus?: TokenChargeStatus;
  /** Server-reported amounts used only for display in the status row. */
  reservedCredits?: number;
  chargedCredits?: number;
}

export function TokenCost({
  feature,
  className,
  showWarning = true,
  variant = 'badge',
  chargeStatus = 'unknown',
  reservedCredits,
  chargedCredits,
}: TokenCostProps) {
  const { canAfford } = useTokenStore();
  const { t } = useLanguageStore();
  const cost = TOKEN_COSTS[feature];
  const affordable = canAfford(feature);

  const hasStatus = chargeStatus !== 'unknown' && chargeStatus !== 'idle';
  const statusRow = hasStatus ? (
    <TokenChargeStatus
      status={chargeStatus}
      reservedCredits={reservedCredits}
      chargedCredits={chargedCredits}
    />
  ) : null;

  if (variant === 'inline') {
    return (
      <span className={cn('inline-flex items-center gap-1 text-xs', className)}>
        <Coins className="h-3 w-3 text-amber-500" />
        <span className={cn('font-medium tabular-nums', affordable ? 'text-amber-600 dark:text-amber-400' : 'text-red-500')}>
          {cost}
        </span>
        {statusRow}
      </span>
    );
  }

  if (variant === 'button-label') {
    return (
      <span className={cn('inline-flex items-center gap-1', className)}>
        <Coins className="h-3.5 w-3.5 text-amber-500" />
        <span className="text-xs font-medium tabular-nums">{cost}</span>
        {statusRow}
      </span>
    );
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <Badge
        variant="secondary"
        className={cn(
          'text-xs',
          affordable
            ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
            : 'bg-red-500/10 text-red-600 dark:text-red-400'
        )}
      >
        <Coins className="mr-1 h-3 w-3" />
        {cost} tokens
      </Badge>

      {showWarning && !affordable && (
        <Link href="/pricing" className="flex items-center gap-1 text-xs text-red-500 hover:underline">
          <AlertTriangle className="h-3 w-3" />
          {t.common.outOfTokens}
        </Link>
      )}

      {statusRow && <span className="w-full border-t border-border/50 pt-1" aria-hidden="true" />}
      {statusRow}
    </div>
  );
}

/**
 * Balance-refresh wrapper for AI actions. Reservation, settlement and refund
 * are owned entirely by the server ledger; this hook does not charge anything.
 * Returns { consumeAndRun, refreshBalance, canAfford, cost }.
 */
export function useTokenGate(feature: AIFeature) {
  const { canAfford, balance, loadBalance } = useTokenStore();
  const cost = TOKEN_COSTS[feature];

  const refreshBalance = async (): Promise<void> => {
    await loadBalance();
  };

  /** @deprecated Use `refreshBalance`; the name implied client-side charging. */
  const consumeAndRun = async <T,>(action: () => Promise<T>): Promise<T | null> => {
    if (!canAfford(feature)) return null;
    try {
      const result = await action();
      return result;
    } finally {
      await refreshBalance();
    }
  };

  return {
    consumeAndRun,
    refreshBalance,
    canAfford: canAfford(feature),
    cost,
    balance,
  };
}

/*
 * In-file tests: this slice is restricted to a single editable path, so the
 * mapper and status region are verified here rather than in a sibling spec.
 * Run with: vitest run src/components/ui/token-cost.tsx
 */
type VitestImportMeta = ImportMeta & { readonly vitest?: typeof import('vitest') };
const vitest = (import.meta as VitestImportMeta).vitest;
if (vitest) {
  const { describe, it, expect, afterEach } = vitest;
  const { cleanup } = require('@testing-library/react') as typeof import('@testing-library/react');

  afterEach(() => {
    cleanup();
  });

  describe('mapOperationChargeStatus', () => {
    it('reports unknown for missing or invalid server amounts', () => {
      expect(mapOperationChargeStatus(undefined)).toBe('unknown');
      expect(mapOperationChargeStatus({ status: 'SUCCEEDED' })).toBe('unknown');
      expect(mapOperationChargeStatus({ status: 'RUNNING', reservedCredits: -1 })).toBe('unknown');
      expect(mapOperationChargeStatus({ status: 'RUNNING', reservedCredits: Number.NaN })).toBe('unknown');
    });

    it('never reports a refund for UNKNOWN operations', () => {
      expect(mapOperationChargeStatus({ status: 'UNKNOWN', refunded: true })).toBe('needs-reconciliation');
    });

    it('maps verified server facts to explicit charge states', () => {
      expect(mapOperationChargeStatus({ status: 'RUNNING', reserved_credits: 5 })).toBe('reserved');
      expect(mapOperationChargeStatus({ status: 'SUCCEEDED', chargedCredits: 5 })).toBe('charged');
      expect(mapOperationChargeStatus({ status: 'FAILED', reservedCredits: 5, refunded: true })).toBe('refunded');
      expect(mapOperationChargeStatus({ status: 'FAILED', reservedCredits: 5 })).toBe('failed');
      expect(mapOperationChargeStatus({ status: 'CANCELLED', reservedCredits: 5 })).toBe('cancelled');
    });
  });

  describe('TokenChargeStatus', () => {
    it('uses a single stable live region with an explicit amount label', () => {
      const { render, screen } = require('@testing-library/react') as typeof import('@testing-library/react');
      render(
        <TokenChargeStatus status="reserved" reservedCredits={5} />,
      );
      const status = screen.getByRole('status');
      expect(status).toHaveAttribute('aria-live', 'polite');
      expect(status).toHaveTextContent('5 credits held (deducted)');
    });

    it('shows no status region before the server reports charge facts', () => {
      const { render, screen } = require('@testing-library/react') as typeof import('@testing-library/react');
      render(<TokenChargeStatus status="unknown" />);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });
}
