'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { AlertTriangle, Play, Trash2, Target, RotateCcw, Loader2, X, Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguageStore } from '@/stores/language-store';
import { apiClient } from '@/lib/api-client';

interface DifficultWord {
  id: string;
  word: string;
  back: string;
  exampleSentence?: string | null;
  attempts: number;
  correctAttempts: number;
  lastAttempt: string | null;
  retrievabilityPct: number;
}

type PracticeState = 'question' | 'answer';

interface DifficultWordCard {
  cardId: string;
  frontText: string;
  backText: string;
  exampleSentence?: string | null;
  isAtRisk: boolean;
  attempts: number;
  correctAttempts: number;
  lastReviewDate: string | null;
  retrievabilityPct: number;
}

type PracticeItem = DifficultWord & { retry?: boolean };

function PracticeModal({
  words,
  onClose,
}: {
  words: DifficultWord[];
  onClose: () => void;
}) {
  const [queue, setQueue] = useState<PracticeItem[]>(words);
  const [idx, setIdx] = useState(0);
  const [state, setState] = useState<PracticeState>(words[0] ? 'question' : 'answer');
  const [results, setResults] = useState<boolean[]>([]);
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [nextReviewById, setNextReviewById] = useState<Record<string, string>>({});
  const pending = useRef<{ operationId: string; grade: number } | null>(null);
  const busy = useRef(false);

  const current = queue[idx];

  const handleRate = useCallback(async (correct?: boolean) => {
    if (busy.current || !current) return;
    busy.current = true;
    setSaving(true);
    setSaveError(false);
    try {
      pending.current ??= { operationId: crypto.randomUUID(), grade: correct ? 3 : 1 };
      const review = pending.current;
      const { data } = await apiClient.post<{ nextReviewDate?: string }>('/srs/review', { cardId: current.id, ...review });
      pending.current = null;
      if (!current.retry) setResults(prev => [...prev, review.grade >= 2]);
      if (data.nextReviewDate) {
        setNextReviewById(prev => ({ ...prev, [current.id]: data.nextReviewDate as string }));
      }
      const needsRetry = review.grade < 2 && !current.retry;
      if (needsRetry) {
        setQueue(prev => [...prev, { ...current, retry: true }]);
      }
      if (needsRetry || idx < queue.length - 1) {
        setIdx(i => i + 1);
        setState(needsRetry ? 'answer' : 'question');
      } else {
        setDone(true);
      }
    } catch {
      setSaveError(true);
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }, [current, idx, queue.length]);

  const correctCount = results.filter(Boolean).length;

  if (done) {
    const reviewed = results.length || 1;
    const pct = Math.round((correctCount / reviewed) * 100);
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in">
        <Card className="max-w-md w-full mx-4 text-center shadow-2xl animate-fade-in-up">
          <CardContent className="py-12 px-8 space-y-6">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-emerald-500/10">
              <Check className="h-10 w-10 text-emerald-500" />
            </div>
            <div>
              <h2 className="text-2xl font-bold">Luyện tập xong!</h2>
              <p className="text-muted-foreground mt-1 text-sm">Bạn đã hoàn thành {results.length} từ khó</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/20 p-4">
                <p className="text-2xl font-bold text-emerald-600">{correctCount}</p>
                <p className="text-xs text-muted-foreground mt-1">Đúng</p>
              </div>
              <div className="rounded-xl bg-red-50 dark:bg-red-950/20 p-4">
                <p className="text-2xl font-bold text-red-500">{results.length - correctCount}</p>
                <p className="text-xs text-muted-foreground mt-1">Cần ôn thêm</p>
              </div>
            </div>
            <p className="text-3xl font-bold text-primary">{pct}%</p>
            {Object.keys(nextReviewById).length > 0 && (
              <div className="rounded-xl bg-muted/40 p-3 text-left">
                <p className="text-xs font-semibold">Lịch ôn tiếp theo</p>
                <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                  {Object.entries(nextReviewById).map(([id, date]) => (
                    <li key={id}>{queue.find(item => item.id === id)?.word ?? id}: {new Date(date).toLocaleString()}</li>
                  ))}
                </ul>
              </div>
            )}
            <Button variant="gradient" onClick={onClose} className="w-full">Xong</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in">
      <Card className="max-w-lg w-full mx-4 shadow-2xl animate-fade-in-up">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-500" />
            <CardTitle className="text-base">Từ khó #{idx + 1}/{queue.length}</CardTitle>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} disabled={saving} aria-label="Đóng"><X className="h-4 w-4" /></Button>
        </CardHeader>
        <CardContent className="space-y-6 pb-6">
          <Progress value={idx} max={queue.length} variant="gradient" size="sm" />

          <div className="rounded-2xl bg-primary/5 border border-primary/20 p-8 text-center">
            <p className="text-3xl font-bold">{current.word}</p>
            {current.retry && <p className="mt-2 text-xs font-semibold text-amber-600">Từ vừa quên · ôn lại ngay</p>}
            {state === 'answer' && (
              <div className="mt-4 animate-fade-in">
                <div className="h-px bg-border my-3" />
                <p className="text-lg font-medium text-primary">{current.back}</p>
                {current.exampleSentence && <p className="text-sm text-muted-foreground mt-1">{current.exampleSentence}</p>}
                {nextReviewById[current.id] && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Lịch ôn tiếp theo: {new Date(nextReviewById[current.id]).toLocaleString()}
                  </p>
                )}
              </div>
            )}
          </div>

          {state === 'question' ? (
            <Button variant="outline" className="w-full" onClick={() => setState('answer')}>
              Hiện đáp án
            </Button>
          ) : saveError ? (
            <div className="space-y-2">
              <p role="alert">Chưa xác nhận được lượt ôn.</p>
              <Button variant="outline" onClick={() => void handleRate()}>Thử lưu lại</Button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Button
                variant="outline"
                className="border-red-200 hover:bg-red-50 hover:border-red-400 dark:border-red-900 dark:hover:bg-red-950/30"
                onClick={() => handleRate(false)}
                disabled={saving}
              >
                <X className="mr-2 h-4 w-4 text-red-500" /> Chưa nhớ
              </Button>
              <Button
                variant="outline"
                className="border-green-200 hover:bg-green-50 hover:border-green-400 dark:border-green-900 dark:hover:bg-green-950/30"
                onClick={() => handleRate(true)}
                disabled={saving}
              >
                <Check className="mr-2 h-4 w-4 text-green-500" /> Đã nhớ
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function DifficultWordsPage() {
  const { t } = useLanguageStore();
  const queryClient = useQueryClient();
  const [words, setWords] = useState<DifficultWord[]>([]);
  const [loading, setLoading] = useState(true);
  const [practicing, setPracticing] = useState(false);
  const [practiceWords, setPracticeWords] = useState<DifficultWord[]>([]);
  const [loadError, setLoadError] = useState(false);

  const fetchDifficultWords = useCallback(async () => {
    setLoadError(false);
    setLoading(true);
    try {
      const { data } = await apiClient.get<{ decks: { worstCards: DifficultWordCard[] }[] }>('/srs/retention-dashboard');
      setWords(data.decks.flatMap((deck) => deck.worstCards)
        .filter((card) => card.isAtRisk)
        .map((card) => ({
          id: card.cardId,
          word: card.frontText,
          back: card.backText,
          exampleSentence: card.exampleSentence,
          attempts: card.attempts,
          correctAttempts: card.correctAttempts,
          lastAttempt: card.lastReviewDate,
          retrievabilityPct: card.retrievabilityPct,
        })));
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchDifficultWords(); }, [fetchDifficultWords]);
  // No ignore/delete card endpoint exists: hiding is session-only and the
  // word reappears on the next dashboard fetch. The button is labelled as
  // "Hide for this session" so this is explicit to users.
  const hideWordForSession = (id: string) => {
    setWords(prev => prev.filter(w => w.id !== id));
  };

  const startPractice = (selectedWords: DifficultWord[]) => {
    setPracticeWords(selectedWords);
    setPracticing(true);
  };

  return (
    <div className="space-y-6">
      {practicing && (
        <PracticeModal
          words={practiceWords}
          onClose={() => {
            setPracticing(false);
            void fetchDifficultWords();
            void queryClient.invalidateQueries({ queryKey: ["retention-dashboard"] });
            void queryClient.invalidateQueries({ queryKey: ["next-learning-activity"] });
          }}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between animate-fade-in">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-500/10">
            <AlertTriangle className="h-5 w-5 text-red-500" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{t.difficultWords.title}</h1>
            <p className="text-sm text-muted-foreground">{t.difficultWords.desc}</p>
          </div>
        </div>
        {words.length > 0 && (
          <Button variant="gradient" onClick={() => startPractice(words)}>
            <Play className="mr-2 h-4 w-4" /> {t.difficultWords.practiceAll}
          </Button>
        )}
      </div>

      {loading ? (
        <Card className="animate-fade-in">
          <CardContent className="flex flex-col items-center gap-4 py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Đang tải từ khó...</p>
          </CardContent>
        </Card>
      ) : loadError ? (
        <div className="space-y-2">
          <p role="alert">Chưa tải được từ khó.</p>
          <Button variant="outline" onClick={() => void fetchDifficultWords()}>Thử lại</Button>
        </div>
      ) : words.length === 0 ? (
        <Card className="border-dashed animate-fade-in" style={{ animationDelay: '100ms' }}>
          <CardContent className="flex flex-col items-center gap-4 py-16">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-500/10">
              <AlertTriangle className="h-8 w-8 text-red-400" />
            </div>
            <div className="text-center">
              <p className="font-medium">{t.difficultWords.noWords}</p>
              <p className="mt-1 text-sm text-muted-foreground max-w-md">{t.difficultWords.noWordsDesc}</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {words.map((word, i) => {
            const accuracy = word.attempts > 0 ? Math.round((word.correctAttempts / word.attempts) * 100) : 0;
            return (
              <Card key={word.id} className="card-hover animate-fade-in-up" style={{ animationDelay: `${i * 50}ms` }}>
                <CardContent className="flex items-center justify-between p-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-lg">{word.word}</span>
                      <Badge className="bg-red-500/10 text-red-600 text-xs">
                        <Target className="mr-1 h-3 w-3" /> {accuracy}%
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">{word.back}</p>
                    <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                      <span>{t.difficultWords.attempts}: {word.attempts}</span>
                      {word.lastAttempt && <span>{t.difficultWords.lastAttempt} · {new Date(word.lastAttempt).toLocaleDateString()}</span>}
                    </div>
                    <Progress value={accuracy} max={100} variant={accuracy > 50 ? 'success' : 'warning'} size="sm" className="mt-2 max-w-xs" />
                  </div>
                  <div className="flex gap-2 ml-4">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => startPractice([word])}
                    >
                      <RotateCcw className="mr-1 h-3.5 w-3.5" /> Practice
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-red-500"
                      onClick={() => hideWordForSession(word.id)}
                      title="Hide for this session"
                      aria-label="Hide for this session"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
