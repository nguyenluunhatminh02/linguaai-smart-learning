'use client';

import { useState, useMemo, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Languages, ChevronLeft, CheckCircle, XCircle, BookOpen, Lightbulb, AlertTriangle, Loader2,
} from 'lucide-react';
import { FlagIcon } from '@/components/ui/flag-icon';

export interface JaGrammarExercise {
  id: number;
  type: 'fill-blank' | 'multiple-choice' | 'reorder' | 'translate';
  question: string;
  options?: string[];
  answer: string;
  explanation: string;
}

export interface JaGrammarLesson {
  id: string;
  title: string;
  titleVi: string;
  slug: string;
  level: string;
  category: string;
  description: string;
  formula: string;
  explanation: string;
  examples: { ja: string; vi: string }[];
  exercises: JaGrammarExercise[];
  tips: string[];
  commonMistakes: { wrong: string; right: string; note: string }[];
}

const jaGrammarCategories = [
  { id: 'particles', label: 'Trợ từ (助詞)' },
  { id: 'verb-forms', label: 'Thể động từ (動詞の形)' },
  { id: 'sentence-patterns', label: 'Mẫu câu (文型)' },
  { id: 'honorifics', label: 'Kính ngữ (敬語)' },
  { id: 'advanced-grammar', label: 'Ngữ pháp nâng cao' },
];

function cmsToJaGrammarLesson(lesson: Record<string, unknown>): JaGrammarLesson {
  const c = (lesson.content ?? {}) as Record<string, unknown>;
  return {
    id: (lesson.slug as string) || (lesson.id as string),
    title: lesson.title as string,
    titleVi: (lesson.titleVi ?? lesson.title_vi) as string,
    slug: (lesson.slug as string) ?? '',
    level: lesson.level as string,
    category: lesson.category as string,
    description: (lesson.description as string) ?? '',
    formula: (c.formula as string) ?? '',
    explanation: (c.explanation as string) ?? '',
    examples: ((c.examples as Array<Record<string, string>>) ?? []).map((ex) => ({ ja: ex.native || ex.ja || '', vi: ex.vi || '' })),
    exercises: ((c.exercises as Array<Record<string, unknown>>) ?? []).map((ex) => ({
      id: (ex.id as number) ?? 0,
      type: (ex.type as JaGrammarExercise['type']) ?? 'multiple-choice',
      question: (ex.question as string) ?? '',
      options: (ex.options as string[]) ?? [],
      answer: (ex.answer as string) ?? (ex.options as string[])?.[ex.correct as number] ?? '',
      explanation: (ex.explanation as string) ?? '',
    })),
    tips: (c.tips as string[]) ?? [],
    commonMistakes: (c.commonMistakes as JaGrammarLesson['commonMistakes']) ?? [],
  };
}

const levels = ['N5', 'N4', 'N3', 'N2', 'N1', 'Advanced'] as const;

