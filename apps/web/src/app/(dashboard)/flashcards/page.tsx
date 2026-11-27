"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useDecks, useRetentionDashboard } from "@/hooks/use-decks";
import {
  Plus,
  BookOpen,
  Layers,
  ArrowRight,
  Sparkles,
  Brain,
  AlertTriangle,
  ShieldCheck,
  Loader2,
} from "lucide-react";
import { useLanguageStore } from "@/stores/language-store";
import { useLearningLanguageStore } from "@/stores/learning-language-store";

interface RetentionCard {
  cardId: string;
  frontText: string;
  stability: number;
  difficulty: number;
  retrievabilityPct: number;
  isAtRisk: boolean;
  nextReviewDate: string;
  repetitions: number;
}

interface DeckRetention {
  deckId: string;
  totalCards: number;
  atRiskCards: number;
  avgRetentionPct: number;
  worstCards: RetentionCard[];
}

interface RetentionDashboard {
  totalTracked: number;
  atRiskTotal: number;
  globalAvgRetentionPct: number;
  decks: DeckRetention[];
  algorithm: string;
  generatedAt: string;
}

interface Deck {
  id: string;
  title: string;
  description: string;
  cardCount: number;
  isPublic: boolean;
  createdAt: string;
}

type Tab = "decks" | "memory";

