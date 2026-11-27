'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Volume2, X } from 'lucide-react';
import { speakWord } from '@/lib/speech';
import { FlagIcon } from '@/components/ui/flag-icon';

interface DictionaryEntry {
  word: string;
  phonetic: string;
  partOfSpeech: string;
  definition: string;
  definitionVi: string;
  example: string;
}

// ── Module-level cache (persists across mounts/navigations) ──────────────────
interface CacheRecord {
  entry: DictionaryEntry | null;
  expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;      // successful lookups and 404 misses
const MISS_TTL_MS = 30 * 1000;           // short TTL for definitive 404 misses
const MAX_CACHE_ENTRIES = 200;           // bound memory growth in long sessions
const apiCache = new Map<string, CacheRecord>();
const pendingFetches = new Map<string, Promise<DictionaryEntry | null>>();

function readCache(lw: string): DictionaryEntry | null | undefined {
  const record = apiCache.get(lw);
  if (!record) return undefined;
  if (record.expiresAt <= Date.now()) {
    apiCache.delete(lw);
    return undefined;
  }
  // Refresh insertion order for simple LRU eviction.
  apiCache.delete(lw);
  apiCache.set(lw, record);
  return record.entry;
}

function writeCache(lw: string, entry: DictionaryEntry | null, ttl: number) {
  apiCache.delete(lw);
  apiCache.set(lw, { entry, expiresAt: Date.now() + ttl });
  // Evict the least-recently-used entry once the cache grows past its cap.
  if (apiCache.size > MAX_CACHE_ENTRIES) {
    const oldest = apiCache.keys().next().value;
    if (oldest !== undefined) apiCache.delete(oldest);
  }
}

async function fetchFromFreeDict(word: string, signal?: AbortSignal): Promise<DictionaryEntry | null> {
  const lw = word.toLowerCase();
  const cached = readCache(lw);
  if (cached !== undefined) return cached ?? null;
  if (pendingFetches.has(lw)) return pendingFetches.get(lw)!;

  const promise = (async (): Promise<DictionaryEntry | null> => {
    try {
      const res = await fetch(
        `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(lw)}`,
        { signal },
      );
      // Only definitive "word not found" responses are cached, and briefly.
      if (res.status === 404) { writeCache(lw, null, MISS_TTL_MS); return null; }
      // Rate limits and server errors are transient — never cache them as misses.
      if (!res.ok) return null;
      const data = await res.json();
      if (!Array.isArray(data) || !data[0]) { writeCache(lw, null, MISS_TTL_MS); return null; }
      const e = data[0];
      const phonetic =
        e.phonetic ||
        (e.phonetics as { text?: string }[])?.find((p) => p.text)?.text ||
        '';
      const meaning = (e.meanings as { partOfSpeech: string; definitions: { definition: string; example?: string }[] }[])?.[0];
      const def0 = meaning?.definitions?.[0];
      const result: DictionaryEntry = {
        word: e.word || word,
        phonetic,
        partOfSpeech: meaning?.partOfSpeech || 'word',
        definition: def0?.definition || '',
        definitionVi: '',   // Free Dictionary API has no Vietnamese
        example: def0?.example || '',
      };
      writeCache(lw, result, CACHE_TTL_MS);
      return result;
    } catch {
      // Network errors and aborts are transient: leave the word uncached so
      // a later hover/click can retry once connectivity returns.
      return null;
    } finally {
      pendingFetches.delete(lw);
    }
  })();

  pendingFetches.set(lw, promise);
  return promise;
}

// ─────────────────────────────────────────────────────────────────────────────
interface WordHoverProps {
  text: string;
  className?: string;
}

export function WordHover({ text, className }: WordHoverProps) {
  const [tooltip, setTooltip] = useState<{ entry: DictionaryEntry; x: number; y: number } | null>(null);
  const [pinnedWord, setPinnedWord] = useState<string | null>(null);
  const [pendingLookup, setPendingLookup] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const currentHoverRef = useRef<string | null>(null);
  const requestSeqRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  // Invalidate any in-flight click lookup when the tooltip is dismissed.
  const dismiss = useCallback(() => {
    requestSeqRef.current += 1;
    setPendingLookup(false);
    setPinnedWord(null);
    setTooltip(null);
  }, []);

  // Pre-fetch all unique words in the passage in the background
  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current = controller;
    const unique = new Set(
      text
        .split(/\s+/)
        .map((t) => t.replace(/^[^a-zA-Z']+|[^a-zA-Z']+$/g, '').toLowerCase())
        .filter((w) => w.length >= 2 && readCache(w) === undefined),
    );
    const wordsToFetch = [...unique].slice(0, 20);
    wordsToFetch.forEach((w) => {
      if (!controller.signal.aborted) fetchFromFreeDict(w, controller.signal);
    });
    return () => {
      controller.abort();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [text]);

  const calcPos = useCallback((e: React.MouseEvent<HTMLSpanElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const containerRect = containerRef.current?.getBoundingClientRect();
    if (!containerRect) return null;
    return {
      x: rect.left - containerRect.left + rect.width / 2,
      y: rect.top - containerRect.top,
    };
  }, []);

  const handleMouseEnter = useCallback(
    async (e: React.MouseEvent<HTMLSpanElement>, word: string) => {
      if (pinnedWord || !word || word.length < 2) return;
      const pos = calcPos(e); // must capture synchronously before any await
      if (!pos) return;
      currentHoverRef.current = word;

      // 1. Already in API cache (sync)
      const lw = word.toLowerCase();
      const cached = readCache(lw);
      if (cached !== undefined) {
        if (cached) setTooltip({ entry: cached, ...pos });
        return;
      }

      // 2. Fetch asynchronously, show when ready (only if still hovering)
      const entry = await fetchFromFreeDict(word, controllerRef.current?.signal);
      if (currentHoverRef.current === word && entry) setTooltip({ entry, ...pos });
    },
    [pinnedWord, calcPos],
  );

  const handleMouseLeave = useCallback(() => {
    currentHoverRef.current = null;
    if (!pinnedWord) setTooltip(null);
  }, [pinnedWord]);

  const handleClick = useCallback(
    async (e: React.MouseEvent<HTMLSpanElement>, word: string) => {
      e.stopPropagation();
      if (!word || word.length < 2) return;
      if (pinnedWord === word) { dismiss(); return; }
      const pos = calcPos(e);
      if (!pos) return;

      // Capture the request sequence so a stale response cannot overwrite a
      // newer click or a dismissal that happens while the fetch is in flight.
      const seq = ++requestSeqRef.current;
      currentHoverRef.current = null;

      // 1. API cache (sync)
      const lw = word.toLowerCase();
      const cached = readCache(lw);
      if (cached !== undefined) {
        if (cached) { setPinnedWord(word); setTooltip({ entry: cached, ...pos }); }
        return;
      }

      // 2. Fetch then pin, only if this click is still the latest action
      setPendingLookup(true);
      const entry = await fetchFromFreeDict(word, controllerRef.current?.signal);
      if (seq !== requestSeqRef.current) return;
      setPendingLookup(false);
      if (entry) { setPinnedWord(word); setTooltip({ entry, ...pos }); }
    },
    [pinnedWord, calcPos, dismiss],
  );

  // Click outside container → unpin/cancel. Active while pinned OR while a
  // lookup is pending, so an outside click before the response arrives cannot
  // be followed by a late tooltip reappearing.
  useEffect(() => {
    if (!pinnedWord && !pendingLookup) return;
    const onOutside = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) dismiss();
    };
    document.addEventListener('click', onOutside);
    return () => document.removeEventListener('click', onOutside);
  }, [pinnedWord, pendingLookup, dismiss]);

  useEffect(() => {
    const handleScroll = () => { if (!pinnedWord) setTooltip(null); };
    window.addEventListener('scroll', handleScroll, true);
    return () => window.removeEventListener('scroll', handleScroll, true);
  }, [pinnedWord]);

  const tokens = text.split(/(\s+)/);

  return (
    <div ref={containerRef} className={`relative ${className || ''}`}>
      <div className="text-sm leading-8">
        {tokens.map((token, i) => {
          if (/^\s+$/.test(token)) return <span key={i}>{token}</span>;
          const cleanWord = token.replace(/^[^a-zA-Z']+|[^a-zA-Z']+$/g, '');
          const isLookupable = cleanWord.length >= 2;
          const isPinned = cleanWord === pinnedWord;
          return (
            <span
              key={i}
              className={`inline rounded px-0.5 transition-colors ${
                isLookupable
                  ? `cursor-pointer underline decoration-dotted underline-offset-4 ${
                      isPinned
                        ? 'bg-blue-200 text-blue-800 decoration-blue-500 dark:bg-blue-900/50 dark:text-blue-200'
                        : 'decoration-blue-300/60 hover:bg-blue-100 hover:text-blue-700 dark:hover:bg-blue-900/30 dark:hover:text-blue-300'
                    }`
                  : ''
              }`}
              onMouseEnter={(e) => handleMouseEnter(e, cleanWord)}
              onMouseLeave={handleMouseLeave}
              onClick={(e) => handleClick(e, cleanWord)}
            >
              {token}
            </span>
          );
        })}
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          ref={tooltipRef}
          className="absolute z-50 w-72 rounded-xl border border-zinc-200 bg-white p-3.5 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
          style={{ left: tooltip.x, top: tooltip.y - 8, transform: 'translate(-50%, -100%)' }}
          onMouseLeave={() => { if (!pinnedWord) setTooltip(null); }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header row */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                className="font-bold text-base text-zinc-900 dark:text-zinc-100 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                onClick={() => speakWord(tooltip.entry.word)}
                title="Nghe phát âm"
              >
                {tooltip.entry.word}
              </button>
              {tooltip.entry.phonetic && (
                <span className="text-xs text-zinc-500 dark:text-zinc-400 font-mono">{tooltip.entry.phonetic}</span>
              )}
              <button
                className="rounded p-0.5 text-zinc-400 dark:text-zinc-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors"
                onClick={(e) => { e.stopPropagation(); speakWord(tooltip.entry.word); }}
                title="Nghe phát âm"
              >
                <Volume2 className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                {tooltip.entry.partOfSpeech}
              </span>
              {pinnedWord && (
                <button
                  className="rounded p-0.5 text-zinc-400 dark:text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                  onClick={(e) => { e.stopPropagation(); dismiss(); }}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Definition */}
          {tooltip.entry.definition && (
            <p className="mt-2 text-xs text-zinc-700 dark:text-zinc-300">{tooltip.entry.definition}</p>
          )}
          {tooltip.entry.definitionVi && (
            <p className="mt-1 text-xs font-semibold text-blue-600 dark:text-blue-400 flex items-center gap-1.5">
              <FlagIcon country="vi" className="h-3 w-4.5 shrink-0" />
              <span>{tooltip.entry.definitionVi}</span>
            </p>
          )}

          {/* Example sentence */}
          {tooltip.entry.example && (
            <div className="mt-2 border-t border-zinc-200 dark:border-zinc-700 pt-2 space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Ví dụ</p>
              <p className="text-[11px] italic text-zinc-500 dark:text-zinc-400">• &ldquo;{tooltip.entry.example}&rdquo;</p>
            </div>
          )}

          {/* Pin hint */}
          {!pinnedWord && (
            <p className="mt-1.5 text-[10px] text-zinc-400 dark:text-zinc-500">Nhấn vào từ để ghim &bull; Click word to pin</p>
          )}

          {/* Arrow */}
          <div className="absolute -bottom-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-b border-r border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900" />
        </div>
      )}
    </div>
  );
}
