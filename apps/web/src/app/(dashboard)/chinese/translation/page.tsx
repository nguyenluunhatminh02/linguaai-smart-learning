'use client';

import { useState, useMemo, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  ArrowRightLeft, ChevronRight, ChevronLeft, Check, X, RotateCcw,
  Trophy, Sparkles, BookOpen, Volume2, Loader2,
} from 'lucide-react';
import { FlagIcon } from '@/components/ui/flag-icon';

const levels = ['HSK1', 'HSK2', 'HSK3', 'HSK4', 'HSK5', 'HSK6'] as const;

interface ZhTranslationSentence {
  id: number;
  vi: string;
  zh: string;
  alts?: string[];
  hint?: string;
}

interface ZhTranslationLesson {
  id: string;
  title: string;
  titleVi: string;
  level: string;
  category: string;
  categoryVi: string;
  sentences: ZhTranslationSentence[];
}

const zhTranslationCategories = [
  { id: 'daily', label: 'Cuộc sống', labelVi: 'Cuộc sống hàng ngày' },
  { id: 'travel', label: 'Du lịch', labelVi: 'Du lịch' },
  { id: 'work', label: 'Công việc', labelVi: 'Công việc & Học tập' },
  { id: 'social', label: 'Giao tiếp', labelVi: 'Giao tiếp xã hội' },
  { id: 'academic', label: 'Học thuật', labelVi: 'Học thuật' },
];

function cmsToZhTranslationLesson(lesson: Record<string, unknown>): ZhTranslationLesson {
  const c = (lesson.content ?? {}) as Record<string, unknown>;
  const raw = (c.sentences as Record<string, unknown>[]) ?? [];
  return {
    id: (lesson.slug as string) || (lesson.id as string),
    title: lesson.title as string,
    titleVi: ((lesson.titleVi ?? lesson.title_vi) as string) ?? '',
    level: lesson.level as string,
    category: (lesson.category as string) ?? '',
    categoryVi: (lesson.category_vi ?? lesson.categoryVi) as string ?? '',
    sentences: raw.map(s => ({
      id: s.id as number,
      vi: s.vi as string,
      zh: (s.zh ?? s.target) as string,
      alts: s.alts as string[] | undefined,
      hint: s.hint as string | undefined,
    })),
  };
}

function speakSentence(text: string, lang: string = 'zh-CN') {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = lang;
  utter.rate = 0.85;
  window.speechSynthesis.speak(utter);
}

function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ').replace(/[.!?,;:。！？，；：]+$/, '');
}

function checkAnswer(userAnswer: string, expected: string, alts?: string[]): boolean {
  const norm = normalize(userAnswer);
  if (norm === normalize(expected)) return true;
  if (alts?.some((a) => norm === normalize(a))) return true;
  return false;
}

