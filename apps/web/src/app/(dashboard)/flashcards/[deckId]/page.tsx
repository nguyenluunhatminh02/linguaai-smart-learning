"use client";

import { useEffect, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useParams, useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { apiClient } from "@/lib/api-client";
import {
  Plus,
  Play,
  Trash2,
  ArrowLeft,
  BookOpen,
  Sparkles,
  Loader2,
  Volume2,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { speakWord } from "@/lib/speech";

interface CardItem {
  id: string;
  frontText?: string;
  backText?: string;
  front?: string;
  back?: string;
  ipaPronunciation?: string;
  exampleSentence?: string;
  createdAt: string;
}

interface Deck {
  id: string;
  title?: string;
  name?: string;
  description: string;
  cardCount: number;
}

type Tab = "cards" | "ai";

export default function DeckDetailPage() {
  const params = useParams();
  const router = useRouter();
  const deckId = params.deckId as string;
  const [deck, setDeck] = useState<Deck | null>(null);
  const [cards, setCards] = useState<CardItem[]>([]);
  const [cardsError, setCardsError] = useState(false);
  const [cardsLoading, setCardsLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  const rowVirtualizer = useVirtualizer({
    count: cards.length,
    getScrollElement: () => {
      if (typeof document === 'undefined') return null;
      return document.querySelector('main.flex-1.overflow-y-auto');
    },
    estimateSize: () => 110,
    overscan: 10,
  });
  const [tab, setTab] = useState<Tab>("cards");
  const [showAdd, setShowAdd] = useState(false);
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [adding, setAdding] = useState(false);
  // AI Generate state
  const [aiText, setAiText] = useState("");
  const [aiLanguage, setAiLanguage] = useState("english");
  const [aiCount, setAiCount] = useState(5);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiGenerated, setAiGenerated] = useState<CardItem[]>([]);
  const [deletingCardId, setDeletingCardId] = useState<string | null>(null);

  const fetchCards = () => {
    setCardsLoading(true);
    apiClient
      .get(`/decks/${deckId}/cards`)
      .then((r) => {
        setCards(Array.isArray(r.data) ? r.data : []);
        setCardsError(false);
      })
      .catch(() => setCardsError(true))
      .finally(() => setCardsLoading(false));
  };

  useEffect(() => {
    apiClient
      .get(`/decks/${deckId}`)
      .then((r) => setDeck(r.data))
      .catch(() => router.push("/flashcards"));
    fetchCards();
    // `reloadKey` is incremented by the retry button to re-run this fetch.
  }, [deckId, router, reloadKey]);

  const handleAddCard = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true);
    try {
      const res = await apiClient.post(`/decks/${deckId}/cards`, {
        frontText: front,
        backText: back,
      });
      setCards([...cards, res.data]);
      setFront("");
      setBack("");
      setShowAdd(false);
    } catch {
      // silently handle
    } finally {
      setAdding(false);
    }
  };

  const handleAiGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiText.trim()) return;
    setAiGenerating(true);
    setAiGenerated([]);
    try {
      const res = await apiClient.post(
        `/decks/${deckId}/cards/generate-from-text`,
        {
          text: aiText,
          language: aiLanguage,
          count: aiCount,
        },
      );
      const newCards: CardItem[] = res.data.cards || [];
      setAiGenerated(newCards);
      // Merge the freshly-generated cards into the visible list (dedupe by id)
      // so the 'Cards (N)' count and the cards tab reflect the new state
      // without waiting for a refetch that can race with the cache.
      setCards((prev) => {
        const existingIds = new Set(prev.map((c) => c.id));
        const fresh = newCards.filter((c) => c.id && !existingIds.has(c.id));
        return fresh.length ? [...prev, ...fresh] : prev;
      });
      toast.success(`Generated ${res.data.generated} cards from your text!`);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message || "Failed to generate cards. Please try again.";
      toast.error(msg);
    } finally {
      setAiGenerating(false);
    }
  };

  const handleDeleteCard = async (cardId: string) => {
    try {
      await apiClient.delete(`/decks/${deckId}/cards/${cardId}`);
      setCards(cards.filter((c) => c.id !== cardId));
    } catch {
      // silently handle
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/flashcards">
          <Button variant="ghost" size="icon" className="shrink-0">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold truncate">
            {deck?.title ?? deck?.name ?? "Loading..."}
          </h1>
          {deck?.description && (
            <p className="text-sm text-muted-foreground truncate">
              {deck.description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link href={`/flashcards/${deckId}/study`}>
            <Button variant="gradient">
              <Play className="h-4 w-4" /> Study
            </Button>
          </Link>
          <Button
            variant="outline"
            onClick={() => {
              setShowAdd(!showAdd);
              setTab("cards");
            }}
          >
            <Plus className="h-4 w-4" /> Add Card
          </Button>
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-2">
        <button
          onClick={() => setTab("cards")}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${tab === "cards" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
        >
          <BookOpen className="h-4 w-4" /> Cards ({cards.length})
        </button>
        <button
          onClick={() => setTab("ai")}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${tab === "ai" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
        >
          <Sparkles className="h-4 w-4" /> AI Generate
        </button>
      </div>

      {/* Cards Tab */}
      {tab === "cards" && (
        <div className="space-y-4">
          {/* Add Card Form */}
          {showAdd && (
            <Card className="animate-scale-in border-primary/20">
              <CardContent className="p-6">
                <form onSubmit={handleAddCard} className="space-y-4">
                  <Input
                    label="Front (Question / Word)"
                    value={front}
                    onChange={(e) => setFront(e.target.value)}
                    required
                  />
                  <Input
                    label="Back (Answer / Definition)"
                    value={back}
                    onChange={(e) => setBack(e.target.value)}
                    required
                  />
                  <div className="flex gap-2">
                    <Button type="submit" disabled={adding}>
                      {adding ? "Adding..." : "Add Card"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setShowAdd(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          {cardsError ? (
            <Card className="border-destructive/40">
              <CardContent className="flex flex-col items-center gap-4 py-16">
                <div className="text-center">
                  <p className="font-semibold">Couldn&apos;t load cards</p>
                  <p className="text-sm text-muted-foreground">
                    Check your connection and try again.
                  </p>
                </div>
                <Button onClick={() => setReloadKey((k) => k + 1)}>
                  Retry
                </Button>
              </CardContent>
            </Card>
          ) : cards.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center gap-4 py-16">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
                  <BookOpen className="h-8 w-8 text-primary" />
                </div>
                <div className="text-center">
                  <p className="font-semibold">
                    {cardsLoading ? "Loading cards..." : "No cards yet"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Add manually or use AI to generate from text
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button onClick={() => setShowAdd(true)}>
                    <Plus className="h-4 w-4" /> Add Card
                  </Button>
                  <Button variant="outline" onClick={() => setTab("ai")}>
                    <Sparkles className="h-4 w-4" /> AI Generate
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{cards.length} cards</Badge>
              </div>
              <div
                style={{
                  height: `${rowVirtualizer.getTotalSize()}px`,
                  width: '100%',
                  position: 'relative',
                }}
              >
                {rowVirtualizer.getVirtualItems().map((virtualItem) => {
                  const card = cards[virtualItem.index];
                  const i = virtualItem.index;
                  const f = card.frontText ?? card.front ?? "";
                  const b = card.backText ?? card.back ?? "";
                  return (
                    <div
                      key={card.id}
                      ref={rowVirtualizer.measureElement}
                      data-index={virtualItem.index}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${virtualItem.start}px)`,
                      }}
                      className="pb-3"
                    >
                      <Card
                        className="group card-hover animate-fade-in"
                        style={{ animationDelay: `${i * 20}ms` }}
                      >
                        <CardContent className="flex items-start justify-between gap-4 p-5">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-muted text-xs font-medium text-muted-foreground">
                                {i + 1}
                              </span>
                              <span className="font-medium">{f}</span>
                              {card.ipaPronunciation && (
                                <span className="text-xs text-muted-foreground font-mono">
                                  {card.ipaPronunciation}
                                </span>
                              )}
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-6 w-6 rounded-full text-muted-foreground hover:text-primary transition-colors" 
                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); speakWord(f); }}
                                aria-label="Play audio"
                              >
                                <Volume2 className="h-3 w-3" />
                              </Button>
                            </div>
                            <p className="ml-8 text-sm text-muted-foreground">
                              {b}
                            </p>
                            {card.exampleSentence && (
                              <p className="ml-8 mt-1 text-xs text-muted-foreground italic">
                                &quot;{card.exampleSentence}&quot;
                              </p>
                            )}
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                            disabled={deletingCardId === card.id}
                            onClick={async () => {
                              setDeletingCardId(card.id);
                              try {
                                await apiClient.delete(
                                  `/decks/${deckId}/cards/${card.id}`,
                                );
                                setCards(cards.filter((c) => c.id !== card.id));
                                toast.success("Card deleted");
                              } catch {
                                toast.error("Failed to delete card");
                              } finally {
                                setDeletingCardId(null);
                              }
                            }}
                          >
                            {deletingCardId === card.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4 text-destructive" />
                            )}
                          </Button>
                        </CardContent>
                      </Card>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "ai" && (
        <div className="space-y-6">
          <Card className="border-violet-200 dark:border-violet-900/40">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="h-5 w-5 text-violet-500" />
                Generate Cards from Text
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Paste any text and AI will extract key vocabulary cards
                automatically.
              </p>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleAiGenerate} className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium">
                    Source Text
                  </label>
                  <textarea
                    className="w-full min-h-36 rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
                    placeholder="Paste a paragraph, article excerpt, or any text you want to study..."
                    value={aiText}
                    onChange={(e) => setAiText(e.target.value)}
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium">
                      Language
                    </label>
                    <select
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      value={aiLanguage}
                      onChange={(e) => setAiLanguage(e.target.value)}
                    >
                      <option value="english">English</option>
                      <option value="chinese">Chinese</option>
                      <option value="japanese">Japanese</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium">
                      Number of Cards
                    </label>
                    <select
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      value={aiCount}
                      onChange={(e) => setAiCount(Number(e.target.value))}
                    >
                      {[3, 5, 8, 10, 15, 20].map((n) => (
                        <option key={n} value={n}>
                          {n} cards
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <Button
                  type="submit"
                  disabled={aiGenerating || !aiText.trim()}
                  className="w-full"
                >
                  {aiGenerating ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />{" "}
                      Generating with AI...
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-4 w-4" /> Generate {aiCount}{" "}
                      Cards
                    </>
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Generated preview */}
          {aiGenerated.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-200">
                  {aiGenerated.length} cards added to deck
                </Badge>
              </div>
              {aiGenerated.map((card, i) => {
                const f = card.frontText ?? card.front ?? "";
                const b = card.backText ?? card.back ?? "";
                return (
                  <Card
                    key={card.id ?? i}
                    className="animate-fade-in border-emerald-200 dark:border-emerald-900/30"
                    style={{ animationDelay: `${i * 60}ms` }}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-semibold">{f}</p>
                          {card.ipaPronunciation && (
                            <p className="text-xs text-muted-foreground font-mono">
                              {card.ipaPronunciation}
                            </p>
                          )}
                          <p className="text-sm text-muted-foreground mt-1">
                            {b}
                          </p>
                          {card.exampleSentence && (
                            <p className="text-xs text-muted-foreground italic mt-1">
                              &quot;{card.exampleSentence}&quot;
                            </p>
                          )}
                        </div>
                        <Badge variant="secondary">New</Badge>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
