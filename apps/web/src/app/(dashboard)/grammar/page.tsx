"use client";

import { useState, useRef } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useGrammarLessons, useGrammarExplain } from "@/hooks/use-grammar";
import {
  BookA,
  Loader2,
  Lightbulb,
  Sparkles,
  Search,
  GraduationCap,
  Pencil,
  CheckCircle,
  XCircle,
  ArrowLeft,
  Library,
} from "lucide-react";
import { toast } from "sonner";
import { useLanguageStore } from "@/stores/language-store";
import { TokenCost } from "@/components/ui/token-cost";
import { FlagIcon } from "@/components/ui/flag-icon";
import { useTokenStore } from "@/stores/token-store";
import { toAppError, type AppError } from "@/lib/errors";

export interface GrammarExercise {
  question: string;
  options: string[];
  correct: number;
  explanation: string;
}

export interface GrammarLesson {
  id: string;
  title: string;
  titleVi: string;
  slug: string;
  level: string;
  category: string;
  description: string;
  formula: string;
  explanation: string;
  examples: { en: string; vi: string }[];
  exercises: GrammarExercise[];
  tips: string[];
  commonMistakes: { wrong: string; right: string; note: string }[];
}

const grammarCategories = [
  { id: "tenses", label: "Tenses", labelVi: "Các thì" },
  { id: "conditionals", label: "Conditionals", labelVi: "Câu điều kiện" },
  {
    id: "passive",
    label: "Passive & Reported",
    labelVi: "Bị động & Tường thuật",
  },
  {
    id: "sentence-structure",
    label: "Sentence Structure",
    labelVi: "Cấu trúc câu",
  },
  { id: "verb-forms", label: "Verb Forms", labelVi: "Dạng động từ" },
  { id: "other", label: "Other Grammar", labelVi: "Ngữ pháp khác" },
];

type Tab = "lessons" | "ai";

interface GrammarResult {
  topic: string;
  explanation: string;
  examples: { sentence: string; translation: string }[];
  exercises: { question: string; answer: string }[];
  tips: string[];
  operationId?: string;
  balance?: number;
}

interface ExplainMutationInput {
  grammarPoint: string;
  language: string;
  operationKey: string;
}

