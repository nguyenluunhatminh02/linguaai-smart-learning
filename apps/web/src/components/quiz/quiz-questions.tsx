'use client';

import { useState } from 'react';
import { CheckCircle, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface QuizQuestionData {
  question: string;
  options: string[];
  correctAnswer: number;
  explanation?: string;
}

interface QuizQuestionsProps {
  questions: QuizQuestionData[];
  title?: string;
  onComplete?: (score: number, total: number) => void;
  submitLabel?: string;
  tryAgainLabel?: string;
}

export function QuizQuestions({
  questions,
  title,
  onComplete,
  submitLabel = 'Submit Answers',
  tryAgainLabel = 'Try Again',
}: QuizQuestionsProps) {
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [submitted, setSubmitted] = useState(false);

  const score = questions.filter((q, i) => answers[i] === q.correctAnswer).length;

  const handleSubmit = () => {
    setSubmitted(true);
    onComplete?.(score, questions.length);
  };

  const handleRetry = () => {
    setAnswers({});
    setSubmitted(false);
  };

  const handleAnswer = (qi: number, oi: number) => {
    if (!submitted) setAnswers((prev) => ({ ...prev, [qi]: oi }));
  };

  return (
    <div className="space-y-5">
      {title && (
        <h3 className="flex items-center gap-2 text-lg font-semibold">{title}</h3>
      )}
      {questions.map((q, qi) => (
        <div key={qi} className="space-y-2">
          <p className="text-sm font-medium">
            <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
              {qi + 1}
            </span>
            {q.question}
          </p>
          <div className="space-y-1.5 pl-8">
            {q.options.map((opt, oi) => {
              let cls = 'border bg-background hover:bg-muted/50';
              if (submitted) {
                if (oi === q.correctAnswer) cls = 'border-emerald-500 bg-emerald-500/15 text-foreground';
                else if (answers[qi] === oi && oi !== q.correctAnswer) cls = 'border-red-500 bg-red-500/15 text-foreground';
              } else if (answers[qi] === oi) {
                cls = 'border-primary bg-primary/5 shadow-sm';
              }
              return (
                <button
                  key={oi}
                  className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left text-sm transition-all ${cls}`}
                  onClick={() => handleAnswer(qi, oi)}
                >
                  {submitted && oi === q.correctAnswer && <CheckCircle className="h-4 w-4 shrink-0 text-emerald-500" />}
                  {submitted && answers[qi] === oi && oi !== q.correctAnswer && <XCircle className="h-4 w-4 shrink-0 text-red-500" />}
                  {!submitted && (
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs ${
                        answers[qi] === oi ? 'border-primary bg-primary text-white' : ''
                      }`}
                    >
                      {String.fromCharCode(65 + oi)}
                    </span>
                  )}
                  <span>{opt}</span>
                </button>
              );
            })}
          </div>
          {submitted && q.explanation && (
            <p className="pl-8 text-xs italic text-muted-foreground">
              💡 {q.explanation}
            </p>
          )}
        </div>
      ))}
      {!submitted ? (
        <Button
          variant="gradient"
          onClick={handleSubmit}
          disabled={Object.keys(answers).length < questions.length}
        >
          {submitLabel}
        </Button>
      ) : (
        <div
          className={`rounded-xl p-5 text-center ${
            score >= questions.length * 0.7
              ? 'bg-emerald-500/10 border border-emerald-500/30'
              : 'bg-amber-500/10 border border-amber-500/30'
          }`}
        >
          <p className="text-3xl font-bold">
            {score} / {questions.length}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {score >= questions.length * 0.7 ? 'Great job! 🎉' : 'Keep practicing! 📚'}
          </p>
          <Button variant="outline" className="mt-3" onClick={handleRetry}>
            {tryAgainLabel}
          </Button>
        </div>
      )}
    </div>
  );
}