export default function JapaneseGrammarPage() {
  const [lessons, setLessons] = useState<JaGrammarLesson[]>([]);
  const [lessonsLoading, setLessonsLoading] = useState(true);
  const [selectedLesson, setSelectedLesson] = useState<JaGrammarLesson | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedLevel, setSelectedLevel] = useState<string>('all');
  const [exerciseAnswers, setExerciseAnswers] = useState<Record<number, string>>({});
  const [exerciseSubmitted, setExerciseSubmitted] = useState(false);

  useEffect(() => {
    fetch('/api/cms/lessons?type=grammar&language=japanese&published=true&limit=200')
      .then(r => r.json())
      .then(json => {
        const items: Record<string, unknown>[] = json.data ?? json ?? [];
        setLessons(items.map(cmsToJaGrammarLesson));
      })
      .catch(() => {})
      .finally(() => setLessonsLoading(false));
  }, []);

  const filteredLessons = useMemo(() => {
    return lessons.filter((l) => {
      if (selectedCategory !== 'all' && l.category !== selectedCategory) return false;
      if (selectedLevel !== 'all' && l.level !== selectedLevel) return false;
      return true;
    });
  }, [lessons, selectedCategory, selectedLevel]);

  const normalize = (s: string | undefined) => (s ?? '').trim().replace(/\s+/g, ' ');

  // ─── Lesson Detail ───
  if (selectedLesson) {
    const exerciseScore = selectedLesson.exercises.filter(
      (ex, i) => normalize(exerciseAnswers[i] || '') === normalize(ex.answer)
    ).length;

    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={() => { setSelectedLesson(null); setExerciseAnswers({}); setExerciseSubmitted(false); }} className="gap-1">
          <ChevronLeft className="h-4 w-4" /> Quay lại
        </Button>

        {/* Header */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="secondary">{selectedLesson.level}</Badge>
            <Badge variant="outline">{jaGrammarCategories.find(c => c.id === selectedLesson.category)?.label}</Badge>
          </div>
          <h1 className="text-2xl font-bold">{selectedLesson.title}</h1>
          <p className="text-sm text-muted-foreground">{selectedLesson.titleVi}</p>
        </div>

        {/* Formula & Explanation */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-blue-500" /> Giải thích
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-lg bg-primary/5 border border-primary/20 px-4 py-3">
              <p className="font-mono text-sm font-semibold text-primary">{selectedLesson.formula}</p>
            </div>
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{selectedLesson.explanation}</p>
          </CardContent>
        </Card>

        {/* Examples */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Ví dụ 例文</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {selectedLesson.examples.map((ex, i) => (
              <div key={i} className="rounded-lg border p-3 space-y-1">
                <p className="text-sm font-medium flex items-center gap-1.5">
                  <FlagIcon country="ja" className="h-3.5 w-5 shrink-0" />
                  <span>{ex.ja}</span>
                </p>
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <FlagIcon country="vi" className="h-3 w-4.5 shrink-0" />
                  <span>{ex.vi}</span>
                </p>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Exercises */}
        {selectedLesson.exercises.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                Bài tập <Badge variant="secondary">{selectedLesson.exercises.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {selectedLesson.exercises.map((ex, qi) => (
                <ExerciseItem
                  key={ex.id}
                  exercise={ex}
                  index={qi}
                  userAnswer={exerciseAnswers[qi] || ''}
                  submitted={exerciseSubmitted}
                  onAnswer={(val) => setExerciseAnswers(prev => ({ ...prev, [qi]: val }))}
                />
              ))}

              {!exerciseSubmitted ? (
                <Button
                  variant="gradient"
                  onClick={() => setExerciseSubmitted(true)}
                  disabled={Object.keys(exerciseAnswers).length < selectedLesson.exercises.length}
                >
                  Nộp bài
                </Button>
              ) : (
                <div className={`rounded-xl p-5 text-center ${exerciseScore >= selectedLesson.exercises.length * 0.7 ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-amber-500/10 border border-amber-500/30'}`}>
                  <p className="text-3xl font-bold">{exerciseScore} / {selectedLesson.exercises.length}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {exerciseScore >= selectedLesson.exercises.length * 0.7 ? 'すごい！素晴らしい 🎉' : 'がんばって！もう一度 📚'}
                  </p>
                  <Button variant="outline" className="mt-3" onClick={() => { setExerciseAnswers({}); setExerciseSubmitted(false); }}>
                    Làm lại
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Tips */}
        {selectedLesson.tips.length > 0 && (
          <Card className="border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2 text-amber-700 dark:text-amber-400">
                <Lightbulb className="h-4 w-4" /> Mẹo hay
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {selectedLesson.tips.map((tip, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span className="text-amber-500 mt-0.5">•</span>
                    <span>{tip}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Common Mistakes */}
        {selectedLesson.commonMistakes.length > 0 && (
          <Card className="border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-950/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2 text-red-700 dark:text-red-400">
                <AlertTriangle className="h-4 w-4" /> Lỗi thường gặp
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {selectedLesson.commonMistakes.map((m, i) => (
                <div key={i} className="rounded-lg border border-red-200 dark:border-red-800 p-3 space-y-1">
                  <p className="text-sm"><span className="text-red-500">✗</span> <span className="line-through">{m.wrong}</span></p>
                  <p className="text-sm"><span className="text-emerald-500">✓</span> {m.right}</p>
                  <p className="text-xs text-muted-foreground">{m.note}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  // ─── Lesson List ───
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10">
          <Languages className="h-5 w-5 text-blue-500" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Ngữ pháp tiếng Nhật</h1>
          <p className="text-sm text-muted-foreground">日本語文法 — Bài học ngữ pháp N5–N1</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant={selectedLevel === 'all' ? 'default' : 'outline'} size="sm" onClick={() => setSelectedLevel('all')} className="rounded-full">
          Tất cả
        </Button>
        {levels.map((lv) => (
          <Button key={lv} variant={selectedLevel === lv ? 'default' : 'outline'} size="sm" onClick={() => setSelectedLevel(lv)} className="rounded-full">
            {lv}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant={selectedCategory === 'all' ? 'secondary' : 'ghost'} size="sm" onClick={() => setSelectedCategory('all')}>
          Tất cả
        </Button>
        {jaGrammarCategories.map((cat) => (
          <Button key={cat.id} variant={selectedCategory === cat.id ? 'secondary' : 'ghost'} size="sm" onClick={() => setSelectedCategory(cat.id)}>
            {cat.label}
          </Button>
        ))}
      </div>

      {lessonsLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : filteredLessons.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Languages className="h-10 w-10 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">Không có bài học cho bộ lọc này</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredLessons.map((lesson, i) => (
            <Card
              key={lesson.id}
              className="cursor-pointer transition-all hover:shadow-md hover:border-primary/30 animate-fade-in-up"
              style={{ animationDelay: `${i * 60}ms` }}
              onClick={() => setSelectedLesson(lesson)}
            >
              <CardContent className="p-5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="secondary">{lesson.level}</Badge>
                  <Badge variant="outline" className="text-[10px]">
                    {jaGrammarCategories.find(c => c.id === lesson.category)?.label}
                  </Badge>
                </div>
                <div>
                  <p className="font-semibold text-sm">{lesson.title}</p>
                  <p className="text-xs text-muted-foreground">{lesson.titleVi}</p>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{lesson.exercises.length} bài tập</span>
                  <span>•</span>
                  <span>{lesson.examples.length} ví dụ</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Exercise Item Component ───
// Handles different exercise types: fill-blank, multiple-choice, translate
function ExerciseItem({
  exercise,
  index,
  userAnswer,
  submitted,
  onAnswer,
}: {
  exercise: JaGrammarExercise;
  index: number;
  userAnswer: string;
  submitted: boolean;
  onAnswer: (val: string) => void;
}) {
  const normalize = (s: string | undefined) => (s ?? '').trim().replace(/\s+/g, ' ');
  const isCorrect = normalize(userAnswer) === normalize(exercise.answer);

  const typeLabel = exercise.type === 'fill-blank' ? '穴埋め' : exercise.type === 'multiple-choice' ? '選択' : exercise.type === 'translate' ? '翻訳' : exercise.type;

  return (
    <div className="space-y-2">
      <p className="font-medium text-sm">
        <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{index + 1}</span>
        {exercise.question}
        <Badge variant="outline" className="ml-2 text-[10px]">{typeLabel}</Badge>
      </p>

      {exercise.type === 'multiple-choice' && exercise.options ? (
        <div className="space-y-1.5 pl-8">
          {exercise.options.map((opt, oi) => {
            let cls = 'border bg-background hover:bg-muted/50';
            if (submitted) {
              if (opt === exercise.answer) cls = 'border-emerald-500 bg-emerald-500/15';
              else if (userAnswer === opt && opt !== exercise.answer) cls = 'border-red-500 bg-red-500/15';
            } else if (userAnswer === opt) {
              cls = 'border-primary bg-primary/5 shadow-sm';
            }
            return (
              <button
                key={oi}
                className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left text-sm transition-all ${cls}`}
                onClick={() => { if (!submitted) onAnswer(opt); }}
              >
                {submitted && opt === exercise.answer && <CheckCircle className="h-4 w-4 shrink-0 text-emerald-500" />}
                {submitted && userAnswer === opt && opt !== exercise.answer && <XCircle className="h-4 w-4 shrink-0 text-red-500" />}
                {!submitted && (
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs ${userAnswer === opt ? 'border-primary bg-primary text-white' : ''}`}>
                    {String.fromCharCode(65 + oi)}
                  </span>
                )}
                <span>{opt}</span>
              </button>
            );
          })}
        </div>
      ) : (
        /* fill-blank / translate */
        <div className="pl-8">
          <Input
            placeholder={exercise.type === 'fill-blank' ? '___を入力...' : 'Nhập bản dịch...'}
            value={userAnswer}
            onChange={(e) => { if (!submitted) onAnswer(e.target.value); }}
            disabled={submitted}
            className={submitted ? (isCorrect ? 'border-emerald-500 bg-emerald-500/10' : 'border-red-500 bg-red-500/10') : ''}
          />
          {submitted && !isCorrect && (
            <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">Đáp án: <span className="font-semibold">{exercise.answer}</span></p>
          )}
        </div>
      )}

      {submitted && <p className="pl-8 text-xs text-muted-foreground italic">💡 {exercise.explanation}</p>}
    </div>
  );
}
