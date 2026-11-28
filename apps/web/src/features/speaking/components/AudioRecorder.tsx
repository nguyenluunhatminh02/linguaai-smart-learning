'use client';

/**
 * Self-contained speaking recorder extracted from the inline implementation in
 * `src/app/(dashboard)/speaking/page.tsx` (roadmap FE-01/FE-02). The owning page
 * remains responsible for topic selection and layout; this component owns every
 * capture resource and the idle/permission/recording/processing/completed/error
 * state machine, so unmounting (e.g. switching routes or modes) cannot leak
 * media tracks, timers, object URLs, WebSockets or in-flight requests.
 */

import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Mic, MicOff, Loader2, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { getAccessToken } from '@/stores/auth-store';
import { useTokenStore } from '@/stores/token-store';
import apiClient from '@/lib/api-client';

export type RecorderPhase =
  | 'idle'
  | 'permission'
  | 'recording'
  | 'processing'
  | 'completed'
  | 'error';

export interface SpeakingTopic {
  topic: string;
  prompt: string;
  tips: string[];
  samplePhrases: string[];
  duration: number;
  difficulty: string;
}

export interface SpeakingScores {
  overall: number;
  grammar: number;
  vocabulary: number;
  basis?: string;
}

export interface RecordingResult {
  transcript: string;
  feedback: string;
  scores: SpeakingScores | null;
}

export interface AudioRecorderProps {
  topic: SpeakingTopic | null;
  level: string;
  language: string;
  /** Called when the user stops/starts over or asks for a new attempt. */
  onReset?: () => void;
  /** Optional transcript consumer (coach mode comparison), kept out of WS state. */
  onTranscript?: (text: string) => void;
  className?: string;
  ref?: React.Ref<AudioRecorderHandle>;
}

export interface AudioRecorderHandle {
  /** REST Whisper fallback used by coach mode when SpeechRecognition is absent. */
  transcribe: (mimeType?: string) => Promise<void>;
}

type WsStatus = 'idle' | 'connecting' | 'open' | 'error';

const WS_TIMEOUT_MS = 90_000;
const MIN_RECORDING_SECONDS = 3;

const getWsUrl = () => {
  const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
  return apiBase.replace(/\/api(\/v\d+)?$/, '').replace(/^https/, 'wss').replace(/^http/, 'ws') + '/speaking-ws';
};

const getSupportedMimeType = () => {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  if (typeof window === 'undefined' || typeof MediaRecorder === 'undefined') return 'audio/webm';
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? 'audio/webm';
};

