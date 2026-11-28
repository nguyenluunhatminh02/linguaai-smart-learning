'use client';

/**
 * Listening dashboard page (roadmap FE-28).
 *
 * UI composition, library filtering and player rendering live here. All paid
 * generation calls go through the backend adapter below: the browser owns an
 * idempotency key for the lifetime of a submission, submits it once, then
 * polls a durable operation until a terminal status is observed. Provider
 * keys, token reservation/refund and lesson ownership stay server-side.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Headphones, CheckCircle, XCircle, ArrowLeft, FileText,
  Clock, GraduationCap, Eye, EyeOff, Loader2,
  Play, Pause, SkipBack, SkipForward, Volume2, VolumeX,
  RefreshCw, Youtube, Plus, Upload, FileAudio, AlertCircle, X,
  Sparkles
} from 'lucide-react';
import { useLanguageStore } from '@/stores/language-store';
import { VocabCard } from '@/components/reading/vocab-card';
import { useLearningLanguageStore } from '@/stores/learning-language-store';
import { getAccessToken } from '@/stores/auth-store';
import { toast } from 'sonner';
import Link from 'next/link';
import { normalizeLessonQuestions, type LessonQuestion } from '@/lib/lesson-questions';
import { useSkillCompletion, type SkillCompletion } from '@/hooks/use-skill-completion';
import { SkillSaveStatus } from '@/components/learning/skill-save-status';
import { useActivityDuration } from '@/hooks/use-activity-duration';

interface ListeningVocab {
  word: string;
  definition: string;
  definitionVi: string;
}

interface ListeningLesson {
  id: string;
  activityId: string;
  language: string;
  title: string;
  titleVi: string;
  level: string;
  category: string;
  duration: string;
  transcript: string;
  vocabulary: ListeningVocab[];
  questions: LessonQuestion[];
  invalidQuestionCount: number;
  audioUrl?: string;
  isUserUploaded?: boolean;
  userId?: string;
}

const listeningCategories = [
  { id: 'conversation', label: 'Conversations' },
  { id: 'announcement', label: 'Announcements' },
  { id: 'lecture', label: 'Lectures' },
  { id: 'interview', label: 'Interviews' },
  { id: 'news', label: 'News' },
];

function cmsToListeningLesson(lesson: Record<string, unknown>): ListeningLesson {
  const c = (lesson.content ?? {}) as Record<string, unknown>;
  return {
    id: (lesson.slug as string) || (lesson.id as string),
    activityId: (lesson.id as string) || (lesson.slug as string),
    language: (lesson.language as string) || 'english',
    title: lesson.title as string,
    titleVi: ((lesson.titleVi ?? lesson.title_vi) as string) ?? '',
    level: lesson.level as string,
    category: (lesson.category as string) ?? '',
    duration: (c.duration as string) ?? '',
    transcript: (c.transcript as string) ?? '',
    vocabulary: (c.vocabulary as ListeningVocab[]) ?? [],
    ...normalizeLessonQuestions(c.questions),
    audioUrl: (c.audioUrl as string) ?? undefined,
    isUserUploaded: (lesson.isUserUploaded as boolean) ?? undefined,
    userId: (lesson.userId as string) ?? undefined,
  };
}

function getLangCode(language: string): string {
  switch (language) {
    case 'japanese': return 'ja-JP';
    case 'chinese': return 'zh-CN';
    case 'korean': return 'ko-KR';
    case 'french': return 'fr-FR';
    case 'spanish': return 'es-ES';
    case 'vietnamese': return 'vi-VN';
    default: return 'en-US';
  }
}

// ─── Backend adapter & operation status ────────────────────────────────────
type OperationStatus = 'PENDING' | 'RESERVED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'UNKNOWN';

interface ListeningOperation {
  operationId: string;
  status: OperationStatus;
  errorCode?: string | null;
  reservedCredits?: number | null;
  chargedCredits?: number | null;
  refunded?: boolean;
  data?: Record<string, unknown> | null;
}

/** Client-owned key: kept across retries so the server charges once. */
function createOperationKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `listening-generate-${crypto.randomUUID()}`;
  }
  return `listening-generate-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const TERMINAL_STATUSES: ReadonlySet<OperationStatus> = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED', 'UNKNOWN']);
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
const MAX_STATUS_POLLS = 60;
const POLL_INTERVAL_MS = 1_000;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function unwrapData(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  return record && 'data' in record ? (asRecord(record.data) ?? record) : record;
}

function parseOperation(value: unknown): ListeningOperation | null {
  const record = unwrapData(value);
  if (!record) return null;
  const id = record.operationId ?? record.operation_id;
  const rawStatus = record.status;
  if (typeof id !== 'string' || !id.trim() || typeof rawStatus !== 'string') return null;
  const status = rawStatus.toUpperCase() as OperationStatus;
  if (!['PENDING', 'RESERVED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'UNKNOWN'].includes(status)) {
    return null;
  }
  const numberOrNull = (input: unknown): number | null =>
    typeof input === 'number' && Number.isFinite(input) ? input : null;
  const reserved = numberOrNull(record.reservedCredits ?? record.reserved_credits);
  const charged = numberOrNull(record.chargedCredits ?? record.charged_credits);
  return {
    operationId: id,
    status,
    ...(typeof record.errorCode === 'string' ? { errorCode: record.errorCode } : {}),
    ...(reserved !== null ? { reservedCredits: reserved } : {}),
    ...(charged !== null ? { chargedCredits: charged } : {}),
    ...(record.refunded === true ? { refunded: true } : {}),
    ...(asRecord(record.data) ? { data: asRecord(record.data) } : {}),
  };
}

function operationErrorMessage(status: number, payload: unknown): string {
  const record = asRecord(payload);
  const code = typeof record?.code === 'string' ? record.code : '';
  if (code === 'INSUFFICIENT_CREDITS' || status === 402) {
    return 'Không đủ credits để tạo bài nghe.';
  }
  if (status === 401 || status === 403) return 'Vui lòng đăng nhập để tiếp tục.';
  if (status === 409 || code === 'OPERATION_CONFLICT') {
    return 'Yêu cầu này đã được gửi. Vui lòng đợi kết quả.';
  }
  if (status === 429) return 'Quá nhiều yêu cầu. Vui lòng thử lại sau.';
  if (status === 502 || status === 503 || status === 504) {
    return 'Dịch vụ tạo bài nghe đang tạm thời gián đoạn.';
  }
  return 'Tạo bài học thất bại. Vui lòng thử lại.';
}

async function submitListeningGeneration(
  body: Record<string, unknown>,
  file: File | null,
  operationKey: string,
  signal: AbortSignal,
): Promise<ListeningOperation> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${getAccessToken() ?? ''}`,
    'Idempotency-Key': operationKey,
    'X-Client-Operation-Id': operationKey,
  };
  let response: Response;
  try {
    if (file) {
      const formData = new FormData();
      formData.append('file', file);
      Object.entries(body).forEach(([key, value]) => formData.append(key, String(value)));
      response = await fetch('/api/listening/generate', {
        method: 'POST', headers, body: formData, signal, cache: 'no-store',
      });
    } else {
      response = await fetch('/api/listening/generate', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
        cache: 'no-store',
      });
    }
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error('Không thể kết nối tới dịch vụ tạo bài nghe.');
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(operationErrorMessage(response.status, payload));
    const operation = parseOperation(payload);
    if (operation) Object.assign(error, { operationId: operation.operationId });
    throw error;
  }
  const operation = parseOperation(payload);
  if (!operation) throw new Error('Phản hồi tạo bài học không hợp lệ.');
  return operation;
}

