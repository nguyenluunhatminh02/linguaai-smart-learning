'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Zap, Check, X, Trophy, RotateCcw, Timer, Flame, Target, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguageStore } from '@/stores/language-store';
import { apiClient } from '@/lib/api-client';

interface FlashCard {
  id: string;
  front: string;
  back: string;
}

interface CardTexts {
  frontText?: string;
  front_text?: string;
  front?: string;
  backText?: string;
  back_text?: string;
  back?: string;
}

interface DueCardEntry {
  cardId: string;
  card?: CardTexts;
}

type NewCardEntry = CardTexts & { id: string };

// Demo cards for when no real cards are available
const demoCards: FlashCard[] = [
  { id: '1', front: 'Hello', back: 'Xin chào' },
  { id: '2', front: 'Thank you', back: 'Cảm ơn' },
  { id: '3', front: 'Good morning', back: 'Chào buổi sáng' },
  { id: '4', front: 'Goodbye', back: 'Tạm biệt' },
  { id: '5', front: 'Please', back: 'Xin vui lòng' },
  { id: '6', front: 'Sorry', back: 'Xin lỗi' },
  { id: '7', front: 'Water', back: 'Nước' },
  { id: '8', front: 'Food', back: 'Thức ăn' },
  { id: '9', front: 'Friend', back: 'Bạn bè' },
  { id: '10', front: 'Love', back: 'Tình yêu' },
];

const cleanTranslation = (front: string, back: string): string => {
  if (!back) return '';
  const escapedFront = front.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').trim();
  
  // Try splits
  const splitSeps = ['/', '-', ':'];
  for (const sep of splitSeps) {
    if (back.includes(sep)) {
      const parts = back.split(sep);
      if (parts[0].trim().toLowerCase() === front.trim().toLowerCase()) {
        return parts.slice(1).join(sep).trim();
      }
    }
  }

  // Try regex matching
  const regex1 = new RegExp(`^${escapedFront}\\s*[/\\-:]\\s*(.*)`, 'i');
  const match1 = back.match(regex1);
  if (match1) return match1[1].trim();

  const regex2 = new RegExp(`(.*)\\s*\\(${escapedFront}\\)`, 'i');
  const match2 = back.match(regex2);
  if (match2) return match2[1].trim();

  const regex3 = new RegExp(`^${escapedFront}\\s*\\((.*)\\)`, 'i');
  const match3 = back.match(regex3);
  if (match3) return match3[1].trim();

  return back.trim();
};

type GameState = 'idle' | 'playing' | 'complete';

