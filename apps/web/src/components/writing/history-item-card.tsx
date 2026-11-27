"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronUp, XCircle, AlertTriangle, CheckCircle } from "lucide-react";
import type { Translations } from "@/lib/i18n/types";
import type { HistoryItem } from "./types";
import { RewrittenCard } from "./rewritten-card";

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 80
      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
      : score >= 60
        ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
        : "bg-red-500/10 text-red-500";
  return (
    <span
      className={`inline-flex items-center rounded-lg px-2.5 py-1 text-sm font-bold ${color}`}
    >
      {score}/100
    </span>
  );
}

interface HistoryItemCardProps {
  item: HistoryItem;
  t: Translations;
}

export function HistoryItemCard({ item, t }: HistoryItemCardProps) {
  const [expanded, setExpanded] = useState(false);
  const date = new Date(item.createdAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <Card>
      <CardContent className="px-5 py-4">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-sm leading-relaxed text-foreground">
              {item.userText}
            </p>
            <p className="mt-1 text-xs text-muted-foreground/90">
              {date} · {item.language}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <ScoreBadge score={item.overallScore} />
            {item.errorCount > 0 && (
              <span className="text-xs text-red-500">
                {item.errorCount} {t.writing.errorsFound}
              </span>
            )}
          </div>
        </div>

        {item.feedback && (
          <p className="mt-2.5 text-xs leading-relaxed text-foreground/70 dark:text-muted-foreground line-clamp-2">
            {item.feedback}
          </p>
        )}

        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          {expanded ? (
            <>
              <ChevronUp className="h-3.5 w-3.5" /> {t.writing.hideDetail}
            </>
          ) : (
            <>
              <ChevronDown className="h-3.5 w-3.5" /> {t.writing.viewDetail}
            </>
          )}
        </button>

        {expanded && (
          <div className="mt-4 space-y-4 border-t pt-4">
            {/* Scores */}
            {item.scores &&
              Object.values(item.scores).some((v) => v != null) && (
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { label: t.writing.grammarScore, val: item.scores.grammar },
                    {
                      label: t.writing.vocabScore,
                      val: item.scores.vocabulary,
                    },
                    {
                      label: t.writing.coherenceScore,
                      val: item.scores.coherence,
                    },
                    { label: "Task", val: item.scores.taskAchievement },
                  ]
                    .filter((s) => s.val != null)
                    .map(({ label, val }) => (
                      <div
                        key={label}
                        className="flex flex-col items-center rounded-lg bg-muted/40 py-2"
                      >
                        <span className="text-[10px] text-muted-foreground">
                          {label}
                        </span>
                        <span className="text-sm font-bold">{val}/10</span>
                      </div>
                    ))}
                </div>
              )}

            {/* Errors */}
            {item.errors.length > 0 && (
              <div className="space-y-2">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-red-500">
                  <XCircle className="h-3.5 w-3.5" /> {t.writing.corrections} (
                  {item.errors.length})
                </p>
                {item.errors.map((err, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-red-200 bg-red-50/50 px-3 py-2 text-xs dark:border-red-900/30 dark:bg-red-500/10"
                  >
                    <p className="text-foreground/90">
                      <span className="line-through text-red-400 dark:text-red-400/80">
                        {err.original}
                      </span>
                      <span className="text-muted-foreground/60 dark:text-zinc-400 mx-1">→</span>
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                        {err.correction}
                      </span>
                    </p>
                    {err.explanation && (
                      <p className="mt-1 text-muted-foreground dark:text-zinc-300 leading-relaxed">
                        {err.explanation}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Rewritten text */}
            {item.rewrittenText && (
              <RewrittenCard text={item.rewrittenText} t={t} />
            )}

            {/* Suggestions */}
            {item.suggestions.length > 0 && (
              <div>
                <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-emerald-500">
                  <CheckCircle className="h-3.5 w-3.5" />{" "}
                  {t.writing.suggestions}
                </p>
                <ul className="space-y-1">
                  {item.suggestions.map((s, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
