'use client';

import { useState, useMemo, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Languages, ChevronLeft, CheckCircle, XCircle, BookOpen, Lightbulb, AlertTriangle, Loader2,
} from 'lucide-react';
import { FlagIcon } from '@/components/ui/flag-icon';

interface ZhGrammarExercise {
  question: string;
  options: string[];
  correct: number;
  explanation: string;
}

interface ZhGrammarLesson {
  id: string;
  title: string;
  titleVi: string;
  slug: string;
  level: string;
  category: string;
  description: string;
  formula: string;
  explanation: string;
  examples: { zh: string; vi: string }[];
  exercises: ZhGrammarExercise[];
  tips: string[];
  commonMistakes: { wrong: string; right: string; note: string }[];
}

const zhGrammarCategories = [
  { id: 'sentence-structure', label: 'Cấu trúc câu', icon: '📐' },
  { id: 'particles', label: 'Trợ từ', icon: '🔤' },
  { id: 'complements', label: 'Bổ ngữ', icon: '📊' },
  { id: 'special-patterns', label: 'Mẫu câu đặc biệt', icon: '⭐' },
];

function cmsToZhGrammarLesson(lesson: Record<string, unknown>): ZhGrammarLesson {
  const c = (lesson.content ?? {}) as Record<string, unknown>;
  return {
    id: (lesson.slug as string) || (lesson.id as string),
    title: lesson.title as string,
    titleVi: ((lesson.titleVi ?? lesson.title_vi) as string) ?? '',
    slug: (lesson.slug as string) ?? '',
    level: lesson.level as string,
    category: (lesson.category as string) ?? '',
    description: (lesson.description as string) ?? '',
    formula: (c.formula as string) ?? '',
    explanation: (c.explanation as string) ?? '',
    examples: ((c.examples as Array<Record<string, string>>) ?? []).map((ex) => ({ zh: ex.native || ex.zh || '', vi: ex.vi || '' })),
    exercises: (c.exercises as ZhGrammarExercise[]) ?? [],
    tips: (c.tips as string[]) ?? [],
    commonMistakes: (c.commonMistakes as { wrong: string; right: string; note: string }[]) ?? [],
  };
}

const levels = ['HSK1', 'HSK2', 'HSK3', 'HSK4', 'HSK5', 'HSK6'] as const;

function renderMarkdownText(text: string) {
  const lines = text.split('\n');
  return lines.map((line, li) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g);
    return (
      <span key={li}>
        {parts.map((part, pi) =>
          part.startsWith('**') && part.endsWith('**')
            ? <strong key={pi}>{part.slice(2, -2)}</strong>
            : <span key={pi}>{part}</span>
        )}
        {li < lines.length - 1 && <br />}
      </span>
    );
  });
}

export default function ChineseGrammarPage() {
  const [selectedLesson, setSelectedLesson] = useState<ZhGrammarLesson | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedLevel, setSelectedLevel] = useState<string>('all');
  const [exerciseAnswers, setExerciseAnswers] = useState<Record<number, number>>({});
  const [exerciseSubmitted, setExerciseSubmitted] = useState(false);
  const [lessons, setLessons] = useState<ZhGrammarLesson[]>([]);
  const [lessonsLoading, setLessonsLoading] = useState(true);

  useEffect(() => {
    fetch('/api/cms/lessons?type=grammar&language=chinese&published=true&limit=200')
      .then(r => r.json())
      .then(json => {
        const items: Record<string, unknown>[] = json.data ?? json ?? [];
        setLessons(items.map(cmsToZhGrammarLesson));
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

  // ─── Lesson Detail ───
  if (selectedLesson) {
    const exerciseScore = selectedLesson.exercises.filter(
      (ex, i) => exerciseAnswers[i] === ex.correct
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
            <Badge variant="outline">{zhGrammarCategories.find(c => c.id === selectedLesson.category)?.label}</Badge>
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
            <p className="text-sm leading-relaxed">{renderMarkdownText(selectedLesson.explanation)}</p>
          </CardContent>
        </Card>

        {/* Examples */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Ví dụ 例句</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {selectedLesson.examples.map((ex, i) => (
              <div key={i} className="rounded-lg border p-3 space-y-1">
                <p className="text-sm font-medium flex items-center gap-1.5">
                  <FlagIcon country="zh" className="h-3.5 w-5 shrink-0" />
                  <span>{ex.zh}</span>
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
                <div key={qi} className="space-y-2">
                  <p className="font-medium text-sm">
                    <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{qi + 1}</span>
                    {ex.question}
                  </p>
                  <div className="space-y-1.5 pl-8">
                    {ex.options.map((opt, oi) => {
                      let cls = 'border bg-background hover:bg-muted/50';
                      if (exerciseSubmitted) {
                        if (oi === ex.correct) cls = 'border-emerald-500 bg-emerald-500/15';
                        else if (exerciseAnswers[qi] === oi && oi !== ex.correct) cls = 'border-red-500 bg-red-500/15';
                      } else if (exerciseAnswers[qi] === oi) {
                        cls = 'border-primary bg-primary/5 shadow-sm';
                      }
                      return (
                        <button
                          key={oi}
                          className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left text-sm transition-all ${cls}`}
                          onClick={() => { if (!exerciseSubmitted) setExerciseAnswers(prev => ({ ...prev, [qi]: oi })); }}
                        >
                          {exerciseSubmitted && oi === ex.correct && <CheckCircle className="h-4 w-4 shrink-0 text-emerald-500" />}
                          {exerciseSubmitted && exerciseAnswers[qi] === oi && oi !== ex.correct && <XCircle className="h-4 w-4 shrink-0 text-red-500" />}
                          {!exerciseSubmitted && (
                            <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs ${exerciseAnswers[qi] === oi ? 'border-primary bg-primary text-white' : ''}`}>
                              {String.fromCharCode(65 + oi)}
                            </span>
                          )}
                          <span>{opt}</span>
                        </button>
                      );
                    })}
                  </div>
                  {exerciseSubmitted && <p className="pl-8 text-xs text-muted-foreground italic">💡 {ex.explanation}</p>}
                </div>
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
                    {exerciseScore >= selectedLesson.exercises.length * 0.7 ? 'Tuyệt vời! 🎉' : 'Hãy luyện thêm nhé! 📚'}
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
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10">
          <Languages className="h-5 w-5 text-blue-500" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Ngữ pháp tiếng Trung</h1>
          <p className="text-sm text-muted-foreground">中文语法 — Bài học ngữ pháp HSK1–HSK6</p>
        </div>
      </div>

      {/* Level filters */}
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

      {/* Category filters */}
      <div className="flex flex-wrap gap-2">
        <Button variant={selectedCategory === 'all' ? 'secondary' : 'ghost'} size="sm" onClick={() => setSelectedCategory('all')}>
          Tất cả
        </Button>
        {zhGrammarCategories.map((cat) => (
          <Button key={cat.id} variant={selectedCategory === cat.id ? 'secondary' : 'ghost'} size="sm" onClick={() => setSelectedCategory(cat.id)}>
            {cat.icon} {cat.label}
          </Button>
        ))}
      </div>

      {/* Lessons grid */}
      {lessonsLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
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
                    {zhGrammarCategories.find(c => c.id === lesson.category)?.icon} {zhGrammarCategories.find(c => c.id === lesson.category)?.label}
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
