'use client';

import { Sparkles } from 'lucide-react';
import { useLanguageStore } from '@/stores/language-store';

export default function DashboardLoading() {
  const { t } = useLanguageStore();

  return (
    <div className="flex h-[60vh] flex-col items-center justify-center gap-4">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl gradient-bg shadow-sm shadow-primary/15 animate-pulse-ring">
        <Sparkles className="h-6 w-6 text-white" />
      </div>
      <div className="flex flex-col items-center gap-1">
        <p className="text-sm font-medium text-foreground/70" suppressHydrationWarning>
          {t.common.loading}
        </p>
      </div>
    </div>
  );
}
