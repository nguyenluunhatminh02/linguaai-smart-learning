"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { apiClient } from "@/lib/api-client";
import { toast } from "sonner";
import {
  PenTool,
  Loader2,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Sparkles,
  Languages,
  History,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  FileText,
  TrendingUp,
  Target,
} from "lucide-react";
import { useLanguageStore } from "@/stores/language-store";
import { useLearningLanguageStore } from "@/stores/learning-language-store";
import { TokenCost, useTokenGate } from "@/components/ui/token-cost";
import type { Translations } from "@/lib/i18n/types";

import dynamic from "next/dynamic";
import type {
  WritingResult,
  HistoryItem,
  ErrorAnalysis,
} from "@/components/writing/types";

const FeedbackPanel = dynamic(
  () => import("@/components/writing/feedback-panel").then((m) => m.FeedbackPanel),
  {
    ssr: false,
    loading: () => <div className="h-60 rounded-xl bg-muted/40 animate-pulse" />,
  }
);

const HistoryItemCard = dynamic(
  () => import("@/components/writing/history-item-card").then((m) => m.HistoryItemCard),
  {
    ssr: false,
    loading: () => <div className="h-24 rounded-xl bg-muted/40 animate-pulse" />,
  }
);


export default function WritingPage() {
  const { t } = useLanguageStore();
  const { language } = useLearningLanguageStore();
  const { consumeAndRun, canAfford: canAffordWriting } =
    useTokenGate("writing_feedback");
  const [activeTab, setActiveTab] = useState<"write" | "history" | "errors">(
    "write",
  );

  // Write tab state
  const [text, setText] = useState("");
  const [targetLanguage, setTargetLanguage] = useState<string>(language);
  const [level, setLevel] = useState("B1");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<WritingResult | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // History tab state
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Error Analysis tab state
  const [errorAnalysis, setErrorAnalysis] = useState<ErrorAnalysis | null>(
    null,
  );
  const [errorLang, setErrorLang] = useState<string>(language);
  const [errorLoading, setErrorLoading] = useState(false);

  useEffect(() => {
    setTargetLanguage(language);
    setErrorLang(language);
    // Analysis from the previous language must not be shown under the new one.
    setErrorAnalysis(null);
  }, [language]);

  const loadHistory = useCallback(async (page = 1, append = false) => {
    setHistoryLoading(true);
    try {
      const res = await apiClient.get(`/writing/history?language=${language}&page=${page}&limit=10`);
      const data = res.data;
      setHistory((prev) => (append ? [...prev, ...data.items] : data.items));
      setHistoryTotal(data.total);
      setHistoryPage(page);
    } catch {
      // silent
    } finally {
      setHistoryLoading(false);
    }
  }, [language]);

  useEffect(() => {
    if (activeTab === "history") loadHistory(1, false);
    if (activeTab === "errors" && !errorAnalysis) loadErrorAnalysis();
  }, [activeTab, loadHistory]);

  const loadErrorAnalysis = async () => {
    setErrorLoading(true);
    try {
      const res = await apiClient.get(
        `/writing/error-analysis?language=${errorLang}`,
      );
      setErrorAnalysis(res.data);
    } catch {
      // silently handle
    } finally {
      setErrorLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!text.trim()) return;
    if (!canAffordWriting) {
      toast.error(t.common.insufficientTokens || "Insufficient token balance");
      return;
    }
    setLoading(true);
    setResult(null);
    setSubmitError(null);
    try {
      await consumeAndRun(async () => {
        const res = await apiClient.post("/writing/assess", {
          userText: text,
          language: targetLanguage,
          targetLevel: level,
        });
        setResult(res.data);
      });
    } catch (err: unknown) {
      const message =
        (
          err as {
            response?: { data?: { message?: string } };
            message?: string;
          }
        )?.response?.data?.message ||
        (err as { message?: string })?.message ||
        "Không thể chấm bài. Hãy thử lại sau.";
      setSubmitError(
        typeof message === "string" ? message : "Đã xảy ra lỗi không xác định.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10">
          <PenTool className="h-5 w-5 text-violet-500" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">{t.writing.title}</h1>
          <p className="text-sm text-muted-foreground">{t.writing.desc}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl border bg-muted/30 p-1 w-fit">
        <button
          onClick={() => setActiveTab("write")}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "write"
              ? "bg-background shadow-sm text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <PenTool className="h-4 w-4" />
          {t.writing.tabWrite}
        </button>
        <button
          onClick={() => setActiveTab("history")}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "history"
              ? "bg-background shadow-sm text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <History className="h-4 w-4" />
          {t.writing.tabHistory}
          {historyTotal > 0 && (
            <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-xs font-bold text-primary">
              {historyTotal}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("errors")}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "errors"
              ? "bg-background shadow-sm text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <TrendingUp className="h-4 w-4" />
          {t.writing.tabErrors}
        </button>
      </div>

      {/* Write Tab */}
      {activeTab === "write" && (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Input Panel */}
          <div className="space-y-4">
            <Card>
              <CardHeader className="px-6 pt-6 pb-4">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Languages className="h-4 w-4 text-primary" />{" "}
                  {t.writing.yourWriting}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 px-6 pb-6">
                <div className="flex gap-3">
                  <select
                    className="flex-1 rounded-xl border bg-background px-3 py-2.5 text-sm transition-colors hover:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    value={targetLanguage}
                    onChange={(e) => setTargetLanguage(e.target.value)}
                    aria-label="Chọn ngôn ngữ mục tiêu"
                  >
                    <option value="english">{t.languages.english}</option>
                    <option value="vietnamese">{t.languages.vietnamese}</option>
                    <option value="japanese">{t.languages.japanese}</option>
                    <option value="korean">{t.languages.korean}</option>
                    <option value="chinese">{t.languages.chinese}</option>
                    <option value="french">{t.languages.french}</option>
                    <option value="spanish">{t.languages.spanish}</option>
                  </select>
                  <select
                    className="flex-1 rounded-xl border bg-background px-3 py-2.5 text-sm transition-colors hover:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    value={level}
                    onChange={(e) => setLevel(e.target.value)}
                    aria-label="Chọn trình độ mục tiêu"
                  >
                    <option value="A1">A1 - Beginner</option>
                    <option value="A2">A2 - Elementary</option>
                    <option value="B1">B1 - Intermediate</option>
                    <option value="B2">B2 - Upper Inter.</option>
                    <option value="C1">C1 - Advanced</option>
                    <option value="C2">C2 - Proficient</option>
                  </select>
                </div>
                <textarea
                  className="min-h-75 w-full rounded-xl border bg-background p-4 text-sm leading-relaxed transition-colors placeholder:text-muted-foreground/60 hover:border-primary/30 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none"
                  placeholder={t.writing.placeholder}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  aria-label={t.writing.yourWriting || "Nội dung bài viết"}
                />
                <div className="flex items-center justify-between">
                  <span className="tabular-nums text-xs text-muted-foreground">
                    {text.length} {t.writing.characters}
                  </span>
                  <div className="flex items-center gap-2">
                    <TokenCost feature="writing_feedback" variant="badge" />
                    <Button
                      variant="gradient"
                      onClick={handleSubmit}
                      disabled={loading || !text.trim()}
                    >
                      {loading ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />{" "}
                          {t.writing.analyzing}
                        </>
                      ) : (
                        <>
                          <Sparkles className="mr-2 h-4 w-4" />{" "}
                          {t.writing.getFeedback}
                        </>
                      )}
                    </Button>
                  </div>
                </div>
                {loading && (
                  <div className="sr-only" aria-live="polite">
                    {t.writing.analyzing || "Đang phân tích bài viết, vui lòng đợi..."}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Feedback Panel */}
          <div className="space-y-4">
            {submitError && (
              <Card role="alert" className="border-red-200 bg-red-50/40 dark:border-red-900/30 dark:bg-red-950/10">
                <CardContent className="flex items-start gap-3 px-6 py-4">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-red-700 dark:text-red-400">
                      Không thể chấm bài
                    </p>
                    <p className="mt-0.5 text-xs text-red-600/80 dark:text-red-400/80">
                      {submitError}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSubmitError(null)}
                  >
                    ✕
                  </Button>
                </CardContent>
              </Card>
            )}
            {result ? (
              <FeedbackPanel result={result} t={t} />
            ) : (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center gap-4 py-20 px-6">
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-500/10">
                    <PenTool className="h-8 w-8 text-violet-400" />
                  </div>
                  <div className="text-center">
                    <p className="font-medium">{t.writing.writeAndGet}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t.writing.writeAndGetDesc}
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}

      {/* History Tab */}
      {activeTab === "history" && (
        <div className="space-y-4">
          {historyLoading && history.length === 0 ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : history.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center gap-4 py-16 px-6">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/50">
                  <History className="h-7 w-7 text-muted-foreground" />
                </div>
                <div className="text-center">
                  <p className="font-medium">{t.writing.historyEmpty}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t.writing.historyEmptyDesc}
                  </p>
                </div>
                <Button variant="outline" onClick={() => setActiveTab("write")}>
                  <PenTool className="mr-2 h-4 w-4" /> {t.writing.tabWrite}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="space-y-3">
                {history.map((item) => (
                  <HistoryItemCard key={item.id} item={item} t={t} />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Error Analysis Tab */}
      {activeTab === "errors" && (
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium">Language</label>
              <select
                className="rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={errorLang}
                onChange={(e) => {
                  setErrorLang(e.target.value);
                  setErrorAnalysis(null);
                }}
              >
                <option value="english">English</option>
                <option value="vietnamese">Vietnamese</option>
                <option value="japanese">Japanese</option>
                <option value="chinese">Chinese</option>
                <option value="korean">Korean</option>
              </select>
            </div>
            <div className="flex-1" />
            <Button
              variant="outline"
              size="sm"
              onClick={loadErrorAnalysis}
              disabled={errorLoading}
            >
              {errorLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <TrendingUp className="h-4 w-4" />
              )}
              Analyze My Errors
            </Button>
          </div>

          {errorLoading ? (
            <Card>
              <CardContent className="flex items-center justify-center py-16">
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="h-8 w-8 animate-spin text-violet-500" />
                  <p className="text-sm text-muted-foreground">
                    {t.writing.errorsAnalyzing}
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : errorAnalysis ? (
            <div className="space-y-6">
              {/* Summary */}
              <Card className="border-violet-200 dark:border-violet-900/40">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <TrendingUp className="h-5 w-5 text-violet-500" />
                      Error Pattern Summary
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">
                        {errorAnalysis.analyzedSubmissions} submissions
                      </Badge>
                      <Badge variant="destructive">
                        {errorAnalysis.totalErrors} errors
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm leading-relaxed">
                    {errorAnalysis.summary}
                  </p>
                  <div className="rounded-lg bg-amber-500/5 border border-amber-200 dark:border-amber-900/30 px-4 py-3">
                    <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                      Priority Focus:{" "}
                      <span className="font-bold">
                        {errorAnalysis.priority_focus}
                      </span>
                    </p>
                    <p className="text-xs text-amber-600/70 dark:text-amber-500/70">
                      Level: {errorAnalysis.level}
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* Patterns */}
              {errorAnalysis.patterns.length > 0 && (
                <div>
                  <h3 className="mb-3 font-semibold text-sm uppercase tracking-wide text-muted-foreground">
                    Error Patterns
                  </h3>
                  <div className="space-y-3">
                    {errorAnalysis.patterns.map((p, i) => (
                      <Card
                        key={i}
                        className="border-red-200 dark:border-red-900/30"
                      >
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <p className="font-semibold text-sm">
                              {p.pattern_name}
                            </p>
                            <div className="flex items-center gap-2 shrink-0">
                              <Badge variant="secondary">{p.category}</Badge>
                              <Badge variant="destructive">
                                ×{p.frequency}
                              </Badge>
                            </div>
                          </div>
                          <p className="text-sm text-muted-foreground mb-2">
                            {p.description}
                          </p>
                          {p.examples.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {p.examples.map((ex, j) => (
                                <span
                                  key={j}
                                  className="rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/30 px-2 py-0.5 text-xs font-mono text-red-600 dark:text-red-400"
                                >
                                  &quot;{ex}&quot;
                                </span>
                              ))}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              )}

              {/* Exercises */}
              {errorAnalysis.exercises.length > 0 && (
                <div>
                  <h3 className="mb-3 font-semibold text-sm uppercase tracking-wide text-muted-foreground">
                    Targeted Exercises
                  </h3>
                  <div className="space-y-4">
                    {errorAnalysis.exercises.map((ex, i) => (
                      <Card
                        key={i}
                        className="border-emerald-200 dark:border-emerald-900/30"
                      >
                        <CardContent className="p-5">
                          <div className="flex items-center gap-2 mb-3">
                            <Target className="h-4 w-4 text-emerald-500" />
                            <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 uppercase">
                              {ex.type.replace("_", " ")}
                            </p>
                            <Badge variant="secondary" className="text-xs">
                              {ex.target_pattern}
                            </Badge>
                          </div>
                          <p className="text-sm font-medium mb-2">
                            {ex.instruction}
                          </p>
                          <p className="text-sm text-muted-foreground bg-muted/50 rounded-lg px-4 py-3 mb-3">
                            {ex.question}
                          </p>
                          {ex.options.length > 0 && (
                            <div className="grid grid-cols-2 gap-2 mb-3">
                              {ex.options.map((opt, j) => (
                                <div
                                  key={j}
                                  className={`rounded-lg border px-3 py-2 text-sm ${opt === ex.correct_answer ? "border-emerald-400 bg-emerald-50/50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 font-medium" : "border-border"}`}
                                >
                                  {opt === ex.correct_answer && (
                                    <CheckCircle className="inline mr-1.5 h-3.5 w-3.5" />
                                  )}
                                  {opt}
                                </div>
                              ))}
                            </div>
                          )}
                          <div className="rounded-lg bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/30 px-3 py-2">
                            <p className="text-xs text-blue-600 dark:text-blue-400">
                              {ex.explanation}
                            </p>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center gap-4 py-16">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-500/10">
                  <TrendingUp className="h-8 w-8 text-violet-400" />
                </div>
                <div className="text-center">
                  <p className="font-medium">{t.writing.errorsAnalysis}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t.writing.errorsNoData}
                  </p>
                </div>
                <Button onClick={loadErrorAnalysis} disabled={errorLoading}>
                  <TrendingUp className="mr-2 h-4 w-4" /> Start Analysis
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