/** Stable per-intent key: retries reuse it so the server can replay/settle once. */
function createOperationKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `grammar-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Typed, user-facing messages; raw transport/provider text is never shown. */
const EXPLAIN_ERROR_MESSAGES: Record<string, string> = {
  VALIDATION_ERROR: "Please check your question and try again.",
  INSUFFICIENT_CREDITS: "Insufficient token balance",
  OPERATION_CONFLICT: "This explanation is already being processed. Please wait for its result.",
  RATE_LIMITED: "Too many requests. Please wait a moment and try again.",
  PROVIDER_UNAVAILABLE: "The AI service is temporarily unavailable. Please try again.",
  PROVIDER_TIMEOUT: "The AI service took too long to respond. Please try again.",
  INVALID_AI_OUTPUT: "The AI returned an invalid response. Please try again.",
  DATABASE_UNAVAILABLE: "Could not save the result. Please try again.",
  INTERNAL_ERROR: "Something went wrong. Please try again.",
};

function explainErrorMessage(error: unknown, insufficientTokensLabel: string): string {
  const appError: AppError = toAppError(error);
  // Status-based fallback for servers whose error envelope omits a typed code.
  if (
    appError.code === "INTERNAL_ERROR" &&
    (appError.httpStatus === 400 || appError.httpStatus === 402 || appError.httpStatus === 409 || appError.httpStatus === 429)
  ) {
    const byStatus: Record<number, string> = {
      400: EXPLAIN_ERROR_MESSAGES.VALIDATION_ERROR,
      402: insufficientTokensLabel,
      409: EXPLAIN_ERROR_MESSAGES.OPERATION_CONFLICT,
      429: EXPLAIN_ERROR_MESSAGES.RATE_LIMITED,
    };
    return byStatus[appError.httpStatus];
  }
  if (appError.code === "INSUFFICIENT_CREDITS") return insufficientTokensLabel;
  return EXPLAIN_ERROR_MESSAGES[appError.code] ?? EXPLAIN_ERROR_MESSAGES.INTERNAL_ERROR;
}

export default function GrammarPage() {
  const { t } = useLanguageStore();
  const [tab, setTab] = useState<Tab>("lessons");
  const [selectedLesson, setSelectedLesson] = useState<GrammarLesson | null>(
    null,
  );
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [exerciseAnswers, setExerciseAnswers] = useState<
    Record<number, number>
  >({});
  const [exerciseSubmitted, setExerciseSubmitted] = useState(false);

  const { data: lessons = [], isLoading: lessonsLoading } = useGrammarLessons();
  const explainMutation = useGrammarExplain();

  // AI tab state
  const [query, setQuery] = useState("");
  const [targetLanguage, setTargetLanguage] = useState("english");
  const [nativeLanguage, setNativeLanguage] = useState("vietnamese");
  const [result, setResult] = useState<GrammarResult | null>(null);
  const [showExerciseAnswers, setShowExerciseAnswers] = useState<
    Record<number, boolean>
  >({});
  const { syncBalance } = useTokenStore();
  const insufficientTokensLabel =
    t.common.insufficientTokens || "Insufficient token balance";
  // One key per Explain intent. It stays unchanged across retries of that
  // intent so a timeout/refund/settle cannot result in a second debit.
  const operationKeyRef = useRef(createOperationKey());

  const loading = explainMutation.isPending;

  const handleSearch = async () => {
    if (!query.trim() || loading) return;
    const grammarPoint = query.trim();
    setResult(null);
    setShowExerciseAnswers({});
    try {
      const data = await explainMutation.mutateAsync({
        grammarPoint,
        language: targetLanguage,
        operationKey: operationKeyRef.current,
      } as ExplainMutationInput);
      const explanation = data as GrammarResult;
      setResult(explanation);
      // The response carries the authoritative post-settlement balance.
      if (typeof explanation.balance === "number") {
        syncBalance(explanation.balance);
      }
      // The intent completed; a later click is a new operation and must get a
      // fresh key. On failure we keep the key for a safe retry.
      operationKeyRef.current = createOperationKey();
    } catch (error) {
      // Server-side reserve/settle/refund is authoritative. Surface the typed
      // 400/402/409/429 (and provider) failures instead of failing silently.
      toast.error(explainErrorMessage(error, insufficientTokensLabel));
    }
  };

  const filteredLessons =
    selectedCategory === "all"
      ? lessons
      : lessons.filter((l) => l.category === selectedCategory);

  const handleExerciseAnswer = (qIdx: number, optIdx: number) => {
    if (exerciseSubmitted) return;
    setExerciseAnswers((prev) => ({ ...prev, [qIdx]: optIdx }));
  };

  const exerciseScore = selectedLesson
    ? selectedLesson.exercises.filter(
        (ex, i) => exerciseAnswers[i] === ex.correct,
      ).length
    : 0;

  const openLesson = (lesson: GrammarLesson) => {
    setSelectedLesson(lesson);
    setExerciseAnswers({});
    setExerciseSubmitted(false);
  };

  // ======= LESSON DETAIL VIEW =======
  if (selectedLesson) {
    return (
      <div className="space-y-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setSelectedLesson(null)}
        >
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Lessons
        </Button>

        {/* Lesson Header */}
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10">
            <GraduationCap className="h-6 w-6 text-emerald-500" />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">{selectedLesson.title}</h1>
            <p className="text-sm text-muted-foreground">
              {selectedLesson.titleVi}
            </p>
            <div className="mt-2 flex gap-2">
              <Badge variant="secondary">{selectedLesson.level}</Badge>
              <Badge variant="outline">{selectedLesson.category}</Badge>
            </div>
          </div>
        </div>

        {/* Explanation */}
        <Card>
          <CardHeader className="px-6 pt-6 pb-3">
            <CardTitle className="text-lg">📖 Explanation</CardTitle>
          </CardHeader>
          <CardContent className="px-6 pb-6 space-y-3">
            <div className="rounded-lg bg-primary/5 p-4 font-mono text-sm">
              {selectedLesson.formula}
            </div>
            <div className="whitespace-pre-wrap text-sm leading-7 text-foreground/90">
              {selectedLesson.explanation}
            </div>
          </CardContent>
        </Card>

        {/* Examples */}
        <Card>
          <CardHeader className="px-6 pt-6 pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              📝 Examples{" "}
              <Badge variant="secondary">
                {selectedLesson.examples.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-6 pb-6 space-y-3">
            {selectedLesson.examples.map((ex, i) => (
              <div
                key={i}
                className="rounded-xl border bg-muted/30 p-4 transition-colors hover:bg-muted/50"
              >
                <p className="font-medium text-sm flex items-center gap-1.5">
                  <FlagIcon country="en" className="h-3.5 w-5 shrink-0" />
                  <span>{ex.en}</span>
                </p>
                <p className="mt-1.5 text-sm text-muted-foreground flex items-center gap-1.5">
                  <FlagIcon country="vi" className="h-3 w-4.5 shrink-0" />
                  <span>{ex.vi}</span>
                </p>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Exercises */}
        <Card>
          <CardHeader className="px-6 pt-6 pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Pencil className="h-5 w-5 text-violet-500" /> Practice Exercises
              <Badge variant="secondary">
                {selectedLesson.exercises.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-6 pb-6 space-y-5">
            {selectedLesson.exercises.map((ex, qi) => (
              <div key={qi} className="space-y-2">
                <p className="font-medium text-sm">
                  <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                    {qi + 1}
                  </span>
                  {ex.question}
                </p>
                <div className="space-y-1.5 pl-8">
                  {ex.options.map((opt, oi) => {
                    let cls = "border bg-background hover:bg-muted/50";
                    if (exerciseSubmitted) {
                      if (oi === ex.correct)
                        cls =
                          "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30";
                      else if (exerciseAnswers[qi] === oi && oi !== ex.correct)
                        cls = "border-red-500 bg-red-50 dark:bg-red-950/30";
                    } else if (exerciseAnswers[qi] === oi) {
                      cls = "border-primary bg-primary/5 shadow-sm";
                    }
                    return (
                      <button
                        key={oi}
                        className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left text-sm transition-all ${cls}`}
                        onClick={() => handleExerciseAnswer(qi, oi)}
                      >
                        {exerciseSubmitted && oi === ex.correct && (
                          <CheckCircle className="h-4 w-4 shrink-0 text-emerald-500" />
                        )}
                        {exerciseSubmitted &&
                          exerciseAnswers[qi] === oi &&
                          oi !== ex.correct && (
                            <XCircle className="h-4 w-4 shrink-0 text-red-500" />
                          )}
                        {!exerciseSubmitted && (
                          <span
                            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs ${exerciseAnswers[qi] === oi ? "border-primary bg-primary text-white" : ""}`}
                          >
                            {String.fromCharCode(65 + oi)}
                          </span>
                        )}
                        <span>{opt}</span>
                      </button>
                    );
                  })}
                </div>
                {exerciseSubmitted && (
                  <p className="pl-8 text-xs text-muted-foreground italic">
                    💡 {ex.explanation}
                  </p>
                )}
              </div>
            ))}
            {!exerciseSubmitted ? (
              <Button
                variant="gradient"
                onClick={() => setExerciseSubmitted(true)}
                disabled={
                  Object.keys(exerciseAnswers).length <
                  selectedLesson.exercises.length
                }
              >
                Submit Answers
              </Button>
            ) : (
              <div
                className={`rounded-xl p-5 text-center ${exerciseScore >= selectedLesson.exercises.length * 0.7 ? "bg-emerald-50 dark:bg-emerald-950/20" : "bg-amber-50 dark:bg-amber-950/20"}`}
              >
                <p className="text-3xl font-bold">
                  {exerciseScore} / {selectedLesson.exercises.length}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {exerciseScore >= selectedLesson.exercises.length * 0.7
                    ? "Great job! 🎉"
                    : "Keep practicing! 📚"}
                </p>
                <Button
                  variant="outline"
                  className="mt-3"
                  onClick={() => {
                    setExerciseAnswers({});
                    setExerciseSubmitted(false);
                  }}
                >
                  Try Again
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Tips */}
        <Card className="border-amber-200 dark:border-amber-900/30">
          <CardHeader className="px-6 pt-6 pb-3">
            <CardTitle className="flex items-center gap-2 text-base text-amber-600 dark:text-amber-400">
              <Lightbulb className="h-5 w-5" /> Pro Tips
            </CardTitle>
          </CardHeader>
          <CardContent className="px-6 pb-6">
            <ul className="space-y-3">
              {selectedLesson.tips.map((tip, i) => (
                <li key={i} className="flex items-start gap-3 text-sm">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber-500" />
                  <span className="leading-relaxed">{tip}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {/* Common Mistakes */}
        <Card className="border-red-200 dark:border-red-900/30">
          <CardHeader className="px-6 pt-6 pb-3">
            <CardTitle className="flex items-center gap-2 text-base text-red-500">
              ⚠️ Common Mistakes
            </CardTitle>
          </CardHeader>
          <CardContent className="px-6 pb-6 space-y-3">
            {selectedLesson.commonMistakes.map((m, i) => (
              <div key={i} className="rounded-xl border p-4 space-y-1">
                <p className="text-sm">
                  <span className="text-red-500 line-through">{m.wrong}</span>
                </p>
                <p className="text-sm">
                  <span className="text-emerald-600 font-medium">
                    {m.right}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">{m.note}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  // ======= MAIN VIEW =======
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10">
          <BookA className="h-5 w-5 text-emerald-500" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">{t.grammar.title}</h1>
          <p className="text-sm text-muted-foreground">{t.grammar.desc}</p>
        </div>
      </div>

      {/* Tab Switch */}
      <div className="flex gap-2 border-b pb-1">
        <button
          className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${tab === "lessons" ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground"}`}
          onClick={() => setTab("lessons")}
        >
          <Library className="mr-2 h-4 w-4 inline" /> Lessons ({lessons.length})
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${tab === "ai" ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground"}`}
          onClick={() => setTab("ai")}
        >
          <Sparkles className="mr-2 h-4 w-4 inline" /> AI Explain
        </button>
      </div>

      {/* ======= LESSONS TAB ======= */}
      {tab === "lessons" && (
        <>
          {/* Category Filter */}
          <div className="flex flex-wrap gap-2">
            <Button
              variant={selectedCategory === "all" ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedCategory("all")}
            >
              All
            </Button>
            {grammarCategories.map((cat) => (
              <Button
                key={cat.id}
                variant={selectedCategory === cat.id ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedCategory(cat.id)}
              >
                {cat.label}
              </Button>
            ))}
          </div>

          {/* Loading / Lesson Grid */}
          {lessonsLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredLessons.map((lesson) => (
                <Card
                  key={lesson.id}
                  className="cursor-pointer transition-all hover:shadow-md hover:border-primary/30"
                  onClick={() => openLesson(lesson)}
                >
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="font-semibold text-sm">
                          {lesson.title}
                        </h3>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {lesson.titleVi}
                        </p>
                      </div>
                      <Badge variant="secondary" className="shrink-0">
                        {lesson.level}
                      </Badge>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground line-clamp-2">
                      {lesson.description}
                    </p>
                    <div className="mt-3 flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">
                        {lesson.exercises.length} exercises
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {lesson.examples.length} examples
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {/* ======= AI TAB ======= */}
      {tab === "ai" && (
        <>
          <Card>
            <CardContent className="px-6 py-5">
              <div className="flex flex-wrap gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    className="h-11 w-full rounded-xl border bg-background pl-10 pr-4 text-sm transition-colors placeholder:text-muted-foreground/60 hover:border-primary/30 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    placeholder={t.grammar.topicPlaceholder}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  />
                </div>
                <select
                  className="h-11 rounded-xl border bg-background px-3 text-sm"
                  value={targetLanguage}
                  onChange={(e) => setTargetLanguage(e.target.value)}
                >
                  <option value="english">{t.languages.english}</option>
                  <option value="vietnamese">{t.languages.vietnamese}</option>
                  <option value="japanese">{t.languages.japanese}</option>
                  <option value="korean">{t.languages.korean}</option>
                </select>
                <select
                  className="h-11 rounded-xl border bg-background px-3 text-sm"
                  value={nativeLanguage}
                  onChange={(e) => setNativeLanguage(e.target.value)}
                >
                  <option value="vietnamese">{t.languages.vietnamese}</option>
                  <option value="english">{t.languages.english}</option>
                </select>
                <Button
                  variant="gradient"
                  onClick={handleSearch}
                  disabled={loading || !query.trim()}
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />{" "}
                      {t.grammar.explaining}
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-4 w-4" /> {t.grammar.explain}
                    </>
                  )}
                </Button>
                <TokenCost feature="grammar_explain" variant="badge" />
              </div>
            </CardContent>
          </Card>

          {result && (
            <div className="animate-fade-in space-y-5">
              <Card>
                <CardHeader className="px-6 pt-6 pb-4">
                  <div className="flex items-center gap-2">
                    <GraduationCap className="h-5 w-5 text-primary" />
                    <CardTitle className="text-xl">{result.topic}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="px-6 pb-6">
                  <div className="whitespace-pre-wrap text-sm leading-7 text-foreground/90">
                    {result.explanation}
                  </div>
                </CardContent>
              </Card>
              {result.examples?.length > 0 && (
                <Card>
                  <CardHeader className="px-6 pt-6 pb-4">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <BookA className="h-4 w-4 text-blue-500" /> Examples{" "}
                      <Badge variant="secondary">
                        {result.examples.length}
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 px-6 pb-6">
                    {result.examples.map((ex, i) => (
                      <div
                        key={i}
                        className="rounded-xl border bg-muted/30 p-4"
                      >
                        <p className="font-medium text-sm">{ex.sentence}</p>
                        <p className="mt-1.5 text-sm text-muted-foreground">
                          {ex.translation}
                        </p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
              {result.exercises?.length > 0 && (
                <Card>
                  <CardHeader className="px-6 pt-6 pb-4">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Pencil className="h-4 w-4 text-violet-500" /> Exercises
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 px-6 pb-6">
                    {result.exercises.map((ex, i) => (
                      <div key={i} className="rounded-xl border p-4">
                        <p className="font-medium text-sm">{ex.question}</p>
                        {showExerciseAnswers[i] ? (
                          <div className="mt-2.5 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 dark:bg-emerald-950/20">
                            <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                              ✓ {ex.answer}
                            </span>
                          </div>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="mt-2 text-primary"
                            onClick={() =>
                              setShowExerciseAnswers({
                                ...showExerciseAnswers,
                                [i]: true,
                              })
                            }
                          >
                            Show Answer →
                          </Button>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
              {result.tips?.length > 0 && (
                <Card className="border-amber-200 dark:border-amber-900/30">
                  <CardHeader className="px-6 pt-6 pb-4">
                    <CardTitle className="flex items-center gap-2 text-base text-amber-600 dark:text-amber-400">
                      <Lightbulb className="h-5 w-5" /> Pro Tips
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-6 pb-6">
                    <ul className="space-y-3">
                      {result.tips.map((tip, i) => (
                        <li key={i} className="flex items-start gap-3 text-sm">
                          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber-500" />
                          <span className="leading-relaxed">{tip}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
