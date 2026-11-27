'use client';

import { useLanguageStore } from '@/stores/language-store';
import { localeNames } from '@/lib/i18n/types';
import type { Locale } from '@/lib/i18n/types';
import { useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { useClickOutside } from '@/hooks/use-click-outside';
import { FlagIcon } from '@/components/ui/flag-icon';

const locales: Locale[] = ['en', 'vi', 'zh', 'ja', 'ko'];

export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale } = useLanguageStore();
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);
  const ref = useClickOutside(close);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={`Language: ${localeNames[locale]}`}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          'flex items-center gap-2 rounded-xl transition-all duration-200',
          compact
            ? 'h-8 w-8 items-center justify-center bg-muted/40 hover:bg-muted/70 text-muted-foreground/60 hover:text-foreground'
            : 'px-3 py-1.5 bg-muted/40 hover:bg-muted/70 text-sm font-medium text-muted-foreground/70 hover:text-foreground',
        )}
      >
        <FlagIcon country={locale} className="h-3.5 w-5 shrink-0" />
        <span className={cn('text-xs', compact ? 'sr-only' : 'hidden sm:inline')}>
          {localeNames[locale]}
        </span>
      </button>

      {open && (
        <div role="menu" aria-label="Select language" className="absolute right-0 top-full z-50 mt-1.5 w-44 rounded-xl border border-border/50 bg-popover p-1 shadow-lg animate-scale-in">
          {locales.map((l) => (
            <button
              key={l}
              onClick={() => { setLocale(l); setOpen(false); }}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-[13px] transition-colors',
                l === locale
                  ? 'bg-primary/[0.06] text-primary-dark font-medium'
                  : 'hover:bg-muted/40 text-foreground/70',
              )}
            >
              <FlagIcon country={l} className="h-3.5 w-5 shrink-0" />
              <span>{localeNames[l]}</span>
              {l === locale && <div className="ml-auto h-1 w-1 rounded-full bg-primary/40" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