export default function SpeedReviewPage() {
  const { t } = useLanguageStore();
  const queryClient = useQueryClient();
  const [saveFailures, setSaveFailures] = useState(0);
  const [gameState, setGameState] = useState<GameState>('idle');
  const [cards, setCards] = useState<FlashCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [timeLeft, setTimeLeft] = useState(60);
  const [correct, setCorrect] = useState(0);
  const [total, setTotal] = useState(0);
  const [feedback, setFeedback] = useState<'correct' | 'incorrect' | null>(null);

  // The 800 ms feedback transition must not survive a restart or unmount:
  // otherwise it advances a fresh round to the previous round's next card.
  const feedbackTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const roundId = useRef(0);
  const gameStateRef = useRef<GameState>('idle');
  gameStateRef.current = gameState;

  const clearFeedbackTimeout = useCallback(() => {
    if (feedbackTimeout.current !== null) {
      clearTimeout(feedbackTimeout.current);
      feedbackTimeout.current = null;
    }
  }, []);

  useEffect(() => clearFeedbackTimeout, [clearFeedbackTimeout]);

  // Proposed translation challenge states
  const [proposedTranslation, setProposedTranslation] = useState('');
  const [isMatch, setIsMatch] = useState(true);

  useEffect(() => {
    const loadCards = async () => {
      try {
        // First get user's decks
        const decksRes = await apiClient.get('/decks/my');
        const decks = decksRes.data;

        if (decks.length > 0) {
          // Try to get due cards from the first deck
          const allCards: FlashCard[] = [];

          for (const deck of decks.slice(0, 3)) {
            try {
              const dueRes = await apiClient.get(`/srs/due-cards?deckId=${deck.id}&limit=10`);
              const dueData = dueRes.data;

              // Map due cards (both existing and new)
              const dueCards = [
                ...(dueData.dueCards || []).map((c: DueCardEntry) => ({
                  id: c.cardId,
                  front: c.card?.frontText || c.card?.front_text || c.card?.front || '',
                  back: c.card?.backText || c.card?.back_text || c.card?.back || '',
                })),
                ...(dueData.newCards || []).map((c: NewCardEntry) => ({
                  id: c.id,
                  front: c.frontText || c.front_text || c.front || '',
                  back: c.backText || c.back_text || c.back || '',
                })),
              ];
              allCards.push(...dueCards);
            } catch {
              // Try getting all cards from the deck
              try {
                const cardsRes = await apiClient.get(`/decks/${deck.id}/cards`);
                const deckCards = (cardsRes.data || []).map((c: NewCardEntry) => ({
                  id: c.id,
                  front: c.frontText || c.front_text || c.front || '',
                  back: c.backText || c.back_text || c.back || '',
                }));
                allCards.push(...deckCards.slice(0, 10));
              } catch { /* skip this deck */ }
            }
          }

          if (allCards.length > 0) {
            setCards(allCards);
          } else {
            setCards(demoCards);
          }
        } else {
          setCards(demoCards);
        }
      } catch {
        setCards(demoCards);
      } finally {
        setLoading(false);
      }
    };

    loadCards();
  }, []);

  useEffect(() => {
    if (gameState !== 'playing' || timeLeft <= 0) return;
    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          setGameState('complete');
          void queryClient.invalidateQueries({ queryKey: ['decks'] });
          void queryClient.invalidateQueries({ queryKey: ['retention-dashboard'] });
          void queryClient.invalidateQueries({ queryKey: ['next-learning-activity'] });
          void queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [gameState, timeLeft, queryClient]);

  // Generates a True/False match challenge
  const generateChallenge = useCallback((index: number, currentCards: FlashCard[]) => {
    if (currentCards.length === 0) return;
    const currentCard = currentCards[index];
    const shouldMatch = Math.random() > 0.5;

    if (shouldMatch || currentCards.length < 2) {
      setIsMatch(true);
      setProposedTranslation(cleanTranslation(currentCard.front, currentCard.back));
    } else {
      setIsMatch(false);
      // Pick a random wrong card translation
      const otherCards = currentCards.filter(c => c.back !== currentCard.back);
      if (otherCards.length > 0) {
        const randomCard = otherCards[Math.floor(Math.random() * otherCards.length)];
        setProposedTranslation(cleanTranslation(randomCard.front, randomCard.back));
      } else {
        setIsMatch(true);
        setProposedTranslation(cleanTranslation(currentCard.front, currentCard.back));
      }
    }
  }, []);

  const startGame = () => {
    clearFeedbackTimeout();
    roundId.current += 1;
    setGameState('playing');
    setCurrentIndex(0);
    setScore(0);
    setStreak(0);
    setBestStreak(0);
    setTimeLeft(60);
    setCorrect(0);
    setTotal(0);
    setSaveFailures(0);
    setShowAnswer(false);
    setFeedback(null);
    generateChallenge(0, cards);
  };

  const handleAnswer = useCallback((userGuessedMatch: boolean) => {
    if (gameState !== 'playing' || showAnswer) return;
    setTotal(prev => prev + 1);
    setShowAnswer(true);

    const isAnswerCorrect = userGuessedMatch === isMatch;
    const card = cards[currentIndex];
    if (card && card.id.length === 36) {
      void apiClient.post('/srs/review', {
        cardId: card.id,
        grade: isAnswerCorrect ? 3 : 1,
        operationId: crypto.randomUUID(),
      }).catch(() => setSaveFailures(prev => prev + 1));
    }

    if (isAnswerCorrect) {
      setCorrect(prev => prev + 1);
      setScore(prev => prev + 10 + streak * 2);
      setStreak(prev => {
        const newStreak = prev + 1;
        setBestStreak(best => Math.max(best, newStreak));
        return newStreak;
      });
      setFeedback('correct');
    } else {
      setStreak(0);
      setFeedback('incorrect');
    }

    const activeRound = roundId.current;
    clearFeedbackTimeout();
    feedbackTimeout.current = setTimeout(() => {
      feedbackTimeout.current = null;
      // A restart (or a game that ended during the pause) invalidates the
      // queued transition; never advance a card in the wrong round.
      if (roundId.current !== activeRound || gameStateRef.current !== 'playing') return;
      setShowAnswer(false);
      setFeedback(null);
      const nextIndex = (currentIndex + 1) % cards.length;
      setCurrentIndex(nextIndex);
      generateChallenge(nextIndex, cards);
    }, 800);
  }, [gameState, showAnswer, isMatch, streak, cards, currentIndex, generateChallenge, clearFeedbackTimeout]);

  // Keyboard controls listener
  useEffect(() => {
    if (gameState !== 'playing' || showAnswer) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'f' || e.key === '1') {
        e.preventDefault();
        handleAnswer(false); // Guess Mismatch
      } else if (e.key === 'ArrowRight' || e.key === 'j' || e.key === '2') {
        e.preventDefault();
        handleAnswer(true); // Guess Match
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [gameState, showAnswer, handleAnswer]);

  const currentCard = cards[currentIndex];
  const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;

  if (loading || cards.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3 animate-fade-in">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500/10">
            <Zap className="h-5 w-5 text-orange-500" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{t.speedReview.title}</h1>
            <p className="text-sm text-muted-foreground">{t.speedReview.desc}</p>
          </div>
        </div>
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-4 py-16">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-500/10">
              {loading ? <Loader2 className="h-8 w-8 animate-spin text-orange-400" /> : <Zap className="h-8 w-8 text-orange-400" />}
            </div>
            <p className="font-medium">{loading ? 'Đang tải thẻ ôn tập...' : t.speedReview.noCards}</p>
            {!loading && <p className="text-sm text-muted-foreground">{t.speedReview.noCardsDesc}</p>}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between animate-fade-in">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500/10">
            <Zap className="h-5 w-5 text-orange-500" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{t.speedReview.title}</h1>
            <p className="text-sm text-muted-foreground">{t.speedReview.desc}</p>
          </div>
        </div>
      </div>

      {gameState === 'idle' && (
        <div className="flex items-center justify-center min-h-100 animate-fade-in">
          <Card className="max-w-md w-full text-center border border-border/60 shadow-xl bg-background/65 backdrop-blur-md">
            <CardContent className="py-12 px-8 space-y-6">
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-orange-500/10 border border-orange-500/10">
                <Zap className="h-10 w-10 text-orange-500" />
              </div>
              <div className="space-y-2">
                <h2 className="text-lg font-bold">Ready for the challenge?</h2>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Decide quickly if the translation matches the word. Use your keyboard for high speeds:
                </p>
                <div className="flex justify-center gap-4 pt-2 text-xs font-semibold text-muted-foreground">
                  <span className="bg-muted px-2.5 py-1 rounded-lg border">← / F : Incorrect</span>
                  <span className="bg-muted px-2.5 py-1 rounded-lg border">→ / J : Correct</span>
                </div>
              </div>
              <Button variant="gradient" size="lg" className="w-full sm:w-auto" onClick={startGame}>
                <Zap className="mr-2 h-5 w-5" /> {t.speedReview.start}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {gameState === 'playing' && (
        <div className="space-y-6">
          {/* Game stats bar */}
          <div className="grid grid-cols-4 gap-4 animate-fade-in">
            <Card className="bg-background/50 backdrop-blur-sm">
              <CardContent className="flex items-center gap-2 p-3 justify-center md:justify-start">
                <Timer className="h-4 w-4 text-muted-foreground" />
                <span className={cn('font-bold tabular-nums', timeLeft <= 10 && 'text-red-500')}>{timeLeft}s</span>
                <span className="text-[10px] hidden md:inline text-muted-foreground font-medium">{t.speedReview.timeLeft}</span>
              </CardContent>
            </Card>
            <Card className="bg-background/50 backdrop-blur-sm">
              <CardContent className="flex items-center gap-2 p-3 justify-center md:justify-start">
                <Trophy className="h-4 w-4 text-amber-500" />
                <span className="font-bold tabular-nums">{score}</span>
                <span className="text-[10px] hidden md:inline text-muted-foreground font-medium">{t.speedReview.score}</span>
              </CardContent>
            </Card>
            <Card className="bg-background/50 backdrop-blur-sm">
              <CardContent className="flex items-center gap-2 p-3 justify-center md:justify-start">
                <Flame className="h-4 w-4 text-orange-500 animate-pulse" />
                <span className="font-bold tabular-nums">{streak}</span>
                <span className="text-[10px] hidden md:inline text-muted-foreground font-medium">{t.speedReview.streak}</span>
              </CardContent>
            </Card>
            <Card className="bg-background/50 backdrop-blur-sm">
              <CardContent className="flex items-center gap-2 p-3 justify-center md:justify-start">
                <Target className="h-4 w-4 text-green-500" />
                <span className="font-bold tabular-nums">{accuracy}%</span>
                <span className="text-[10px] hidden md:inline text-muted-foreground font-medium">{t.speedReview.accuracy}</span>
              </CardContent>
            </Card>
          </div>

          {/* Timer bar */}
          <Progress value={timeLeft} max={60} variant={timeLeft <= 10 ? 'warning' : 'gradient'} size="sm" />

          {/* Game Play Card */}
          <div className="flex items-center justify-center">
            <Card className={cn(
              'max-w-lg w-full transition-all duration-300 border bg-background/60 backdrop-blur-md shadow-lg',
              feedback === 'correct' && 'border-emerald-500 shadow-emerald-500/10',
              feedback === 'incorrect' && 'border-rose-500 shadow-rose-500/10',
            )}>
              <CardContent className="py-12 px-8 text-center space-y-8">
                {/* Target word */}
                <div className="space-y-1">
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest block">
                    Word to review
                  </span>
                  <p className="text-3xl font-extrabold text-foreground">{currentCard.front}</p>
                </div>

                {/* Proposed translation section */}
                <div className="py-6 px-4 bg-muted/30 rounded-2xl border border-border/40 inline-block min-w-80">
                  <span className="text-[10px] font-bold text-muted-foreground/85 uppercase tracking-widest block mb-1">
                    Proposed Translation
                  </span>
                  <p className="text-2xl font-bold text-primary">{proposedTranslation}</p>
                </div>

                {/* Feedback state */}
                {showAnswer ? (
                  <div className="h-14 flex flex-col justify-center animate-scale-in">
                    <p className={cn(
                      'text-lg font-extrabold tracking-wide',
                      feedback === 'correct' ? 'text-emerald-500' : 'text-rose-500'
                    )}>
                      {feedback === 'correct' ? 'CORRECT! 🎉' : 'INCORRECT'}
                    </p>
                    {(feedback === 'incorrect' || !isMatch) && (
                      <p className="text-xs text-muted-foreground font-medium">
                        Correct translation: <span className="font-bold text-foreground">{cleanTranslation(currentCard.front, currentCard.back)}</span>
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="h-14 flex items-center justify-center gap-4">
                    <Button
                      variant="outline"
                      size="lg"
                      className="border-rose-200 hover:bg-rose-500/5 hover:border-rose-500 text-rose-500 font-bold min-w-32 rounded-xl transition-all h-12"
                      onClick={() => handleAnswer(false)}
                    >
                      <X className="mr-2 h-4 w-4 shrink-0" /> {t.speedReview.incorrect}
                    </Button>
                    <Button
                      variant="outline"
                      size="lg"
                      className="border-emerald-200 hover:bg-emerald-500/5 hover:border-emerald-500 text-emerald-500 font-bold min-w-32 rounded-xl transition-all h-12"
                      onClick={() => handleAnswer(true)}
                    >
                      <Check className="mr-2 h-4 w-4 shrink-0" /> {t.speedReview.correct}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {gameState === 'complete' && (
        <div className="flex items-center justify-center min-h-100 animate-fade-in-up">
          <Card className="max-w-md w-full text-center border border-border/60 shadow-xl bg-background/65 backdrop-blur-md">
            <CardContent className="py-12 px-8 space-y-6">
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-amber-500/10 border border-amber-500/10">
                <Trophy className="h-10 w-10 text-amber-500" />
              </div>
              <div>
                <h2 className="text-xl font-bold">{t.speedReview.roundComplete}</h2>
                <p className="text-xs text-muted-foreground mt-1">Excellent speed run!</p>
              </div>
              <div className="grid grid-cols-3 gap-4 py-2 bg-muted/30 rounded-xl border border-border/40">
                <div>
                  <p className="text-2xl font-bold text-primary">{score}</p>
                  <p className="text-[10px] text-muted-foreground font-semibold">{t.speedReview.score}</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-emerald-500">{accuracy}%</p>
                  <p className="text-[10px] text-muted-foreground font-semibold">{t.speedReview.accuracy}</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-orange-500">{bestStreak}</p>
                  <p className="text-[10px] text-muted-foreground font-semibold">{t.speedReview.bestStreak}</p>
                </div>
              </div>
              <div className="text-xs text-muted-foreground font-medium">
                {t.speedReview.wordsReviewed}: <span className="font-bold text-foreground">{total}</span>
              </div>
              {saveFailures > 0 && (
                <p role="status" className="text-xs text-amber-600">
                  {saveFailures} lượt ôn chưa lưu được do mất kết nối. Lịch ôn sẽ được cập nhật khi bạn dùng lại thẻ này.
                </p>
              )}
              <Button variant="gradient" size="lg" className="w-full" onClick={startGame}>
                <RotateCcw className="mr-2 h-5 w-5" /> {t.speedReview.playAgain}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
