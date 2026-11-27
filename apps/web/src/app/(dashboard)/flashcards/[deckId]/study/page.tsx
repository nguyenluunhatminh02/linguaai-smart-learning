"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { ArrowLeft, Volume2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { apiClient } from "@/lib/api-client";
import { speakWord } from "@/lib/speech";
import { useLanguageStore } from "@/stores/language-store";

interface StudyCard {
  id: string;
  frontText: string;
  backText: string;
  exampleSentence?: string;
}

type SaveAction = { type: "review"; cardId: string; grade: number; operationId: string };

interface FinishAction {
  sessionId: string;
  cardsReviewed: number;
  cardsCorrect: number;
  durationSeconds: number;
}

const grades = [
  { value: 1, en: "Forgot", vi: "Chưa nhớ" },
  { value: 2, en: "Hard", vi: "Nhớ khó" },
  { value: 3, en: "Good", vi: "Đã nhớ" },
  { value: 4, en: "Easy", vi: "Nhớ dễ" },
];

export default function StudyPage() {
  return <Suspense><DeckStudyRoute /></Suspense>;
}

function DeckStudyRoute() {
  const { deckId } = useParams<{ deckId: string }>();
  const limitParam = useSearchParams().get("limit");
  const parsed = Number(limitParam);
  const limit = parsed > 0 && Number.isInteger(parsed) ? Math.min(parsed, 20) : 20;
  return <DeckStudy key={`${deckId}:${limit}`} deckId={deckId} limit={limit} />;
}