export default function FlashcardsPage() {
  const { t } = useLanguageStore();
  const { language } = useLearningLanguageStore();
  const [tab, setTab] = useState<Tab>("decks");
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const { decks, isLoading: decksLoading, createDeck, isCreating: creating } = useDecks(language);
  const { data: retention, isLoading: retentionLoading, refetch: fetchRetention } = useRetentionDashboard();

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createDeck({ title: name, description, language });
      setName("");
      setDescription("");
      setShowCreate(false);
    } catch {
      // silently handle
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t.flashcards.title}</h1>
          <p className="text-sm text-muted-foreground">{t.flashcards.desc}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/flashcards/generate">
            <Button variant="outline" className="gap-2 border-primary/30 dark:border-primary/20 hover:bg-primary/5 hover:text-primary dark:hover:text-primary-light">
              <Sparkles className="h-4 w-4 text-primary animate-pulse" /> AI Deck Generator
            </Button>
          </Link>
          <Button variant="gradient" onClick={() => setShowCreate(!showCreate)}>
            <Plus className="h-4 w-4" /> {t.flashcards.newDeck}
          </Button>
        </div>
      </div>

      {/* Tab switcher */}
      <div
        className="flex gap-2"
        role="tablist"
        aria-label="Flashcard sections"
      >
        <button
          onClick={() => setTab("decks")}
          role="tab"
          aria-selected={tab === "decks"}
          aria-controls="decks-panel"
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${tab === "decks" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
        >
          <Layers className="h-4 w-4" aria-hidden="true" /> My Decks
        </button>
        <button
          onClick={() => setTab("memory")}
          role="tab"
          aria-selected={tab === "memory"}
          aria-controls="memory-panel"
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${tab === "memory" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
        >
          <Brain className="h-4 w-4" aria-hidden="true" />
          Memory Health
          {retention && retention.atRiskTotal > 0 && (
            <span
              className="ml-1 rounded-full bg-red-500 px-1.5 py-0.5 text-xs text-white"
              aria-label={`${retention.atRiskTotal} cards at risk`}
            >
              {retention.atRiskTotal}
            </span>
          )}
        </button>
      </div>

      {/* Create Form */}
      {showCreate && (
        <Card className="animate-scale-in border-primary/20">
          <CardContent className="p-6">
            <form onSubmit={handleCreate} className="space-y-4">
              <Input
                label={t.flashcards.deckName}
                placeholder={t.flashcards.deckNamePlaceholder}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
              <Input
                label={t.flashcards.description}
                placeholder={t.flashcards.descriptionPlaceholder}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
              <div className="flex gap-2">
                <Button type="submit" disabled={creating}>
                  {creating ? t.common.loading : t.flashcards.createDeck}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowCreate(false)}
                >
                  {t.common.cancel}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Decks Tab */}
      {tab === "decks" && (
        <div id="decks-panel" role="tabpanel" aria-labelledby="decks-tab">
          {decks.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center gap-4 py-16">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
                  <Layers className="h-8 w-8 text-primary" />
                </div>
                <div className="text-center">
                  <p className="font-semibold">{t.flashcards.noDecks}</p>
                  <p className="text-sm text-muted-foreground">
                    {t.flashcards.noDecksDesc}
                  </p>
                </div>
                <Button variant="gradient" onClick={() => setShowCreate(true)}>
                  <Plus className="h-4 w-4" /> {t.flashcards.createFirst}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {decks.map((deck, i) => (
                <Link key={deck.id} href={`/flashcards/${deck.id}`}>
                  <Card
                    className="group card-hover h-full cursor-pointer animate-fade-in"
                    style={{ animationDelay: `${i * 60}ms` }}
                  >
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <CardTitle className="text-lg group-hover:text-primary transition-colors">
                          {deck.title}
                        </CardTitle>
                        <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 transition-all group-hover:opacity-100 group-hover:translate-x-1" />
                      </div>
                    </CardHeader>
                    <CardContent>
                      {deck.description && (
                        <p className="mb-4 text-sm text-muted-foreground line-clamp-2">
                          {deck.description}
                        </p>
                      )}
                      <div className="flex items-center gap-3">
                        <Badge variant="secondary">
                          <BookOpen className="mr-1 h-3 w-3" />
                          {deck.cardCount} {t.flashcards.cards}
                        </Badge>
                        {deck.isPublic && (
                          <Badge variant="default">Public</Badge>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Memory Health Tab */}
      {tab === "memory" && (
        <div
          id="memory-panel"
          role="tabpanel"
          aria-labelledby="memory-tab"
          className="space-y-6"
        >
          {retentionLoading ? (
            <Card>
              <CardContent className="flex items-center justify-center py-16">
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-sm text-muted-foreground">
                    Loading memory health...
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : retention ? (
            <>
              {/* Global stats */}
              <div className="grid grid-cols-3 gap-4">
                <Card>
                  <CardContent className="p-5">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10">
                        <Brain className="h-5 w-5 text-blue-500" />
                      </div>
                      <div>
                        <p className="text-2xl font-bold">
                          {retention.totalTracked}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Cards Tracked
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-5">
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex h-10 w-10 items-center justify-center rounded-xl ${retention.globalAvgRetentionPct >= 80 ? "bg-emerald-500/10" : "bg-amber-500/10"}`}
                      >
                        <ShieldCheck
                          className={`h-5 w-5 ${retention.globalAvgRetentionPct >= 80 ? "text-emerald-500" : "text-amber-500"}`}
                        />
                      </div>
                      <div>
                        <p className="text-2xl font-bold">
                          {retention.globalAvgRetentionPct}%
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Avg. Retention
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-5">
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex h-10 w-10 items-center justify-center rounded-xl ${retention.atRiskTotal > 0 ? "bg-red-500/10" : "bg-emerald-500/10"}`}
                      >
                        <AlertTriangle
                          className={`h-5 w-5 ${retention.atRiskTotal > 0 ? "text-red-500" : "text-emerald-500"}`}
                        />
                      </div>
                      <div>
                        <p className="text-2xl font-bold">
                          {retention.atRiskTotal}
                        </p>
                        <p className="text-xs text-muted-foreground">At Risk</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <p className="text-xs text-muted-foreground">
                Algorithm: {retention.algorithm}
              </p>

              {/* Per-deck breakdown */}
              {retention.decks.length === 0 ? (
                <Card className="border-dashed">
                  <CardContent className="flex flex-col items-center gap-3 py-12">
                    <Brain className="h-10 w-10 text-muted-foreground/40" />
                    <p className="text-sm text-muted-foreground">
                      Start reviewing cards to see memory health data.
                    </p>
                    <Link href="/flashcards">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setTab("decks")}
                      >
                        View Decks
                      </Button>
                    </Link>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-4">
                  {retention.decks.map((deck) => (
                    <Card key={deck.deckId}>
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-base">
                            {decks.find((d) => d.id === deck.deckId)?.title ??
                              "Deck"}
                          </CardTitle>
                          <div className="flex items-center gap-2">
                            {deck.atRiskCards > 0 && (
                              <Badge className="bg-red-500/10 text-red-600 border-red-200 dark:border-red-900/40">
                                <AlertTriangle className="mr-1 h-3 w-3" />
                                {deck.atRiskCards} at risk
                              </Badge>
                            )}
                            <Badge variant="secondary">
                              {deck.avgRetentionPct}% retention
                            </Badge>
                          </div>
                        </div>
                        <Progress
                          value={deck.avgRetentionPct}
                          max={100}
                          variant="gradient"
                          size="sm"
                          className="mt-2"
                        />
                      </CardHeader>
                      {deck.worstCards.length > 0 && (
                        <CardContent className="pt-0">
                          <p className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                            Weakest Cards (review these first)
                          </p>
                          <div className="space-y-2">
                            {deck.worstCards.slice(0, 3).map((c) => (
                              <div
                                key={c.cardId}
                                className={`flex items-center justify-between rounded-lg p-3 ${c.isAtRisk ? "bg-red-500/5 border border-red-200 dark:border-red-900/30" : "bg-muted/50"}`}
                              >
                                <div>
                                  <p className="text-sm font-medium">
                                    {c.frontText}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    Stability: {c.stability}d · Reps:{" "}
                                    {c.repetitions}
                                  </p>
                                </div>
                                <div className="text-right">
                                  <p
                                    className={`text-sm font-bold ${c.retrievabilityPct < 70 ? "text-red-500" : c.retrievabilityPct < 85 ? "text-amber-500" : "text-emerald-500"}`}
                                  >
                                    {c.retrievabilityPct}%
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    retention
                                  </p>
                                </div>
                              </div>
                            ))}
                          </div>
                          <Link
                            href={`/flashcards/${deck.deckId}/study`}
                            className="mt-3 block"
                          >
                            <Button
                              variant="outline"
                              size="sm"
                              className="w-full"
                            >
                              Study Now{" "}
                              <ArrowRight className="ml-1 h-3.5 w-3.5" />
                            </Button>
                          </Link>
                        </CardContent>
                      )}
                    </Card>
                  ))}
                </div>
              )}
            </>
          ) : (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center gap-3 py-12">
                <Brain className="h-10 w-10 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  Could not load memory health.
                </p>
                <Button variant="outline" size="sm" onClick={() => fetchRetention()}>
                  Retry
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
