'use client';

/**
 * Accessible speaking history list component (roadmap FE-04).
 *
 * Presents a paginated list of speaking sessions with expandable detail views.
 * Handles loading, empty, and error states with proper ARIA semantics.
 * Uses semantic list markup (<ol>/<li>) and articles for each item.
 * Implements keyboard navigation and focus management for expand/collapse.
 * Single polite live-region announcer for terminal state transitions.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Mic, Loader2, ChevronDown, ChevronUp, Volume2, AlertCircle,
} from 'lucide-react';
import { TranscriptFeedback } from '@/components/speaking/transcript-feedback';

export interface SpeakingHistoryItem {
  id: string;
  topic: string | null;
  transcript: string;
  feedback: string;
  scores: {
    overall: number;
    basis?: 'transcript';
    grammar: number;
    vocabulary: number;
  } | null;
  language: string;
  level: string;
  durationSec: number;
  createdAt: string;
}

export interface HistoryListProps {
  items: SpeakingHistoryItem[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  total: number;
  onLoadMore?: () => void;
  onRetry?: () => void;
}

const scoreColor = (s: number) =>
  s >= 80 ? 'text-emerald-500' : s >= 60 ? 'text-amber-500' : 'text-red-500';

/**
 * Individual history item with expandable detail section.
 * Uses <article> with aria-labelledby for semantic grouping.
 * Implements aria-expanded/aria-controls pattern for expand/collapse.
 */
function HistoryListItem({ item }: { item: SpeakingHistoryItem }) {
  const [expanded, setExpanded] = useState(false);
  const detailId = `detail-${item.id}`;
  const headingId = `heading-${item.id}`;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const scores = item.scores;
  const transcriptScore = scores?.basis === 'transcript' ? scores.overall : null;

  const date = new Date(item.createdAt).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const handleToggle = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  // Return focus to toggle button when collapsing
  useEffect(() => {
    if (!expanded && buttonRef.current) {
      buttonRef.current.focus();
    }
  }, [expanded]);

  return (
    <li>
      <Card>
        <CardContent className="px-5 py-4">
          <article aria-labelledby={headingId}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p id={headingId} className="line-clamp-2 text-sm font-medium">
                  {item.topic || 'Free speaking'}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {date} · {item.language} · {item.level} · {item.durationSec}s
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                {transcriptScore !== null ? (
                  <>
                    <div className={`text-2xl font-bold tabular-nums ${scoreColor(transcriptScore)}`}>
                      {transcriptScore}
                    </div>
                    <span className="text-[10px] text-muted-foreground">
                      Content score · /100
                    </span>
                  </>
                ) : (
                  <Badge variant="secondary">Transcript-based</Badge>
                )}
              </div>
            </div>

            <button
              ref={buttonRef}
              onClick={handleToggle}
              aria-expanded={expanded}
              aria-controls={detailId}
              className="mt-3 flex items-center gap-1 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
            >
              {expanded ? (
                <>
                  <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                  Hide detail
                </>
              ) : (
                <>
                  <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                  View detail
                </>
              )}
            </button>

            {expanded && (
              <div
                id={detailId}
                role="region"
                aria-labelledby={headingId}
                className="mt-4 space-y-4 border-t pt-4"
              >
                <div>
                  <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase">
                    <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
                    Transcript
                  </p>
                  <p className="text-sm italic text-foreground/80 bg-muted/40 rounded-lg px-3 py-2">
                    &quot;{item.transcript}&quot;
                  </p>
                </div>

                {scores && (
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: 'Grammar', val: scores.grammar },
                      { label: 'Vocabulary', val: scores.vocabulary },
                    ].map(({ label, val }) => (
                      <div
                        key={label}
                        className="flex flex-col items-center rounded-lg bg-muted/40 py-2"
                      >
                        <span className={`text-lg font-bold tabular-nums ${scoreColor(val)}`}>
                          {val}
                        </span>
                        <span className="text-[10px] text-muted-foreground">{label}</span>
                        <Progress
                          value={val}
                          size="sm"
                          className="mt-1 w-12"
                          aria-label={`${label} score: ${val} out of 100`}
                        />
                      </div>
                    ))}
                  </div>
                )}

                <div>
                  <p className="mb-1 text-xs font-semibold text-muted-foreground uppercase">
                    Transcript-based feedback
                  </p>
                  <div className="space-y-1 rounded-lg bg-muted/30 px-3 py-2">
                    <TranscriptFeedback
                      text={
                        transcriptScore !== null
                          ? item.feedback
                          : item.feedback.replace(
                              /^\*\*[^\n]*(?:pronunciation|fluency)[^\n]*\*\*\n[\s\S]*?(?=^\*\*|$)/gim,
                              '',
                            )
                      }
                    />
                  </div>
                </div>
              </div>
            )}
          </article>
        </CardContent>
      </Card>
    </li>
  );
}