/**
 * Best-effort reconciliation from committed server state. It never starts a
 * provider call or charges credits; an unavailable endpoint leaves the job
 * non-terminal rather than pretending it succeeded.
 */
async function fetchOperationStatus(
  operationId: string,
  signal: AbortSignal,
): Promise<ListeningOperation | null> {
  const paths = [
    `/listening/operations/${encodeURIComponent(operationId)}`,
    `/chat/operations/${encodeURIComponent(operationId)}`,
    `/ai-operations/${encodeURIComponent(operationId)}`,
  ];
  for (const path of paths) {
    try {
      const response = await fetch(`${API_BASE}${path}`, {
        headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
        signal,
        cache: 'no-store',
      });
      if (!response.ok) continue;
      const operation = parseOperation(await response.json().catch(() => null));
      if (operation) return operation;
    } catch {
      // Endpoint unavailable or aborted: try the next known status path.
    }
  }
  return null;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
    const onAbort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

// ─── TTS Audio Player Component ────────────────────────────────────────────
function TTSPlayer({ transcript, language, title }: { transcript: string; language: string; title: string }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [rate, setRate] = useState(0.85);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [progress, setProgress] = useState(0);
  const [supported, setSupported] = useState(true);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const charsSpokenRef = useRef(0);
  const totalCharsRef = useRef(transcript.length);
  const langCode = getLangCode(language);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      setSupported(false);
      return;
    }
    const loadVoices = () => {
      const v = window.speechSynthesis.getVoices();
      setVoices(v);
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    return () => {
      window.speechSynthesis.cancel();
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  useEffect(() => {
    stop();
    totalCharsRef.current = transcript.length;
    charsSpokenRef.current = 0;
    setProgress(0);
  }, [transcript]);

  const stop = useCallback(() => {
    if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
    setIsPlaying(false);
    setIsPaused(false);
    charsSpokenRef.current = 0;
    setProgress(0);
    if (intervalRef.current) clearInterval(intervalRef.current);
  }, []);

  const getBestVoice = useCallback(() => {
    const matching = voices.filter(v => v.lang.startsWith(langCode.split('-')[0]));
    return matching.find(v => v.name.includes('Google')) || matching[0] || null;
  }, [voices, langCode]);

  const play = useCallback(() => {
    if (!window.speechSynthesis) return;
    if (isPaused) {
      window.speechSynthesis.resume();
      setIsPlaying(true);
      setIsPaused(false);
      return;
    }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(transcript);
    u.lang = langCode;
    u.rate = rate;
    u.volume = muted ? 0 : volume;
    const voice = getBestVoice();
    if (voice) u.voice = voice;

    u.onstart = () => {
      setIsPlaying(true);
      setIsPaused(false);
      charsSpokenRef.current = 0;
    };
    u.onboundary = (e) => {
      if (e.name === 'word') {
        charsSpokenRef.current = e.charIndex;
        setProgress(Math.min(100, (e.charIndex / totalCharsRef.current) * 100));
      }
    };
    u.onend = () => {
      setIsPlaying(false);
      setIsPaused(false);
      setProgress(100);
    };
    u.onerror = () => {
      setIsPlaying(false);
      setIsPaused(false);
    };
    utteranceRef.current = u;
    window.speechSynthesis.speak(u);
  }, [isPaused, transcript, langCode, rate, volume, muted, getBestVoice]);

  const pause = useCallback(() => {
    window.speechSynthesis?.pause();
    setIsPlaying(false);
    setIsPaused(true);
  }, []);

  const restart = useCallback(() => {
    stop();
    setTimeout(play, 100);
  }, [stop, play]);

  const toggleMute = () => {
    setMuted(m => !m);
    if (utteranceRef.current) {
      utteranceRef.current.volume = !muted ? 0 : volume;
    }
  };

  if (!supported) {
    return (
      <div className="flex items-center gap-3 rounded-xl bg-amber-500/10 border border-amber-500/20 px-5 py-4 text-sm text-amber-600 dark:text-amber-400">
        <Volume2 className="h-5 w-5 shrink-0" />
        Browser không hỗ trợ TTS. Đọc transcript bên dưới để luyện nghe.
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-2xl bg-gradient-to-br from-violet-500/10 to-purple-500/5 border border-violet-500/20 p-5">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/15">
          <Headphones className="h-5 w-5 text-violet-500" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate">{title}</p>
          <p className="text-xs text-muted-foreground">AI Text-to-Speech • {langCode}</p>
        </div>
        <Badge variant="outline" className="ml-auto text-violet-500 border-violet-500/30 shrink-0">TTS</Badge>
      </div>

      <div className="relative h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-violet-500 to-purple-500 transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={restart}
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            title="Restart"
          >
            <SkipBack className="h-4 w-4" />
          </button>
          <button
            onClick={isPlaying ? pause : play}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-violet-500 text-white shadow-lg hover:bg-violet-600 transition-all active:scale-95"
          >
            {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 translate-x-0.5" />}
          </button>
          <button
            onClick={stop}
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            title="Stop"
          >
            <SkipForward className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Speed:</span>
          {[0.7, 0.85, 1.0, 1.2].map(r => (
            <button
              key={r}
              onClick={() => setRate(r)}
              className={`rounded-md px-2 py-1 font-mono transition-colors ${rate === r ? 'bg-violet-500/20 text-violet-500 font-bold' : 'hover:bg-muted/60'}`}
            >
              {r}×
            </button>
          ))}
        </div>

        <button
          onClick={toggleMute}
          className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
        >
          {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </button>
      </div>

      <p className="text-center text-xs text-muted-foreground">
        {isPlaying ? '🔊 Đang phát...' : isPaused ? '⏸ Đã tạm dừng' : progress === 100 ? '✅ Đã phát xong' : '▶ Nhấn Play để nghe'}
      </p>
    </div>
  );
}

// ─── Audio file player (for mp3/ogg) ────────────────────────────────────────
function AudioFilePlayer({ url, title }: { url: string; title: string }) {
  return (
    <div className="space-y-3 rounded-2xl bg-gradient-to-br from-violet-500/10 to-purple-500/5 border border-violet-500/20 p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/15">
          <Headphones className="h-5 w-5 text-violet-500" />
        </div>
        <div>
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-xs text-muted-foreground">Audio File</p>
        </div>
      </div>
      <audio controls className="w-full rounded-xl accent-violet-500" src={url}>
        Your browser does not support the audio element.
      </audio>
    </div>
  );
}

// ─── YouTube Video Player ───────────────────────────────────────────────────
function YouTubePlayer({ url, title }: { url: string; title: string }) {
  const getYoutubeId = (url: string) => {
    const regExp = /^.*(youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
  };

  const videoId = getYoutubeId(url);

  if (!videoId) {
    return (
      <div className="flex items-center gap-3 rounded-xl bg-red-500/10 border border-red-500/20 px-5 py-4 text-sm text-red-600 dark:text-red-400">
        <VolumeX className="h-5 w-5 shrink-0" />
        Invalid YouTube URL
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-2xl bg-gradient-to-br from-red-500/10 to-orange-500/5 border border-red-500/20 p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-500/15">
          <Youtube className="h-5 w-5 text-red-500" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate">{title}</p>
          <p className="text-xs text-muted-foreground">YouTube Video</p>
        </div>
      </div>
      <div className="relative w-full overflow-hidden rounded-xl bg-black" style={{ paddingTop: '56.25%' }}>
        <iframe
          className="absolute top-0 left-0 w-full h-full"
          src={`https://www.youtube.com/embed/${videoId}?rel=0`}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    </div>
  );
}

export default function ListeningPage() {
  const { t } = useLanguageStore();
  const { language } = useLearningLanguageStore();
  const [activeTab, setActiveTab] = useState<'system' | 'user'>('system');
  const [selectedLevel, setSelectedLevel] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedLesson, setSelectedLesson] = useState<ListeningLesson | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [submitted, setSubmitted] = useState(false);
  const progress = useSkillCompletion();
  const getDurationSeconds = useActivityDuration(selectedLesson?.activityId);
  const [lessons, setLessons] = useState<ListeningLesson[]>([]);
  const [lessonsLoading, setLessonsLoading] = useState(true);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [sourceType, setSourceType] = useState<'youtube' | 'file'>('youtube');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [youtubeTranscript, setYoutubeTranscript] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadLanguage, setUploadLanguage] = useState<string>(language);
  const [uploadLevel, setUploadLevel] = useState('B1');
  const [uploadCategory, setUploadCategory] = useState('conversation');
  const [uploadTitle, setUploadTitle] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [operation, setOperation] = useState<ListeningOperation | null>(null);
  const operationKeyRef = useRef<string | null>(null);
  const pollAbortRef = useRef<AbortController | null>(null);

  const getLevelsForLanguage = (lang: string) => {
    switch (lang.toLowerCase()) {
      case 'japanese': return ['N5', 'N4', 'N3', 'N2', 'N1'];
      case 'chinese': return ['HSK1', 'HSK2', 'HSK3', 'HSK4', 'HSK5', 'HSK6'];
      default: return ['A1', 'A2', 'B1', 'B2', 'C1'];
    }
  };
  const levels = getLevelsForLanguage(language);

  // Automatically update uploadLanguage and uploadLevel defaults
  useEffect(() => {
    setUploadLanguage(language);
    const lvls = getLevelsForLanguage(language);
    setUploadLevel(lvls[Math.floor(lvls.length / 2)] || 'B1');
  }, [language]);

  const fetchLessons = useCallback(() => {
    setLessonsLoading(true);
    setSelectedLevel('all');
    setSelectedCategory('all');
    
    const token = getAccessToken();
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const url = activeTab === 'user'
      ? `/api/cms/lessons?type=listening&language=${language}&published=true&userUploaded=true&limit=200`
      : `/api/cms/lessons?type=listening&language=${language}&published=true&limit=200`;

    fetch(url, { headers })
      .then(r => r.json())
      .then(json => {
        const items: Record<string, unknown>[] = json.data ?? json ?? [];
        setLessons(items.map(cmsToListeningLesson));
      })
      .catch(() => {})
      .finally(() => setLessonsLoading(false));
  }, [language, activeTab]);

  useEffect(() => {
    setSelectedLesson(null);
    fetchLessons();
  }, [fetchLessons]);

  const filteredLessons = lessons.filter(l => {
    if (selectedLevel !== 'all' && l.level !== selectedLevel) return false;
    if (selectedCategory !== 'all' && l.category !== selectedCategory) return false;
    return true;
  });

  const openLesson = (lesson: ListeningLesson) => {
    setSelectedLesson(lesson);
    setShowTranscript(false);
    setAnswers({});
    setSubmitted(false);
  };

  const score = selectedLesson
    ? selectedLesson.questions.filter((q, i) => answers[i] === q.correctAnswer).length
    : 0;

  const isYouTubeUrl = (url?: string) => {
    if (!url) return false;
    return url.includes('youtube.com') || url.includes('youtu.be');
  };

  // ======= MODAL SUBMIT HANDLER (backend adapter + operation polling) =======
  const applyOperationResult = useCallback((result: ListeningOperation) => {
    const lessonData = result.data;
    if (!lessonData) {
      toast.error('Tạo bài học thất bại. Vui lòng thử lại.');
      return false;
    }
    const newLesson = cmsToListeningLesson(lessonData);
    setLessons(prev => [newLesson, ...prev.filter(item => item.id !== newLesson.id)]);
    setActiveTab('user');
    setIsModalOpen(false);
    setYoutubeUrl('');
    setYoutubeTranscript('');
    setSelectedFile(null);
    setUploadTitle('');
    openLesson(newLesson);
    return true;
  }, []);

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sourceType === 'youtube' && !youtubeUrl) {
      toast.error('Vui lòng nhập đường dẫn YouTube');
      return;
    }
    if (sourceType === 'youtube' && !youtubeTranscript.trim()) {
      toast.error('Vui lòng dán lời thoại thực tế của video.');
      return;
    }
    if (sourceType === 'file' && !selectedFile) {
      toast.error('Vui lòng chọn hoặc kéo thả file âm thanh');
      return;
    }
    if (isGenerating) return; // one intent at a time; retries reuse the key

    setIsGenerating(true);
    setOperation(null);
    pollAbortRef.current?.abort();
    const abort = new AbortController();
    pollAbortRef.current = abort;
    // One key per user intent: retries and status reads never re-bill.
    const key = operationKeyRef.current ?? createOperationKey();
    operationKeyRef.current = key;

    const payload: Record<string, unknown> = {
      sourceType,
      language: uploadLanguage,
      level: uploadLevel,
      category: uploadCategory,
      title: uploadTitle,
      idempotencyKey: key,
      clientOperationId: key,
    };
    if (sourceType === 'youtube') {
      payload.youtubeUrl = youtubeUrl;
      payload.transcript = youtubeTranscript.trim();
    }

    try {
      let current = await submitListeningGeneration(
        payload,
        sourceType === 'file' ? selectedFile : null,
        key,
        abort.signal,
      );
      setOperation(current);

      for (let attempt = 0; attempt < MAX_STATUS_POLLS && !TERMINAL_STATUSES.has(current.status); attempt++) {
        await sleep(POLL_INTERVAL_MS, abort.signal);
        const next = await fetchOperationStatus(current.operationId, abort.signal);
        if (next) {
          current = next;
          setOperation(current);
        }
      }

      if (abort.signal.aborted) return;
      if (current.status === 'SUCCEEDED') {
        if (applyOperationResult(current)) {
          operationKeyRef.current = null;
          toast.success('Tạo bài học thành công!');
        }
      } else if (current.status === 'FAILED' || current.status === 'CANCELLED') {
        toast.error(current.errorCode === 'INSUFFICIENT_CREDITS'
          ? 'Không đủ credits để tạo bài nghe.'
          : 'Tạo bài học thất bại. Vui lòng thử lại.');
      } else {
        // UNKNOWN or still running: never claim success; keep the key so the
        // user can reconcile the operation instead of paying for a retry.
        toast.error(`Bài học đang được xử lý (${current.status}). Vui lòng đợi trước khi gửi lại.`);
      }
    } catch (err: unknown) {
      if (!abort.signal.aborted) {
        const errorWithOperation = asRecord(err);
        const operationId = errorWithOperation?.operationId;
        if (typeof operationId === 'string') {
          // A conflict or timeout still carries a durable id: recover it.
          const recovered = await fetchOperationStatus(operationId, abort.signal);
          if (recovered && recovered.status === 'SUCCEEDED' && applyOperationResult(recovered)) {
            operationKeyRef.current = null;
            toast.success('Tạo bài học thành công!');
            return;
          }
        }
        console.error(err);
        toast.error(err instanceof Error ? err.message : 'Có lỗi xảy ra trong quá trình xử lý');
      }
    } finally {
      if (pollAbortRef.current === abort) pollAbortRef.current = null;
      setIsGenerating(false);
    }
  };

  // ======= LESSON DETAIL VIEW =======
  if (selectedLesson) {
    const activity: SkillCompletion = {
      activityType: 'listening',
      activityId: selectedLesson.activityId,
      language: selectedLesson.language,
      durationSeconds: getDurationSeconds(),
    };
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={() => setSelectedLesson(null)}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Library
        </Button>

        {/* Lesson Header */}
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-violet-500/10">
            {isYouTubeUrl(selectedLesson.audioUrl) ? (
              <Youtube className="h-6 w-6 text-red-500" />
            ) : (
              <Headphones className="h-6 w-6 text-violet-500" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold truncate">{selectedLesson.title}</h1>
            <p className="text-sm text-muted-foreground truncate">{selectedLesson.titleVi}</p>
            <div className="mt-2 flex gap-2 flex-wrap">
              <Badge variant="secondary">{selectedLesson.level}</Badge>
              <Badge variant="outline"><Clock className="mr-1 h-3 w-3" />{selectedLesson.duration}</Badge>
              {selectedLesson.isUserUploaded && (
                <Badge className="bg-violet-500/10 text-violet-500 border-violet-500/20">Của tôi</Badge>
              )}
            </div>
          </div>
        </div>

        {/* Audio/Video Player */}
        <Card>
          <CardContent className="p-5">
            {selectedLesson.audioUrl ? (
              isYouTubeUrl(selectedLesson.audioUrl) ? (
                <YouTubePlayer url={selectedLesson.audioUrl} title={selectedLesson.title} />
              ) : (
                <AudioFilePlayer url={selectedLesson.audioUrl} title={selectedLesson.title} />
              )
            ) : (
              <TTSPlayer
                transcript={selectedLesson.transcript}
                language={language}
                title={selectedLesson.title}
              />
            )}
          </CardContent>
        </Card>

        {/* Transcript */}
        <Card>
          <CardHeader className="px-6 pt-6 pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-lg">
                <FileText className="h-5 w-5 text-violet-500" /> Transcript
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setShowTranscript(!showTranscript)}>
                {showTranscript ? <><EyeOff className="mr-1 h-4 w-4" /> Hide</> : <><Eye className="mr-1 h-4 w-4" /> Show</>}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="px-6 pb-6">
            {showTranscript ? (
              <div className="whitespace-pre-wrap text-sm leading-7 text-foreground/90">{selectedLesson.transcript}</div>
            ) : (
              <div className="rounded-xl bg-muted/50 p-4 text-center text-sm text-muted-foreground">
                🎧 Try listening first, then reveal the transcript to check your understanding.
              </div>
            )}
          </CardContent>
        </Card>

        {/* Vocabulary */}
        {selectedLesson.vocabulary.length > 0 && (
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
                    accent="violet"
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Comprehension Questions */}
        {selectedLesson.invalidQuestionCount > 0 && (
          <p role="status" className="rounded-lg border border-border p-3 text-sm">Một số câu hỏi thiếu đáp án hợp lệ nên đã được bỏ qua.</p>
        )}
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
                      if (submitted) {
                        if (oi === q.correctAnswer) cls = 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30';
                        else if (answers[qi] === oi && oi !== q.correctAnswer) cls = 'border-red-500 bg-red-50 dark:bg-red-950/30';
                      } else if (answers[qi] === oi) {
                        cls = 'border-primary bg-primary/5 shadow-sm';
                      }
                      return (
                        <button key={oi} className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left text-sm transition-all ${cls}`} onClick={() => { if (!submitted) setAnswers(prev => ({ ...prev, [qi]: oi })); }}>
                          {submitted && oi === q.correctAnswer && <CheckCircle className="h-4 w-4 shrink-0 text-emerald-500" />}
                          {submitted && answers[qi] === oi && oi !== q.correctAnswer && <XCircle className="h-4 w-4 shrink-0 text-red-500" />}
                          {!submitted && <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs ${answers[qi] === oi ? 'border-primary bg-primary text-white' : ''}`}>{String.fromCharCode(65 + oi)}</span>}
                          <span>{opt}</span>
                        </button>
                      );
                    })}
                  </div>
                  {submitted && q.explanation && <p className="pl-8 text-xs text-muted-foreground italic">{q.explanation}</p>}
                </div>
              ))}
              {!submitted ? (
                <Button variant="gradient" onClick={() => { setSubmitted(true); progress.mutate(activity); }} disabled={Object.keys(answers).length < selectedLesson.questions.length}>Submit Answers</Button>
              ) : (
                <div className={`rounded-xl p-5 text-center ${score >= selectedLesson.questions.length * 0.7 ? 'bg-emerald-50 dark:bg-emerald-950/20' : 'bg-amber-50 dark:bg-amber-950/20'}`}>
                  <p className="text-3xl font-bold">{score} / {selectedLesson.questions.length}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{score >= selectedLesson.questions.length * 0.7 ? 'Great job! 🎉' : 'Keep practicing! 📚'}</p>
                  <SkillSaveStatus progress={progress} activity={activity} />
                  <Button variant="outline" className="mt-3" onClick={() => { setAnswers({}); setSubmitted(false); }}>
                    <RefreshCw className="mr-2 h-4 w-4" /> Try Again
                  </Button>
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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10">
            <Headphones className="h-5 w-5 text-violet-500" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{t.listening.title}</h1>
            <p className="text-sm text-muted-foreground">{t.listening.desc}</p>
          </div>
        </div>

        {/* Tabs for splitting library */}
        <div className="flex gap-1 rounded-xl border bg-muted/30 p-1 w-fit">
          <button
            onClick={() => setActiveTab('system')}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all ${
              activeTab === 'system'
                ? 'bg-background shadow-sm text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Thư viện hệ thống
          </button>
          <button
            onClick={() => setActiveTab('user')}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all ${
              activeTab === 'user'
                ? 'bg-background shadow-sm text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Bài nghe của tôi
          </button>
        </div>
      </div>

      {/* Action / Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-4">
        {/* Left: Filters */}
        <div className="flex flex-wrap gap-2 flex-1">
          <Badge
            variant={selectedLevel === 'all' ? 'default' : 'outline'}
            className="cursor-pointer px-3 py-1.5 text-xs rounded-full transition-all"
            onClick={() => setSelectedLevel('all')}
          >
            All Levels
          </Badge>
          {levels.map(lvl => (
            <Badge
              key={lvl}
              variant={selectedLevel === lvl ? 'default' : 'outline'}
              className="cursor-pointer px-3 py-1.5 text-xs rounded-full transition-all"
              onClick={() => setSelectedLevel(lvl)}
            >
              {lvl}
            </Badge>
          ))}
          <div className="w-px h-6 bg-muted self-center mx-1" />
          <Badge
            variant={selectedCategory === 'all' ? 'default' : 'outline'}
            className="cursor-pointer px-3 py-1.5 text-xs rounded-full transition-all"
            onClick={() => setSelectedCategory('all')}
          >
            All Topics
          </Badge>
          {listeningCategories.map(cat => (
            <Badge
              key={cat.id}
              variant={selectedCategory === cat.id ? 'default' : 'outline'}
              className="cursor-pointer px-3 py-1.5 text-xs rounded-full transition-all"
              onClick={() => setSelectedCategory(cat.id)}
            >
              {cat.label}
            </Badge>
          ))}
        </div>

        {/* Right: Upload Button for Users */}
        {activeTab === 'user' && (
          <Button
            onClick={() => setIsModalOpen(true)}
            className="bg-violet-600 hover:bg-violet-700 text-white font-medium"
          >
            <Plus className="mr-2 h-4 w-4" /> Tạo bài luyện nghe
          </Button>
        )}
      </div>

      {/* Lesson grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {lessonsLoading && (
          <div className="col-span-full flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-violet-500" />
          </div>
        )}
        {!lessonsLoading && filteredLessons.map(lesson => (
          <Card key={lesson.id} className="cursor-pointer transition-all hover:shadow-md hover:border-violet-500/30 group relative overflow-hidden" onClick={() => openLesson(lesson)}>
            <CardContent className="p-5 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-sm group-hover:text-violet-500 transition-colors line-clamp-2">{lesson.title}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{lesson.titleVi}</p>
                </div>
                <Badge variant="secondary" className="shrink-0">{lesson.level}</Badge>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{lesson.transcript.slice(0, 100)}...</p>
              <div className="flex items-center gap-2 flex-wrap pt-2 border-t text-[10px]">
                <Badge variant="outline" className="text-[10px]"><Clock className="mr-1 h-2.5 w-2.5" />{lesson.duration}</Badge>
                <Badge variant="outline" className="text-[10px]">{lesson.questions.length} questions</Badge>
                <Badge variant="outline" className="text-[10px]">{lesson.vocabulary.length} vocab</Badge>
                <span className="ml-auto text-violet-500 flex items-center gap-1">
                  {isYouTubeUrl(lesson.audioUrl) ? (
                    <><Youtube className="h-3.5 w-3.5 text-red-500" /> YouTube</>
                  ) : lesson.audioUrl ? (
                    <><FileAudio className="h-3.5 w-3.5" /> Audio</>
                  ) : (
                    <><Headphones className="h-3 w-3" /> TTS</>
                  )}
                </span>
              </div>
            </CardContent>
          </Card>
        ))}
        {!lessonsLoading && filteredLessons.length === 0 && (
          activeTab === 'user' ? (
            <div className="col-span-full py-16 text-center border-2 border-dashed rounded-2xl bg-muted/10 px-6">
              <Headphones className="mx-auto mb-4 h-12 w-12 text-violet-500/50" />
              <h3 className="text-lg font-semibold text-foreground">Chưa có bài luyện nghe cá nhân nào</h3>
              <p className="text-sm text-muted-foreground mt-1 mb-5 max-w-md mx-auto">
                Tự tạo bài luyện nghe của riêng bạn bằng cách dán liên kết YouTube hoặc tải lên tệp âm thanh (.mp3, .wav...). AI sẽ hỗ trợ nhận dạng giọng nói và chuẩn bị nội dung học tập.
              </p>
              <Button onClick={() => setIsModalOpen(true)} className="bg-violet-600 hover:bg-violet-700">
                <Plus className="mr-2 h-4 w-4" /> Tạo bài luyện nghe ngay
              </Button>
            </div>
          ) : (
            <div className="col-span-full py-12 text-center text-muted-foreground">
              <Headphones className="mx-auto mb-3 h-10 w-10 opacity-30" />
              <p className="text-sm">No lessons found for the selected filters.</p>
            </div>
          )
        )}
      </div>

      {/* CREATE LESSON MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-background border rounded-2xl w-full max-w-lg shadow-2xl p-6 relative overflow-hidden animate-in fade-in zoom-in duration-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b pb-4 mb-4">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-violet-500" />
                <h3 className="font-bold text-lg">Tạo bài luyện nghe mới</h3>
              </div>
              <button
                onClick={() => !isGenerating && setIsModalOpen(false)}
                className="text-muted-foreground hover:text-foreground rounded-full p-1 hover:bg-muted"
                disabled={isGenerating}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleUploadSubmit} className="space-y-4">
              {/* Source Type Selector */}
              <div>
                <label className="text-xs font-semibold text-muted-foreground block mb-2">Nguồn tài liệu</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setSourceType('youtube')}
                    className={`flex items-center justify-center gap-2 border rounded-xl p-3 text-sm font-medium transition-all ${
                      sourceType === 'youtube'
                        ? 'border-violet-500 bg-violet-500/5 text-violet-600 dark:text-violet-400'
                        : 'hover:bg-muted'
                    }`}
                  >
                    <Youtube className="h-4 w-4 text-red-500" />
                    Đường dẫn YouTube
                  </button>
                  <button
                    type="button"
                    onClick={() => setSourceType('file')}
                    className={`flex items-center justify-center gap-2 border rounded-xl p-3 text-sm font-medium transition-all ${
                      sourceType === 'file'
                        ? 'border-violet-500 bg-violet-500/5 text-violet-600 dark:text-violet-400'
                        : 'hover:bg-muted'
                    }`}
                  >
                    <Upload className="h-4 w-4 text-blue-500" />
                    Tệp âm thanh
                  </button>
                </div>
              </div>

              {/* Title input */}
              <div>
                <label className="text-xs font-semibold text-muted-foreground block mb-1.5">Tiêu đề (Không bắt buộc)</label>
                <Input
                  value={uploadTitle}
                  onChange={(e) => setUploadTitle(e.target.value)}
                  placeholder="Nhập tiêu đề hoặc để trống để AI tự động lấy"
                  className="rounded-xl"
                  disabled={isGenerating}
                />
              </div>

              {/* YouTube URL input */}
              {sourceType === 'youtube' && (
                <div className="space-y-4">
                  <div>
                    <label htmlFor="youtube-url" className="text-xs font-semibold text-muted-foreground block mb-1.5">Đường dẫn YouTube</label>
                    <Input
                      id="youtube-url"
                      value={youtubeUrl}
                      onChange={(e) => setYoutubeUrl(e.target.value)}
                      placeholder="https://www.youtube.com/watch?v=..."
                      className="rounded-xl"
                      disabled={isGenerating}
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="youtube-transcript" className="text-xs font-semibold block mb-1.5">Lời thoại thực tế của video</label>
                    <textarea
                      id="youtube-transcript"
                      value={youtubeTranscript}
                      onChange={(event) => setYoutubeTranscript(event.target.value)}
                      className="w-full rounded-xl border border-border bg-background p-3"
                      aria-describedby="youtube-transcript-help"
                      rows={4}
                      maxLength={20000}
                      disabled={isGenerating}
                      required
                    />
                    <p id="youtube-transcript-help" className="mt-1 text-xs text-muted-foreground">
                      Dán bản chép lời hoặc phụ đề của video để câu hỏi khớp nội dung bạn nghe.
                      {' '}Bạn cũng có thể <Link href="/learn" className="underline">chọn bài nghe giao tiếp có sẵn</Link>.
                    </p>
                  </div>
                </div>
              )}

              {/* File upload input */}
              {sourceType === 'file' && (
                <div>
                  <label className="text-xs font-semibold text-muted-foreground block mb-1.5">Chọn tệp âm thanh (Tối đa 15MB)</label>
                  <div className="border-2 border-dashed border-muted hover:border-violet-500/50 rounded-2xl p-6 text-center cursor-pointer transition-colors relative">
                    <input
                      type="file"
                      accept=".mp3,.wav,.ogg,.m4a,.aac,.flac"
                      onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                      className="absolute inset-0 opacity-0 cursor-pointer"
                      disabled={isGenerating}
                    />
                    <FileAudio className="mx-auto h-8 w-8 text-muted-foreground/60 mb-2" />
                    {selectedFile ? (
                      <div>
                        <p className="text-sm font-semibold text-violet-500 truncate max-w-xs mx-auto">{selectedFile.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{(selectedFile.size / (1024 * 1024)).toFixed(2)} MB</p>
                      </div>
                    ) : (
                      <div>
                        <p className="text-sm font-medium">Kéo thả hoặc nhấn để chọn file</p>
                        <p className="text-[10px] text-muted-foreground mt-1">Định dạng hỗ trợ: MP3, WAV, M4A, OGG, FLAC</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Parameters: Language / Level / Category */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground block mb-1.5">Ngôn ngữ</label>
                  <select
                    value={uploadLanguage}
                    onChange={(e) => {
                      const lang = e.target.value;
                      setUploadLanguage(lang);
                      const lvls = getLevelsForLanguage(lang);
                      setUploadLevel(lvls[Math.floor(lvls.length / 2)] || 'B1');
                    }}
                    className="w-full text-sm rounded-xl border p-2.5 bg-background outline-none focus:border-violet-500"
                    disabled={isGenerating}
                  >
                    <option value="english">English</option>
                    <option value="japanese">Japanese</option>
                    <option value="chinese">Chinese</option>
                    <option value="french">French</option>
                    <option value="spanish">Spanish</option>
                    <option value="korean">Korean</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground block mb-1.5">Trình độ</label>
                  <select
                    value={uploadLevel}
                    onChange={(e) => setUploadLevel(e.target.value)}
                    className="w-full text-sm rounded-xl border p-2.5 bg-background outline-none focus:border-violet-500"
                    disabled={isGenerating}
                  >
                    {getLevelsForLanguage(uploadLanguage).map(lvl => (
                      <option key={lvl} value={lvl}>{lvl}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground block mb-1.5">Thể loại</label>
                  <select
                    value={uploadCategory}
                    onChange={(e) => setUploadCategory(e.target.value)}
                    className="w-full text-sm rounded-xl border p-2.5 bg-background outline-none focus:border-violet-500"
                    disabled={isGenerating}
                  >
                    {listeningCategories.map(cat => (
                      <option key={cat.id} value={cat.id}>{cat.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Submit Buttons */}
              <div className="flex items-center justify-end gap-2 border-t pt-4 mt-6">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsModalOpen(false)}
                  disabled={isGenerating}
                  className="rounded-xl"
                >
                  Hủy
                </Button>
                <Button
                  type="submit"
                  disabled={isGenerating}
                  className="bg-violet-600 hover:bg-violet-700 text-white rounded-xl min-w-32"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Đang xử lý...
                    </>
                  ) : (
                    'Tạo bài học'
                  )}
                </Button>
              </div>
            </form>

            {/* Spinner Overlay while AI works */}
            {isGenerating && (
              <div className="absolute inset-0 bg-background/80 flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-300">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-violet-100 dark:bg-violet-950/50 mb-4 animate-pulse">
                  <Sparkles className="h-8 w-8 text-violet-600 animate-spin duration-3000" />
                </div>
                <h4 className="font-bold text-base text-foreground">AI đang biên soạn bài nghe...</h4>
                <p className="text-xs text-muted-foreground mt-2 max-w-xs leading-relaxed">
                  {sourceType === 'file' 
                    ? 'Đang tải lên file và nhận diện giọng nói (Whisper API)... Quá trình này có thể mất 1-2 phút.'
                    : 'Đang trích xuất thông tin YouTube và xây dựng bài luyện nghe. Vui lòng chờ.'}
                </p>
                <div className="mt-5 w-48 bg-muted h-1 rounded-full overflow-hidden relative">
                  <div className="bg-violet-600 h-full rounded-full animate-progress absolute left-0 top-0 w-1/3" />
                </div>
                <p role="status" aria-live="polite" className="mt-4 text-xs text-muted-foreground">
                  {operation
                    ? `Trạng thái máy chủ: ${operation.status}${operation.reservedCredits !== undefined ? ` · ${operation.reservedCredits} credits đã giữ` : ''}${operation.refunded ? ' · đã hoàn tiền' : ''}`
                    : 'Đang gửi yêu cầu tới máy chủ...'}
                </p>
                {operation?.operationId && (
                  <p className="mt-1 text-[10px] text-muted-foreground/70">
                    Mã thao tác: {operation.operationId}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
