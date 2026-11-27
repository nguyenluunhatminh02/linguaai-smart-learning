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
import { useLanguageStore } from '@/stores/language-store';
import { getAccessToken } from '@/stores/auth-store';
import { useTokenStore } from '@/stores/token-store';
import { toast } from 'sonner';
import { FlagIcon } from '@/components/ui/flag-icon';

export interface TranslationSentence {
  id: number;
  vi: string;
  en: string;
  alts?: string[];
  hint?: string;
}

export interface TranslationLesson {
  id: string;
  title: string;
  titleVi: string;
  level: string;
  category: string;
  categoryVi: string;
  sentences: TranslationSentence[];
}

const translationCategoryIds = ['daily', 'travel', 'work', 'social', 'opinion', 'academic'] as const;

function cmsToTranslationLesson(lesson: Record<string, unknown>): TranslationLesson {
  const c = (lesson.content ?? {}) as Record<string, unknown>;
  const raw = (c.sentences as Record<string, unknown>[]) ?? [];
  // Drop malformed rows so ExerciseView never dereferences an undefined
  // sentence (or strings with undefined expected/source text).
  const sentences = raw
    .filter(s => typeof s === 'object' && s !== null &&
      typeof s.vi === 'string' && typeof (s.en ?? s.target) === 'string')
    .map(s => ({
      id: s.id as number,
      vi: s.vi as string,
      en: (s.en ?? s.target) as string,
      alts: s.alts as string[] | undefined,
      hint: s.hint as string | undefined,
    }));
  return {
    id: (lesson.slug as string) || (lesson.id as string),
    title: lesson.title as string,
    titleVi: (lesson.titleVi ?? lesson.title_vi) as string,
    level: lesson.level as string,
    category: lesson.category as string,
    categoryVi: (lesson.categoryVi ?? lesson.category_vi ?? lesson.category) as string,
    sentences,
  };
}

const levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;

function speakSentence(text: string, lang: string = 'en-US') {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = lang;
  utter.rate = 0.85;
  window.speechSynthesis.speak(utter);
}

/** Normalize text for comparison: lowercase, trim, collapse whitespace, remove trailing punctuation */
function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ').replace(/[.!?,;:]+$/, '');
}

function checkAnswer(userAnswer: string, expected: string, alts?: string[]): boolean {
  const norm = normalize(userAnswer);
  if (norm === normalize(expected)) return true;
  if (alts?.some((a) => norm === normalize(a))) return true;
  return false;
}

/** Simple word-diff for highlighting */
function diffWords(user: string, expected: string): { word: string; ok: boolean }[] {
  const uWords = user.split(/\s+/);
  const eWords = expected.split(/\s+/);
  return eWords.map((w, i) => ({
    word: w,
    ok: i < uWords.length && normalize(uWords[i]) === normalize(w),
  }));
}

// ─── Lesson List View ───
function LessonGrid({
  lessons,
  onSelect,
  sentencesSuffix,
}: {
  lessons: TranslationLesson[];
  onSelect: (l: TranslationLesson) => void;
  sentencesSuffix: string;
}) {
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
              <Badge variant="outline" className="text-xs">
                {lesson.level}
              </Badge>
              <span className="text-xs text-muted-foreground">{lesson.sentences.length} {sentencesSuffix}</span>
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
  sentence: TranslationSentence;
  userAnswer: string;
  correct: boolean;
}

