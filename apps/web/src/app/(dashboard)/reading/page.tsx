'use client';

import { useState, useCallback, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { apiClient } from '@/lib/api-client';
import { BookOpen, Loader2, CheckCircle, XCircle, Sparkles, Search, ArrowLeft, Library, BookMarked, GraduationCap, Clock, History } from 'lucide-react';
import { useLanguageStore } from '@/stores/language-store';
import dynamic from 'next/dynamic';
import { getAccessToken } from '@/stores/auth-store';
import { normalizeLessonQuestions, type LessonQuestion } from '@/lib/lesson-questions';
import { useSkillCompletion, type SkillCompletion } from '@/hooks/use-skill-completion';
import { SkillSaveStatus } from '@/components/learning/skill-save-status';
import { useActivityDuration } from '@/hooks/use-activity-duration';
import { toast } from 'sonner';

const WordHover = dynamic(() => import('@/components/reading/word-hover').then(m => m.WordHover), {
  ssr: false,
  loading: () => <span className="animate-pulse">Loading text...</span>
});

const VocabCard = dynamic(() => import('@/components/reading/vocab-card').then(m => m.VocabCard), {
  ssr: false,
  loading: () => <div className="h-24 rounded-xl bg-muted/40 animate-pulse" />
});

export interface ReadingLesson {
  id: string;
  activityId: string;
  title: string;
  titleVi: string;
  level: string;
  category: string;
  wordCount: number;
  content: string;
  vocabulary: { word: string; definition: string; definitionVi: string; partOfSpeech: string; example: string }[];
  questions: LessonQuestion[];
  invalidQuestionCount: number;
}

const readingCategories = [
  { id: 'daily-life', label: 'Daily Life', labelVi: 'Cuộc sống hàng ngày' },
  { id: 'culture', label: 'Culture & Travel', labelVi: 'Văn hóa & Du lịch' },
  { id: 'science', label: 'Science & Nature', labelVi: 'Khoa học & Thiên nhiên' },
  { id: 'society', label: 'Society & People', labelVi: 'Xã hội & Con người' },
  { id: 'technology', label: 'Technology', labelVi: 'Công nghệ' },
];

function cmsToReadingLesson(lesson: Record<string, unknown>): ReadingLesson {
  const c = (lesson.content ?? {}) as Record<string, unknown>;
  return {
    id: (lesson.slug as string) || (lesson.id as string),
    activityId: (lesson.id as string) || (lesson.slug as string),
    title: lesson.title as string,
    titleVi: (lesson.titleVi ?? lesson.title_vi) as string,
    level: lesson.level as string,
    category: lesson.category as string,
    wordCount: (c.wordCount as number) ?? 0,
    content: (c.text as string) ?? (c.content as string) ?? '',
    vocabulary: (c.vocabulary as ReadingLesson['vocabulary']) ?? [],
    ...normalizeLessonQuestions(c.questions),
  };
}

type Tab = 'library' | 'ai' | 'nlp';

function QuestionNotice() {
  return <p role="status" className="rounded-lg border border-border p-3 text-sm">Một số câu hỏi thiếu đáp án hợp lệ nên đã được bỏ qua.</p>;
}

interface NlpResult {
  wordCount: number;
  sentenceCount: number;
  avgSentenceLength: number;
  estimatedLevel: string;
  readabilityScore: number;
  vocabularyComplexity: string;
  topKeywords: string[];
  complexWords: string[];
  grammarPatternsFound: string[];
  textType: string;
  learningValue: string;
  suggestedExercises: string[];
  notes?: string;
}

interface ReadingResult {
  id: string;
  language: string;
  title?: string;
  passage: string;
  questions: LessonQuestion[];
  invalidQuestionCount: number;
  vocabulary?: { word: string; meaning: string }[];
}

// AI-generated passage stored in DB
interface SavedPassage {
  id: string;
  passageText: string;
  vocabulary: { word: string; meaning?: string; definition?: string; partOfSpeech?: string; part_of_speech?: string; example?: string }[];
  questions: unknown[];
  level: string;
  topic: string;
  language: string;
  createdAt: string;
}

export default function ReadingPage() {
  const { t } = useLanguageStore();
  const [tab, setTab] = useState<Tab>('library');
  const [lessons, setLessons] = useState<ReadingLesson[]>([]);
  const [lessonsLoading, setLessonsLoading] = useState(true);
  const [selectedLevel, setSelectedLevel] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedLesson, setSelectedLesson] = useState<ReadingLesson | null>(null);
  const [lessonAnswers, setLessonAnswers] = useState<Record<number, number>>({});
  const [lessonSubmitted, setLessonSubmitted] = useState(false);
  const progress = useSkillCompletion();

  useEffect(() => {
    const token = getAccessToken();
    fetch('/api/cms/lessons?type=reading&language=english&published=true&limit=200', {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
      .then(r => r.json())
      .then(json => {
        const items: Record<string, unknown>[] = json.data ?? json ?? [];
        setLessons(items.map(cmsToReadingLesson));
      })
      .catch(() => {})
      .finally(() => setLessonsLoading(false));
  }, []);

  // AI tab state
  const [topic, setTopic] = useState('');
  const [targetLanguage, setTargetLanguage] = useState('english');
  const [level, setLevel] = useState('B1');
  const [loading, setLoading] = useState(false);
  const [generationError, setGenerationError] = useState(false);
  const [result, setResult] = useState<ReadingResult | null>(null);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [submitted, setSubmitted] = useState(false);

  // Saved passages state
  const [savedPassages, setSavedPassages] = useState<SavedPassage[]>([]);
  const [savedLoading, setSavedLoading] = useState(false);
  const [selectedSaved, setSelectedSaved] = useState<SavedPassage | null>(null);
  const [savedAnswers, setSavedAnswers] = useState<Record<number, number>>({});
  const [savedSubmitted, setSavedSubmitted] = useState(false);
  const currentActivity = selectedSaved
    ? { activityId: selectedSaved.id, language: selectedSaved.language }
    : selectedLesson
      ? { activityId: selectedLesson.activityId, language: 'english' }
      : tab === 'ai' && result
        ? { activityId: result.id, language: result.language }
        : undefined;
  const getDurationSeconds = useActivityDuration(currentActivity?.activityId);
  const activity: SkillCompletion | undefined = currentActivity && { activityType: 'reading', ...currentActivity };

  function markComplete() {
    if (activity) progress.mutate({ ...activity, durationSeconds: getDurationSeconds() });
  }

  // NLP tab state
  const [nlpText, setNlpText] = useState('');
  const [nlpLanguage, setNlpLanguage] = useState('english');
  const [nlpLoading, setNlpLoading] = useState(false);
  const [nlpResult, setNlpResult] = useState<NlpResult | null>(null);
  const [nlpError, setNlpError] = useState<string | null>(null);

  const handleNlpAnalyze = async () => {
    if (!nlpText.trim()) return;
    setNlpLoading(true);
    setNlpResult(null);
    setNlpError(null);
    try {
      const res = await apiClient.post('/reading/analyze-text', { text: nlpText, language: nlpLanguage });
      setNlpResult(res.data);
    } catch {
      const message = 'Failed to analyze text. Please try again.';
      setNlpError(message);
      toast.error(message);
    }
    finally { setNlpLoading(false); }
  };

  const loadHistory = useCallback(async () => {
    setSavedLoading(true);
    try {
      const res = await apiClient.get('/reading/history?limit=20');
      setSavedPassages(res.data.items || []);
    } catch { /* ignore – user may not be authenticated yet */ }
    finally { setSavedLoading(false); }
  }, []);

  // Load history on first AI tab visit
  const handleTabSwitch = useCallback((newTab: Tab) => {
    setTab(newTab);
    if (newTab === 'ai' && savedPassages.length === 0) loadHistory();
  }, [savedPassages.length, loadHistory]);

  const handleGenerate = async () => {
    if (!topic.trim()) return;
    setLoading(true);
    setGenerationError(false);
    setResult(null);
    setAnswers({});
    setSubmitted(false);
    try {
      const res = await apiClient.post('/reading/generate', { topic, level, language: targetLanguage });
      const raw = res.data as { id: string; passage: string; vocabulary?: { word: string; meaning: string }[]; questions: unknown };
      const normalizedResult: ReadingResult = {
        ...raw,
        language: targetLanguage,
        ...normalizeLessonQuestions(raw.questions),
      };
      setResult(normalizedResult);
      // Reload history so the newly saved passage appears
      loadHistory();
    } catch { setGenerationError(true); }
    finally { setLoading(false); }
  };

  const handleAnswer = (qIndex: number, optIndex: number) => { if (!submitted) setAnswers({ ...answers, [qIndex]: optIndex }); };
  const handleSubmit = () => {
    setSubmitted(true);
    markComplete();
  };
  const getScore = () => { if (!result) return 0; return result.questions.filter((q, i) => answers[i] === q.correctAnswer).length; };

  const filteredLessons = lessons.filter(l => {
    if (selectedLevel !== 'all' && l.level !== selectedLevel) return false;
    if (selectedCategory !== 'all' && l.category !== selectedCategory) return false;
    return true;
  });

  const openLesson = (lesson: ReadingLesson) => {
    setSelectedLesson(lesson);
    setLessonAnswers({});
    setLessonSubmitted(false);
  };

  const lessonScore = selectedLesson
    ? selectedLesson.questions.filter((q, i) => lessonAnswers[i] === q.correctAnswer).length
    : 0;

  const openSaved = (p: SavedPassage) => {
    setSelectedSaved(p);
    setSavedAnswers({});
    setSavedSubmitted(false);
  };

  // ======= SAVED PASSAGE DETAIL VIEW =======
  if (selectedSaved) {
    const { questions: normQs, invalidQuestionCount } = normalizeLessonQuestions(selectedSaved.questions);
    const savedScore = normQs.filter((q, i) => savedAnswers[i] === q.correctAnswer).length;

    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={() => setSelectedSaved(null)}>
          <ArrowLeft className="mr-2 h-4 w-4" /> {t.reading.backToList}
        </Button>

        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-violet-500/10">
            <Sparkles className="h-6 w-6 text-violet-500" />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold capitalize">{selectedSaved.topic}</h1>
            <p className="text-sm text-muted-foreground">AI Generated • {new Date(selectedSaved.createdAt).toLocaleDateString('vi-VN')}</p>
            <div className="mt-2 flex gap-2">
              <Badge variant="secondary">{selectedSaved.level}</Badge>
              <Badge variant="outline">{selectedSaved.language}</Badge>
            </div>
          </div>
        </div>

        <Card>
          <CardHeader className="px-6 pt-6 pb-2">
            <CardTitle className="flex items-center gap-2 text-lg">
              <BookMarked className="h-5 w-5 text-violet-500" /> Reading Passage
              <Badge variant="outline" className="text-[10px]">Hover / click từ để xem nghĩa</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-6 pb-6">
            <WordHover text={selectedSaved.passageText} className="whitespace-pre-wrap leading-8" />
          </CardContent>
        </Card>

        {selectedSaved.vocabulary.length > 0 && (
          <Card>
            <CardHeader className="px-6 pt-6 pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                📚 Key Vocabulary <Badge variant="secondary">{selectedSaved.vocabulary.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="px-6 pb-6">
              <div className="grid gap-3 sm:grid-cols-2">
                {selectedSaved.vocabulary.map((v, i) => (
                  <VocabCard
                    key={i}
                    word={v.word}
                    definition={v.definition || v.meaning || ''}
                    definitionVi=""
                    partOfSpeech={v.partOfSpeech || v.part_of_speech || ''}
                    example={v.example}
                    accent="violet"
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {invalidQuestionCount > 0 && <QuestionNotice />}
        {normQs.length > 0 && (
          <Card>
            <CardHeader className="px-6 pt-6 pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <GraduationCap className="h-5 w-5 text-violet-500" /> Comprehension Questions
              </CardTitle>
            </CardHeader>
            <CardContent className="px-6 pb-6 space-y-5">
              {normQs.map((q, qi) => (
                <div key={qi} className="space-y-2">
                  <p className="font-medium text-sm">
                    <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{qi + 1}</span>
                    {q.question}
                  </p>
                  <div className="space-y-1.5 pl-8">
                    {q.options.map((opt, oi) => {
                      let cls = 'border bg-background hover:bg-muted/50';
                      if (savedSubmitted) {
                        if (oi === q.correctAnswer) cls = 'border-emerald-500 bg-emerald-500/15 text-foreground';
                        else if (savedAnswers[qi] === oi) cls = 'border-red-500 bg-red-500/15 text-foreground';
                      } else if (savedAnswers[qi] === oi) {
                        cls = 'border-primary bg-primary/5 shadow-sm';
                      }
                      return (
                        <button key={oi} className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left text-sm transition-all ${cls}`}
                          onClick={() => { if (!savedSubmitted) setSavedAnswers(prev => ({ ...prev, [qi]: oi })); }}>
                          {savedSubmitted && oi === q.correctAnswer && <CheckCircle className="h-4 w-4 shrink-0 text-emerald-500" />}
                          {savedSubmitted && savedAnswers[qi] === oi && oi !== q.correctAnswer && <XCircle className="h-4 w-4 shrink-0 text-red-500" />}
                          {!savedSubmitted && <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs ${savedAnswers[qi] === oi ? 'border-primary bg-primary text-white' : ''}`}>{String.fromCharCode(65 + oi)}</span>}
                          <span>{opt}</span>
                        </button>
                      );
                    })}
                  </div>
                  {savedSubmitted && q.explanation && <p className="pl-8 text-xs text-muted-foreground">{q.explanation}</p>}
                </div>
              ))}
              {!savedSubmitted ? (
                <Button variant="gradient" onClick={() => { setSavedSubmitted(true); markComplete(); }} disabled={Object.keys(savedAnswers).length < normQs.length}>
                  Submit Answers
                </Button>
              ) : (
                <div className={`rounded-xl p-5 text-center ${savedScore >= normQs.length * 0.7 ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-amber-500/10 border border-amber-500/30'}`}>
                  <p className="text-3xl font-bold">{savedScore} / {normQs.length}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{savedScore >= normQs.length * 0.7 ? 'Great job! 🎉' : 'Keep practicing! 📚'}</p>
                  {activity && <SkillSaveStatus progress={progress} activity={activity} />}
                  <Button variant="outline" className="mt-3" onClick={() => { setSavedAnswers({}); setSavedSubmitted(false); }}>Try Again</Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  // ======= LESSON DETAIL VIEW =======
  if (selectedLesson) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={() => setSelectedLesson(null)}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Library
        </Button>

        {/* Lesson Header */}
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/10">
            <BookOpen className="h-6 w-6 text-blue-500" />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">{selectedLesson.title}</h1>
            <p className="text-sm text-muted-foreground">{selectedLesson.titleVi}</p>
            <div className="mt-2 flex gap-2">
              <Badge variant="secondary">{selectedLesson.level}</Badge>
              <Badge variant="outline">{selectedLesson.wordCount} words</Badge>
            </div>
          </div>
        </div>

        {/* Reading Passage with Hover */}
        <Card>
          <CardHeader className="px-6 pt-6 pb-2">
            <CardTitle className="flex items-center gap-2 text-lg">
              <BookMarked className="h-5 w-5 text-blue-500" /> Reading Passage
              <Badge variant="outline" className="text-[10px]">Hover words for translation</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-6 pb-6">
            <WordHover text={selectedLesson.content} className="whitespace-pre-wrap leading-8" />
          </CardContent>
        </Card>

        {/* Key Vocabulary */}
        <Card>
          <CardHeader className="px-6 pt-6 pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">📚 Key Vocabulary <Badge variant="secondary">{selectedLesson.vocabulary.length}</Badge></CardTitle>
          </CardHeader>
          <CardContent className="px-6 pb-6">
            <div className="grid gap-3 sm:grid-cols-2">
              {selectedLesson.vocabulary.map((v, i) => (
                <VocabCard
                  key={i}
                  word={v.word}
                  definition={v.definition}
                  definitionVi={v.definitionVi}
                  partOfSpeech={v.partOfSpeech}
                  example={v.example}
                  accent="blue"
                />
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Comprehension Questions */}
        {selectedLesson.invalidQuestionCount > 0 && <QuestionNotice />}
        {selectedLesson.questions.length > 0 && (
        <Card>
          <CardHeader className="px-6 pt-6 pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <GraduationCap className="h-5 w-5 text-violet-500" /> Comprehension Questions
            </CardTitle>
          </CardHeader>
          <CardContent className="px-6 pb-6 space-y-5">
            {selectedLesson.questions.map((q, qi) => (
              <div key={qi} className="space-y-2">
                <p className="font-medium text-sm">
                  <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{qi + 1}</span>
                  {q.question}
                </p>
                <div className="space-y-1.5 pl-8">
                  {q.options.map((opt, oi) => {
                    let cls = 'border bg-background hover:bg-muted/50';
                    if (lessonSubmitted) {
                      if (oi === q.correctAnswer) cls = 'border-emerald-500 bg-emerald-500/15 text-foreground';
                      else if (lessonAnswers[qi] === oi && oi !== q.correctAnswer) cls = 'border-red-500 bg-red-500/15 text-foreground';
                    } else if (lessonAnswers[qi] === oi) {
                      cls = 'border-primary bg-primary/5 shadow-sm';
                    }
                    return (
                      <button key={oi} className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left text-sm transition-all ${cls}`} onClick={() => { if (!lessonSubmitted) setLessonAnswers(prev => ({ ...prev, [qi]: oi })); }}>
                        {lessonSubmitted && oi === q.correctAnswer && <CheckCircle className="h-4 w-4 shrink-0 text-emerald-500" />}
                        {lessonSubmitted && lessonAnswers[qi] === oi && oi !== q.correctAnswer && <XCircle className="h-4 w-4 shrink-0 text-red-500" />}
                        {!lessonSubmitted && <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs ${lessonAnswers[qi] === oi ? 'border-primary bg-primary text-white' : ''}`}>{String.fromCharCode(65 + oi)}</span>}
                        <span>{opt}</span>
                      </button>
                    );
                  })}
                </div>
                {lessonSubmitted && q.explanation && <p className="pl-8 text-xs text-muted-foreground italic">{q.explanation}</p>}
              </div>
            ))}
            {!lessonSubmitted ? (
              <Button variant="gradient" onClick={() => { setLessonSubmitted(true); markComplete(); }} disabled={Object.keys(lessonAnswers).length < selectedLesson.questions.length}>Submit Answers</Button>
            ) : (
              <div className={`rounded-xl p-5 text-center ${lessonScore >= selectedLesson.questions.length * 0.7 ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-amber-500/10 border border-amber-500/30'}`}>
                <p className="text-3xl font-bold">{lessonScore} / {selectedLesson.questions.length}</p>
                <p className="mt-1 text-sm text-muted-foreground">{lessonScore >= selectedLesson.questions.length * 0.7 ? 'Great job! 🎉' : 'Keep practicing! 📚'}</p>
                {activity && <SkillSaveStatus progress={progress} activity={activity} />}
                <Button variant="outline" className="mt-3" onClick={() => { setLessonAnswers({}); setLessonSubmitted(false); }}>Try Again</Button>
              </div>
            )}
          </CardContent>
        </Card>
        )}
      </div>
    );
  }

  // ======= MAIN VIEW =======
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10">
          <BookOpen className="h-5 w-5 text-blue-500" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">{t.reading.title}</h1>
          <p className="text-sm text-muted-foreground">{t.reading.desc}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b pb-1">
        <button className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${tab === 'library' ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground hover:text-foreground'}`} onClick={() => handleTabSwitch('library')}>
          <Library className="mr-2 h-4 w-4 inline" /> Library ({lessons.length})
        </button>
        <button className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${tab === 'ai' ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground hover:text-foreground'}`} onClick={() => handleTabSwitch('ai')}>
          <Sparkles className="mr-2 h-4 w-4 inline" /> AI Generate
        </button>
        <button className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${tab === 'nlp' ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground hover:text-foreground'}`} onClick={() => handleTabSwitch('nlp')}>
          <GraduationCap className="mr-2 h-4 w-4 inline" /> Analyze Text
        </button>
      </div>

      {/* ======= LIBRARY TAB ======= */}
      {tab === 'library' && (
        <>
          <div className="flex flex-wrap gap-2">
            <Button variant={selectedLevel === 'all' ? 'default' : 'outline'} size="sm" onClick={() => setSelectedLevel('all')}>All Levels</Button>
            {['A1', 'A2', 'B1', 'B2', 'C1'].map(lvl => (
              <Button key={lvl} variant={selectedLevel === lvl ? 'default' : 'outline'} size="sm" onClick={() => setSelectedLevel(lvl)}>{lvl}</Button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant={selectedCategory === 'all' ? 'default' : 'outline'} size="sm" onClick={() => setSelectedCategory('all')}>All Topics</Button>
            {readingCategories.map(cat => (
              <Button key={cat.id} variant={selectedCategory === cat.id ? 'default' : 'outline'} size="sm" onClick={() => setSelectedCategory(cat.id)}>{cat.label}</Button>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {lessonsLoading ? (
              <div className="col-span-full flex items-center justify-center py-16">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : filteredLessons.length === 0 ? (
              <div className="col-span-full">
                <Card>
                  <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
                    <BookOpen className="h-10 w-10 text-muted-foreground/50" />
                    <p className="text-sm text-muted-foreground">No reading lessons found.</p>
                  </CardContent>
                </Card>
              </div>
            ) : filteredLessons.map(lesson => (
              <Card key={lesson.id} className="cursor-pointer transition-all hover:shadow-md hover:border-primary/30" onClick={() => openLesson(lesson)}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-semibold text-sm">{lesson.title}</h3>
                      <p className="text-xs text-muted-foreground mt-0.5">{lesson.titleVi}</p>
                    </div>
                    <Badge variant="secondary" className="shrink-0">{lesson.level}</Badge>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground line-clamp-2">{lesson.content.slice(0, 120)}...</p>
                  <div className="mt-3 flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">{lesson.wordCount} words</Badge>
                    <Badge variant="outline" className="text-[10px]">{lesson.questions.length} questions</Badge>
                    <Badge variant="outline" className="text-[10px]">{lesson.vocabulary.length} vocab</Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* ======= AI TAB ======= */}
      {tab === 'ai' && (
        <>
          <Card>
            <CardContent className="px-6 py-5">
              <div className="flex flex-wrap gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input className="h-11 w-full rounded-xl border bg-background pl-10 pr-4 text-sm transition-colors placeholder:text-muted-foreground/60 hover:border-primary/30 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" placeholder={t.reading.topicPlaceholder} value={topic} onChange={(e) => setTopic(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleGenerate()} />
                </div>
                <select className="h-11 rounded-xl border bg-background px-3 text-sm" value={targetLanguage} onChange={(e) => setTargetLanguage(e.target.value)}>
                  <option value="english">{t.languages.english}</option>
                  <option value="vietnamese">{t.languages.vietnamese}</option>
                  <option value="japanese">{t.languages.japanese}</option>
                  <option value="korean">{t.languages.korean}</option>
                </select>
                <select className="h-11 rounded-xl border bg-background px-3 text-sm" value={level} onChange={(e) => setLevel(e.target.value)}>
                  {['A1','A2','B1','B2','C1','C2'].map(l => <option key={l} value={l}>{l}</option>)}
                </select>
                <Button variant="gradient" onClick={handleGenerate} disabled={loading || !topic.trim()}>
                  {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t.reading.generating}</> : <><Sparkles className="mr-2 h-4 w-4" /> {t.reading.generate}</>}
                </Button>
              </div>
            </CardContent>
          </Card>

          {result && (
            <div className="animate-fade-in space-y-6">
              <Card>
                <CardHeader className="px-6 pt-6 pb-4">
                  <div className="flex items-center justify-between"><CardTitle className="text-xl">{result.title}</CardTitle><Badge variant="secondary">{level}</Badge></div>
                </CardHeader>
                <CardContent className="px-6 pb-6">
                  <WordHover text={result.passage} className="whitespace-pre-wrap leading-8" />
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="px-6 pt-6 pb-4"><CardTitle className="flex items-center gap-2 text-lg">Comprehension Questions <Badge>{result.questions.length}</Badge></CardTitle></CardHeader>
                <CardContent className="space-y-6 px-6 pb-6">
                  {result.questions.map((q, qi) => (
                    <div key={qi} className="space-y-2.5">
                      <p className="font-medium text-sm"><span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{qi + 1}</span>{q.question}</p>
                      <div className="space-y-1.5 pl-8">
                        {q.options.map((opt, oi) => {
                          let s = 'border bg-background hover:bg-muted/50 hover:border-primary/30';
                          if (submitted) { if (oi === q.correctAnswer) s = 'border-emerald-500 bg-emerald-500/15 text-foreground'; else if (answers[qi] === oi) s = 'border-red-500 bg-red-500/15 text-foreground'; }
                          else if (answers[qi] === oi) s = 'border-primary bg-primary/5 shadow-sm';
                          return (
                            <button key={oi} className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left text-sm transition-all ${s}`} onClick={() => handleAnswer(qi, oi)}>
                              {submitted && oi === q.correctAnswer && <CheckCircle className="h-4 w-4 shrink-0 text-emerald-500" />}
                              {submitted && answers[qi] === oi && oi !== q.correctAnswer && <XCircle className="h-4 w-4 shrink-0 text-red-500" />}
                              {!submitted && <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs ${answers[qi] === oi ? 'border-primary bg-primary text-white' : ''}`}>{String.fromCharCode(65 + oi)}</span>}
                              <span>{opt}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  {!submitted ? (
                    <Button variant="gradient" onClick={handleSubmit} disabled={Object.keys(answers).length < result.questions.length}>Submit Answers</Button>
                  ) : (
                    <div className={`rounded-xl p-5 text-center ${getScore() >= result.questions.length * 0.7 ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-amber-500/10 border border-amber-500/30'}`}>
                      <p className="text-3xl font-bold">{getScore()} / {result.questions.length}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{getScore() >= result.questions.length * 0.7 ? 'Great job! 🎉' : 'Keep practicing! 📚'}</p>
                      <Button className="mt-3" variant="outline" onClick={() => { setResult(null); setTopic(''); }}>Tạo bài mới</Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* ── Saved/History section ── */}
          {!result && (
            <div className="mt-2 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                  <History className="h-4 w-4" /> {t.reading.savedPassages}
                </h3>
                <Button variant="ghost" size="sm" onClick={loadHistory} disabled={savedLoading} className="text-xs">
                  {savedLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : t.reading.refresh}
                </Button>
              </div>

              {savedLoading && (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              )}

              {!savedLoading && savedPassages.length === 0 && (
                <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
                  <Sparkles className="mx-auto mb-2 h-8 w-8 opacity-30" />
                  <p className="text-sm">{t.reading.noSavedPassages}</p>
                </div>
              )}

              {!savedLoading && savedPassages.length > 0 && (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {savedPassages.map((p) => (
                    <Card key={p.id} className="cursor-pointer transition-all hover:shadow-md hover:border-violet-400/50" onClick={() => openSaved(p)}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <h4 className="font-semibold text-sm capitalize">{p.topic}</h4>
                            <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {new Date(p.createdAt).toLocaleDateString('vi-VN')}
                            </p>
                          </div>
                          <Badge variant="secondary" className="shrink-0">{p.level}</Badge>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground line-clamp-2">{p.passageText.slice(0, 110)}...</p>
                        <div className="mt-2 flex gap-1.5">
                          <Badge variant="outline" className="text-[10px]">{p.language}</Badge>
                          {p.vocabulary.length > 0 && <Badge variant="outline" className="text-[10px]">{p.vocabulary.length} vocab</Badge>}
                          {p.questions.length > 0 && <Badge variant="outline" className="text-[10px]">{p.questions.length} Qs</Badge>}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ======= NLP ANALYZE TAB ======= */}
      {tab === 'nlp' && (
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <GraduationCap className="h-5 w-5 text-blue-500" />
                {t.reading.nlpTitle}
              </CardTitle>
              <p className="text-sm text-muted-foreground">{t.reading.nlpDesc}</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <textarea
                className="w-full min-h-36 rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
                placeholder="Paste any paragraph or article you want to analyze..."
                value={nlpText}
                onChange={(e) => setNlpText(e.target.value)}
              />
              <div className="flex items-center gap-3">
                <select
                  className="rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={nlpLanguage}
                  onChange={(e) => setNlpLanguage(e.target.value)}
                >
                  <option value="english">English</option>
                  <option value="chinese">Chinese</option>
                  <option value="japanese">Japanese</option>
                  <option value="vietnamese">Vietnamese</option>
                </select>
                <Button onClick={handleNlpAnalyze} disabled={nlpLoading || !nlpText.trim()} variant="gradient">
                  {nlpLoading ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Analyzing...</>
                  ) : (
                    <><Search className="mr-2 h-4 w-4" /> Analyze Text</>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          {nlpLoading && (
            <Card>
              <CardContent className="flex items-center justify-center py-12">
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                  <p className="text-sm text-muted-foreground">{t.reading.analyzingText}</p>
                </div>
              </CardContent>
            </Card>
          )}

          {nlpError && !nlpLoading && (
            <Card>
              <CardContent className="py-6 text-center text-sm text-destructive">{nlpError}</CardContent>
            </Card>
          )}

          {nlpResult && !nlpLoading && (
            <div className="space-y-4 animate-fade-in">
              {/* Level + Readability overview */}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {[
                  { label: 'CEFR Level', value: nlpResult.estimatedLevel, color: 'text-blue-500', bg: 'bg-blue-500/10' },
                  { label: 'Readability', value: `${nlpResult.readabilityScore}/100`, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
                  { label: 'Word Count', value: String(nlpResult.wordCount), color: 'text-violet-500', bg: 'bg-violet-500/10' },
                  { label: 'Complexity', value: nlpResult.vocabularyComplexity, color: 'text-orange-500', bg: 'bg-orange-500/10' },
                ].map((s) => (
                  <Card key={s.label}>
                    <CardContent className="p-4 flex flex-col items-center gap-1">
                      <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${s.bg}`}>
                        <GraduationCap className={`h-5 w-5 ${s.color}`} />
                      </div>
                      <p className="text-lg font-bold">{s.value}</p>
                      <p className="text-xs text-muted-foreground">{s.label}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Keywords + Complex words */}
              <div className="grid gap-4 sm:grid-cols-2">
                {nlpResult.topKeywords.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-semibold">Top Keywords</CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-wrap gap-2 pt-0">
                      {nlpResult.topKeywords.map((kw, i) => (
                        <Badge key={i} variant="secondary">{kw}</Badge>
                      ))}
                    </CardContent>
                  </Card>
                )}
                {nlpResult.complexWords.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-semibold">Complex Words to Learn</CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-wrap gap-2 pt-0">
                      {nlpResult.complexWords.map((w, i) => (
                        <Badge key={i} className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200">{w}</Badge>
                      ))}
                    </CardContent>
                  </Card>
                )}
              </div>

              {/* Grammar patterns */}
              {nlpResult.grammarPatternsFound.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold">Grammar Patterns Found</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-wrap gap-2 pt-0">
                    {nlpResult.grammarPatternsFound.map((gp, i) => (
                      <Badge key={i} className="bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-200">{gp}</Badge>
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* Suggestions + Notes */}
              {(nlpResult.suggestedExercises.length > 0 || nlpResult.notes) && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold">Learning Recommendations</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {nlpResult.notes && <p className="text-sm text-muted-foreground">{nlpResult.notes}</p>}
                    {nlpResult.suggestedExercises.length > 0 && (
                      <ul className="space-y-2">
                        {nlpResult.suggestedExercises.map((ex, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm">
                            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                            {ex}
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
