"use client";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { XCircle, AlertTriangle, CheckCircle } from "lucide-react";
import type { Translations } from "@/lib/i18n/types";
import type { WritingResult } from "./types";
import { RewrittenCard } from "./rewritten-card";

interface FeedbackPanelProps {
  result: WritingResult;
  t: Translations;
}

export function FeedbackPanel({ result, t }: FeedbackPanelProps) {
  const getScoreVariant = (score: number): "success" | "warning" | "default" =>
    score >= 80 ? "success" : score >= 60 ? "warning" : "default";

  return (
    <div className="animate-fade-in space-y-4">
      {/* Score Card */}
      <Card className="overflow-hidden">
        <div className="gradient-bg px-6 py-6 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-white/70">{t.writing.overallScore}</p>
              <p className="mt-1 text-4xl font-bold">
                {result.overallScore}
                <span className="text-lg text-white/70">/100</span>
              </p>
            </div>
            <Progress
              value={result.overallScore}
              max={100}
              variant={getScoreVariant(result.overallScore)}
              size="lg"
              className="w-20 bg-white/20"
            />
          </div>
        </div>
        {result.feedback && (
          <CardContent className="px-6 py-4">
            <p className="text-sm leading-relaxed">{result.feedback}</p>
          </CardContent>
        )}
      </Card>

      {/* Scores breakdown */}
      {result.scores && Object.values(result.scores).some((v) => v != null) && (
        <Card>
          <CardContent className="grid grid-cols-2 gap-3 px-6 py-5 sm:grid-cols-4">
            {[
              { label: t.writing.grammarScore, val: result.scores.grammar },
              { label: t.writing.vocabScore, val: result.scores.vocabulary },
              { label: t.writing.coherenceScore, val: result.scores.coherence },
              { label: "Task", val: result.scores.taskAchievement },
            ]
              .filter((s) => s.val != null)
              .map(({ label, val }) => (
                <div
                  key={label}
                  className="flex flex-col items-center gap-1 rounded-xl bg-muted/40 py-3"
                >
                  <span className="text-xs text-muted-foreground">{label}</span>
                  <span className="text-lg font-bold">
                    {val}
                    <span className="text-xs text-muted-foreground">/10</span>
                  </span>
                </div>
              ))}
          </CardContent>
        </Card>
      )}

      {/* Errors */}
      {result.errors && result.errors.length > 0 && (
        <Card>
          <CardHeader className="px-6 pt-6 pb-4">
            <CardTitle className="flex items-center gap-2 text-base text-red-500">
              <XCircle className="h-5 w-5" /> Errors
              <Badge variant="destructive">{result.errors.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 px-6 pb-6">
            {result.errors.map((err, i) => (
              <div
                key={i}
                className="rounded-xl border border-red-200 bg-red-50/50 p-4 text-sm dark:border-red-900/30 dark:bg-red-500/10"
              >
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" />
                  <div className="space-y-1.5">
                    <p className="text-foreground/90">
                      <span className="line-through text-red-400 dark:text-red-400/80">
                        {err.original}
                      </span>
                      <span className="text-muted-foreground/60 dark:text-zinc-400 mx-1.5">→</span>
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                        {err.correction}
                      </span>
                    </p>
                    <p className="text-muted-foreground dark:text-zinc-300 leading-relaxed">{err.explanation}</p>
                    <Badge variant="secondary" className="mt-1">{err.type}</Badge>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Rewritten text */}
      {result.rewrittenText && (
        <RewrittenCard text={result.rewrittenText} t={t} />
      )}

      {/* Suggestions */}
      {result.suggestions && result.suggestions.length > 0 && (
        <Card>
          <CardHeader className="px-6 pt-6 pb-4">
            <CardTitle className="flex items-center gap-2 text-base text-emerald-500">
              <CheckCircle className="h-5 w-5" /> {t.writing.suggestions}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-6 pb-6">
            <ul className="space-y-2.5">
              {result.suggestions.map((s, i) => (
                <li key={i} className="flex items-start gap-3 text-sm">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                  <span className="leading-relaxed">{s}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