function ExerciseView({
  lesson,
  onBack,
  t,
}: {
  lesson: TranslationLesson;
  onBack: () => void;
  t: ReturnType<typeof useLanguageStore.getState>['t'];
}) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [userInput, setUserInput] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [results, setResults] = useState<GradedSentence[]>([]);
  const [showSummary, setShowSummary] = useState(false);

  // A lesson with no sentences cannot be exercised; bail out before any
  // dereference of `sentence` so an empty CMS/AI lesson never crashes render.
  if (!lesson.sentences.length) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1">
          <ChevronLeft className="h-4 w-4" /> {t.translationPage.back}
        </Button>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <BookOpen className="h-10 w-10 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">{t.translationPage.noLessons}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const sentence = lesson.sentences[currentIdx];
  const isCorrect = submitted ? checkAnswer(userInput, sentence.en, sentence.alts) : null;

  const handleSubmit = () => {
    if (!userInput.trim() || submitted) return;
    setSubmitted(true);
    setResults((prev) => [
      ...prev,
      {
        sentence,
        userAnswer: userInput.trim(),
        correct: checkAnswer(userInput.trim(), sentence.en, sentence.alts),
      },
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

  // ─── Summary screen ───
  if (showSummary) {
    const correctCount = results.filter((r) => r.correct).length;
    const pct = Math.round((correctCount / results.length) * 100);
    return (
      <div className="space-y-6 animate-fade-in">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1">
          <ChevronLeft className="h-4 w-4" /> {t.translationPage.back}
        </Button>

        {/* Score card */}
        <Card className="overflow-hidden">
          <div className="gradient-bg p-6 text-center text-white">
            <Trophy className="mx-auto mb-2 h-10 w-10" />
            <h2 className="text-3xl font-bold">{pct}%</h2>
            <p className="text-white/80 text-sm mt-1">
              {correctCount}/{results.length} {t.translationPage.summaryCorrect}
            </p>
            <p className="text-white/70 text-xs mt-2">
              {pct === 100 ? t.translationPage.summaryPerfect : pct >= 60 ? t.translationPage.summaryGood : t.translationPage.summaryKeepPracticing}
            </p>
          </div>
        </Card>

        {/* Detailed results */}
        <div className="space-y-3">
          <h3 className="font-semibold text-sm">{t.translationPage.detailResults}</h3>
          {results.map((r, i) => (
            <Card key={i} className={`border-l-4 ${r.correct ? 'border-l-emerald-500' : 'border-l-red-400'}`}>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium flex items-center gap-1.5">
                    <FlagIcon country="vi" className="h-3.5 w-5 shrink-0" />
                    {r.sentence.vi}
                  </p>
                  {r.correct ? (
                    <Check className="h-4 w-4 shrink-0 text-emerald-500" />
                  ) : (
                    <X className="h-4 w-4 shrink-0 text-red-400" />
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t.translationPage.youWrote} <span className={r.correct ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}>{r.userAnswer}</span>
                </p>
                {!r.correct && (
                  <div className="flex items-center gap-2">
                    <p className="text-xs">
                      {t.translationPage.answer} <span className="font-semibold text-emerald-600 dark:text-emerald-400">{r.sentence.en}</span>
                    </p>
                    <button
                      className="text-muted-foreground hover:text-primary"
                      onClick={() => speakSentence(r.sentence.en)}
                    >
                      <Volume2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="flex gap-3">
          <Button onClick={handleRestart} className="gap-1.5">
            <RotateCcw className="h-4 w-4" /> {t.translationPage.restart}
          </Button>
          <Button variant="outline" onClick={onBack}>
            {t.translationPage.pickAnother}
          </Button>
        </div>
      </div>
    );
  }

  // ─── Exercise screen ───
  const diff = submitted ? diffWords(userInput, sentence.en) : null;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1">
          <ChevronLeft className="h-4 w-4" /> {t.translationPage.back}
        </Button>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>{currentIdx + 1}/{lesson.sentences.length}</span>
          <Badge variant="outline" className="text-[10px]">{lesson.level}</Badge>
        </div>
      </div>

      {/* Progress bar */}
      <Progress value={((currentIdx + (submitted ? 1 : 0)) / lesson.sentences.length) * 100} variant="gradient" />

      {/* Question card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-primary" />
            {t.translationPage.promptDirection}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5 pb-6">
          {/* Vietnamese sentence */}
          <div className="rounded-xl bg-primary/5 border border-primary/20 p-4">
            <div className="flex items-center gap-2 mb-1">
              <FlagIcon country="vi" className="h-4 w-5.5 shrink-0" />
              <span className="text-xs font-medium text-primary">{t.translationPage.sourceLabel}</span>
            </div>
            <p className="text-lg font-semibold text-foreground">{sentence.vi}</p>
          </div>

          {/* User input */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <FlagIcon country="en" className="h-4 w-5.5 shrink-0" />
              <span className="text-xs font-medium text-muted-foreground">{t.translationPage.yourTranslation}</span>
            </div>
            <textarea
              className="w-full rounded-xl border bg-background px-4 py-3 text-sm transition-colors hover:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none disabled:opacity-60"
              rows={2}
              placeholder={t.translationPage.inputPlaceholder}
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

          {/* Feedback after submit */}
          {submitted && (
            <div className={`rounded-xl p-4 border ${isCorrect ? 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800' : 'bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800'}`}>
              <div className="flex items-center gap-2 mb-2">
                {isCorrect ? (
                  <>
                    <Check className="h-5 w-5 text-emerald-500" />
                    <span className="font-semibold text-sm text-emerald-700 dark:text-emerald-400">{t.translationPage.correctTitle}</span>
                  </>
                ) : (
                  <>
                    <X className="h-5 w-5 text-red-500" />
                    <span className="font-semibold text-sm text-red-700 dark:text-red-400">{t.translationPage.incorrectTitle}</span>
                  </>
                )}
              </div>

              {/* Show expected answer with word-level diff */}
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">{t.translationPage.sampleAnswer}</p>
                <div className="flex flex-wrap items-center gap-1">
                  {diff?.map((d, i) => (
                    <span
                      key={i}
                      className={`text-sm px-1 rounded ${d.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/40 font-medium'}`}
                    >
                      {d.word}
                    </span>
                  ))}
                  <button
                    className="ml-1 text-muted-foreground hover:text-primary transition-colors"
                    onClick={() => speakSentence(sentence.en)}
                  >
                    <Volume2 className="h-4 w-4" />
                  </button>
                </div>
                {sentence.alts && sentence.alts.length > 0 && !isCorrect && (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {t.translationPage.altAnswers} {sentence.alts.slice(0, 2).join(' / ')}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            {!submitted ? (
              <Button
                onClick={handleSubmit}
                disabled={!userInput.trim()}
                className="gap-1.5"
              >
                <Check className="h-4 w-4" /> {t.translationPage.check}
              </Button>
            ) : (
              <Button onClick={handleNext} className="gap-1.5">
                {currentIdx < lesson.sentences.length - 1 ? (
                  <>{t.translationPage.next} <ChevronRight className="h-4 w-4" /></>
                ) : (
                  <>{t.translationPage.seeResult} <Sparkles className="h-4 w-4" /></>
                )}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Main page ───
export default function TranslationPage() {
  const { t } = useLanguageStore();
  const [lessons, setLessons] = useState<TranslationLesson[]>([]);
  const [lessonsLoading, setLessonsLoading] = useState(true);
  const [activeLevel, setActiveLevel] = useState<string>('all');
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [selectedLesson, setSelectedLesson] = useState<TranslationLesson | null>(null);
  const [aiTopic, setAiTopic] = useState('');
  const [aiGenerating, setAiGenerating] = useState(false);
  const [showAiInput, setShowAiInput] = useState(false);

  const handleAiGenerate = async () => {
    if (useTokenStore.getState().balance < 3) {
      toast.error(t.common.insufficientTokens || 'Không đủ token! Bạn cần ít nhất 3 token để tạo bài tập dịch thuật.');
      return;
    }
    setAiGenerating(true);
    try {
      const res = await fetch('/api/translation/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getAccessToken()}`,
        },
        body: JSON.stringify({
          topic: aiTopic || undefined,
          level: activeLevel !== 'all' ? activeLevel : 'B1',
          category: activeCategory !== 'all' ? activeCategory : 'daily',
          count: 5,
        }),
      });
      const json = await res.json();
      if (json.data) {
        const d = json.data;
        // A generation that returns no usable sentences must not enter the
        // exercise view, where an empty lesson would crash on render.
        const rawSentences: TranslationSentence[] = Array.isArray(d.sentences) ? d.sentences : [];
        const sentences = rawSentences
          .filter((s) => s && typeof s.vi === 'string' && typeof s.en === 'string')
          .map((s, i) => ({ ...s, id: s.id || i + 1 }));
        if (!sentences.length) {
          toast.error('Không tạo được câu nào. Vui lòng thử lại với chủ đề khác.');
          return;
        }
        setSelectedLesson({
          id: `ai-${Date.now()}`,
          title: d.title || 'AI Generated',
          titleVi: d.titleVi || 'Bài tập AI',
          level: d.level || 'B1',
          category: d.category || 'daily',
          categoryVi: d.categoryVi || 'AI',
          sentences,
        });
        setShowAiInput(false);
        setAiTopic('');
        useTokenStore.getState().loadBalance();
      } else if (json.error) {
        toast.error(json.error);
      }
    } catch (err) {
      console.error('AI generate error:', err);
      toast.error('Có lỗi xảy ra khi tạo bài tập từ AI.');
    } finally {
      setAiGenerating(false);
    }
  };

  useEffect(() => {
    fetch('/api/cms/lessons?type=translation&language=english&published=true&limit=200')
      .then(r => r.json())
      .then(json => {
        const items: Record<string, unknown>[] = json.data ?? json ?? [];
        setLessons(items.map(cmsToTranslationLesson));
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
        <ExerciseView lesson={selectedLesson} onBack={() => setSelectedLesson(null)} t={t} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-500/10">
          <ArrowRightLeft className="h-5 w-5 text-teal-500" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">{t.nav.translation}</h1>
          <p className="text-sm text-muted-foreground">{t.translationPage.desc}</p>
        </div>
      </div>

      {/* Level filters */}
      <div className="flex flex-wrap gap-2">
        <Button
          variant={activeLevel === 'all' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setActiveLevel('all')}
          className="rounded-full"
        >
          {t.translationPage.allLevels}
        </Button>
        {levels.map((lv) => (
          <Button
            key={lv}
            variant={activeLevel === lv ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveLevel(lv)}
            className="rounded-full"
          >
            {lv}
          </Button>
        ))}
      </div>

      {/* Category filters */}
      <div className="flex flex-wrap gap-2">
        <Button
          variant={activeCategory === 'all' ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => setActiveCategory('all')}
        >
          {t.translationPage.allCategories}
        </Button>
        {translationCategoryIds.map((catId) => (
          <Button
            key={catId}
            variant={activeCategory === catId ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setActiveCategory(catId)}
          >
            {t.translationPage.categories[catId]}
          </Button>
        ))}
      </div>

      {/* AI Generate */}
      {!showAiInput ? (
        <Button variant="outline" onClick={() => setShowAiInput(true)} className="w-full border-dashed">
          <Sparkles className="mr-2 h-4 w-4 text-violet-500" /> {t.translationPage.aiGenerate}
        </Button>
      ) : (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-violet-500" />
              <span className="font-semibold text-sm">{t.translationPage.aiTitle}</span>
            </div>
            <input
              type="text"
              placeholder={t.translationPage.aiTopicPlaceholder}
              className="w-full border rounded-lg px-4 py-2 text-sm"
              value={aiTopic}
              onChange={e => setAiTopic(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !aiGenerating && handleAiGenerate()}
            />
            <div className="flex gap-2">
              <Button onClick={handleAiGenerate} disabled={aiGenerating} className="flex-1">
                {aiGenerating ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t.translationPage.aiGenerating}</> : <><Sparkles className="mr-2 h-4 w-4" /> {t.translationPage.aiCreate}</>}
              </Button>
              <Button variant="ghost" onClick={() => setShowAiInput(false)}>{t.translationPage.aiCancel}</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Lessons grid */}
      {lessonsLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : filteredLessons.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <BookOpen className="h-10 w-10 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">{t.translationPage.noLessons}</p>
          </CardContent>
        </Card>
      ) : (
        <LessonGrid lessons={filteredLessons} onSelect={setSelectedLesson} sentencesSuffix={t.translationPage.sentencesSuffix} />
      )}
    </div>
  );
}