function DeckStudy({ deckId, limit }: { deckId: string; limit: number }) {
  const vi = useLanguageStore((state) => state.locale === "vi");
  const label = (en: string, translated: string) => vi ? translated : en;
  const queryClient = useQueryClient();
  const [cards, setCards] = useState<StudyCard[] | null>(null);
  const [reviewed, setReviewed] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [loadingError, setLoadingError] = useState(false);
  const [loadCount, setLoadCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [correct, setCorrect] = useState(0);
  const session = useRef<{ id: string; startedAt: number; acknowledged: boolean } | null>(null);
  const pending = useRef<SaveAction | FinishAction | null>(null);
  const busy = useRef(false);
  const card = cards?.[reviewed];

  useEffect(() => {
    let active = true;
    void apiClient.get<{ dueCards: { card: StudyCard }[]; newCards: StudyCard[] }>("/srs/due-cards", {
      params: { deckId, limit },
    }).then(({ data }) => {
      if (!active) return;
      setCards([...data.dueCards.map(({ card }) => card), ...data.newCards]);
    }).catch(() => {
      if (active) setLoadingError(true);
    });
    return () => { active = false; };
  }, [deckId, limit, loadCount]);

  const save = async (grade?: number) => {
    if (busy.current || completed || !cards?.length) return;
    if (!pending.current && (!card || grade === undefined)) return;
    busy.current = true;
    setSaving(true);
    setSaveError(false);
    try {
      if (!pending.current && card && grade !== undefined) {
        pending.current = { type: "review", cardId: card.id, grade, operationId: crypto.randomUUID() };
      }
      session.current ??= { id: crypto.randomUUID(), startedAt: Date.now(), acknowledged: false };
      const reviewSession = session.current;
      if (!reviewSession.acknowledged) {
        const response = await apiClient.post<{ id: string; startedAt: string }>("/srs/session/start", {
          deckId,
          sessionId: reviewSession.id,
        });
        reviewSession.startedAt = Date.parse(response.data.startedAt);
        reviewSession.acknowledged = true;
      }
      const action = pending.current;
      if (action && "type" in action) {
        const { cardId, grade, operationId } = action;
        await apiClient.post("/srs/review", { cardId, grade, operationId });
        const cardsReviewed = reviewed + 1;
        const cardsCorrect = correct + Number(grade >= 2);
        setReviewed(cardsReviewed);
        setCorrect(cardsCorrect);
        setFlipped(false);
        pending.current = cardsReviewed === cards.length ? {
          sessionId: reviewSession.id,
          cardsReviewed,
          cardsCorrect,
          durationSeconds: Math.max(0, Math.floor((Date.now() - reviewSession.startedAt) / 1000)),
        } : null;
      }
      if (pending.current && "sessionId" in pending.current) {
        await apiClient.post("/srs/session/finish", pending.current);
        pending.current = null;
        setCompleted(true);
        void queryClient.invalidateQueries({ queryKey: ["next-learning-activity"] });
        void queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
        void queryClient.invalidateQueries({ queryKey: ["decks"] });
        void queryClient.invalidateQueries({ queryKey: ["retention-dashboard"] });
      }
    } catch {
      setSaveError(true);
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <Link href={`/flashcards/${deckId}`} className="inline-flex items-center gap-2 text-sm font-medium">
        <ArrowLeft className="h-4 w-4" aria-hidden /> {label("Back to deck", "Về bộ thẻ")}
      </Link>
      {loadingError ? (
        <div className="space-y-3">
          <p role="alert">{label("The cards could not load.", "Chưa tải được thẻ.")}</p>
          <Button onClick={() => { setLoadingError(false); setLoadCount((count) => count + 1); }}>{label("Retry", "Thử lại")}</Button>
        </div>
      ) : !cards ? (
        <p role="status">{label("Loading cards…", "Đang tải thẻ…")}</p>
      ) : cards.length === 0 ? (
        <p role="status">{label("There are no cards due in this deck.", "Bộ thẻ này chưa có thẻ cần ôn.")}</p>
      ) : (
        <>
          <Progress value={reviewed} max={cards.length} variant="gradient" showLabel />
          {card && (
            <>
              <Card>
                <CardContent className="space-y-4 p-8 text-center">
                  <p className="text-2xl font-semibold">{card.frontText}</p>
                  <Button size="icon" variant="ghost" onClick={() => speakWord(card.frontText)} aria-label={label("Play audio", "Nghe phát âm")}>
                    <Volume2 className="h-5 w-5" aria-hidden />
                  </Button>
                  {flipped && (
                    <div id="flashcard-answer" className="space-y-2 border-t pt-4">
                      <p className="text-lg">{card.backText}</p>
                      {card.exampleSentence && <p className="text-sm text-muted-foreground">{card.exampleSentence}</p>}
                    </div>
                  )}
                  {!flipped && <Button onClick={() => setFlipped(true)}>{label("Show answer", "Hiện đáp án")}</Button>}
                </CardContent>
              </Card>
              {flipped && !saveError && (
                <div className="space-y-3">
                  <p className="text-sm">{label("How well did you remember?", "Bạn nhớ thẻ này đến mức nào?")}</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {grades.map((grade) => (
                      <Button key={grade.value} variant="outline" disabled={saving} onClick={() => void save(grade.value)}>
                        {label(grade.en, grade.vi)}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
          {saving && <p role="status">{label("Saving progress…", "Đang lưu tiến độ…")}</p>}
          {saveError && (
            <div className="space-y-2">
              <p role="alert">{label("Your progress could not be confirmed. You can retry this step.", "Chưa xác nhận được tiến độ. Bạn có thể gửi lại bước này.")}</p>
              <Button onClick={() => void save()}>{label("Retry saving", "Thử lưu lại")}</Button>
            </div>
          )}
          {completed && (
            <Card>
              <CardContent className="space-y-3 p-6">
                <h1 className="text-xl font-semibold">{label("Review saved", "Đã lưu phiên ôn")}</h1>
                <p role="status">{correct}/{reviewed} {label("cards remembered", "thẻ đã nhớ")}</p>
                <Link href="/dashboard" className="text-primary underline-offset-4 hover:underline">{label("Continue learning", "Học tiếp")}</Link>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
