/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Mic, MicOff, Loader2, Sparkles, RefreshCw, Volume2,
  ChevronDown, ChevronUp, Lightbulb, MessageSquare, Wifi, WifiOff, History,
} from 'lucide-react';
import Link from 'next/link';
import { useLanguageStore } from '@/stores/language-store';
import { speakWord } from '@/lib/speech';
import { getAccessToken } from '@/stores/auth-store';
import { useTokenStore } from '@/stores/token-store';
import apiClient from '@/lib/api-client';
import { TranscriptFeedback } from '@/components/speaking/transcript-feedback';
import { useLearningLanguageStore } from '@/stores/learning-language-store';

const getRecognitionLang = (lang: string) => {
  switch (lang) {
    case 'english': return 'en-US';
    case 'vietnamese': return 'vi-VN';
    case 'japanese': return 'ja-JP';
    case 'korean': return 'ko-KR';
    case 'chinese': return 'zh-CN';
    case 'spanish': return 'es-ES';
    case 'french': return 'fr-FR';
    case 'german': return 'de-DE';
    default: return 'en-US';
  }
};

function lcs(target: string[], spoken: string[]) {
  const m = target.length;
  const n = spoken.length;
  const dp: number[][] = Array(m + 1).fill(0).map(() => Array(n + 1).fill(0));
  
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (target[i - 1] === spoken[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  
  let i = m;
  let j = n;
  const matches = new Set<number>();
  
  while (i > 0 && j > 0) {
    if (target[i - 1] === spoken[j - 1]) {
      matches.add(i - 1);
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }
  
  return { matches };
}

interface SpeakingTopic {
  topic: string;
  prompt: string;
  tips: string[];
  samplePhrases: string[];
  duration: number;
  difficulty: string;
}

interface Scores {
  overall: number;
  grammar: number;
  vocabulary: number;
}

type Phase =
  | 'ready'
  | 'topic'
  | 'recording'
  | 'connecting'
  | 'transcribing'
  | 'analyzing'
  | 'streaming'
  | 'done';

const categories = [
  { id: 'daily', label: 'Daily Life' },
  { id: 'travel', label: 'Travel' },
  { id: 'work', label: 'Work & Study' },
  { id: 'opinion', label: 'Opinion' },
  { id: 'story', label: 'Storytelling' },
];

const levels = ['A1', 'A2', 'B1', 'B2', 'C1'];

const getWsUrl = () => {
  const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
  return apiBase.replace(/\/api(\/v\d+)?$/, '').replace(/^https/, 'wss').replace(/^http/, 'ws') + '/speaking-ws';
};

const getSupportedMimeType = () => {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  if (typeof window === 'undefined') return 'audio/webm';
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? 'audio/webm';
};

function compareTranscript(target: string, transcript: string, locale: string) {
  const segment = (value: string) => typeof Intl.Segmenter === 'function'
    ? Array.from(new Intl.Segmenter(locale, { granularity: 'word' }).segment(value))
      .filter((part) => part.isWordLike).map((part) => part.segment)
    : value.match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
  const normalize = (word: string) => word.normalize('NFKC').replace(/’/g, "'").toLocaleLowerCase(locale);
  const targetWords = segment(target);
  const spokenWords = segment(transcript);
  if (targetWords.length === 0 || spokenWords.length === 0) return null;
  const { matches } = lcs(targetWords.map(normalize), spokenWords.map(normalize));
  return {
    score: Math.round((matches.size / targetWords.length) * 100),
    diff: targetWords.map((word, index) => ({
      word,
      status: matches.has(index) ? 'correct' as const : 'incorrect' as const,
    })),
  };
}

export default function SpeakingPage() {
  const { t } = useLanguageStore();
  const { language } = useLearningLanguageStore();
  const [phase, setPhase] = useState<Phase>('ready');
  // Ref mirror for async WS callbacks, which close over stale `phase` values.
  const phaseRef = useRef<Phase>('ready');
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  const [level, setLevel] = useState('B1');
  const [category, setCategory] = useState('daily');
  // S2: speaking practice language (was hardcoded to English, leaving the
  // backend's 8-language Whisper map unused).
  const [targetLanguage, setTargetLanguage] = useState<string>(language);
  const [topic, setTopic] = useState<SpeakingTopic | null>(null);

  useEffect(() => {
    setTargetLanguage(language);
  }, [language]);

  // Coach states
  const [speakingMode, setSpeakingMode] = useState<'topic' | 'coach'>('topic');
  const [targetSentence, setTargetSentence] = useState('The quick brown fox jumps over the lazy dog');
  const [coachTranscript, setCoachTranscript] = useState('');
  const [isCoachListening, setIsCoachListening] = useState(false);
  const [isWhisperFallback, setIsWhisperFallback] = useState(false);
  const [coachScore, setCoachScore] = useState<number | null>(null);
  const [coachDiff, setCoachDiff] = useState<{ word: string; status: 'correct' | 'incorrect' }[]>([]);
  const recognitionRef = useRef<any>(null);
  const [isGeneratingTopic, setIsGeneratingTopic] = useState(false);
  const [showTips, setShowTips] = useState(true);
  const [timer, setTimer] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  // Tracks whether the current WS session reached a terminal feedback state,
  // so a normal close after feedback_done is not mistaken for a dropped session.
  const wsTerminalRef = useRef(false);
  const wsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [wsStatus, setWsStatus] = useState<'idle' | 'connecting' | 'open' | 'error'>('idle');
  const [transcript, setTranscript] = useState('');
  const [streamingText, setStreamingText] = useState('');
  const [recording, setRecording] = useState<Blob | null>(null);
  const [recordingUrl, setRecordingUrl] = useState('');
  const [scores, setScores] = useState<Scores | null>(null);
  const [statusMsg, setStatusMsg] = useState('');
  useEffect(() => {
    if (!recording) {
      setRecordingUrl('');
      return;
    }
    const url = URL.createObjectURL(recording);
    setRecordingUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [recording]);
  const [error, setError] = useState<string | null>(null);

  // Single cleanup path for every capture resource. Called on unmount, reset,
  // mode switches and before starting a new recording so a mode switch or a
  // repeated Start cannot leave the microphone or timer running in the background.
  const cleanupCapture = useCallback(() => {
    if (wsRef.current) {
      // Detach handlers first: an intentional close (reset/mode switch/unmount)
      // must not be reported as a dropped session by onclose.
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch { /* already stopped */ }
      recognitionRef.current = null;
    }
    if (mediaRecorderRef.current) {
      const recorder = mediaRecorderRef.current;
      mediaRecorderRef.current = null;
      if (recorder.state !== 'inactive') {
        recorder.onstop = null;
        try { recorder.stop(); } catch { /* already stopped */ }
      }
      recorder.stream.getTracks().forEach((t) => t.stop());
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (wsTimeoutRef.current) {
      clearTimeout(wsTimeoutRef.current);
      wsTimeoutRef.current = null;
    }
    wsTerminalRef.current = false;
  }, []);

  useEffect(() => {
    return () => { cleanupCapture(); };
  }, [cleanupCapture]);

  const generateTopic = useCallback(async () => {
    setIsGeneratingTopic(true);
    setError(null);
    setTranscript('');
    setRecording(null);
    setStreamingText('');
    setScores(null);
    try {
      const token = getAccessToken();
      const res = await fetch('/api/speaking/topic', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ level, category, language: targetLanguage }),
      });
      const json = await res.json();
      if (!res.ok || !json.data) {
        throw new Error(json?.error || 'Failed to generate topic');
      }
      setTopic(json.data);
      setPhase('topic');
    } catch {
      // Stay on the selection screen so the user sees the error and can retry.
      setPhase('ready');
      setError('Failed to generate topic. Please try again.');
    } finally {
      setIsGeneratingTopic(false);
    }
  }, [level, category, targetLanguage]);

  const startRecording = useCallback(async () => {
    cleanupCapture();
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = getSupportedMimeType();
      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mediaRecorder.start(250);
      mediaRecorderRef.current = mediaRecorder;
      setPhase('recording');
      setTimer(0);
      timerRef.current = setInterval(() => setTimer((p) => p + 1), 1000);
    } catch {
      setError('Microphone access denied. Please allow microphone access and try again.');
    }
  }, [cleanupCapture]);

  const stopRecording = useCallback(() => {
    if (!mediaRecorderRef.current) return;
    const recorder = mediaRecorderRef.current;
    const mimeType = recorder.mimeType;
    const recordedSeconds = timer;
    recorder.onstop = async () => {
      recorder.stream.getTracks().forEach((t) => t.stop());
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      const blob = new Blob(audioChunksRef.current, { type: mimeType });
      if (blob.size === 0) { setError('No audio recorded. Try again.'); setPhase('topic'); return; }
      setRecording(blob);
      // S5: minimum duration check — avoid wasting Groq quota on near-silent clips
      if (recordedSeconds < 3) {
        setError('Bài nói quá ngắn — hãy nói ít nhất 3 giây để AI có thể đánh giá.');
        setPhase('topic');
        return;
      }
      // S4: convert blob to base64 via FileReader (native, non-blocking)
      const base64: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          // result === "data:audio/webm;base64,XXXXX"
          resolve(result.includes(',') ? result.split(',')[1] : result);
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      setPhase('connecting');
      setStatusMsg('Connecting...');
      setStreamingText('');
      setTranscript('');
      setScores(null);
      // S1: include JWT in WS URL so production gateway accepts the connection
      const token = getAccessToken();
      const baseWs = getWsUrl();
      const wsUrl = token ? `${baseWs}?token=${encodeURIComponent(token)}` : baseWs;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      wsTerminalRef.current = false;
      setWsStatus('connecting');
      // Fail a session that never reaches session_ready/feedback_done instead of
      // leaving the spinner up forever (e.g. gateway rejects the connection).
      wsTimeoutRef.current = setTimeout(() => {
        if (wsRef.current !== ws || wsTerminalRef.current) return;
        const current = phaseRef.current;
        if (current === 'connecting' || current === 'transcribing' ||
            current === 'analyzing' || current === 'streaming') {
          wsTerminalRef.current = true;
          setError('Feedback timed out. Please try again.');
          setPhase('topic');
          setWsStatus('error');
          ws.close();
        }
      }, 90_000);
      ws.onopen = () => {
        setWsStatus('open');
        ws.send(JSON.stringify({
          event: 'start_session',
          data: {
            topic: topic?.prompt || topic?.topic || 'Free speaking',
            level,
            // S2: send selected language so Whisper transcribes in the right language
            language: targetLanguage,
          },
        }));
      };
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as { event: string; data: unknown };
          const msgData = msg.data as Record<string, unknown>;
          switch (msg.event) {
            case 'session_ready':
              ws.send(JSON.stringify({ event: 'audio_data', data: { audio: base64, mimeType } }));
              break;
            case 'status':
              setStatusMsg((msgData.message as string) || '');
              setPhase((msgData.phase as string) === 'transcribing' ? 'transcribing' : 'analyzing');
              break;
            case 'transcript':
              setTranscript((msgData.text as string) || '');
              break;
            case 'feedback_chunk':
              setPhase('streaming');
              setStreamingText((prev) => prev + ((msgData.chunk as string) || ''));
              break;
            case 'feedback_done':
              wsTerminalRef.current = true;
              if (wsTimeoutRef.current) { clearTimeout(wsTimeoutRef.current); wsTimeoutRef.current = null; }
              setTranscript((msgData.transcript as string) || '');
              setStreamingText((msgData.feedback as string) || '');
              setScores((msgData.scores as Scores) || null);
              setPhase('done');
              setWsStatus('idle');
              ws.close();
              useTokenStore.getState().loadBalance();
              break;
            case 'error':
              wsTerminalRef.current = true;
              if (wsTimeoutRef.current) { clearTimeout(wsTimeoutRef.current); wsTimeoutRef.current = null; }
              setError((msgData.message as string) || 'An error occurred.');
              setPhase('topic');
              setWsStatus('error');
              ws.close();
              break;
          }
        } catch { /* ignore */ }
      };
      ws.onerror = () => {
        wsTerminalRef.current = true;
        if (wsTimeoutRef.current) { clearTimeout(wsTimeoutRef.current); wsTimeoutRef.current = null; }
        setError('WebSocket connection failed. Make sure the API server is running.');
        setPhase('topic');
        setWsStatus('error');
      };
      ws.onclose = () => {
        if (wsTimeoutRef.current) { clearTimeout(wsTimeoutRef.current); wsTimeoutRef.current = null; }
        if (wsRef.current === ws) wsRef.current = null;
        // A close without a prior error/feedback event means the gateway dropped
        // the session. Restore the topic phase so Record/Try Again stay reachable.
        if (!wsTerminalRef.current) {
          const current = phaseRef.current;
          if (current === 'connecting' || current === 'transcribing' ||
              current === 'analyzing' || current === 'streaming') {
            wsTerminalRef.current = true;
            setError('Connection closed before feedback was complete. Please try again.');
            setPhase('topic');
          }
        }
        setWsStatus('idle');
      };
    };
    recorder.stop();
    mediaRecorderRef.current = null;
  }, [topic, level, targetLanguage, timer]);

  const startCoachListening = useCallback(() => {
    if (typeof window === 'undefined') return;
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    cleanupCapture();
    setError(null);
    setCoachTranscript('');
    setCoachScore(null);
    setCoachDiff([]);

    if (!SpeechRecognition) {
      // Fallback to Whisper
      setIsWhisperFallback(true);
      
      navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
        const mimeType = getSupportedMimeType();
        const mediaRecorder = new MediaRecorder(stream, { mimeType });
        audioChunksRef.current = [];
        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) audioChunksRef.current.push(e.data);
        };
        mediaRecorder.start(250);
        mediaRecorderRef.current = mediaRecorder;
        setIsCoachListening(true);
      }).catch((err) => {
        console.error(err);
        setError('Không thể truy cập microphone. Vui lòng cho phép truy cập và thử lại.');
        setIsCoachListening(false);
        setIsWhisperFallback(false);
      });
      return;
    }
    
    setIsWhisperFallback(false);
    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = getRecognitionLang(targetLanguage);
    
    rec.onresult = (e: any) => {
      let resultText = '';
      for (let i = 0; i < e.results.length; ++i) {
        resultText += ` ${e.results[i][0].transcript}`;
      }
      setCoachTranscript(resultText.trim());
    };
    
    rec.onerror = (e: any) => {
      console.error(e);
      if (e.error === 'not-allowed') {
        setError('Microphone access denied. Please allow microphone access.');
      } else {
        setError(`Lỗi Speech Recognition: ${e.error}`);
      }
      setIsCoachListening(false);
    };
    
    rec.onend = () => {
      setIsCoachListening(false);
    };
    
    recognitionRef.current = rec;
    rec.start();
    setIsCoachListening(true);
  }, [targetLanguage, cleanupCapture]);

  const stopCoachListening = useCallback(async () => {
    const applyTranscript = (text: string) => {
      const result = compareTranscript(targetSentence, text, getRecognitionLang(targetLanguage));
      setCoachScore(result?.score ?? null);
      setCoachDiff(result?.diff ?? []);
      if (!result) setError('Chưa nhận dạng được từ nào để đối chiếu. Bạn có thể thử nói lại.');
    };
    if (isWhisperFallback) {
      if (!mediaRecorderRef.current) return;
      const recorder = mediaRecorderRef.current;
      const mimeType = recorder.mimeType;
      
      recorder.onstop = async () => {
        recorder.stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        if (blob.size === 0) {
          setError('Không thu được âm thanh. Vui lòng thử lại.');
          setIsCoachListening(false);
          setIsWhisperFallback(false);
          return;
        }
        
        try {
          // Convert to base64
          const base64: string = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              const result = reader.result as string;
              resolve(result.includes(',') ? result.split(',')[1] : result);
            };
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
          });
          
          setError(null);
          setStatusMsg('Đang nhận dạng giọng nói bằng Whisper...');
          
          // Send to API backend
          const { data } = await apiClient.post('/speaking/transcribe', {
            audio: base64,
            mimeType,
            language: targetLanguage,
          });
          
          const transcribedText = data.transcript || '';
          setCoachTranscript(transcribedText);
          
          applyTranscript(transcribedText);
          
          // Reload token balance
          useTokenStore.getState().loadBalance();
        } catch (err: any) {
          setError(err.response?.data?.message || err.message || 'Lỗi khi nhận dạng giọng nói bằng Whisper.');
        } finally {
          setIsCoachListening(false);
          setIsWhisperFallback(false);
        }
      };
      
      recorder.stop();
      mediaRecorderRef.current = null;
      return;
    }

    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    setIsCoachListening(false);
    
    applyTranscript(coachTranscript);
  }, [isWhisperFallback, targetSentence, coachTranscript, targetLanguage]);

  const reset = useCallback(() => {
    cleanupCapture();
    setPhase('ready'); setTopic(null); setTranscript(''); setStreamingText('');
    setRecording(null);
    setScores(null); setError(null); setStatusMsg(''); setTimer(0); setWsStatus('idle');
    setCoachTranscript(''); setCoachScore(null); setCoachDiff([]); setIsCoachListening(false);
  }, [cleanupCapture]);

  const tryAgain = useCallback(() => {
    cleanupCapture();
    setPhase('topic'); setTranscript(''); setStreamingText('');
    setRecording(null);
    setScores(null); setError(null); setStatusMsg(''); setTimer(0); setWsStatus('idle');
  }, [cleanupCapture]);

  const scoreColor = (s: number) => s >= 80 ? 'text-emerald-500' : s >= 60 ? 'text-amber-500' : 'text-red-500';
  const scoreVariant = (s: number): 'success' | 'warning' | 'default' => s >= 80 ? 'success' : s >= 60 ? 'warning' : 'default';
  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = (s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
  };
  const isProcessing = phase === 'connecting' || phase === 'transcribing' || phase === 'analyzing' || phase === 'streaming';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/10">
            <Mic className="h-5 w-5 text-rose-500" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{t.speaking.title}</h1>
            <p className="text-sm text-muted-foreground">{t.speaking.desc}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {wsStatus === 'open' && (
            <Badge variant="outline" className="gap-1 text-emerald-600 border-emerald-200">
              <Wifi className="h-3 w-3" /> Live
            </Badge>
          )}
          {wsStatus === 'error' && (
            <Badge variant="outline" className="gap-1 text-red-500 border-red-200">
              <WifiOff className="h-3 w-3" /> Disconnected
            </Badge>
          )}
          <Link href="/speaking/history">
            <Button variant="outline" size="sm">
              <History className="mr-1.5 h-4 w-4" /> History
            </Button>
          </Link>
        </div>
      </div>

      {/* Mode Switcher */}
      <div className="flex gap-2 rounded-xl bg-muted/40 p-1 max-w-sm">
        <button
          onClick={() => {
            reset();
            setSpeakingMode('topic');
          }}
          className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition-all ${
            speakingMode === 'topic' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          🗣️ Luyện nói chủ đề
        </button>
        <button
          onClick={() => {
            reset();
            setSpeakingMode('coach');
          }}
          className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition-all ${
            speakingMode === 'coach' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Luyện nói theo mẫu
        </button>
      </div>

      {speakingMode === 'topic' ? (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            {[
              { label: '🎙️ Record', active: phase === 'recording' },
              { label: '📡 WebSocket', active: phase === 'connecting' },
              { label: '🔊 Whisper STT', active: phase === 'transcribing' },
              { label: '🤖 Llama Stream', active: phase === 'analyzing' || phase === 'streaming' },
              { label: '✨ Typing Effect', active: phase === 'streaming' || phase === 'done' },
            ].map(({ label, active }) => (
              <span
                key={label}
                className={`text-xs rounded-full px-2.5 py-0.5 border transition-colors ${
                  active
                    ? 'bg-primary/10 border-primary/30 text-primary font-medium'
                    : 'bg-muted/50 border-transparent text-muted-foreground/60'
                }`}
              >
                {label}
              </span>
            ))}
          </div>

          {phase === 'ready' && (
            <Card>
              <CardContent className="space-y-5 px-6 py-5">
                <div>
                  <p className="mb-2 text-sm font-medium">Language</p>
                  <select
                    className="w-full rounded-xl border bg-background px-3 py-2.5 text-sm transition-colors hover:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    value={targetLanguage}
                    onChange={(e) => setTargetLanguage(e.target.value)}
                  >
                    <option value="english">English</option>
                    <option value="vietnamese">Tiếng Việt</option>
                    <option value="japanese">日本語</option>
                    <option value="korean">한국어</option>
                    <option value="chinese">中文</option>
                    <option value="spanish">Español</option>
                    <option value="french">Français</option>
                    <option value="german">Deutsch</option>
                  </select>
                </div>
                <div>
                  <p className="mb-2 text-sm font-medium">{t.speaking.selectLevel}</p>
                  <div className="flex flex-wrap gap-2">
                    {levels.map((l) => (
                      <Button key={l} variant={level === l ? 'default' : 'outline'} size="sm" onClick={() => setLevel(l)}>
                        {l}
                      </Button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-sm font-medium">{t.speaking.selectCategory}</p>
                  <div className="flex flex-wrap gap-2">
                    {categories.map((c) => (
                      <Button key={c.id} variant={category === c.id ? 'default' : 'outline'} size="sm" onClick={() => setCategory(c.id)}>
                        {c.label}
                      </Button>
                    ))}
                  </div>
                </div>
                <Button variant="gradient" size="lg" onClick={generateTopic} disabled={isGeneratingTopic} className="w-full">
                  {isGeneratingTopic ? (
                    <><Loader2 className="mr-2 h-5 w-5 animate-spin" />{t.speaking.generating}</>
                  ) : (
                    <><Sparkles className="mr-2 h-5 w-5" />{t.speaking.start}</>
                  )}
                </Button>
              </CardContent>
            </Card>
          )}

          {topic && phase !== 'ready' && (
            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="space-y-4 px-6 py-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <MessageSquare className="h-5 w-5 text-primary" />
                      <h2 className="text-lg font-bold">{topic.topic}</h2>
                    </div>
                    <p className="mt-1 text-sm text-foreground/80">{topic.prompt}</p>
                  </div>
                  <Badge variant="secondary">{topic.difficulty}</Badge>
                </div>
                {topic.tips.length > 0 && (
                  <div>
                    <button
                      className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                      onClick={() => setShowTips(!showTips)}
                    >
                      <Lightbulb className="h-3.5 w-3.5" /> Tips
                      {showTips ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    </button>
                    {showTips && (
                      <ul className="mt-2 space-y-1.5">
                        {topic.tips.map((tip, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />{tip}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                {topic.samplePhrases.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {topic.samplePhrases.map((phrase, i) => (
                      <Badge key={i} variant="outline" className="cursor-pointer text-xs" onClick={() => speakWord(phrase)}>
                        <Volume2 className="mr-1 h-3 w-3" />{phrase}
                      </Badge>
                    ))}
                  </div>
                )}
                {(phase === 'topic' || phase === 'recording') && (
                  <div className="flex items-center gap-3 pt-2">
                    {phase === 'topic' ? (
                      <Button variant="gradient" onClick={startRecording}>
                        <Mic className="mr-2 h-4 w-4" />{t.speaking.record}
                      </Button>
                    ) : (
                      <Button variant="destructive" onClick={stopRecording}>
                        <MicOff className="mr-2 h-4 w-4" />{t.speaking.stop} ({formatTime(timer)})
                      </Button>
                    )}
                    <Button variant="ghost" onClick={reset} disabled={phase === 'recording'}>
                      <RefreshCw className="mr-2 h-4 w-4" />{t.speaking.newTopic}
                    </Button>
                  </div>
                )}
                {phase === 'recording' && (
                  <div className="flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 dark:border-rose-900/30 dark:bg-rose-950/20 px-4 py-3">
                    <div className="flex gap-1 items-end h-6">
                      {[6, 10, 14, 10, 6].map((h, i) => (
                        <span
                          key={i}
                          className="block w-1 rounded-full bg-rose-500 animate-pulse"
                          style={{ height: h + 'px', animationDelay: i * 120 + 'ms' }}
                        />
                      ))}
                    </div>
                    <p className="text-sm font-medium text-rose-600 dark:text-rose-400">
                      🔴 Recording... {formatTime(timer)}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {isProcessing && (
            <Card>
              <CardContent className="flex flex-col items-center gap-4 px-6 py-8 text-center">
                <div className="relative flex h-16 w-16 items-center justify-center">
                  <div className="absolute inset-0 rounded-full border-2 border-primary/20 animate-ping" />
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
                <div>
                  <p className="font-medium">
                    {phase === 'connecting' && 'Connecting to WebSocket...'}
                    {phase === 'transcribing' && 'Groq Whisper — Transcribing audio...'}
                    {phase === 'analyzing' && 'Llama 3.3 — Analyzing your speech...'}
                    {phase === 'streaming' && 'Streaming AI feedback...'}
                  </p>
                  {statusMsg && phase !== 'streaming' && (
                    <p className="mt-1 text-sm text-muted-foreground">{statusMsg}</p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {transcript && (phase === 'analyzing' || phase === 'streaming' || phase === 'done') && (
            <Card className="border-blue-200/50 bg-blue-50/30 dark:border-blue-900/30 dark:bg-blue-950/10">
              <CardContent className="px-6 py-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400 mb-2">
                  Nội dung hệ thống nhận dạng
                </p>
                <p className="text-sm italic text-foreground/90">&ldquo;{transcript}&rdquo;</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {transcript.split(/\s+/).filter(Boolean).map((word, index) => (
                    <span key={`${word}-${index}`} className="rounded-md bg-blue-500/10 px-2 py-0.5 text-xs text-blue-700 dark:text-blue-300">
                      {word.replace(/[.,!?;:]+$/, '')}
                    </span>
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">Các từ ở trên là những gì hệ thống nhận ra; hãy đối chiếu với câu bạn định nói.</p>
              </CardContent>
            </Card>
          )}

          {recordingUrl && (
            <audio aria-label="Nghe lại bản ghi của bạn" controls src={recordingUrl} className="w-full" />
          )}

          {(phase === 'streaming' || phase === 'done') && streamingText && (
            <Card>
              <CardHeader className="px-6 pt-5 pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  Phản hồi dựa trên bản chép lời
                  {phase === 'streaming' && (
                    <span className="ml-auto text-xs font-normal text-muted-foreground flex items-center gap-1.5">
                      <span className="inline-block h-3.5 w-0.5 bg-primary animate-pulse rounded-full" />
                      Typing...
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-6 pb-5">
                <div className="space-y-1">
                  <TranscriptFeedback text={streamingText} />
                  {phase === 'streaming' && (
                    <span className="inline-block h-4 w-0.5 bg-primary animate-pulse ml-0.5 align-middle rounded-full" />
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {phase === 'done' && !scores && (
            <Card className="border-amber-200 bg-amber-50/40 dark:border-amber-900/30 dark:bg-amber-950/10">
              <CardContent className="px-6 py-5 flex items-start gap-3">
                <span className="text-2xl">⚠️</span>
                <div className="flex-1">
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                    Không thể tính điểm cho lần này (AI bỏ qua khối điểm số). Phần feedback ở trên vẫn dùng được.
                  </p>
                  <Button size="sm" variant="outline" onClick={tryAgain} className="mt-3">
                    <RefreshCw className="mr-2 h-3.5 w-3.5" /> Thử ghi âm lại
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {phase === 'done' && scores && (
            <div className="space-y-4">
              <Card>
                <CardContent className="px-6 py-6">
                  <div className="flex flex-col items-center gap-3 text-center">
                    <div className={`text-6xl font-bold tabular-nums ${scoreColor(scores.overall)}`}>
                      {scores.overall}
                    </div>
                    <p className="text-sm font-medium text-muted-foreground">Điểm nội dung bản chép lời</p>
                    <Progress value={scores.overall} variant={scoreVariant(scores.overall)} size="lg" className="max-w-xs" />
                  </div>
                </CardContent>
              </Card>
              <div className="grid gap-3 grid-cols-2">
                {[
                  { label: t.speaking.grammarLabel, score: scores.grammar, icon: '📝' },
                  { label: t.speaking.vocabularyLabel, score: scores.vocabulary, icon: '📚' },
                ].map((item) => (
                  <Card key={item.label}>
                    <CardContent className="flex flex-col items-center gap-2 p-4">
                      <span className="text-2xl">{item.icon}</span>
                      <span className={`text-2xl font-bold tabular-nums ${scoreColor(item.score)}`}>{item.score}</span>
                      <p className="text-xs text-muted-foreground text-center">{item.label}</p>
                      <Progress value={item.score} variant={scoreVariant(item.score)} size="sm" className="w-full" />
                    </CardContent>
                  </Card>
                ))}
              </div>
              <div className="flex gap-3">
                <Button variant="gradient" onClick={tryAgain} className="flex-1">
                  <Mic className="mr-2 h-4 w-4" />Try Again
                </Button>
                <Button variant="outline" onClick={reset} className="flex-1">
                  <RefreshCw className="mr-2 h-4 w-4" />New Topic
                </Button>
              </div>
            </div>
          )}
        </>
      ) : (
        /* Practice a sample sentence */
        <div className="space-y-6 animate-fade-in">
          <Card>
            <CardContent className="space-y-5 px-6 py-5">
              <div>
                <p className="mb-2 text-sm font-medium">Language</p>
                <select
                  className="w-full rounded-xl border bg-background px-3 py-2.5 text-sm transition-colors hover:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  value={targetLanguage}
                  onChange={(e) => setTargetLanguage(e.target.value)}
                >
                  <option value="english">English</option>
                  <option value="vietnamese">Tiếng Việt</option>
                  <option value="japanese">日本語</option>
                  <option value="korean">한국어</option>
                  <option value="chinese">中文</option>
                  <option value="spanish">Español</option>
                  <option value="french">Français</option>
                  <option value="german">Deutsch</option>
                </select>
              </div>

              <div>
                <p className="mb-2 text-sm font-medium">Câu hoặc đoạn văn cần luyện</p>
                <textarea
                  value={targetSentence}
                  onChange={(e) => setTargetSentence(e.target.value)}
                  placeholder="Nhập câu cần luyện..."
                  className="w-full min-h-20 rounded-xl border bg-background px-3 py-2.5 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
                
                {/* Presets */}
                <div className="mt-2 flex flex-wrap gap-1.5 items-center">
                  <span className="text-xs text-muted-foreground">Mẫu:</span>
                  {[
                    { text: 'The quick brown fox jumps over the lazy dog', label: 'Fox' },
                    { text: 'She sells seashells by the seashore', label: 'Seashells' },
                    { text: 'How much wood would a woodchuck chuck?', label: 'Woodchuck' },
                    { text: 'Chúc bạn một ngày học tập vui vẻ!', label: 'Tiếng Việt' },
                    { text: 'こんにちは、はじめまして。', label: 'Tiếng Nhật' },
                  ].map((preset) => (
                    <Badge
                      key={preset.label}
                      variant="outline"
                      className="cursor-pointer hover:bg-primary/5 hover:text-primary transition-colors text-xs"
                      onClick={() => setTargetSentence(preset.text)}
                    >
                      {preset.label}
                    </Badge>
                  ))}
                  
                  {/* Load from active Topic if available */}
                  {topic && topic.samplePhrases && topic.samplePhrases.length > 0 && (
                    <Badge
                      variant="outline"
                      className="cursor-pointer bg-primary/5 text-primary border-primary/20 hover:bg-primary/10 transition-colors text-xs"
                      onClick={() => setTargetSentence(topic.samplePhrases[0])}
                    >
                      ✨ Dùng câu từ chủ đề đang học
                    </Badge>
                  )}
                </div>
              </div>

              {/* Target display with Diff coloring */}
              <div className="rounded-xl border border-border/80 bg-muted/20 p-5 min-h-24 flex flex-col justify-center">
                {coachScore !== null && (
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Kết quả phân tích:</p>
                )}
                <div className="flex flex-wrap gap-x-2 gap-y-3 items-center text-lg font-medium leading-relaxed">
                  {coachScore !== null ? (
                    coachDiff.map((item, idx) => (
                      <span
                        key={idx}
                        className={`px-1.5 py-0.5 rounded-md border ${
                          item.status === 'correct'
                            ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:bg-emerald-500/20 dark:text-emerald-400'
                            : 'bg-rose-500/10 text-rose-600 border-rose-500/20 dark:bg-rose-500/20 dark:text-rose-400'
                        }`}
                      >
                        {item.word}
                      </span>
                    ))
                  ) : (
                    <span className="text-muted-foreground/70">{targetSentence}</span>
                  )}
                </div>
              </div>

              {/* Active microphone status */}
              {isCoachListening && (
                <div className="flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 dark:border-rose-900/30 dark:bg-rose-950/20 px-4 py-3 animate-pulse">
                  <div className="flex gap-1 items-end h-6">
                    {[6, 10, 14, 10, 6].map((h, i) => (
                      <span
                        key={i}
                        className="block w-1 rounded-full bg-rose-500 animate-pulse"
                        style={{ height: h + 'px', animationDelay: i * 120 + 'ms' }}
                      />
                    ))}
                  </div>
                  <p className="text-sm font-medium text-rose-600 dark:text-rose-400">
                    🔴 Đang nghe... Hãy nói câu trên vào microphone.
                  </p>
                </div>
              )}

              {/* Real-time transcript preview */}
              {coachTranscript && (
                <div className="rounded-xl border border-blue-200/50 bg-blue-50/30 p-4 dark:border-blue-900/30 dark:bg-blue-950/10">
                  <p className="text-xs font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400 mb-1">
                    🔊 Nội dung nhận diện:
                  </p>
                  <p className="text-sm italic text-foreground/90">&ldquo;{coachTranscript}&rdquo;</p>
                </div>
              )}

              {/* Score Display Card */}
              {coachScore !== null && (
                <Card className="border-primary/20 bg-primary/[0.02] overflow-hidden">
                  <CardContent className="p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div className="text-center sm:text-left space-y-1">
                      <p className="text-sm text-muted-foreground font-medium">Tỷ lệ từ nhận dạng khớp câu mẫu</p>
                      <h2 className="text-3xl font-extrabold text-foreground flex items-baseline gap-1.5 justify-center sm:justify-start">
                        <span className={scoreColor(coachScore)}>{coachScore}%</span>
                      </h2>
                      <p className="text-xs text-muted-foreground">
                        {coachScore === 100 ? 'Hệ thống nhận dạng được đủ từ theo thứ tự trong câu mẫu.' :
                          'Nghe mẫu rồi thử lại các từ hệ thống chưa nhận dạng được.'}
                      </p>
                    </div>
                    <Progress value={coachScore} variant={scoreVariant(coachScore)} size="lg" className="w-full sm:max-w-44 shrink-0" />
                  </CardContent>
                </Card>
              )}

              {/* Control Buttons */}
              <div className="flex gap-3 pt-2">
                {isCoachListening ? (
                  <Button variant="destructive" onClick={stopCoachListening} className="w-full h-12 text-sm rounded-xl">
                    <MicOff className="mr-2 h-4 w-4" /> Dừng và đối chiếu
                  </Button>
                ) : (
                  <Button variant="gradient" onClick={startCoachListening} className="w-full h-12 text-sm rounded-xl">
                    <Mic className="mr-2 h-4 w-4" /> Bắt đầu luyện nói
                  </Button>
                )}
                {coachScore !== null && (
                  <Button variant="outline" onClick={() => { setCoachTranscript(''); setCoachScore(null); setCoachDiff([]); }} className="h-12 text-sm rounded-xl">
                    Làm lại
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 dark:border-red-900/30 dark:bg-red-950/20 px-4 py-3">
          <p className="text-sm font-medium text-red-600 dark:text-red-400">⚠️ {error}</p>
        </div>
      )}
    </div>
  );
}
