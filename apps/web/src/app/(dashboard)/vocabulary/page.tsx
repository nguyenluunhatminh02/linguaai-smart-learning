'use client';

import { useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { BookMarked, Plus, Search, BookOpen, GraduationCap, Sparkles, Layers, ChevronLeft, Check, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth-store';
import { useLanguageStore } from '@/stores/language-store';
import {
  invalidateDeck,
  invalidateDeckCards,
  invalidateDecks,
  invalidateRetention,
  invalidateDashboard,
  queryKeys,
} from '@/lib/query-keys';
import { apiClient } from '@/lib/api-client';
import { toast } from 'sonner';

export interface VocabWord {
  id: number;
  word: string;
  ipa: string;
  pos: string;
  en: string;
  vi: string;
  example: string;
  topic: string;
}

export interface VocabPack {
  id: string;
  level: string;
  title: string;
  titleVi: string;
  description: string;
  color: string;
  words: VocabWord[];
}

/** Backend rows put word metadata in `data`, CMS rows in `content`. */
function cmsToVocabPack(lesson: Record<string, unknown>): VocabPack {
  const c = ((lesson.content ?? lesson.data ?? {}) as Record<string, unknown>);
  return {
    id: String((lesson.slug as string) || (lesson.id as string) || ''),
    level: (lesson.level as string) ?? '',
    title: (lesson.title as string) ?? '',
    titleVi: (lesson.titleVi ?? lesson.title_vi ?? lesson.title) as string,
    description: (lesson.description as string) ?? '',
    color: (c.color as string) ?? '',
    words: Array.isArray(c.words) ? (c.words as VocabWord[]) : [],
  };
}

interface Word {
  id: string;
  word: string;
  meaning: string;
  example?: string;
  status: 'new' | 'learning' | 'known';
  createdAt: string;
}

interface DeckSummary {
  id: string;
  title?: string;
  name?: string;
  language?: string;
}

interface CardResponse {
  id: string;
  frontText?: string;
  front_text?: string;
  front?: string;
  backText?: string;
  back_text?: string;
  back?: string;
  exampleSentence?: string;
  example_sentence?: string;
  createdAt?: string;
  created_at?: string;
  progress?: { repetitionCount?: number } | null;
}

function statusFromProgress(progress: unknown): Word['status'] {
  const count = (progress as { repetitionCount?: number } | null)?.repetitionCount ?? 0;
  if (count > 0 && count < 3) return 'learning';
  if (count >= 3) return 'known';
  return 'new';
}

/** Personal deck names are deliberately bilingual so both locales find it. */
const VOCAB_DECK_NAMES = ['Từ vựng của tôi', 'My Vocabulary'];
const VOCAB_DECK_TITLE = 'Từ vựng của tôi';

const TABS = [
  { key: 'my-words', panelId: 'vocabulary-my-words-panel', icon: BookMarked },
  { key: 'packs', panelId: 'vocabulary-packs-panel', icon: Layers },
] as const;

type TabKey = (typeof TABS)[number]['key'];

function isVocabularyDeck(deck: DeckSummary): boolean {
  return VOCAB_DECK_NAMES.includes(deck.title ?? '') || VOCAB_DECK_NAMES.includes(deck.name ?? '');
}

function toWord(card: CardResponse): Word {
  return {
    id: card.id,
    word: card.frontText || card.front_text || card.front || '',
    meaning: card.backText || card.back_text || card.back || '',
    example: card.exampleSentence || card.example_sentence || undefined,
    status: statusFromProgress(card.progress),
    createdAt: card.createdAt || card.created_at || new Date().toISOString(),
  };
}

/** Wrap a raw error for the alert UI; TanStack Query may reject with a non-Error. */
function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
}

export default function VocabularyPage() {
  const { t } = useLanguageStore();
  const queryClient = useQueryClient();
  const userId = useAuthStore((state) => state.user?.id);

  // Local UI state only. All server data and its loading/error state live in
  // TanStack Query, so a refetch (including a retry) cannot desync the view.
  const [activeTab, setActiveTab] = useState<TabKey>('my-words');
  const [filter, setFilter] = useState<'all' | 'new' | 'learning' | 'known'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newWord, setNewWord] = useState('');
  const [newMeaning, setNewMeaning] = useState('');
  const [newExample, setNewExample] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [selectedPack, setSelectedPack] = useState<VocabPack | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const backRef = useRef<HTMLButtonElement | null>(null);
  const packHeadlineRef = useRef<HTMLHeadingElement | null>(null);
  // One id per click, kept across retries of that same review action.
  const reviewOperationIds = useRef(new Map<string, string>());
  const reviewForCard = useRef<string | null>(null);

  const deckKey = queryKeys.decks.list(userId, 'my');
  const cardsKey = queryKeys.decks.cards(userId, 'my');
  const packsKey = queryKeys.vocabulary.packs(userId);

  const decksQuery = useQuery<DeckSummary[]>({
    queryKey: deckKey,
    queryFn: async () => {
      const response = await apiClient.get<DeckSummary[] | { items: DeckSummary[] }>('/decks/my');
      const data = response.data;
      if (Array.isArray(data)) return data;
      if (data && typeof data === 'object' && 'items' in data && Array.isArray(data.items)) return data.items;
      return [];
    },
    enabled: activeTab === 'my-words',
  });

  const deck = useMemo(
    () => (decksQuery.data ?? []).find(isVocabularyDeck) ?? null,
    [decksQuery.data],
  );
  const deckId = deck?.id ?? null;

  const cardsQuery = useQuery<CardResponse[], Error>({
    queryKey: cardsKey,
    queryFn: async () => {
      const response = await apiClient.get<CardResponse[] | { items: CardResponse[] }>(
        `/decks/${deckId}/cards`,
      );
      const data = response.data;
      if (Array.isArray(data)) return data;
      if (data && typeof data === 'object' && 'items' in data && Array.isArray(data.items)) return data.items;
      return [];
    },
    enabled: activeTab === 'my-words' && !!deckId,
  });

  const words = useMemo(() => (cardsQuery.data ?? []).map(toWord), [cardsQuery.data]);

  // Pages with an existing `['vocabulary-packs']` entry keep using it; no new
  // request is made against the admin-only proxy from this page.
  const legacyPacksQuery = useQuery<Record<string, unknown>[]>({
    queryKey: ['vocabulary-packs'],
    queryFn: () => Promise.resolve([]),
    enabled: false,
  });

  const packsKeyWithParams = useMemo(
    () => [...packsKey, { type: 'vocabulary', language: 'english' }] as const,
    [packsKey],
  );

  const packsQuery = useQuery<VocabPack[], Error>({
    queryKey: packsKeyWithParams,
    queryFn: async () => {
      // The student endpoint is public and returns published content only;
      // /api/cms/lessons is admin-only and rejects normal users with 401.
      const response = await apiClient.get<unknown>('/lessons', {
        params: { type: 'vocabulary', language: 'english', limit: 200 },
      });
      const payload = response.data;
      const rows: unknown[] = Array.isArray(payload)
        ? payload
        : payload && typeof payload === 'object' && 'items' in payload && Array.isArray(payload.items)
          ? payload.items
          : payload && typeof payload === 'object' && 'data' in payload && Array.isArray(payload.data)
            ? payload.data
            : [];

      const packs = rows
        .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
        .filter((row) => {
          const nested = (row.data ?? row.content ?? {}) as Record<string, unknown>;
          const published = row.published ?? row.isPublished ?? nested.published ?? nested.isPublished;
          const language = row.language ?? nested.language;
          return published !== false && (!language || language === 'english');
        })
        .map(cmsToVocabPack)
        .filter((pack) => pack.words.length > 0);

      if (packs.length > 0) return packs;

      // Fall back to the already-cached admin proxy payload (e.g. an admin
      // viewing this page), never to a new unauthorized request.
      const cachedLegacy = queryClient.getQueryData<Record<string, unknown>[]>(['vocabulary-packs']);
      const fallback = legacyPacksQuery.data ?? cachedLegacy ?? [];
      return fallback
        .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
        .map(cmsToVocabPack);
    },
    enabled: activeTab === 'packs',
  });

  const vocabularyPacks = packsQuery.data ?? [];

  const invalidateVocabularyData = async (targetDeckId: string | null) => {
    await Promise.all([
      invalidateDecks(queryClient, userId),
      invalidateDeck(queryClient, userId, targetDeckId ?? ''),
      invalidateDeckCards(queryClient, userId, targetDeckId ?? ''),
      invalidateRetention(queryClient, userId),
      invalidateDashboard(queryClient, userId),
      queryClient.invalidateQueries({ queryKey: ['decks'] }),
      queryClient.invalidateQueries({ queryKey: ['retention-dashboard'] }),
      queryClient.invalidateQueries({ queryKey: ['next-learning-activity'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] }),
      ...(targetDeckId ? [queryClient.invalidateQueries({ queryKey: ['deck', targetDeckId] })] : []),
      ...(targetDeckId ? [queryClient.invalidateQueries({ queryKey: ['cards', targetDeckId] })] : []),
    ]);
  };

  const createDeckMutation = useMutation({
    mutationFn: async () => {
      const response = await apiClient.post<DeckSummary>('/decks', {
        title: VOCAB_DECK_TITLE,
        description: 'Danh sách từ vựng cá nhân của tôi',
        isPublic: false,
      });
      return response.data;
    },
    onSuccess: async () => {
      await invalidateVocabularyData(null);
      setAnnouncement('Đã tạo bộ từ vựng cá nhân.');
    },
  });

  const createCardMutation = useMutation({
    mutationFn: async (input: {
      deckId: string;
      frontText: string;
      backText: string;
      exampleSentence?: string;
      ipaPronunciation?: string;
    }) => {
      const { deckId: targetDeckId, ...payload } = input;
      const response = await apiClient.post<CardResponse>(`/decks/${targetDeckId}/cards`, payload);
      return response.data;
    },
    onSuccess: async (_card, variables) => {
      await invalidateVocabularyData(variables.deckId);
    },
  });

  const reviewMutation = useMutation({
    mutationFn: async (input: { cardId: string; grade: number; operationId: string }) => {
      await apiClient.post('/srs/review', input);
      return input;
    },
    onSuccess: async ({ cardId }) => {
      await invalidateVocabularyData(deckId);
      // Mastery is derived from progress.repetitionCount, never from the
      // clicked button, so the label matches a reload.
      const refreshed = queryClient.getQueryData<CardResponse[]>(cardsKey);
      const nextStatus = statusFromProgress(refreshed?.find((card) => card.id === cardId)?.progress);
      reviewOperationIds.current.delete(cardId);
      reviewForCard.current = null;
      setAnnouncement(
        nextStatus === 'known'
          ? 'Đã đánh dấu đã thuộc.'
          : nextStatus === 'learning'
            ? 'Đã đánh dấu đang học.'
            : 'Từ đã được ôn tập; trạng thái "Đã thuộc" sẽ đạt sau khi ôn tập đủ 3 lần.',
      );
      toast.success('Đã lưu kết quả ôn tập.');
    },
    onError: () => {
      // Keep the id so a retry is the same logical review operation.
      reviewForCard.current = null;
      toast.error('Không thể cập nhật trạng thái ôn tập.');
      setAnnouncement('Không thể cập nhật trạng thái ôn tập.');
    },
  });

  const getOrCreateDeckId = async (): Promise<string> => {
    if (deckId) return deckId;
    const created = await createDeckMutation.mutateAsync();
    if (!created?.id) throw new Error('Deck creation did not return an id');
    return created.id;
  };

  const addCard = async (input: {
    frontText: string;
    backText: string;
    exampleSentence?: string;
    ipaPronunciation?: string;
  }) => {
    const targetDeckId = await getOrCreateDeckId();
    await createCardMutation.mutateAsync({ deckId: targetDeckId, ...input });
  };

  const addFromPack = async (w: VocabWord) => {
    if (words.some((x) => x.word.toLowerCase() === w.word.toLowerCase())) return;
    try {
      await addCard({
        frontText: w.word,
        backText: `${w.en} / ${w.vi}`,
        exampleSentence: w.example || undefined,
        ipaPronunciation: w.ipa || undefined,
      });
      toast.success(`Đã thêm từ "${w.word}" vào bộ sưu tập.`);
    } catch (err) {
      toast.error(errorMessage(err, 'Không thể thêm từ vựng từ gói.'));
    }
  };

  const addWord = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!newWord.trim() || !newMeaning.trim()) {
      setFormError('Vui lòng nhập cả từ và nghĩa của từ.');
      return;
    }
    setFormError(null);
    try {
      await addCard({
        frontText: newWord.trim(),
        backText: newMeaning.trim(),
        exampleSentence: newExample.trim() || undefined,
      });
      setNewWord('');
      setNewMeaning('');
      setNewExample('');
      setShowAddForm(false);
      setAnnouncement(`Đã thêm từ "${newWord.trim()}" vào bộ sưu tập.`);
      toast.success('Đã thêm từ vựng mới thành công!');
    } catch (err) {
      setFormError(errorMessage(err, 'Không thể thêm từ vựng.'));
      toast.error('Không thể thêm từ vựng.');
    }
  };

  const updateStatus = async (id: string, status: Word['status']) => {
    if (reviewMutation.isPending) return;
    let operationId = reviewOperationIds.current.get(id);
    if (!operationId) {
      operationId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `review-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      reviewOperationIds.current.set(id, operationId);
    }
    reviewForCard.current = id;
    reviewMutation.mutate({ cardId: id, grade: status === 'learning' ? 2 : 4, operationId });
  };

  const changeTab = (key: TabKey, focus = false) => {
    setActiveTab(key);
    setSelectedPack(null);
    if (focus) {
      requestAnimationFrame(() => tabRefs.current[TABS.findIndex((tab) => tab.key === key)]?.focus());
    }
  };

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? TABS.length - 1
        : event.key === 'ArrowRight'
          ? (index + 1) % TABS.length
          : (index - 1 + TABS.length) % TABS.length;
    changeTab(TABS[next].key, true);
  };

  const openPack = (pack: VocabPack) => {
    setSelectedPack(pack);
    requestAnimationFrame(() => packHeadlineRef.current?.focus());
  };

  const closePack = () => {
    setSelectedPack(null);
    requestAnimationFrame(() => backRef.current?.focus());
  };

  const stats = {
    total: words.length,
    known: words.filter((w) => w.status === 'known').length,
    learning: words.filter((w) => w.status === 'learning').length,
    new: words.filter((w) => w.status === 'new').length,
  };

  const filteredWords = words.filter((w) => {
    if (filter !== 'all' && w.status !== filter) return false;
    if (searchQuery && !w.word.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const wordsError = decksQuery.error ?? cardsQuery.error;
  const wordsLoading = activeTab === 'my-words' && (decksQuery.isPending || (!!deckId && cardsQuery.isPending));
  const packsLoading = activeTab === 'packs' && packsQuery.isPending;
  const isMutating = createDeckMutation.isPending || createCardMutation.isPending || reviewMutation.isPending;
  const statusColors = {
    new: 'bg-blue-500/10 text-blue-600',
    learning: 'bg-amber-500/10 text-amber-600',
    known: 'bg-green-500/10 text-green-600',
  };

  return (
    <div className="space-y-6">
      {/* Live region: only terminal outcomes are announced. */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>

      {/* Header */}
      <div className="flex items-center justify-between animate-fade-in">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-500/10">
            <BookMarked className="h-5 w-5 text-teal-500" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{t.vocabulary.title}</h1>
            <p className="text-sm text-muted-foreground">{t.vocabulary.desc}</p>
          </div>
        </div>
        {activeTab === 'my-words' && (
          <Button
            variant="gradient"
            aria-expanded={showAddForm}
            aria-controls="vocabulary-add-word-form"
            onClick={() => setShowAddForm((open) => !open)}
          >
            <Plus className="mr-2 h-4 w-4" /> {t.vocabulary.addWord}
          </Button>
        )}
      </div>

      {/* Tabs */}
      <div
        role="tablist"
        aria-label={t.vocabulary.title}
        className="flex gap-1 rounded-xl bg-muted p-1 w-fit animate-fade-in"
        style={{ animationDelay: '50ms' }}
      >
        {TABS.map((tab, index) => (
          <button
            key={tab.key}
            ref={(node) => { tabRefs.current[index] = node; }}
            type="button"
            role="tab"
            id={`vocabulary-${tab.key}-tab`}
            aria-controls={tab.panelId}
            aria-selected={activeTab === tab.key}
            tabIndex={activeTab === tab.key ? 0 : -1}
            onClick={() => changeTab(tab.key)}
            onKeyDown={(event) => onTabKeyDown(event, index)}
            className={cn(
              'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all',
              activeTab === tab.key
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <tab.icon className="h-4 w-4" aria-hidden="true" />
            {tab.key === 'my-words' ? t.vocabulary.title : 'Gói từ vựng'}
          </button>
        ))}
      </div>

      {/* ═══════════════════════════ MY WORDS TAB ═══════════════════════════ */}
      {activeTab === 'my-words' && (
        <div role="tabpanel" id="vocabulary-my-words-panel" aria-labelledby="vocabulary-my-words-tab" tabIndex={0}>
          {/* Stats */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 animate-fade-in" style={{ animationDelay: '100ms' }}>
            {[
              { label: t.vocabulary.totalWords, value: stats.total, icon: BookMarked, color: 'text-teal-500', bg: 'bg-teal-500/10' },
              { label: t.vocabulary.newWords, value: stats.new, icon: Sparkles, color: 'text-blue-500', bg: 'bg-blue-500/10' },
              { label: t.vocabulary.learningWords, value: stats.learning, icon: BookOpen, color: 'text-amber-500', bg: 'bg-amber-500/10' },
              { label: t.vocabulary.knownWords, value: stats.known, icon: GraduationCap, color: 'text-green-500', bg: 'bg-green-500/10' },
            ].map((stat, i) => (
              <Card key={i} className="card-hover">
                <CardContent className="flex items-center gap-3 p-4">
                  <div className={cn('flex h-10 w-10 items-center justify-center rounded-xl', stat.bg)}>
                    <stat.icon className={cn('h-5 w-5', stat.color)} aria-hidden="true" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{stat.value}</p>
                    <p className="text-xs text-muted-foreground">{stat.label}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Progress */}
          {stats.total > 0 && (
            <Card className="animate-fade-in mt-4" style={{ animationDelay: '200ms' }}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">{t.vocabulary.knownWords}</span>
                  <span className="text-sm text-muted-foreground">{stats.known}/{stats.total}</span>
                </div>
                <Progress value={stats.known} max={stats.total || 1} variant="gradient" />
              </CardContent>
            </Card>
          )}

          {/* Add word form */}
          {showAddForm && (
            <Card className="animate-fade-in-up mt-4">
              <CardHeader className="pb-0">
                <CardTitle className="text-base">{t.vocabulary.addWord}</CardTitle>
              </CardHeader>
              <CardContent className="p-4 space-y-3">
                <form id="vocabulary-add-word-form" onSubmit={addWord} noValidate className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <label htmlFor="vocab-new-word" className="text-sm font-medium">{t.vocabulary.wordPlaceholder}</label>
                      <Input
                        id="vocab-new-word"
                        placeholder={t.vocabulary.wordPlaceholder}
                        value={newWord}
                        onChange={(e) => setNewWord(e.target.value)}
                        aria-invalid={!!formError && !newWord.trim()}
                        aria-describedby={formError && !newWord.trim() ? 'vocab-form-error' : undefined}
                        disabled={createCardMutation.isPending}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="vocab-new-meaning" className="text-sm font-medium">{t.vocabulary.meaningPlaceholder}</label>
                      <Input
                        id="vocab-new-meaning"
                        placeholder={t.vocabulary.meaningPlaceholder}
                        value={newMeaning}
                        onChange={(e) => setNewMeaning(e.target.value)}
                        aria-invalid={!!formError && !newMeaning.trim()}
                        aria-describedby={formError && !newMeaning.trim() ? 'vocab-form-error' : undefined}
                        disabled={createCardMutation.isPending}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="vocab-new-example" className="text-sm font-medium">{t.vocabulary.examplePlaceholder}</label>
                    <Input
                      id="vocab-new-example"
                      placeholder={t.vocabulary.examplePlaceholder}
                      value={newExample}
                      onChange={(e) => setNewExample(e.target.value)}
                      disabled={createCardMutation.isPending}
                    />
                  </div>
                  {formError && (
                    <p id="vocab-form-error" role="alert" className="text-sm text-destructive">{formError}</p>
                  )}
                  <div className="flex gap-2 justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => { setShowAddForm(false); setFormError(null); }}
                    >
                      {t.common.cancel}
                    </Button>
                    <Button type="submit" size="sm" disabled={createCardMutation.isPending} aria-busy={createCardMutation.isPending}>
                      {createCardMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                      {t.vocabulary.addWord}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          {/* Search and filter */}
          <div className="flex gap-3 mt-4 animate-fade-in" style={{ animationDelay: '300ms' }}>
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                className="pl-9"
                type="search"
                aria-label={t.vocabulary.search}
                placeholder={t.vocabulary.search}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="flex gap-1.5" role="group" aria-label="Lọc từ vựng">
              {(['all', 'new', 'learning', 'known'] as const).map((f) => (
                <Button
                  key={f}
                  type="button"
                  variant={filter === f ? 'default' : 'outline'}
                  size="sm"
                  aria-pressed={filter === f}
                  onClick={() => setFilter(f)}
                >
                  {f === 'all' ? t.vocabulary.all : t.vocabulary[f]}
                </Button>
              ))}
            </div>
          </div>

          {/* Word list: status, loading, error and empty are all exposed. */}
          {wordsLoading ? (
            <div role="status" aria-live="polite" className="flex flex-col items-center justify-center gap-2 py-16 animate-fade-in">
              <Loader2 className="h-8 w-8 animate-spin text-teal-500" aria-hidden="true" />
              <span className="text-sm text-muted-foreground">Đang tải từ vựng của bạn…</span>
            </div>
          ) : wordsError ? (
            <Card role="alert" className="border-destructive animate-fade-in mt-4">
              <CardContent className="flex flex-col items-center gap-4 py-12">
                <p className="font-medium">Không thể tải danh sách từ vựng.</p>
                <p className="text-sm text-muted-foreground">{errorMessage(wordsError, 'Vui lòng thử lại.')}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => { void decksQuery.refetch(); void cardsQuery.refetch(); }}
                >
                  Thử lại
                </Button>
              </CardContent>
            </Card>
          ) : filteredWords.length === 0 ? (
            <Card className="border-dashed animate-fade-in mt-4">
              <CardContent className="flex flex-col items-center gap-4 py-16">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-teal-500/10">
                  <BookMarked className="h-8 w-8 text-teal-400" aria-hidden="true" />
                </div>
                <div className="text-center">
                  <p className="font-medium">
                    {words.length === 0 ? t.vocabulary.noWords : 'Không có từ nào khớp bộ lọc.'}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {words.length === 0 ? t.vocabulary.noWordsDesc : 'Hãy thay đổi từ khóa hoặc bộ lọc.'}
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2 mt-4">
              {filteredWords.map((word, i) => (
                <Card key={word.id} className="card-hover animate-fade-in-up" style={{ animationDelay: `${i * 40}ms` }}>
                  <CardContent className="flex items-center justify-between p-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{word.word}</span>
                        <Badge className={statusColors[word.status]}>{t.vocabulary[word.status]}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground mt-0.5">{word.meaning}</p>
                      {word.example && <p className="text-xs text-muted-foreground/70 mt-1 italic">{word.example}</p>}
                    </div>
                    <div className="flex gap-1.5 ml-4">
                      {word.status !== 'learning' && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={isMutating}
                          aria-busy={reviewForCard.current === word.id && reviewMutation.isPending}
                          onClick={() => updateStatus(word.id, 'learning')}
                        >
                          {t.vocabulary.markLearning}
                        </Button>
                      )}
                      {word.status !== 'known' && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={isMutating}
                          aria-busy={reviewForCard.current === word.id && reviewMutation.isPending}
                          onClick={() => updateStatus(word.id, 'known')}
                        >
                          {t.vocabulary.markKnown}
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════ PACKS TAB ═══════════════════════════ */}
      {activeTab === 'packs' && !selectedPack && (
        <div role="tabpanel" id="vocabulary-packs-panel" aria-labelledby="vocabulary-packs-tab" tabIndex={0} className="space-y-4 animate-fade-in">
          <p className="text-sm text-muted-foreground">Chọn một gói để xem danh sách từ vựng và thêm vào bộ sưu tập của bạn.</p>
          {packsLoading ? (
            <div role="status" aria-live="polite" className="flex flex-col items-center justify-center gap-2 py-16">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
              <span className="text-sm text-muted-foreground">Đang tải gói từ vựng…</span>
            </div>
          ) : packsQuery.error ? (
            <Card role="alert" className="border-destructive">
              <CardContent className="flex flex-col items-center gap-4 py-12">
                <p className="font-medium">Không thể tải gói từ vựng.</p>
                <p className="text-sm text-muted-foreground">{errorMessage(packsQuery.error, 'Vui lòng thử lại.')}</p>
                <Button type="button" variant="outline" size="sm" onClick={() => void packsQuery.refetch()}>
                  Thử lại
                </Button>
              </CardContent>
            </Card>
          ) : vocabularyPacks.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                Không có gói từ vựng nào để hiển thị.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {vocabularyPacks.map((pack, i) => (
                <Card
                  key={pack.id}
                  className="card-hover overflow-hidden animate-fade-in-up"
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  <div className={cn('h-2 w-full bg-linear-to-r', pack.color)} aria-hidden="true" />
                  <CardContent className="p-5">
                    <button
                      type="button"
                      onClick={() => openPack(pack)}
                      className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-lg"
                      aria-label={`Xem gói ${pack.titleVi} (${pack.words.length} từ)`}
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <Badge variant="outline" className="mb-2 text-xs font-bold">{pack.level}</Badge>
                          <h3 className="font-bold text-base">{pack.titleVi}</h3>
                          <p className="text-xs text-muted-foreground mt-0.5">{pack.title}</p>
                        </div>
                        <div className={cn('flex h-10 w-10 items-center justify-center rounded-xl bg-linear-to-br text-white text-sm font-bold', pack.color)}>
                          {pack.words.length}
                        </div>
                      </div>
                      <p className="text-sm text-muted-foreground">{pack.description}</p>
                    </button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ════════════ PACK WORD LIST ════════════ */}
      {activeTab === 'packs' && selectedPack && (
        <div role="tabpanel" id="vocabulary-packs-panel" aria-labelledby="vocabulary-packs-tab" tabIndex={0} className="space-y-4 animate-fade-in">
          {/* Back button + title */}
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={closePack}>
              <span ref={backRef as React.RefObject<HTMLSpanElement>} tabIndex={-1}>
                <ChevronLeft className="h-4 w-4 mr-1" aria-hidden="true" /> Quay lại
              </span>
            </Button>
            <div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="font-bold">{selectedPack.level}</Badge>
                <h2 ref={packHeadlineRef} tabIndex={-1} className="font-bold text-lg focus-visible:outline-none">
                  {selectedPack.titleVi}
                </h2>
              </div>
              <p className="text-sm text-muted-foreground">{selectedPack.words.length} từ</p>
            </div>
          </div>

          <div className="space-y-2">
            {selectedPack.words.map((w, i) => {
              const added = words.some((x) => x.word.toLowerCase() === w.word.toLowerCase());
              return (
                <Card key={w.id} className="card-hover animate-fade-in-up" style={{ animationDelay: `${i * 30}ms` }}>
                  <CardContent className="flex items-center justify-between p-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold">{w.word}</span>
                        <span className="text-xs text-muted-foreground font-mono">{w.ipa}</span>
                        <Badge variant="secondary" className="text-xs capitalize">{w.pos}</Badge>
                        <Badge variant="outline" className="text-xs">{w.topic}</Badge>
                      </div>
                      <p className="text-sm mt-0.5"><span className="text-foreground">{w.en}</span> <span className="text-muted-foreground">·</span> <span className="text-muted-foreground">{w.vi}</span></p>
                      <p className="text-xs text-muted-foreground/70 mt-0.5 italic">{w.example}</p>
                    </div>
                    <Button
                      type="button"
                      variant={added ? 'outline' : 'default'}
                      size="sm"
                      className="ml-4 shrink-0"
                      onClick={() => void addFromPack(w)}
                      disabled={added || isMutating || wordsLoading}
                      aria-busy={createCardMutation.isPending && !added}
                    >
                      {added ? (
                        <><Check className="h-3 w-3 mr-1 text-green-500" aria-hidden="true" /> Đã thêm</>
                      ) : (
                        <><Plus className="h-3 w-3 mr-1" aria-hidden="true" /> Thêm</>
                      )}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
