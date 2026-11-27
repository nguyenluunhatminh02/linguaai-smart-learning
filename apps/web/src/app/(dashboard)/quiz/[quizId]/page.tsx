"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { ArrowLeft, CheckCircle, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { apiClient } from "@/lib/api-client";
import { useLanguageStore } from "@/stores/language-store";

interface Quiz {
  id: string;
  title: string;
  description: string;
  timeLimitMinutes?: number;
  quizQuestions: { id: string; questionText: string; options: string[] }[];
}

interface GradedAnswer {
  questionId: string;
  answer: string;
  optionIndex?: number;
  isCorrect: boolean;
  correctAnswer?: string;
  correctOptionIndex?: number | null;
  explanation?: string;
}

interface Attempt {
  score: number;
  total: number;
  results: GradedAnswer[];
}

interface Submission {
  quizId: string;
  attemptId: string;
  durationSeconds: number;
  answers: { questionId: string; answer: string; optionIndex?: number }[];
}

export default function TakeQuizPage() {
  const { quizId } = useParams<{ quizId: string }>();
  return <QuizAttempt key={quizId} quizId={quizId} />;
}

function QuizAttempt({ quizId }: { quizId: string }) {
  const vi = useLanguageStore((state) => state.locale === "vi");
  const queryClient = useQueryClient();
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [answers, setAnswers] = useState<Record<string, string | number>>({});
  const [result, setResult] = useState<Attempt | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [loadCount, setLoadCount] = useState(0);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const startedAt = useRef(0);
  const pending = useRef<Submission | null>(null);
  const busy = useRef(false);
  const submitRef = useRef<(force?: boolean) => void>(() => {});

  useEffect(() => {
    let active = true;
    void Promise.all([
      apiClient.get<Quiz>(`/quiz/${quizId}`),
      apiClient.get<{ score: number; totalQuestions: number; answers: GradedAnswer[] }[]>(`/quiz/${quizId}/attempts`),
    ]).then(([quizResponse, history]) => {
      if (!active) return;
      setQuiz(quizResponse.data);
      setLoadError(false);
      startedAt.current = Date.now();
      const limitMinutes = Number(quizResponse.data?.timeLimitMinutes);
      setTimeLeft(Number.isFinite(limitMinutes) && limitMinutes > 0
        ? Math.ceil(limitMinutes * 60)
        : null);
      const latest = history.data[0];
      if (latest) {
        setResult({ score: latest.score, total: latest.totalQuestions, results: latest.answers });
      }
    }).catch(() => {
      if (active) setLoadError(true);
    });
    return () => { active = false; };
  }, [quizId, loadCount]);

  // Keep the latest submit closure available to the timer without restarting
  // the interval on every keystroke or result change.
  submitRef.current = (force = false) => { void submit(force); };

  useEffect(() => {
    if (timeLeft === null || timeLeft <= 0 || result || submitting) return;
    const deadline = startedAt.current + timeLeft * 1000;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setTimeLeft(remaining);
      if (remaining === 0) submitRef.current(true);
    };
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
    // timeLeft intentionally excluded: it is derived from the fixed deadline
    // captured when the timer starts, not an input to the timer itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quiz, result, submitting, loadCount]);

  if (loadError) {
    return <div className="space-y-3">
      <p role="alert">{vi ? "Chưa tải được bài trắc nghiệm." : "The quiz could not load."}</p>
      <Button onClick={() => { setLoadError(false); setLoadCount((count) => count + 1); }}>
        {vi ? "Thử lại" : "Retry"}
      </Button>
    </div>;
  }
  if (!quiz) return <p role="status">{vi ? "Đang tải bài trắc nghiệm…" : "Loading quiz…"}</p>;
  const questions = quiz.quizQuestions;
  const answeredCount = questions.filter(({ id }) => {
    const answer = answers[id];
    return typeof answer === "number" || Boolean(answer?.trim());
  }).length;
  const locked = Boolean(result || submitting || pending.current);

  const submit = async (force = false) => {
    if (busy.current || result || !questions.length) return;
    // The timer may fire before React re-renders after the last answer, so
    // allow it to submit the current answers even if the count looks short.
    if (!force && answeredCount !== questions.length) return;
    const payload = pending.current ?? {
      quizId,
      attemptId: crypto.randomUUID(),
      durationSeconds: Math.floor((Date.now() - startedAt.current) / 1000),
      answers: questions.map(({ id, options }) => {
        const answer = answers[id];
        return typeof answer === "number"
          ? { questionId: id, answer: options[answer], optionIndex: answer }
          : { questionId: id, answer };
      }),
    };
    busy.current = true;
    // A timer-triggered submit may fire before all answers are entered; send
    // whatever is available rather than silently leaving the attempt open.
    if (force && payload.answers.length !== questions.length) {
      payload.answers = questions.flatMap(({ id, options }) => {
        const answer = answers[id];
        if (typeof answer === "number") {
          return [{ questionId: id, answer: options[answer] ?? "", optionIndex: answer }];
        }
        return typeof answer === "string" && answer.trim()
          ? [{ questionId: id, answer }]
          : [];
      });
    }
    pending.current = payload;
    setSubmitting(true);
    setSubmitError(false);
    try {
      const { data } = await apiClient.post<Attempt>("/quiz/submit", payload);
      setResult(data);
      pending.current = null;
      void queryClient.invalidateQueries({ queryKey: ["next-learning-activity"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
    } catch {
      setSubmitError(true);
    } finally {
      busy.current = false;
      setSubmitting(false);
    }
  };

  const restart = () => {
    setAnswers({});
    setResult(null);
    setSubmitError(false);
    pending.current = null;
    startedAt.current = Date.now();
    setTimeLeft(quiz?.timeLimitMinutes && quiz.timeLimitMinutes > 0
      ? Math.ceil(quiz.timeLimitMinutes * 60)
      : null);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/quiz" className="inline-flex items-center gap-2 text-sm font-medium">
        <ArrowLeft className="h-4 w-4" aria-hidden /> {vi ? "Danh sách trắc nghiệm" : "All quizzes"}
      </Link>
      <div>
        <h1 className="text-2xl font-bold">{quiz.title}</h1>
        {quiz.description && <p className="text-muted-foreground">{quiz.description}</p>}
      </div>
      {questions.length === 0 && <p role="status">{vi ? "Bài này chưa có câu hỏi." : "This quiz has no questions yet."}</p>}
      {!result && questions.length > 0 && (
        <div className="space-y-2">
          <Progress value={answeredCount} max={questions.length} variant="gradient" showLabel />
          {timeLeft !== null && (
            <p role={timeLeft <= 30 ? "alert" : "status"} className={timeLeft <= 30 ? "text-sm font-medium text-red-600" : "text-sm text-muted-foreground"}>
              {vi
                ? `Thời gian còn lại: ${Math.floor(timeLeft / 60)}:${String(timeLeft % 60).padStart(2, "0")}`
                : `Time remaining: ${Math.floor(timeLeft / 60)}:${String(timeLeft % 60).padStart(2, "0")}`}
            </p>
          )}
        </div>
      )}
      {result && (
        <Card>
          <CardContent className="space-y-3 p-5">
            <p role="status" className="font-semibold">
              {vi ? "Kết quả đã lưu" : "Saved result"} · {result.score}/{result.total}
            </p>
            {questions.length > 0 && <Button variant="outline" onClick={restart}>{vi ? "Làm lại" : "Take again"}</Button>}
          </CardContent>
        </Card>
      )}
      {questions.map((question, index) => {
        const feedback = result?.results.find((item) => item.questionId === question.id);
        const answer = feedback ? feedback.optionIndex ?? feedback.answer : answers[question.id];
        return (
          <Card key={question.id}>
            <CardHeader>
              <CardTitle id={`question-${question.id}`} className="text-base">{index + 1}. {question.questionText}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {question.options.length === 0 ? (
                <input
                  aria-labelledby={`question-${question.id}`}
                  className="w-full rounded-xl border px-4 py-3"
                  disabled={locked}
                  maxLength={1000}
                  value={typeof answer === "string" ? answer : ""}
                  onChange={(event) => setAnswers((previous) => ({ ...previous, [question.id]: event.target.value }))}
                />
              ) : question.options.map((option, position) => {
                const selected = answer === position || answer === option;
                const correct = feedback?.correctOptionIndex === position;
                return (
                  <button
                    type="button"
                    disabled={locked}
                    aria-pressed={selected}
                    key={position}
                    className={`block w-full rounded-xl border p-3 text-left ${correct ? "border-emerald-500" : selected ? "border-primary bg-primary/5" : ""}`}
                    onClick={() => setAnswers((previous) => ({ ...previous, [question.id]: position }))}
                  >
                    {option}
                  </button>
                );
              })}
              {feedback && (
                <div className="space-y-1 text-sm">
                  <p className="flex items-center gap-2">
                    {feedback.isCorrect
                      ? <><CheckCircle className="h-4 w-4 text-emerald-600" aria-hidden /> {vi ? "Đúng" : "Correct"}</>
                      : <><XCircle className="h-4 w-4 text-red-600" aria-hidden /> {vi ? "Cần ôn thêm" : "Needs practice"}</>}
                  </p>
                  {!feedback.isCorrect && feedback.correctAnswer && <p>{vi ? "Đáp án" : "Answer"} · {feedback.correctAnswer}</p>}
                  {feedback.explanation && <p>{feedback.explanation}</p>}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
      {!result && questions.length > 0 && (
        <div className="space-y-2 pb-8">
          {submitError && <p role="alert">{vi ? "Chưa xác nhận được kết quả. Câu trả lời vẫn được giữ, bạn có thể gửi lại." : "The result could not be confirmed. Your answers are kept so you can retry."}</p>}
          <Button onClick={() => void submit()} disabled={submitting || answeredCount < questions.length}>
            {submitting ? (vi ? "Đang gửi…" : "Submitting…") : submitError ? (vi ? "Gửi lại" : "Retry submission") : (vi ? "Nộp bài" : "Submit quiz")}
          </Button>
        </div>
      )}
    </div>
  );
}
