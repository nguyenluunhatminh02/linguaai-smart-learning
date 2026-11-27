'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Mic, ArrowLeft, Loader2, History, ChevronDown, ChevronUp, Volume2,
} from 'lucide-react';
import apiClient from '@/lib/api-client';
import { TranscriptFeedback } from '@/components/speaking/transcript-feedback';

interface Scores {
  overall: number;
  basis?: 'transcript';
  grammar: number;
  vocabulary: number;
}

interface SpeakingHistoryItem {
  id: string;
  topic: string | null;
  transcript: string;
  feedback: string;
  scores: Scores | null;
  language: string;
  level: string;
  durationSec: number;
  createdAt: string;
}

interface HistoryResponse {
  total: number;
  page: number;
  limit: number;
  items: SpeakingHistoryItem[];
}

const scoreColor = (s: number) =>
  s >= 80 ? 'text-emerald-500' : s >= 60 ? 'text-amber-500' : 'text-red-500';

function HistoryRow({ item }: { item: SpeakingHistoryItem }) {
  const [expanded, setExpanded] = useState(false);
  const scores = item.scores;
  const transcriptScore = scores?.basis === 'transcript' ? scores.overall : null;
  const date = new Date(item.createdAt).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  return (
    <Card>
      <CardContent className="px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-sm font-medium">{item.topic || 'Free speaking'}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {date} · {item.language} · {item.level} · {item.durationSec}s
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            {transcriptScore !== null ? (
              <div className={`text-2xl font-bold tabular-nums ${scoreColor(transcriptScore)}`}>
                {transcriptScore}
              </div>
            ) : (
              <Badge variant="secondary">Bản chép lời</Badge>
            )}
            {transcriptScore !== null && (
              <span className="text-[10px] text-muted-foreground">
                Nội dung · /100
              </span>
            )}
          </div>
        </div>

        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          {expanded ? (
            <><ChevronUp className="h-3.5 w-3.5" /> Hide detail</>
          ) : (
            <><ChevronDown className="h-3.5 w-3.5" /> View detail</>
          )}
        </button>

        {expanded && (
          <div className="mt-4 space-y-4 border-t pt-4">
            <div>
              <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase">
                <Volume2 className="h-3.5 w-3.5" /> Transcript
              </p>
              <p className="text-sm italic text-foreground/80 bg-muted/40 rounded-lg px-3 py-2">
                &quot;{item.transcript}&quot;
              </p>
            </div>

            {scores && (
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'Ngữ pháp', val: scores.grammar },
                  { label: 'Từ vựng', val: scores.vocabulary },
                ].map(({ label, val }) => (
                  <div
                    key={label}
                    className="flex flex-col items-center rounded-lg bg-muted/40 py-2"
                  >
                    <span className={`text-lg font-bold tabular-nums ${scoreColor(val)}`}>
                      {val}
                    </span>
                    <span className="text-[10px] text-muted-foreground">{label}</span>
                    <Progress value={val} size="sm" className="mt-1 w-12" />
                  </div>
                ))}
              </div>
            )}

            <div>
              <p className="mb-1 text-xs font-semibold text-muted-foreground uppercase">
                Phản hồi dựa trên bản chép lời
              </p>
              <div className="space-y-1 rounded-lg bg-muted/30 px-3 py-2">
                <TranscriptFeedback text={transcriptScore !== null
                  ? item.feedback
                  : item.feedback.replace(/^\*\*[^\n]*(?:pronunciation|fluency)[^\n]*\*\*\n[\s\S]*?(?=^\*\*|$)/gim, '')} />
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function SpeakingHistoryPage() {
  const [items, setItems] = useState<SpeakingHistoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (p: number, append: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<HistoryResponse>(
        `/speaking/history?page=${p}&limit=10`,
      );
      const data = res.data;
      setItems((prev) => (append ? [...prev, ...data.items] : data.items));
      setTotal(data.total);
      setPage(p);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        'Failed to load history';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(1, false);
  }, [load]);

  const hasMore = items.length < total;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/speaking">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
          </Button>
        </Link>
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/10">
          <History className="h-5 w-5 text-cyan-500" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Speaking History</h1>
          <p className="text-sm text-muted-foreground">
            {total} session{total !== 1 ? 's' : ''} recorded
          </p>
        </div>
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50/40 dark:border-red-900/30 dark:bg-red-950/10">
          <CardContent className="px-6 py-4 text-sm text-red-600 dark:text-red-400">
            ⚠️ {error}
          </CardContent>
        </Card>
      )}

      {loading && items.length === 0 ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-4 py-16 px-6">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/50">
              <Mic className="h-7 w-7 text-muted-foreground" />
            </div>
            <div className="text-center">
              <p className="font-medium">No speaking sessions yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Record your first speaking practice to see it here.
              </p>
            </div>
            <Link href="/speaking">
              <Button>
                <Mic className="mr-2 h-4 w-4" /> Start Speaking
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="space-y-3">
            {items.map((item) => (
              <HistoryRow key={item.id} item={item} />
            ))}
          </div>
          {hasMore && (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                disabled={loading}
                onClick={() => load(page + 1, true)}
              >
                {loading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <ChevronDown className="mr-2 h-4 w-4" />
                )}
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
