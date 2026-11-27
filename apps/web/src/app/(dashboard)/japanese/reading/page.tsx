'use client';

import { useState, useMemo, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { BookOpen, CheckCircle, XCircle, ArrowLeft, BookMarked, GraduationCap, Loader2 } from 'lucide-react';
import { getAccessToken } from '@/stores/auth-store';

export interface JaReadingLesson {
  id: string;
  title: string;
  titleVi: string;
  level: string;
  category: string;
  wordCount: number;
  content: string;
  vocabulary: { word: string; reading: string; definition: string; definitionVi: string; partOfSpeech: string; example: string }[];
  questions: { question: string; questionVi: string; options: string[]; correctAnswer: number; explanation: string }[];
}

// IDs must match the CMS/backend lesson `category` values; otherwise the
// filter can never match a lesson.
const jaReadingCategories = [
  { id: 'daily_life', label: '日常生活', labelVi: 'Cuộc sống hàng ngày' },
  { id: 'culture', label: '文化', labelVi: 'Văn hóa Nhật Bản' },
  { id: 'travel', label: '旅行', labelVi: 'Du lịch' },
];

function cmsToJaReadingLesson(lesson: Record<string, unknown>): JaReadingLesson {
  const c = (lesson.content ?? {}) as Record<string, unknown>;
  return {
    id: (lesson.slug as string) || (lesson.id as string),
    title: lesson.title as string,
    titleVi: (lesson.titleVi ?? lesson.title_vi) as string,
    level: lesson.level as string,
    category: lesson.category as string,
    wordCount: (c.wordCount as number) ?? 0,
    content: (c.text as string) ?? (c.content as string) ?? '',
    vocabulary: (c.vocabulary as JaReadingLesson['vocabulary']) ?? [],
    questions: (c.questions as JaReadingLesson['questions']) ?? [],
  };
}

const levels = ['N5', 'N4', 'N3', 'N2', 'N1', 'Advanced'] as const;

export default function JapaneseReadingPage() {
  const [lessons, setLessons] = useState<JaReadingLesson[]>([]);
  const [lessonsLoading, setLessonsLoading] = useState(true);
  const [selectedLevel, setSelectedLevel] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedLesson, setSelectedLesson] = useState<JaReadingLesson | null>(null);
  const [lessonAnswers, setLessonAnswers] = useState<Record<number, number>>({});
  const [lessonSubmitted, setLessonSubmitted] = useState(false);

  useEffect(() => {
    // The CMS proxy forwards Authorization upstream, where lessons require a
    // JWT; without it the request returns 401 and only stale local JSON shows.
    const token = getAccessToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    fetch('/api/cms/lessons?type=reading&language=japanese&published=true&limit=200', { headers })
      .then(r => r.json())
      .then(json => {
        const items: Record<string, unknown>[] = json.data ?? json ?? [];
        setLessons(items.map(cmsToJaReadingLesson));
      })
      .catch(() => {})
      .finally(() => setLessonsLoading(false));
  }, []);

  const filteredLessons = useMemo(() => {
    return lessons.filter((l) => {
      if (selectedLevel !== 'all' && l.level !== selectedLevel) return false;
      if (selectedCategory !== 'all' && l.category !== selectedCategory) return false;
      return true;
    });
  }, [lessons, selectedLevel, selectedCategory]);

  const openLesson = (lesson: JaReadingLesson) => {
    setSelectedLesson(lesson);
    setLessonAnswers({});
    setLessonSubmitted(false);
  };

  const lessonScore = selectedLesson
    ? selectedLesson.questions.filter((q, i) => lessonAnswers[i] === q.correctAnswer).length
    : 0;

  // ─── Lesson Detail ───
  if (selectedLesson) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={() => setSelectedLesson(null)}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Quay lại
        </Button>

        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-violet-500/10">
            <BookOpen className="h-6 w-6 text-violet-500" />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">{selectedLesson.title}</h1>
            <p className="text-sm text-muted-foreground">{selectedLesson.titleVi}</p>
            <div className="mt-2 flex gap-2">
              <Badge variant="secondary">{selectedLesson.level}</Badge>
              <Badge variant="outline">{selectedLesson.wordCount} 字</Badge>
            </div>
          </div>
        </div>

        {/* Reading Passage */}
        <Card>
          <CardHeader className="px-6 pt-6 pb-2">
            <CardTitle className="flex items-center gap-2 text-lg">
              <BookMarked className="h-5 w-5 text-violet-500" /> Bài đọc 読解
            </CardTitle>
          </CardHeader>
          <CardContent className="px-6 pb-6">
            <p className="whitespace-pre-wrap leading-8 text-base">{selectedLesson.content}</p>
          </CardContent>
        </Card>

        {/* Vocabulary */}
        <Card>
          <CardHeader className="px-6 pt-6 pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              📚 Từ vựng chính <Badge variant="secondary">{selectedLesson.vocabulary.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-6 pb-6">
            <div className="grid gap-3 sm:grid-cols-2">
              {selectedLesson.vocabulary.map((v) => (
                <div key={v.word} className="rounded-xl border p-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <span className="font-bold text-sm">{v.word}</span>
                      <span className="ml-2 text-xs text-primary/80">{v.reading}</span>
                    </div>
                    <Badge variant="outline" className="text-[10px]">{v.partOfSpeech}</Badge>
                  </div>
                  <p className="text-xs"><span className="text-muted-foreground">EN:</span> {v.definition}</p>
                  <p className="text-xs"><span className="text-muted-foreground">VI:</span> {v.definitionVi}</p>
                  <p className="text-xs text-muted-foreground italic">{v.example}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Questions */}
        <Card>
          <CardHeader className="px-6 pt-6 pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <GraduationCap className="h-5 w-5 text-violet-500" /> Câu hỏi đọc hiểu
            </CardTitle>
          </CardHeader>
          <CardContent className="px-6 pb-6 space-y-5">
            {selectedLesson.questions.map((q, qi) => (
              <div key={qi} className="space-y-2">
                <p className="font-medium text-sm">
                  <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{qi + 1}</span>
                  {q.question}
                </p>
                <p className="pl-8 text-xs text-muted-foreground">{q.questionVi}</p>
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
                      <button
                        key={oi}
                        className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left text-sm transition-all ${cls}`}
                        onClick={() => { if (!lessonSubmitted) setLessonAnswers(prev => ({ ...prev, [qi]: oi })); }}
                      >
                        {lessonSubmitted && oi === q.correctAnswer && <CheckCircle className="h-4 w-4 shrink-0 text-emerald-500" />}
                        {lessonSubmitted && lessonAnswers[qi] === oi && oi !== q.correctAnswer && <XCircle className="h-4 w-4 shrink-0 text-red-500" />}
                        {!lessonSubmitted && (
                          <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs ${lessonAnswers[qi] === oi ? 'border-primary bg-primary text-white' : ''}`}>
                            {String.fromCharCode(65 + oi)}
                          </span>
                        )}
                        <span>{opt}</span>
                      </button>
                    );
                  })}
                </div>
                {lessonSubmitted && <p className="pl-8 text-xs text-muted-foreground italic">💡 {q.explanation}</p>}
              </div>
            ))}

            {!lessonSubmitted ? (
              <Button variant="gradient" onClick={() => setLessonSubmitted(true)} disabled={Object.keys(lessonAnswers).length < selectedLesson.questions.length}>
                Nộp bài
              </Button>
            ) : (
              <div className={`rounded-xl p-5 text-center ${lessonScore >= selectedLesson.questions.length * 0.7 ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-amber-500/10 border border-amber-500/30'}`}>
                <p className="text-3xl font-bold">{lessonScore} / {selectedLesson.questions.length}</p>
                <p className="mt-1 text-sm text-muted-foreground">{lessonScore >= selectedLesson.questions.length * 0.7 ? 'すごい！🎉' : 'もう少し練習しましょう！📚'}</p>
                <Button variant="outline" className="mt-3" onClick={() => { setLessonAnswers({}); setLessonSubmitted(false); }}>Làm lại</Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // ─── Main List ───
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10">
          <BookOpen className="h-5 w-5 text-violet-500" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Đọc hiểu tiếng Nhật</h1>
          <p className="text-sm text-muted-foreground">日本語読解 — Bài đọc từ N5 đến N1</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant={selectedLevel === 'all' ? 'default' : 'outline'} size="sm" onClick={() => setSelectedLevel('all')}>Tất cả</Button>
        {levels.map(lvl => (
          <Button key={lvl} variant={selectedLevel === lvl ? 'default' : 'outline'} size="sm" onClick={() => setSelectedLevel(lvl)}>{lvl}</Button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant={selectedCategory === 'all' ? 'default' : 'outline'} size="sm" onClick={() => setSelectedCategory('all')}>Tất cả</Button>
        {jaReadingCategories.map(cat => (
          <Button key={cat.id} variant={selectedCategory === cat.id ? 'default' : 'outline'} size="sm" onClick={() => setSelectedCategory(cat.id)}>{cat.labelVi}</Button>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {lessonsLoading ? (
          <div className="col-span-full flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
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
              <p className="mt-2 text-xs text-muted-foreground line-clamp-2">{lesson.content.slice(0, 100)}...</p>
              <div className="mt-3 flex items-center gap-2">
                <Badge variant="outline" className="text-[10px]">{lesson.wordCount} 字</Badge>
                <Badge variant="outline" className="text-[10px]">{lesson.questions.length} câu hỏi</Badge>
                <Badge variant="outline" className="text-[10px]">{lesson.vocabulary.length} từ vựng</Badge>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
