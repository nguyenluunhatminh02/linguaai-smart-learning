'use client';

import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { BookMarked, Plus, Search, X, BookOpen, GraduationCap, Sparkles, Layers, ChevronLeft, Check, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiClient } from '@/lib/api-client';
import { toast } from 'sonner';

interface ZhVocabWord {
  id: number;
  word: string;
  pinyin: string;
  pos: string;
  en: string;
  vi: string;
  example: string;
  topic: string;
}

interface ZhVocabPack {
  id: string;
  level: string;
  title: string;
  titleVi: string;
  description: string;
  color: string;
  words: ZhVocabWord[];
}

function cmsToZhVocabPack(lesson: Record<string, unknown>): ZhVocabPack {
  const c = (lesson.content ?? {}) as Record<string, unknown>;
  return {
    id: (lesson.slug as string) || (lesson.id as string),
    level: lesson.level as string,
    title: lesson.title as string,
    titleVi: ((lesson.titleVi ?? lesson.title_vi) as string) ?? '',
    description: (lesson.description as string) ?? '',
    color: (c.color as string) ?? '',
    words: (c.words as ZhVocabWord[]) ?? [],
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

export default function ChineseVocabularyPage() {
  const [activeTab, setActiveTab] = useState<'my-words' | 'packs'>('my-words');
  const [zhVocabPacks, setZhVocabPacks] = useState<ZhVocabPack[]>([]);
  const [packsLoading, setPacksLoading] = useState(false);
  const [words, setWords] = useState<Word[]>([]);
  const [deckId, setDeckId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [filter, setFilter] = useState<'all' | 'new' | 'learning' | 'known'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newWord, setNewWord] = useState('');
  const [newMeaning, setNewMeaning] = useState('');
  const [newExample, setNewExample] = useState('');
  const [selectedPack, setSelectedPack] = useState<ZhVocabPack | null>(null);

  const loadVocabDeckAndCards = async () => {
    setLoading(true);
    try {
      const decksRes = await apiClient.get('/decks/my');
      const decks = Array.isArray(decksRes.data) ? decksRes.data : [];
      
      const vocabDeck = decks.find(
        (d: any) =>
          d.language === 'chinese' ||
          d.title === 'Từ vựng tiếng Trung của tôi' ||
          d.title === 'Từ vựng tiếng Trung' ||
          d.title === 'My Chinese Vocabulary'
      );

      if (vocabDeck) {
        setDeckId(vocabDeck.id);
        const cardsRes = await apiClient.get(`/decks/${vocabDeck.id}/cards`);
        const cardsData = Array.isArray(cardsRes.data) ? cardsRes.data : [];
        
        const mappedWords: Word[] = cardsData.map((c: any) => {
          let status: Word['status'] = 'new';
          if (c.progress) {
            const count = c.progress.repetitionCount ?? 0;
            if (count > 0 && count < 3) {
              status = 'learning';
            } else if (count >= 3) {
              status = 'known';
            }
          }
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
      console.error('Failed to load Chinese vocabulary deck:', err);
      toast.error('Không thể tải danh sách từ vựng tiếng Trung của bạn.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'my-words') {
      loadVocabDeckAndCards();
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'packs' || zhVocabPacks.length > 0) return;
    setPacksLoading(true);
    fetch('/api/cms/lessons?type=vocabulary&language=chinese&published=true&limit=200')
      .then(r => r.json())
      .then(json => {
        const items: Record<string, unknown>[] = json.data ?? json ?? [];
        setZhVocabPacks(items.map(cmsToZhVocabPack));
      })
      .catch(() => {})
      .finally(() => setPacksLoading(false));
  }, [activeTab, zhVocabPacks.length]);

  const getOrCreateDeckId = async (): Promise<string> => {
    if (deckId) return deckId;
    
    const res = await apiClient.post('/decks', {
      title: 'Từ vựng tiếng Trung của tôi',
      description: 'Danh sách từ vựng tiếng Trung cá nhân của tôi',
      language: 'chinese',
      isPublic: false,
    });
    
    const newDeckId = res.data.id;
    setDeckId(newDeckId);
    return newDeckId;
  };

  const addFromPack = async (w: ZhVocabWord, pack: ZhVocabPack) => {
    if (words.some(x => x.word.toLowerCase() === w.word.toLowerCase())) return;
    try {
      const activeDeckId = await getOrCreateDeckId();
      
      const newCardRes = await apiClient.post(`/decks/${activeDeckId}/cards`, {
        frontText: w.word,
        backText: `${w.en} / ${w.vi}`,
        exampleSentence: w.example || undefined,
        ipaPronunciation: w.pinyin || undefined,
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

  // Stats
  const knownCount = words.filter(w => w.status === 'known').length;
  const learningCount = words.filter(w => w.status === 'learning').length;
  const newCount = words.filter(w => w.status === 'new').length;
  const filteredWords = words.filter(w => {
    if (filter !== 'all' && w.status !== filter) return false;
    if (searchQuery && !w.word.toLowerCase().includes(searchQuery.toLowerCase()) && !w.meaning.toLowerCase().includes(searchQuery.toLowerCase())) return false;
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
      
      setWords(prev => prev.map(w => w.id === id ? { ...w, status } : w));
      toast.success(status === 'learning' ? 'Đã đánh dấu đang học.' : 'Đã đánh dấu đã thuộc.');
    } catch (err) {
      console.error('Failed to update status:', err);
      toast.error('Không thể cập nhật trạng thái ôn tập.');
    }
  };

  const statusColors = { new: 'bg-blue-500', learning: 'bg-amber-500', known: 'bg-emerald-500' };

  // ─── Pack detail ───
  if (selectedPack) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={() => setSelectedPack(null)} className="gap-1">
          <ChevronLeft className="h-4 w-4" /> Quay lại
        </Button>
        <div>
          <h2 className="text-xl font-bold">{selectedPack.title}</h2>
          <p className="text-sm text-muted-foreground">{selectedPack.titleVi} — {selectedPack.description}</p>
          <Badge className="mt-2" variant="secondary">{selectedPack.level}</Badge>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {selectedPack.words.map((w) => {
            const added = words.some(x => x.word.toLowerCase() === w.word.toLowerCase());
            return (
              <Card key={w.id} className="overflow-hidden">
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-bold text-base">{w.word}</p>
                      <p className="text-xs text-primary/80 font-mono">{w.pinyin}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">{w.pos}</Badge>
                      <Button
                        size="sm"
                        variant={added ? 'ghost' : 'outline'}
                        className="h-7 w-7 p-0"
                        onClick={() => addFromPack(w, selectedPack)}
                        disabled={added}
                      >
                        {added ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Plus className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm"><span className="text-muted-foreground">EN:</span> {w.en}</p>
                    <p className="text-sm"><span className="text-muted-foreground">VI:</span> {w.vi}</p>
                  </div>
                  {w.topic && <Badge variant="secondary" className="text-[10px]">{w.topic}</Badge>}
                  <p className="text-xs text-muted-foreground italic">{w.example}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/10">
          <BookMarked className="h-5 w-5 text-rose-500" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Từ vựng tiếng Trung</h1>
          <p className="text-sm text-muted-foreground">中文词汇 — Quản lý từ vựng HSK1–HSK6</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        <Button variant={activeTab === 'my-words' ? 'default' : 'outline'} size="sm" onClick={() => setActiveTab('my-words')} className="gap-1.5">
          <BookOpen className="h-4 w-4" /> Từ của tôi <Badge variant="secondary" className="ml-1 text-[10px]">{words.length}</Badge>
        </Button>
        <Button variant={activeTab === 'packs' ? 'default' : 'outline'} size="sm" onClick={() => setActiveTab('packs')} className="gap-1.5">
          <Layers className="h-4 w-4" /> Gói từ vựng <Badge variant="secondary" className="ml-1 text-[10px]">{zhVocabPacks.length}</Badge>
        </Button>
      </div>

      {/* ─── My Words Tab ─── */}
      {activeTab === 'my-words' && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: 'Tổng', value: words.length, icon: BookMarked, color: 'text-primary' },
              { label: 'Mới', value: newCount, icon: Sparkles, color: 'text-blue-500' },
              { label: 'Đang học', value: learningCount, icon: GraduationCap, color: 'text-amber-500' },
              { label: 'Đã thuộc', value: knownCount, icon: Check, color: 'text-emerald-500' },
            ].map((s) => (
              <Card key={s.label}>
                <CardContent className="flex items-center gap-3 p-4">
                  <s.icon className={cn('h-5 w-5', s.color)} />
                  <div>
                    <p className="text-2xl font-bold">{s.value}</p>
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {words.length > 0 && (
            <Progress value={words.length > 0 ? (knownCount / words.length) * 100 : 0} variant="gradient" />
          )}

          {/* Add word */}
          {showAddForm ? (
            <Card>
              <CardContent className="space-y-3 p-4">
                <Input placeholder="Từ tiếng Trung (例: 你好)" value={newWord} onChange={(e) => setNewWord(e.target.value)} />
                <Input placeholder="Nghĩa (hello / xin chào)" value={newMeaning} onChange={(e) => setNewMeaning(e.target.value)} />
                <Input placeholder="Ví dụ (tùy chọn)" value={newExample} onChange={(e) => setNewExample(e.target.value)} />
                <div className="flex gap-2">
                  <Button size="sm" onClick={addWord} disabled={!newWord.trim() || !newMeaning.trim()}>Thêm</Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowAddForm(false)}>Hủy</Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Button variant="outline" className="gap-1.5" onClick={() => setShowAddForm(true)}>
              <Plus className="h-4 w-4" /> Thêm từ mới
            </Button>
          )}

          {/* Search & filter */}
          {words.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-50">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-9" placeholder="Tìm từ..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
              </div>
              {(['all', 'new', 'learning', 'known'] as const).map((f) => (
                <Button key={f} variant={filter === f ? 'default' : 'outline'} size="sm" onClick={() => setFilter(f)}>
                  {f === 'all' ? 'Tất cả' : f === 'new' ? 'Mới' : f === 'learning' ? 'Đang học' : 'Đã thuộc'}
                </Button>
              ))}
            </div>
          )}

          {/* Word list */}
          {loading ? (
            <div className="flex items-center justify-center py-12 animate-fade-in">
              <Loader2 className="h-8 w-8 animate-spin text-rose-500" />
            </div>
          ) : words.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
                <BookMarked className="h-10 w-10 text-muted-foreground/50" />
                <p className="font-medium">Chưa có từ nào</p>
                <p className="text-sm text-muted-foreground">Thêm từ hoặc chọn từ gói từ vựng HSK</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {filteredWords.map((w) => (
                <Card key={w.id}>
                  <CardContent className="flex items-center gap-3 p-3">
                    <div className={cn('h-2 w-2 rounded-full', statusColors[w.status])} />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{w.word}</p>
                      <p className="text-xs text-muted-foreground truncate">{w.meaning}</p>
                    </div>
                    <div className="flex gap-1">
                      {w.status !== 'learning' && (
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => updateStatus(w.id, 'learning')}>Đang học</Button>
                      )}
                      {w.status !== 'known' && (
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => updateStatus(w.id, 'known')}>Đã thuộc</Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {/* ─── Packs Tab ─── */}
      {activeTab === 'packs' && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {packsLoading && (
            <div className="col-span-full flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}
          {!packsLoading && zhVocabPacks.length === 0 && (
            <div className="col-span-full flex flex-col items-center justify-center py-12 text-center gap-3">
              <Layers className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-muted-foreground">Chưa có gói từ vựng nào</p>
            </div>
          )}
          {!packsLoading && zhVocabPacks.map((pack) => (
            <Card key={pack.id} className="overflow-hidden cursor-pointer transition-all hover:shadow-md hover:border-primary/30" onClick={() => setSelectedPack(pack)}>
              <div className={cn('h-2 w-full bg-linear-to-r', pack.color)} />
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <Badge variant="secondary">{pack.level}</Badge>
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{pack.words.length}</span>
                </div>
                <div>
                  <p className="font-semibold text-sm">{pack.title}</p>
                  <p className="text-xs text-muted-foreground">{pack.titleVi}</p>
                </div>
                <p className="text-xs text-muted-foreground">{pack.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
