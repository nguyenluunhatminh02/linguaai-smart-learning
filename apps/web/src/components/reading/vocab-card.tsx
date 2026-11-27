'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, Volume2 } from 'lucide-react';
import { speakWord } from '@/lib/speech';
import { FlagIcon } from '@/components/ui/flag-icon';

interface VocabCardProps {
  word: string;
  definition: string;
  definitionVi: string;
  partOfSpeech?: string;
  example?: string;
  phonetic?: string;
  /** Accent color: 'blue' (reading) | 'violet' (listening) */
  accent?: 'blue' | 'violet';
}

export function VocabCard({
  word,
  definition,
  definitionVi,
  partOfSpeech,
  example,
  phonetic,
  accent = 'blue',
}: VocabCardProps) {
  const [expanded, setExpanded] = useState(false);

  const displayPhonetic = phonetic;
  const secondExample = null;

  const accentCls =
    accent === 'violet'
      ? 'text-violet-600 dark:text-violet-400'
      : 'text-blue-600 dark:text-blue-400';

  const expandedBorderCls =
    accent === 'violet'
      ? 'border-violet-300 dark:border-violet-700 bg-violet-50 dark:bg-violet-950/40 ring-1 ring-violet-200 dark:ring-violet-800/50'
      : 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/40 ring-1 ring-blue-200 dark:ring-blue-800/50';

  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      className={`rounded-xl border p-3 cursor-pointer select-none transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
        expanded ? expandedBorderCls : 'border-border bg-card hover:border-primary/30 hover:bg-muted/30'
      }`}
      onClick={() => setExpanded((v) => !v)}
      onKeyDown={(e) => {
        // Keydowns from the inner speaker button must not toggle the card or
        // suppress that button's default Enter/Space activation.
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setExpanded((v) => !v);
        }
      }}
    >
      {/* Collapsed / header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <span className="font-semibold text-sm truncate">{word}</span>
          {partOfSpeech && (
            <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {partOfSpeech}
            </span>
          )}
        </div>
        <span className="shrink-0 mt-0.5 text-muted-foreground">
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </span>
      </div>

      {/* Collapsed summary — full contrast so cards look equally legible whether or not another is expanded */}
      {!expanded && (
        <p className="mt-1 text-xs text-muted-foreground line-clamp-1">{definition || definitionVi || 'Nhấn để xem chi tiết'}</p>
      )}

      {/* Expanded details */}
      {expanded && (
        <div className="mt-2 space-y-2" onClick={(e) => e.stopPropagation()}>
          {/* Phonetic + TTS */}
          <div className="flex items-center gap-2">
            <button
              className={`rounded p-1 transition-colors hover:bg-muted/60 ${accentCls}`}
              onClick={(e) => { e.stopPropagation(); speakWord(word); }}
              title="Nghe phát âm"
            >
              <Volume2 className="h-4 w-4" />
            </button>
            {displayPhonetic ? (
              <span className="text-xs font-mono text-muted-foreground">{displayPhonetic}</span>
            ) : (
              <span className="text-[10px] text-muted-foreground italic">Nhấn loa để nghe phát âm</span>
            )}
          </div>

          {/* Definitions */}
          <div className="space-y-0.5">
            {definition && <p className="text-xs text-foreground/90">{definition}</p>}
            {definitionVi ? (
              <p className={`text-xs font-semibold ${accentCls} flex items-center gap-1.5`}>
                <FlagIcon country="vi" className="h-3 w-4.5 shrink-0" />
                <span>{definitionVi}</span>
              </p>
            ) : !definition ? (
              <p className="text-xs text-muted-foreground italic">Chưa có định nghĩa</p>
            ) : null}
          </div>

          {/* Example sentences */}
          {(example || secondExample) && (
            <div className="space-y-1 border-t border-border/60 pt-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Ví dụ
              </p>
              {example && (
                <p className="text-[11px] italic text-foreground/75">
                  &bull; &ldquo;{example}&rdquo;
                </p>
              )}
              {secondExample && (
                <p className="text-[11px] italic text-foreground/75">
                  &bull; &ldquo;{secondExample}&rdquo;
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