/** WS payloads are untrusted; never let them inject functions or raw HTML. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asText(value: unknown, maxLength = 20_000): string {
  return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

function blobToBase64(blob: Blob, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const reader = new FileReader();
    const onAbort = () => {
      reader.abort();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    const finish = () => signal?.removeEventListener('abort', onAbort);
    reader.onload = () => {
      finish();
      const result = typeof reader.result === 'string' ? reader.result : '';
      resolve(result.includes(',') ? result.split(',')[1] : result);
    };
    reader.onerror = () => {
      finish();
      reject(reader.error ?? new Error('Could not read the recording.'));
    };
    reader.readAsDataURL(blob);
  });
}

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds % 60).toString().padStart(2, '0')}`;
}

export function AudioRecorder({
  topic,
  level,
  language,
  onReset,
  onTranscript,
  className,
  ref,
}: AudioRecorderProps) {
  const [phase, setPhase] = useState<RecorderPhase>('idle');
  const [wsStatus, setWsStatus] = useState<WsStatus>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [timer, setTimer] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [recordingUrl, setRecordingUrl] = useState('');
  const [result, setResult] = useState<RecordingResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Mirrors for async callbacks: MediaRecorder.onstop, getUserMedia resolution,
  // FileReader and WS handlers must never act on a session that has been reset.
  const phaseRef = useRef<RecorderPhase>('idle');
  const setPhaseSafely = useCallback((next: RecorderPhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerSecondsRef = useRef(0);
  const wsRef = useRef<WebSocket | null>(null);
  const wsTerminalRef = useRef(false);
  const wsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // One epoch per capture session; stale async results are discarded.
  const epochRef = useRef(0);
  const mountedRef = useRef(true);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const clearWsTimeout = useCallback(() => {
    if (wsTimeoutRef.current !== null) {
      clearTimeout(wsTimeoutRef.current);
      wsTimeoutRef.current = null;
    }
  }, []);

  /**
   * Every capture resource is released through this single path: unmount,
   * reset, mode/topic change, repeated Start and permission retry.
   */
  const cleanupCapture = useCallback(() => {
    epochRef.current += 1;

    if (wsRef.current) {
      // Detach handlers first so an intentional close is not reported as a
      // dropped session by onclose, and no post-unmount state update occurs.
      const ws = wsRef.current;
      wsRef.current = null;
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      try { ws.close(); } catch { /* already closed */ }
    }
    clearWsTimeout();
    wsTerminalRef.current = false;

    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }

    if (recorderRef.current) {
      const recorder = recorderRef.current;
      recorderRef.current = null;
      recorder.ondataavailable = null;
      recorder.onerror = null;
      recorder.onstop = null;
      if (recorder.state !== 'inactive') {
        try { recorder.stop(); } catch { /* already stopped */ }
      }
      recorder.stream?.getTracks().forEach((track) => track.stop());
    }
    chunksRef.current = [];

    clearTimer();
    timerSecondsRef.current = 0;
  }, [clearTimer, clearWsTimeout]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cleanupCapture();
    };
  }, [cleanupCapture]);

  // Object URLs are created once per blob and revoked on replace/reset/unmount.
  // Revoking early would break replay of the recorded audio.
  useEffect(() => {
    if (!audioBlob) {
      setRecordingUrl('');
      return;
    }
    const url = URL.createObjectURL(audioBlob);
    setRecordingUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [audioBlob]);

  const reset = useCallback((nextPhase: RecorderPhase = 'idle') => {
    cleanupCapture();
    if (!mountedRef.current) return;
    setTimer(0);
    setAudioBlob(null);
    setResult(null);
    setStatusMessage('');
    setError(null);
    setWsStatus('idle');
    setPhaseSafely(nextPhase);
    onReset?.();
  }, [cleanupCapture, onReset, setPhaseSafely]);

  const startRecording = useCallback(async () => {
    // Repeated Start (double click, React 19 double effect, mode switch) must
    // never leave two recorders, track sets or intervals behind.
    cleanupCapture();
    const epoch = epochRef.current;
    setError(null);
    setResult(null);
    setStatusMessage('');
    setTimer(0);
    timerSecondsRef.current = 0;
    setPhaseSafely('permission');

    try {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        throw new Error('Microphone unavailable');
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current || epochRef.current !== epoch) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      if (typeof MediaRecorder === 'undefined') {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error('MediaRecorder unavailable');
      }
      const mimeType = getSupportedMimeType();
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (epochRef.current === epoch && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorderRef.current = recorder;
      recorder.start(250);
      setPhaseSafely('recording');
      timerRef.current = setInterval(() => {
        if (epochRef.current !== epoch) return;
        timerSecondsRef.current += 1;
        setTimer(timerSecondsRef.current);
      }, 1000);
    } catch {
      if (!mountedRef.current || epochRef.current !== epoch) return;
      setError('Microphone access denied. Please allow microphone access and try again.');
      setPhaseSafely('error');
    }
  }, [cleanupCapture, setPhaseSafely]);

  const runFeedbackPipeline = useCallback(async (blob: Blob, mimeType: string, epoch: number) => {
    setPhaseSafely('processing');
    const controller = new AbortController();
    abortRef.current = controller;
    setStatusMessage('Đang chuyển đổi âm thanh...');

    try {
      if (controller.signal.aborted || epochRef.current !== epoch) return;
      const base64 = await blobToBase64(blob, controller.signal);
      if (!mountedRef.current || epochRef.current !== epoch || controller.signal.aborted) return;

      setStatusMessage('Connecting...');
      const token = getAccessToken();
      const baseWs = getWsUrl();
      const wsUrl = token ? `${baseWs}?token=${encodeURIComponent(token)}` : baseWs;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      wsTerminalRef.current = false;
      setWsStatus('connecting');

      // Fail a session stuck before terminal feedback instead of spinning forever.
      wsTimeoutRef.current = setTimeout(() => {
        if (!mountedRef.current || wsRef.current !== ws || wsTerminalRef.current) return;
        if (phaseRef.current === 'processing') {
          wsTerminalRef.current = true;
          setError('Feedback timed out. Please try again.');
          setPhaseSafely('error');
          setWsStatus('error');
          clearWsTimeout();
          ws.close();
        }
      }, WS_TIMEOUT_MS);

      ws.onopen = () => {
        if (!mountedRef.current || epochRef.current !== epoch || wsRef.current !== ws) return;
        setWsStatus('open');
        ws.send(JSON.stringify({
          event: 'start_session',
          data: {
            topic: topic?.prompt || topic?.topic || 'Free speaking',
            level,
            language,
          },
        }));
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current || epochRef.current !== epoch || wsRef.current !== ws) return;
        let message: unknown;
        try {
          message = JSON.parse(typeof event.data === 'string' ? event.data : '');
        } catch {
          return;
        }
        const envelope = asRecord(message);
        const payload = asRecord(envelope?.data);
        const eventName = envelope?.event;
        if (typeof eventName !== 'string') return;

        switch (eventName) {
          case 'session_ready':
            ws.send(JSON.stringify({ event: 'audio_data', data: { audio: base64, mimeType } }));
            break;
          case 'status': {
            const statusPhase = asText(payload?.phase, 32);
            setStatusMessage(statusPhase === 'transcribing'
              ? 'Groq Whisper — Transcribing audio...'
              : 'Llama 3.3 — Analyzing your speech...');
            if (asText(payload?.message, 500)) {
              setStatusMessage(asText(payload?.message, 500));
            }
            setPhaseSafely('processing');
            break;
          }
          case 'transcript':
            onTranscript?.(asText(payload?.text));
            break;
          case 'feedback_chunk':
            // Untrusted WS text is rendered as text by <p>, never as HTML.
            setResult((previous) => ({
              transcript: previous?.transcript ?? '',
              feedback: (previous?.feedback ?? '') + asText(payload?.chunk),
              scores: previous?.scores ?? null,
            }));
            break;
          case 'feedback_done': {
            wsTerminalRef.current = true;
            clearWsTimeout();
            const feedback = asText(payload?.feedback);
            const transcript = asText(payload?.transcript);
            const scoresValue = asRecord(payload?.scores);
            const scores: SpeakingScores | null = scoresValue
              ? {
                  overall: Number(scoresValue.overall) || 0,
                  grammar: Number(scoresValue.grammar) || 0,
                  vocabulary: Number(scoresValue.vocabulary) || 0,
                  basis: asText(scoresValue.basis, 64) || undefined,
                }
              : null;
            onTranscript?.(transcript);
            setResult({ transcript, feedback, scores });
            setStatusMessage('');
            setPhaseSafely('completed');
            setWsStatus('idle');
            if (wsRef.current === ws) wsRef.current = null;
            ws.close();
            void useTokenStore.getState().loadBalance();
            break;
          }
          case 'error': {
            wsTerminalRef.current = true;
            clearWsTimeout();
            setError(asText(payload?.message, 500) || 'Đã xảy ra lỗi khi xử lý. Vui lòng thử lại.');
            setPhaseSafely('error');
            setWsStatus('error');
            if (wsRef.current === ws) wsRef.current = null;
            ws.close();
            break;
          }
          default:
            break;
        }
      };

      ws.onerror = () => {
        if (!mountedRef.current || epochRef.current !== epoch || wsRef.current !== ws) return;
        wsTerminalRef.current = true;
        clearWsTimeout();
        setError('WebSocket connection failed. Make sure the API server is running.');
        setPhaseSafely('error');
        setWsStatus('error');
      };

      ws.onclose = () => {
        if (!mountedRef.current || epochRef.current !== epoch) return;
        clearWsTimeout();
        if (wsRef.current === ws) wsRef.current = null;
        if (!wsTerminalRef.current && phaseRef.current === 'processing') {
          wsTerminalRef.current = true;
          setError('Connection closed before feedback was complete. Please try again.');
          setPhaseSafely('error');
        }
        setWsStatus('idle');
      };
    } catch {
      if (!mountedRef.current || epochRef.current !== epoch) return;
      setError('Không thể gửi âm thanh để đánh giá. Vui lòng thử lại.');
      setPhaseSafely('error');
      setWsStatus('error');
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [clearWsTimeout, language, level, onTranscript, setPhaseSafely, topic]);

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    const epoch = epochRef.current;
    const mimeType = recorder.mimeType;

    recorder.onstop = () => {
      // A cleanup (unmount/reset/mode switch) already stopped the tracks and
      // invalidated this epoch: do not upload a transcript for a dead session.
      if (epochRef.current !== epoch || !mountedRef.current) return;
      recorder.stream?.getTracks().forEach((track) => track.stop());
      if (recorderRef.current === recorder) recorderRef.current = null;
      clearTimer();
      const blob = new Blob(chunksRef.current, { type: mimeType });
      chunksRef.current = [];
      if (blob.size === 0) {
        setError('No audio recorded. Try again.');
        setPhaseSafely('error');
        return;
      }
      setAudioBlob(blob);
      if (timerSecondsRef.current < MIN_RECORDING_SECONDS) {
        setError('Bài nói quá ngắn — hãy nói ít nhất 3 giây để AI có thể đánh giá.');
        setPhaseSafely('error');
        return;
      }
      void runFeedbackPipeline(blob, mimeType, epoch);
    };

    try {
      recorder.stop();
    } catch {
      if (recorderRef.current === recorder) recorderRef.current = null;
      if (!mountedRef.current || epochRef.current !== epoch) return;
      setError('No audio recorded. Try again.');
      setPhaseSafely('error');
    }
  }, [clearTimer, runFeedbackPipeline, setPhaseSafely]);

  /** REST transcription fallback (coach mode) with an abortable axios request. */
  const transcribe = useCallback(async (mimeType: string) => {
    if (!audioBlob) return;
    const epoch = epochRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    setPhaseSafely('processing');
    setStatusMessage('Đang nhận dạng giọng nói bằng Whisper...');
    try {
      const base64 = await blobToBase64(audioBlob, controller.signal);
      if (!mountedRef.current || epochRef.current !== epoch) return;
      const { data } = await apiClient.post('/speaking/transcribe', {
        audio: base64,
        mimeType,
        language,
      }, { signal: controller.signal });
      if (!mountedRef.current || epochRef.current !== epoch) return;
      const transcript = asText(data?.transcript);
      onTranscript?.(transcript);
      setResult({ transcript, feedback: '', scores: null });
      setStatusMessage('');
      setPhaseSafely('completed');
      void useTokenStore.getState().loadBalance();
    } catch {
      if (!mountedRef.current || epochRef.current !== epoch || controller.signal.aborted) return;
      setError('Lỗi khi nhận dạng giọng nói bằng Whisper.');
      setPhaseSafely('error');
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [audioBlob, language, onTranscript, setPhaseSafely]);

  useImperativeHandle(ref, () => ({
    transcribe: (mimeType?: string) =>
      transcribe(mimeType ?? recorderRef.current?.mimeType ?? getSupportedMimeType()),
  }), [transcribe]);

  const isProcessing = phase === 'processing';
  const displayText = result?.feedback ?? '';

  return (
    <div className={className} aria-label="Trình ghi âm luyện nói">
      <span className="sr-only" role="status" aria-live="polite">
        {phase === 'permission' && 'Đang yêu cầu quyền truy cập microphone'}
        {phase === 'recording' && `Đang ghi âm ${formatTime(timer)}`}
        {isProcessing && (statusMessage || 'Đang xử lý âm thanh')}
        {phase === 'completed' && 'Đã nhận được phản hồi'}
        {phase === 'error' && (error ?? 'Có lỗi xảy ra')}
      </span>

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
      </div>

      {(phase === 'idle' || phase === 'permission' || phase === 'error') && (
        <div className="flex items-center gap-3 pt-2">
          <Button
            variant="gradient"
            onClick={() => void startRecording()}
            disabled={phase === 'permission'}
          >
            {phase === 'permission'
              ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              : <Mic className="mr-2 h-4 w-4" />}
            {phase === 'error' ? 'Thử lại' : 'Record'}
          </Button>
          <Button variant="ghost" onClick={() => reset()} disabled={phase === 'permission'}>
            <RefreshCw className="mr-2 h-4 w-4" />New Topic
          </Button>
        </div>
      )}

      {phase === 'recording' && (
        <>
          <div className="flex items-center gap-3 pt-2">
            <Button variant="destructive" onClick={stop}>
              <MicOff className="mr-2 h-4 w-4" />Stop ({formatTime(timer)})
            </Button>
            <Button variant="ghost" onClick={() => reset()}>
              <RefreshCw className="mr-2 h-4 w-4" />New Topic
            </Button>
          </div>
          <div className="mt-3 flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 dark:border-rose-900/30 dark:bg-rose-950/20">
            <div className="flex h-6 items-end gap-1">
              {[6, 10, 14, 10, 6].map((height, index) => (
                <span
                  key={index}
                  className="block w-1 animate-pulse rounded-full bg-rose-500"
                  style={{ height: `${height}px`, animationDelay: `${index * 120}ms` }}
                />
              ))}
            </div>
            <p className="text-sm font-medium text-rose-600 dark:text-rose-400">
              🔴 Recording... {formatTime(timer)}
            </p>
          </div>
        </>
      )}

      {isProcessing && (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="font-medium">{statusMessage || 'Đang xử lý âm thanh...'}</p>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-500">
          {error}
        </p>
      )}

      {recordingUrl && (
        <audio aria-label="Nghe lại bản ghi của bạn" controls src={recordingUrl} className="mt-3 w-full" />
      )}

      {phase === 'completed' && (
        <div className="mt-3 space-y-2">
          {result?.transcript && (
            <p className="text-sm italic text-foreground/90">&ldquo;{result.transcript}&rdquo;</p>
          )}
          {displayText && <p className="whitespace-pre-wrap text-sm leading-relaxed">{displayText}</p>}
          <Button variant="outline" onClick={() => void startRecording()}>
            <Mic className="mr-2 h-4 w-4" />Record again
          </Button>
        </div>
      )}
    </div>
  );
}

export default AudioRecorder;
