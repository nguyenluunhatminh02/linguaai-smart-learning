'use client';

import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { BookMarked, Plus, Search, X, BookOpen, GraduationCap, Sparkles, Layers, ChevronLeft, Check, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { useLanguageStore } from '@/stores/language-store';
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

function cmsToVocabPack(lesson: Record<string, unknown>): VocabPack {
  const c = (lesson.content ?? {}) as Record<string, unknown>;
  return {
    id: (lesson.slug as string) || (lesson.id as string),
    level: lesson.level as string,
    title: lesson.title as string,
    titleVi: (lesson.titleVi ?? lesson.title_vi) as string,
    description: (lesson.description as string) ?? '',
    color: (c.color as string) ?? '',
    words: (c.words as VocabWord[]) ?? [],
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

function statusFromProgress(progress: unknown): Word['status'] {
  const count = (progress as { repetitionCount?: number } | null)?.repetitionCount ?? 0;
  if (count > 0 && count < 3) return 'learning';
  if (count >= 3) return 'known';
  return 'new';
}

export default function VocabularyPage() {
  const { t } = useLanguageStore();
  const [activeTab, setActiveTab] = useState<'my-words' | 'packs'>('my-words');
  const [words, setWords] = useState<Word[]>([]);
  const [deckId, setDeckId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [filter, setFilter] = useState<'all' | 'new' | 'learning' | 'known'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newWord, setNewWord] = useState('');
  const [newMeaning, setNewMeaning] = useState('');
  const [newExample, setNewExample] = useState('');
  // Packs state
  const [selectedPack, setSelectedPack] = useState<VocabPack | null>(null);

  const packsQuery = useQuery<VocabPack[]>({
    queryKey: ['vocabulary-packs'],
    queryFn: async () => {
      const response = await fetch('/api/cms/lessons?type=vocabulary&language=english&published=true&limit=200');
      if (!response.ok) throw new Error("Failed to fetch vocabulary packs");
      const json = await response.json();
      const items: Record<string, unknown>[] = json.data ?? json ?? [];
      return items.map(cmsToVocabPack);
    },
    enabled: activeTab === 'packs',
  });

  const vocabularyPacks = packsQuery.data ?? [];
  const packsLoading = packsQuery.isFetching;

  const loadVocabDeckAndCards = async () => {
    setLoading(true);
    try {
      const decksRes = await apiClient.get('/decks/my');
      const decks = Array.isArray(decksRes.data) ? decksRes.data : [];
      
      const vocabDeck = decks.find(
        (d: any) =>
          d.title === 'Từ vựng của tôi' ||
          d.title === 'My Vocabulary' ||
          d.name === 'Từ vựng của tôi' ||
          d.name === 'My Vocabulary'
      );

      if (vocabDeck) {
        setDeckId(vocabDeck.id);
        const cardsRes = await apiClient.get(`/decks/${vocabDeck.id}/cards`);
        const cardsData = Array.isArray(cardsRes.data) ? cardsRes.data : [];
        
        const mappedWords: Word[] = cardsData.map((c: any) => {
          const status = statusFromProgress(c.progress);
          return {
            id: c.id,
            word: c.frontText || c.frontText || c.front_text || c.front || '',
            meaning: c.backText || c.backText || c.back_text || c.back || '',
            example: c.exampleSentence || c.example_sentence || undefined,
            status,
            createdAt: c.createdAt || c.created_at || new Date().toISOString(),
          };
        });
        setWords(mappedWords);
      } else {
        setWords([]);
      }
    } catch (err) {
      console.error('Failed to load vocabulary deck:', err);
      toast.error('Không thể tải danh sách từ vựng của bạn.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'my-words') {
      loadVocabDeckAndCards();
    }
  }, [activeTab]);

  const getOrCreateDeckId = async (): Promise<string> => {
    if (deckId) return deckId;
    
    const res = await apiClient.post('/decks', {
      title: 'Từ vựng của tôi',
      description: 'Danh sách từ vựng cá nhân của tôi',
      isPublic: false,
    });
    
    const newDeckId = res.data.id;
    setDeckId(newDeckId);
    return newDeckId;
  };

  const addFromPack = async (w: VocabWord, pack: VocabPack) => {
    if (words.some(x => x.word.toLowerCase() === w.word.toLowerCase())) return;
    try {
      const activeDeckId = await getOrCreateDeckId();
      
      const newCardRes = await apiClient.post(`/decks/${activeDeckId}/cards`, {
        frontText: w.word,
        backText: `${w.en} / ${w.vi}`,
        exampleSentence: w.example || undefined,
        ipaPronunciation: w.ipa || undefined,
      });

      const newCard = newCardRes.data;
      
      const word: Word = {
        id: newCard.id,
        word: newCard.front_text || newCard.front || w.word,
        meaning: newCard.back_text || newCard.back || `${w.en} / ${w.vi}`,
        example: newCard.example_sentence || undefined,
        status: 'new',
        createdAt: newCard.created_at || new Date().toISOString(),
      };
      
      setWords(prev => [word, ...prev]);
      toast.success(`Đã thêm từ "${w.word}" vào bộ sưu tập.`);
    } catch (err) {
      console.error('Failed to add word from pack:', err);
      toast.error('Không thể thêm từ vựng từ gói.');
    }
  };

  const stats = {
    total: words.length,
    known: words.filter(w => w.status === 'known').length,
    learning: words.filter(w => w.status === 'learning').length,
    new: words.filter(w => w.status === 'new').length,
  };

  const filteredWords = words.filter(w => {
    if (filter !== 'all' && w.status !== filter) return false;
    if (searchQuery && !w.word.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const addWord = async () => {
    if (!newWord.trim() || !newMeaning.trim()) return;
    try {
      const activeDeckId = await getOrCreateDeckId();
      
      const newCardRes = await apiClient.post(`/decks/${activeDeckId}/cards`, {
        frontText: newWord.trim(),
        backText: newMeaning.trim(),
        exampleSentence: newExample.trim() || undefined,
      });

      const newCard = newCardRes.data;
      
      const word: Word = {
        id: newCard.id,
        word: newCard.front_text || newCard.front || newWord.trim(),
        meaning: newCard.back_text || newCard.back || newMeaning.trim(),
        example: newCard.example_sentence || undefined,
        status: 'new',
        createdAt: newCard.created_at || new Date().toISOString(),
      };
      
      setWords(prev => [word, ...prev]);
      setNewWord('');
      setNewMeaning('');
      setNewExample('');
      setShowAddForm(false);
      toast.success('Đã thêm từ vựng mới thành công!');
    } catch (err) {
      console.error('Failed to add word:', err);
      toast.error('Không thể thêm từ vựng.');
    }
  };

  const updateStatus = async (id: string, status: Word['status']) => {
    try {
      const grade = status === 'learning' ? 2 : 4; // 2 = Hard, 4 = Easy
      await apiClient.post('/srs/review', {
        cardId: id,
        grade,
        operationId: crypto.randomUUID(),
      });
      
      // A review only schedules the next interval; it does not set the mastery
      // label directly. Re-read progress so the displayed status matches what
      // the server persisted (and survives a page reload).
      let nextStatus: Word['status'] = 'new';
      try {
        if (!deckId) throw new Error('Vocabulary deck is not loaded');
        const cardsRes = await apiClient.get(`/decks/${deckId}/cards`);
        const cardsData = Array.isArray(cardsRes.data) ? cardsRes.data : [];
        const updated = cardsData.find((c: any) => c.id === id);
        if (updated) nextStatus = statusFromProgress(updated.progress);
        setWords(prev => prev.map(w => w.id === id ? { ...w, status: nextStatus } : w));
      } catch (refreshErr) {
        // The review succeeded; fall back to a full reload rather than showing
        // a status that the server will not reproduce after a page reload.
        console.error('Failed to refresh card progress:', refreshErr);
        await loadVocabDeckAndCards();
        return;
      }

      if (status === 'known' && nextStatus !== 'known') {
        toast.info('Từ đã được ôn tập; trạng thái "Đã thuộc" sẽ đạt sau khi ôn tập đủ 3 lần.');
      } else {
        toast.success(status === 'learning' ? 'Đã đánh dấu đang học.' : 'Đã đánh dấu đã thuộc.');
      }
    } catch (err) {
      console.error('Failed to update status:', err);
      toast.error('Không thể cập nhật trạng thái ôn tập.');
    }
  };

  const statusColors = {
    new: 'bg-blue-500/10 text-blue-600',
    learning: 'bg-amber-500/10 text-amber-600',
    known: 'bg-green-500/10 text-green-600',
  };

  return (
    <div className="space-y-6">
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
          <Button variant="gradient" onClick={() => setShowAddForm(!showAddForm)}>
            <Plus className="mr-2 h-4 w-4" /> {t.vocabulary.addWord}
          </Button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl bg-muted p-1 w-fit animate-fade-in" style={{ animationDelay: '50ms' }}>
        {[
          { key: 'my-words', label: t.vocabulary.title, icon: BookMarked },
          { key: 'packs', label: 'Gói từ vựng', icon: Layers },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => { setActiveTab(tab.key as typeof activeTab); setSelectedPack(null); }}
            className={cn(
              'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all',
              activeTab === tab.key
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* ═══════════════════════════ MY WORDS TAB ═══════════════════════════ */}
      {activeTab === 'my-words' && (
        <>
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
                    <stat.icon className={cn('h-5 w-5', stat.color)} />
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
            <Card className="animate-fade-in" style={{ animationDelay: '200ms' }}>
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
            <Card className="animate-fade-in-up">
              <CardContent className="p-4 space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input placeholder={t.vocabulary.wordPlaceholder} value={newWord} onChange={(e) => setNewWord(e.target.value)} />
                  <Input placeholder={t.vocabulary.meaningPlaceholder} value={newMeaning} onChange={(e) => setNewMeaning(e.target.value)} />
                </div>
                <Input placeholder={t.vocabulary.examplePlaceholder} value={newExample} onChange={(e) => setNewExample(e.target.value)} />
                <div className="flex gap-2 justify-end">
                  <Button variant="outline" size="sm" onClick={() => setShowAddForm(false)}>{t.common.cancel}</Button>
                  <Button size="sm" onClick={addWord}>{t.vocabulary.addWord}</Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Search and filter */}
          <div className="flex gap-3 animate-fade-in" style={{ animationDelay: '300ms' }}>
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder={t.vocabulary.search}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="flex gap-1.5">
              {(['all', 'new', 'learning', 'known'] as const).map((f) => (
                <Button
                  key={f}
                  variant={filter === f ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setFilter(f)}
                >
                  {f === 'all' ? t.vocabulary.all : t.vocabulary[f]}
                </Button>
              ))}
            </div>
          </div>

          {/* Word list */}
          {loading ? (
            <div className="flex items-center justify-center py-16 animate-fade-in">
              <Loader2 className="h-8 w-8 animate-spin text-teal-500" />
            </div>
          ) : filteredWords.length === 0 ? (
            <Card className="border-dashed animate-fade-in">
              <CardContent className="flex flex-col items-center gap-4 py-16">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-teal-500/10">
                  <BookMarked className="h-8 w-8 text-teal-400" />
                </div>
                <div className="text-center">
                  <p className="font-medium">{t.vocabulary.noWords}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{t.vocabulary.noWordsDesc}</p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
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
                        <Button variant="ghost" size="sm" onClick={() => updateStatus(word.id, 'learning')}>
                          {t.vocabulary.markLearning}
                        </Button>
                      )}
                      {word.status !== 'known' && (
                        <Button variant="ghost" size="sm" onClick={() => updateStatus(word.id, 'known')}>
                          {t.vocabulary.markKnown}
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {/* ═══════════════════════════ PACKS TAB ═══════════════════════════ */}
      {activeTab === 'packs' && !selectedPack && (
        <div className="space-y-4 animate-fade-in">
          <p className="text-sm text-muted-foreground">Chọn một gói để xem danh sách từ vựng và thêm vào bộ sưu tập của bạn.</p>
          {packsLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {vocabularyPacks.map((pack, i) => (
              <Card
                key={pack.id}
                className="card-hover cursor-pointer overflow-hidden animate-fade-in-up"
                style={{ animationDelay: `${i * 60}ms` }}
                onClick={() => setSelectedPack(pack)}
              >
                <div className={cn('h-2 w-full bg-linear-to-r', pack.color)} />
                <CardContent className="p-5">
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
                </CardContent>
              </Card>
            ))}
          </div>
          )}
        </div>
      )}

      {/* ════════════ PACK WORD LIST ════════════ */}
      {activeTab === 'packs' && selectedPack && (
        <div className="space-y-4 animate-fade-in">
          {/* Back button + title */}
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => setSelectedPack(null)}>
              <ChevronLeft className="h-4 w-4 mr-1" /> Quay lại
            </Button>
            <div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="font-bold">{selectedPack.level}</Badge>
                <h2 className="font-bold text-lg">{selectedPack.titleVi}</h2>
              </div>
              <p className="text-sm text-muted-foreground">{selectedPack.words.length} từ</p>
            </div>
          </div>

          <div className="space-y-2">
            {selectedPack.words.map((w, i) => {
              const added = words.some(x => x.word.toLowerCase() === w.word.toLowerCase());
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
                      variant={added ? 'outline' : 'default'}
                      size="sm"
                      className="ml-4 shrink-0"
                      onClick={() => addFromPack(w, selectedPack)}
                      disabled={added}
                    >
                      {added ? (
                        <><Check className="h-3 w-3 mr-1 text-green-500" /> Đã thêm</>
                      ) : (
                        <><Plus className="h-3 w-3 mr-1" /> Thêm</>
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
