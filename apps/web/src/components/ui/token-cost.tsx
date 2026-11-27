'use client';

import { Coins, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useTokenStore, TOKEN_COSTS, type AIFeature } from '@/stores/token-store';
import { useLanguageStore } from '@/stores/language-store';
import { cn } from '@/lib/utils';
import Link from 'next/link';

interface TokenCostProps {
  feature: AIFeature;
  className?: string;
  showWarning?: boolean;
  variant?: 'badge' | 'inline' | 'button-label';
}

export function TokenCost({ feature, className, showWarning = true, variant = 'badge' }: TokenCostProps) {
  const { balance, canAfford } = useTokenStore();
  const { t } = useLanguageStore();
  const cost = TOKEN_COSTS[feature];
  const affordable = canAfford(feature);

  if (variant === 'inline') {
    return (
      <span className={cn('inline-flex items-center gap-1 text-xs', className)}>
        <Coins className="h-3 w-3 text-amber-500" />
        <span className={cn('font-medium tabular-nums', affordable ? 'text-amber-600 dark:text-amber-400' : 'text-red-500')}>
          {cost}
        </span>
      </span>
    );
  }

  if (variant === 'button-label') {
    return (
      <span className={cn('inline-flex items-center gap-1', className)}>
        <Coins className="h-3.5 w-3.5 text-amber-500" />
        <span className="text-xs font-medium tabular-nums">{cost}</span>
      </span>
    );
  }

  return (
    <div className={cn('flex items-center gap-2', className)}>
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
    </div>
  );
}

/**
 * Hook to consume tokens before performing an AI action.
 * Returns { consumeAndRun, canAfford, cost }
 */
export function useTokenGate(feature: AIFeature) {
  const { canAfford, balance, loadBalance } = useTokenStore();
  const cost = TOKEN_COSTS[feature];

  const consumeAndRun = async <T,>(action: () => Promise<T>): Promise<T | null> => {
    if (!canAfford(feature)) return null;
    try {
      const result = await action();
      return result;
    } finally {
      await loadBalance();
    }
  };

  return {
    consumeAndRun,
    canAfford: canAfford(feature),
    cost,
    balance,
  };
}