/**
 * Loading skeleton with aria-busy for screen readers.
 */
function LoadingState() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading speaking history"
      className="flex items-center justify-center py-16"
    >
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
      <span className="sr-only">Loading...</span>
    </div>
  );
}

/**
 * Empty state with role="status" and semantic heading.
 */
function EmptyState() {
  return (
    <Card className="border-dashed" role="status">
      <CardContent className="flex flex-col items-center gap-4 py-16 px-6">
        <div
          className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/50"
          aria-hidden="true"
        >
          <Mic className="h-7 w-7 text-muted-foreground" />
        </div>
        <div className="text-center">
          <h2 className="font-medium">No speaking sessions yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Record your first speaking practice to see it here.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Error state with role="alert", icon + text (not color-only), and retry button.
 */
function ErrorState({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <Card
      className="border-red-200 bg-red-50/40 dark:border-red-900/30 dark:bg-red-950/10"
      role="alert"
    >
      <CardContent className="px-6 py-4">
        <div className="flex items-start gap-3">
          <AlertCircle
            className="h-5 w-5 shrink-0 text-red-600 dark:text-red-400"
            aria-hidden="true"
          />
          <div className="flex-1">
            <p className="text-sm font-medium text-red-600 dark:text-red-400">
              Failed to load history
            </p>
            <p className="mt-1 text-sm text-red-600 dark:text-red-400">{error}</p>
            {onRetry && (
              <Button
                variant="outline"
                size="sm"
                onClick={onRetry}
                className="mt-3"
              >
                Try again
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Main history list component.
 * Uses semantic <ol> for ordered list of sessions.
 * Single polite live-region announcer for state transitions.
 */
export function HistoryList({
  items,
  loading,
  error,
  hasMore,
  total,
  onLoadMore,
  onRetry,
}: HistoryListProps) {
  const [announcement, setAnnouncement] = useState('');
  const prevLoadingRef = useRef(loading);
  const prevErrorRef = useRef(error);

  // Announce terminal state transitions to screen readers
  useEffect(() => {
    const wasLoading = prevLoadingRef.current;
    const hadError = prevErrorRef.current;

    // Announce when loading completes
    if (wasLoading && !loading && !error) {
      if (items.length === 0) {
        setAnnouncement('No speaking sessions found');
      } else {
        setAnnouncement(`Loaded ${items.length} speaking session${items.length !== 1 ? 's' : ''}`);
      }
    }

    // Announce error state
    if (!hadError && error) {
      setAnnouncement(`Error loading history: ${error}`);
    }

    prevLoadingRef.current = loading;
    prevErrorRef.current = error;
  }, [loading, error, items.length]);

  // Clear announcement after it's been read
  useEffect(() => {
    if (announcement) {
      const timer = setTimeout(() => setAnnouncement(''), 3000);
      return () => clearTimeout(timer);
    }
  }, [announcement]);

  return (
    <div className="space-y-6">
      {/* Polite live region for announcements */}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        role="status"
      >
        {announcement}
      </div>

      {/* Error state */}
      {error && <ErrorState error={error} onRetry={onRetry} />}

      {/* Loading state (initial load) */}
      {loading && items.length === 0 && <LoadingState />}

      {/* Empty state */}
      {!loading && !error && items.length === 0 && <EmptyState />}

      {/* List of items */}
      {!loading && items.length > 0 && (
        <>
          <p className="sr-only">
            {total} speaking session{total !== 1 ? 's' : ''} recorded
          </p>
          <ol className="space-y-3" aria-label="Speaking history">
            {items.map((item) => (
              <HistoryListItem key={item.id} item={item} />
            ))}
          </ol>

          {/* Load more button */}
          {hasMore && onLoadMore && (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                disabled={loading}
                onClick={onLoadMore}
                aria-busy={loading}
              >
                {loading ? (
                  <>
                    <Loader2
                      className="mr-2 h-4 w-4 animate-spin"
                      aria-hidden="true"
                    />
                    <span>Loading...</span>
                  </>
                ) : (
                  <>
                    <ChevronDown
                      className="mr-2 h-4 w-4"
                      aria-hidden="true"
                    />
                    <span>Load more</span>
                  </>
                )}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