// ─── Lesson Grid ───
function LessonGrid({ lessons, onSelect }: { lessons: ZhTranslationLesson[]; onSelect: (l: ZhTranslationLesson) => void }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {lessons.map((lesson, i) => (
        <Card
          key={lesson.id}
          className="card-hover cursor-pointer animate-fade-in-up"
          style={{ animationDelay: `${i * 60}ms` }}
          onClick={() => onSelect(lesson)}
        >
          <CardContent className="flex flex-col gap-3 p-5">
            <div className="flex items-start justify-between gap-2">
              <Badge variant="outline" className="text-xs">{lesson.level}</Badge>
              <span className="text-xs text-muted-foreground">{lesson.sentences.length} câu</span>
            </div>
            <div>
              <p className="font-semibold text-sm">{lesson.titleVi}</p>
              <p className="text-xs text-muted-foreground">{lesson.title}</p>
            </div>
            <div className="flex items-center justify-between pt-1">
              <Badge variant="secondary" className="text-[10px]">{lesson.categoryVi}</Badge>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Exercise View ───
interface GradedSentence {
  sentence: ZhTranslationSentence;
  userAnswer: string;
  correct: boolean;
}

function ExerciseView({ lesson, onBack }: { lesson: ZhTranslationLesson; onBack: () => void }) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [userInput, setUserInput] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [results, setResults] = useState<GradedSentence[]>([]);
  const [showSummary, setShowSummary] = useState(false);

  const sentence = lesson.sentences[currentIdx];
  const isCorrect = submitted ? checkAnswer(userInput, sentence.zh, sentence.alts) : null;

  const handleSubmit = () => {
    if (!userInput.trim() || submitted) return;
    setSubmitted(true);
    setResults((prev) => [
      ...prev,
      { sentence, userAnswer: userInput.trim(), correct: checkAnswer(userInput.trim(), sentence.zh, sentence.alts) },
    ]);
  };

  const handleNext = () => {
    if (currentIdx < lesson.sentences.length - 1) {
      setCurrentIdx((i) => i + 1);
      setUserInput('');
      setSubmitted(false);
    } else {
      setShowSummary(true);
    }
  };

  const handleRestart = () => {
    setCurrentIdx(0);
    setUserInput('');
    setSubmitted(false);
    setResults([]);
    setShowSummary(false);
  };

  // Summary
  if (showSummary) {
    const correctCount = results.filter((r) => r.correct).length;
    const pct = Math.round((correctCount / results.length) * 100);
    return (
      <div className="space-y-6 animate-fade-in">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1">
          <ChevronLeft className="h-4 w-4" /> Quay lại
        </Button>
        <Card className="overflow-hidden">
          <div className="gradient-bg p-6 text-center text-white">
            <Trophy className="mx-auto mb-2 h-10 w-10" />
            <h2 className="text-3xl font-bold">{pct}%</h2>
            <p className="text-white/80 text-sm mt-1">{correctCount}/{results.length} câu đúng</p>
            <p className="text-white/70 text-xs mt-2">
              {pct === 100 ? 'Xuất sắc! 🎉' : pct >= 60 ? 'Khá tốt! Tiếp tục cố gắng 💪' : 'Hãy luyện tập thêm nhé! 📚'}
            </p>
          </div>
        </Card>
        <div className="space-y-3">
          <h3 className="font-semibold text-sm">Chi tiết kết quả</h3>
          {results.map((r, i) => (
            <Card key={i} className={`border-l-4 ${r.correct ? 'border-l-emerald-500' : 'border-l-red-400'}`}>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium flex items-center gap-1.5">
                    <FlagIcon country="vi" className="h-3.5 w-5 shrink-0" />
                    {r.sentence.vi}
                  </p>
                  {r.correct ? <Check className="h-4 w-4 shrink-0 text-emerald-500" /> : <X className="h-4 w-4 shrink-0 text-red-400" />}
                </div>
                <p className="text-xs text-muted-foreground">
                  Bạn viết: <span className={r.correct ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}>{r.userAnswer}</span>
                </p>
                {!r.correct && (
                  <div className="flex items-center gap-2">
                    <p className="text-xs">Đáp án: <span className="font-semibold text-emerald-600 dark:text-emerald-400">{r.sentence.zh}</span></p>
                    <button className="text-muted-foreground hover:text-primary" onClick={() => speakSentence(r.sentence.zh)}>
                      <Volume2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="flex gap-3">
          <Button onClick={handleRestart} className="gap-1.5"><RotateCcw className="h-4 w-4" /> Làm lại</Button>
          <Button variant="outline" onClick={onBack}>Chọn bài khác</Button>
        </div>
      </div>
    );
  }

  // Exercise screen
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1">
          <ChevronLeft className="h-4 w-4" /> Quay lại
        </Button>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>{currentIdx + 1}/{lesson.sentences.length}</span>
          <Badge variant="outline" className="text-[10px]">{lesson.level}</Badge>
        </div>
      </div>

      <Progress value={((currentIdx + (submitted ? 1 : 0)) / lesson.sentences.length) * 100} variant="gradient" />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-primary" />
            Dịch câu sau sang tiếng Trung
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5 pb-6">
          {/* Vietnamese sentence */}
          <div className="rounded-xl bg-primary/5 border border-primary/20 p-4">
            <div className="flex items-center gap-2 mb-1">
              <FlagIcon country="vi" className="h-4 w-5.5 shrink-0" />
              <span className="text-xs font-medium text-primary">Tiếng Việt</span>
            </div>
            <p className="text-lg font-semibold text-foreground">{sentence.vi}</p>
            {sentence.hint && (
              <p className="text-xs text-muted-foreground mt-1">💡 Gợi ý: {sentence.hint}</p>
            )}
          </div>

          {/* User input */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <FlagIcon country="zh" className="h-4 w-5.5 shrink-0" />
              <span className="text-xs font-medium text-muted-foreground">Bản dịch tiếng Trung của bạn</span>
            </div>
            <textarea
              className="w-full rounded-xl border bg-background px-4 py-3 text-sm transition-colors hover:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none disabled:opacity-60"
              rows={2}
              placeholder="输入中文翻译..."
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              disabled={submitted}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (!submitted) handleSubmit();
                  else handleNext();
                }
              }}
            />
          </div>

          {/* Feedback */}
          {submitted && (
            <div className={`rounded-xl p-4 border ${isCorrect ? 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800' : 'bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800'}`}>
              <div className="flex items-center gap-2 mb-2">
                {isCorrect ? (
                  <>
                    <Check className="h-5 w-5 text-emerald-500" />
                    <span className="font-semibold text-sm text-emerald-700 dark:text-emerald-400">Chính xác! 🎉</span>
                  </>
                ) : (
                  <>
                    <X className="h-5 w-5 text-red-500" />
                    <span className="font-semibold text-sm text-red-700 dark:text-red-400">Chưa đúng</span>
                  </>
                )}
              </div>
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">Đáp án mẫu:</p>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-emerald-700 dark:text-emerald-400">{sentence.zh}</span>
                  <button className="text-muted-foreground hover:text-primary transition-colors" onClick={() => speakSentence(sentence.zh)} title="Nghe phát âm">
                    <Volume2 className="h-4 w-4" />
                  </button>
                </div>
                {sentence.alts && sentence.alts.length > 0 && !isCorrect && (
                  <p className="text-[11px] text-muted-foreground mt-1">Cách khác: {sentence.alts.slice(0, 2).join(' / ')}</p>
                )}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            {!submitted ? (
              <Button onClick={handleSubmit} disabled={!userInput.trim()} className="gap-1.5">
                <Check className="h-4 w-4" /> Kiểm tra
              </Button>
            ) : (
              <Button onClick={handleNext} className="gap-1.5">
                {currentIdx < lesson.sentences.length - 1 ? (
                  <>Câu tiếp theo <ChevronRight className="h-4 w-4" /></>
                ) : (
                  <>Xem kết quả <Sparkles className="h-4 w-4" /></>
                )}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Main Page ───
export default function ChineseTranslationPage() {
  const [activeLevel, setActiveLevel] = useState<string>('all');
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [selectedLesson, setSelectedLesson] = useState<ZhTranslationLesson | null>(null);
  const [lessons, setLessons] = useState<ZhTranslationLesson[]>([]);
  const [lessonsLoading, setLessonsLoading] = useState(true);

  useEffect(() => {
    fetch('/api/cms/lessons?type=translation&language=chinese&published=true&limit=200')
      .then(r => r.json())
      .then(json => {
        const items: Record<string, unknown>[] = json.data ?? json ?? [];
        setLessons(items.map(cmsToZhTranslationLesson));
      })
      .catch(() => {})
      .finally(() => setLessonsLoading(false));
  }, []);

  const filteredLessons = useMemo(() => {
    return lessons.filter((l) => {
      if (activeLevel !== 'all' && l.level !== activeLevel) return false;
      if (activeCategory !== 'all' && l.category !== activeCategory) return false;
      return true;
    });
  }, [lessons, activeLevel, activeCategory]);

  if (selectedLesson) {
    return (
      <div className="mx-auto max-w-2xl">
        <ExerciseView lesson={selectedLesson} onBack={() => setSelectedLesson(null)} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-500/10">
          <ArrowRightLeft className="h-5 w-5 text-teal-500" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Dịch Việt → Trung</h1>
          <p className="text-sm text-muted-foreground">越译中 — Luyện dịch câu tiếng Việt sang tiếng Trung</p>
        </div>
      </div>

      {/* Level filters */}
      <div className="flex flex-wrap gap-2">
        <Button variant={activeLevel === 'all' ? 'default' : 'outline'} size="sm" onClick={() => setActiveLevel('all')} className="rounded-full">Tất cả</Button>
        {levels.map((lv) => (
          <Button key={lv} variant={activeLevel === lv ? 'default' : 'outline'} size="sm" onClick={() => setActiveLevel(lv)} className="rounded-full">{lv}</Button>
        ))}
      </div>

      {/* Category filters */}
      <div className="flex flex-wrap gap-2">
        <Button variant={activeCategory === 'all' ? 'secondary' : 'ghost'} size="sm" onClick={() => setActiveCategory('all')}>Tất cả chủ đề</Button>
        {zhTranslationCategories.map((cat) => (
          <Button key={cat.id} variant={activeCategory === cat.id ? 'secondary' : 'ghost'} size="sm" onClick={() => setActiveCategory(cat.id)}>{cat.labelVi}</Button>
        ))}
      </div>

      {lessonsLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filteredLessons.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <BookOpen className="h-10 w-10 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">Không có bài tập cho bộ lọc này</p>
          </CardContent>
        </Card>
      ) : (
        <LessonGrid lessons={filteredLessons} onSelect={setSelectedLesson} />
      )}
    </div>
  );
}
