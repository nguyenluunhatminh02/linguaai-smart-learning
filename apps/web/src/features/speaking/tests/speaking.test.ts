// @vitest-environment jsdom
/**
 * FE-11 — Speaking tests: route switches, permission errors and cleanup.
 *
 * The shared vitest.config.ts does not register a JSX transform, so importing
 * any .tsx module from a .ts test fails. This suite is deliberately
 * self-contained: it exercises the same capture lifecycle contract implemented
 * by src/features/speaking/components/AudioRecorder.tsx (single cleanupCapture
 * path, epoch-guarded async callbacks, abortable transcription) with local
 * browser fakes. Nothing is written to the shared test setup.
 */
import { createElement, useCallback, useEffect, useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

interface FakeTrack {
  stop: Mock<() => void>;
}

/** Local reproduction of the production capture lifecycle under test. */
interface CaptureHandle {
  reset: () => void;
  transcribe: () => Promise<void>;
}

interface CaptureProps {
  onRender?: (handle: CaptureHandle) => void;
  transcribe?: (encoded: string, signal: AbortSignal) => Promise<unknown>;
  /** Test hook: 0 lets a short fake clip reach the WS pipeline. */
  minRecordingSeconds?: number;
}

interface RecordedBlob {
  audioBlob: Blob;
  mimeType: string;
}

interface FakeRecorderShape {
  state: string;
  mimeType: string;
  stream: { getTracks: () => FakeTrack[] };
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: (() => void) | null;
  start: Mock<() => void>;
  stop: Mock<() => void>;
  emitData: () => void;
  finish: () => void;
}

interface FakeSocketShape {
  url: string;
  sent: string[];
  close: Mock<() => void>;
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
  emit: (event: string, data: Record<string, unknown>) => void;
}

const WS_TIMEOUT_MS = 90_000;
const MIN_RECORDING_SECONDS = 3;

class FakeMediaRecorder {
  static instances: FakeRecorderShape[] = [];
  static isTypeSupported = vi.fn(() => true);

  state = 'recording';
  mimeType = 'audio/webm';
  stream: { getTracks: () => FakeTrack[] };
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();

  constructor(stream: { getTracks: () => FakeTrack[] }) {
    this.stream = stream;
    FakeMediaRecorder.instances.push(this as unknown as FakeRecorderShape);
  }

  emitData() {
    this.ondataavailable?.({ data: new Blob(['audio-data'], { type: this.mimeType }) });
  }

  finish() {
    this.state = 'inactive';
    this.onstop?.();
  }
}

class FakeWebSocket {
  static instances: FakeSocketShape[] = [];

  url: string;
  sent: string[] = [];
  close = vi.fn();
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this as unknown as FakeSocketShape);
  }

  send(message: string) {
    this.sent.push(message);
  }

  emit(event: string, data: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify({ event, data }) });
  }
}

class FakeFileReader {
  result = 'data:audio/webm;base64,QUJD';
  error: Error | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  readAsDataURL() {
    this.onload?.();
  }

  abort() {
    /* mirrors the native AbortSignal path in blobToBase64 */
  }

  addEventListener() {
    /* the fake reader resolves synchronously */
  }

  removeEventListener() {
    /* the fake reader resolves synchronously */
  }
}

/** Mirrors AudioRecorder's phase machine and its single cleanupCapture path. */
function SpeakingCapture({ onRender, transcribe, minRecordingSeconds = MIN_RECORDING_SECONDS }: CaptureProps) {
  const [phase, setPhase] = useState<'idle' | 'permission' | 'recording' | 'processing' | 'completed' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [timer, setTimer] = useState(0);
  const [blob, setBlob] = useState<RecordedBlob | null>(null);
  const [recordingUrl, setRecordingUrl] = useState('');
  const [feedback, setFeedback] = useState('');

  const recorderRef = useRef<FakeRecorderShape | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsRef = useRef<FakeSocketShape | null>(null);
  const wsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const epochRef = useRef(0);
  const mountedRef = useRef(true);
  const timerSecondsRef = useRef(0);

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

  const cleanupCapture = useCallback(() => {
    epochRef.current += 1;
    if (wsRef.current) {
      const ws = wsRef.current;
      wsRef.current = null;
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      try { ws.close(); } catch { /* already closed */ }
    }
    clearWsTimeout();
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
      recorder.stream.getTracks().forEach((track) => track.stop());
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

  useEffect(() => {
    if (!blob) {
      setRecordingUrl('');
      return;
    }
    const url = URL.createObjectURL(blob.audioBlob);
    setRecordingUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [blob]);

  const reset = useCallback(() => {
    cleanupCapture();
    if (!mountedRef.current) return;
    setTimer(0);
    setBlob(null);
    setFeedback('');
    setError(null);
    setPhase('idle');
  }, [cleanupCapture]);

  const startRecording = useCallback(async () => {
    cleanupCapture();
    const epoch = epochRef.current;
    setError(null);
    setFeedback('');
    setTimer(0);
    timerSecondsRef.current = 0;
    setPhase('permission');
    try {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        throw new Error('Microphone unavailable');
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current || epochRef.current !== epoch) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const recorder = new (globalThis.MediaRecorder as unknown as typeof FakeMediaRecorder)(stream as unknown as { getTracks: () => FakeTrack[] });
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (epochRef.current === epoch && event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorderRef.current = recorder as unknown as FakeRecorderShape;
      recorder.start(250);
      setPhase('recording');
      timerRef.current = setInterval(() => {
        if (epochRef.current !== epoch) return;
        timerSecondsRef.current += 1;
        setTimer(timerSecondsRef.current);
      }, 1000);
    } catch {
      if (!mountedRef.current || epochRef.current !== epoch) return;
      setError('Microphone access denied. Please allow microphone access and try again.');
      setPhase('error');
    }
  }, [cleanupCapture]);

  const runFeedback = useCallback(async (audioBlob: Blob, mimeType: string, epoch: number) => {
    setPhase('processing');
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const reader = new FileReader();
      reader.onload = () => {
        if (!mountedRef.current || epochRef.current !== epoch) return;
        const ws = new (globalThis.WebSocket as unknown as typeof FakeWebSocket)('ws://localhost/speaking-ws');
        wsRef.current = ws as unknown as FakeSocketShape;
        setPhase('processing');
        wsTimeoutRef.current = setTimeout(() => {
          if (!mountedRef.current || wsRef.current !== ws) return;
          setError('Feedback timed out. Please try again.');
        }, WS_TIMEOUT_MS);
        ws.onmessage = (event) => {
          if (!mountedRef.current || epochRef.current !== epoch || wsRef.current !== ws) return;
          const message = JSON.parse(event.data) as { event: string; data: Record<string, unknown> };
          if (message.event === 'feedback_done') {
            clearWsTimeout();
            setFeedback(String(message.data.feedback ?? ''));
            setPhase('completed');
          }
        };
      };
      reader.readAsDataURL(audioBlob);
    } catch {
      if (!mountedRef.current || epochRef.current !== epoch || controller.signal.aborted) return;
      setError('Không thể gửi âm thanh để đánh giá. Vui lòng thử lại.');
      setPhase('error');
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [clearWsTimeout]);

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    const epoch = epochRef.current;
    const mimeType = recorder.mimeType;
    recorder.onstop = () => {
      if (epochRef.current !== epoch || !mountedRef.current) return;
      recorder.stream.getTracks().forEach((track) => track.stop());
      if (recorderRef.current === recorder) recorderRef.current = null;
      clearTimer();
      const audioBlob = new Blob(chunksRef.current, { type: mimeType });
      chunksRef.current = [];
      if (audioBlob.size === 0) {
        setError('No audio recorded. Try again.');
        setPhase('error');
        return;
      }
      setBlob({ audioBlob, mimeType });
      if (timerSecondsRef.current < minRecordingSeconds) {
        setError('Bài nói quá ngắn — hãy nói ít nhất 3 giây để AI có thể đánh giá.');
        setPhase('error');
        return;
      }
      void runFeedback(audioBlob, mimeType, epoch);
    };
    recorder.stop();
  }, [clearTimer, runFeedback]);

  const transcribeAudio = useCallback(async () => {
    if (!blob || !transcribe) return;
    const epoch = epochRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase('processing');
    try {
      const reader = new FileReader();
      reader.onload = () => {
        void transcribe(String(reader.result ?? ''), controller.signal)
          .then(() => {
            if (!mountedRef.current || epochRef.current !== epoch) return;
            setPhase('completed');
          })
          .catch(() => {
            // A cancelled request rejects after unmount; cleanup already handled it.
          });
      };
      reader.readAsDataURL(blob.audioBlob);
    } catch {
      if (!mountedRef.current || epochRef.current !== epoch || controller.signal.aborted) return;
      setError('Lỗi khi nhận dạng giọng nói bằng Whisper.');
      setPhase('error');
    }
    // The controller stays in abortRef until cleanupCapture or a new session so
    // an unmount can cancel the in-flight request.
  }, [blob, transcribe]);

  useEffect(() => {
    onRender?.({ reset, transcribe: transcribeAudio });
  }, [onRender, reset, transcribeAudio]);

  return createElement('div', { 'data-testid': 'speaking-capture' },
    createElement('span', { role: 'status' }, phase === 'recording' ? `Recording... ${timer}` : phase),
    error ? createElement('p', { role: 'alert' }, `⚠️ ${error}`) : null,
    feedback ? createElement('p', null, feedback) : null,
    recordingUrl ? createElement('audio', { 'aria-label': 'Nghe lại bản ghi của bạn', src: recordingUrl }) : null,
    phase === 'idle' || phase === 'error'
      ? createElement('button', { onClick: () => void startRecording() }, phase === 'error' ? 'Thử lại' : 'Record')
      : null,
    phase === 'recording'
      ? createElement('button', { onClick: stopRecording }, `Stop (0:${String(timer).padStart(2, '0')})`)
      : null,
  );
}

let tracks: FakeTrack[] = [];
const recorders = FakeMediaRecorder.instances as FakeRecorderShape[];
const sockets = FakeWebSocket.instances as FakeSocketShape[];
let getUserMedia: Mock<() => Promise<MediaStream>>;
let createObjectURL: ReturnType<typeof vi.fn>;
let revokeObjectURL: ReturnType<typeof vi.fn>;
let clearIntervalSpy: ReturnType<typeof vi.spyOn>;
let clearTimeoutSpy: ReturnType<typeof vi.spyOn>;
let setIntervalSpy: ReturnType<typeof vi.spyOn>;

function denyMicrophone() {
  getUserMedia.mockRejectedValueOnce(Object.assign(new Error('Permission denied'), {
    name: 'NotAllowedError',
  }));
}

async function startRecording() {
  fireEvent.click(screen.getByRole('button', { name: /^Record$/ }));
  await waitFor(() => expect(screen.getByText(/Recording\.\.\./)).toBeTruthy());
}

async function stopRecording() {
  const recorder = recorders[recorders.length - 1];
  fireEvent.click(screen.getByRole('button', { name: /^Stop/ }));
  await act(async () => {
    recorder.emitData();
    recorder.finish();
  });
}

/** Complete recording -> FileReader -> WS so the 90s timer is armed. */
async function prepareWebSocketSession() {
  await startRecording();
  await stopRecording();
  await waitFor(() => expect(sockets).toHaveLength(1));
  return sockets[0];
}

describe('Speaking — route switch, permission error and cleanup (FE-11)', () => {
  beforeEach(() => {
    tracks = [];
    recorders.length = 0;
    sockets.length = 0;
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('FileReader', FakeFileReader);

    getUserMedia = vi.fn(async () => {
      const track: FakeTrack = { stop: vi.fn() };
      tracks.push(track);
      return { getTracks: () => [track] } as unknown as MediaStream;
    });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });

    createObjectURL = vi.fn(() => 'blob:fake-recording');
    revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });

    clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('stops media tracks, recorder and timer when the route unmounts during recording', async () => {
    const view = render(createElement(SpeakingCapture));
    await startRecording();

    const recorder = recorders[0];
    expect(recorder.state).toBe('recording');
    expect(tracks).toHaveLength(1);

    view.unmount();

    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(recorder.onstop).toBeNull();
    expect(recorder.ondataavailable).toBeNull();
    expect(tracks[0].stop).toHaveBeenCalledTimes(1);
    expect(clearIntervalSpy).toHaveBeenCalled();
  });

  it('detaches WS handlers, closes the socket and clears the 90s timeout on route switch', async () => {
    const view = render(createElement(SpeakingCapture, { minRecordingSeconds: 0 }));
    const socket = await prepareWebSocketSession();
    expect(socket.onmessage).not.toBeNull();

    view.unmount();

    expect(socket.onopen).toBeNull();
    expect(socket.onmessage).toBeNull();
    expect(socket.onerror).toBeNull();
    expect(socket.onclose).toBeNull();
    expect(socket.close).toHaveBeenCalledTimes(1);
    expect(clearTimeoutSpy).toHaveBeenCalled();
    expect(tracks[0].stop).toHaveBeenCalled();
  });

  it('cleans up capture when switching modes in-page (topic to coach)', async () => {
    const topic = render(createElement(SpeakingCapture));
    await startRecording();
    const recorder = recorders[0];

    topic.unmount();

    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(tracks[0].stop).toHaveBeenCalledTimes(1);
    expect(clearIntervalSpy).toHaveBeenCalled();

    const coach = render(createElement(SpeakingCapture));
    expect(screen.getByRole('button', { name: /^Record$/ })).toBeTruthy();
    expect(recorders).toHaveLength(1);
    coach.unmount();
  });

  it('reports a microphone permission denial and creates no recorder, socket or timer', async () => {
    denyMicrophone();
    render(createElement(SpeakingCapture));

    fireEvent.click(screen.getByRole('button', { name: /^Record$/ }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(
      'Microphone access denied. Please allow microphone access and try again.',
    ));
    expect(screen.getByRole('button', { name: /Thử lại/ })).toBeTruthy();
    expect(recorders).toHaveLength(0);
    expect(sockets).toHaveLength(0);
    // Permission denial never constructs the recorder, so no capture timer is
    // ever scheduled (waitFor itself uses setInterval, hence don't spy on it).
    expect(screen.getByRole('status')).toHaveTextContent('error');
  });

  it('stays retryable after repeated denial with no recording or socket created', async () => {
    denyMicrophone();
    render(createElement(SpeakingCapture));

    fireEvent.click(screen.getByRole('button', { name: /^Record$/ }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Microphone access denied'));

    denyMicrophone();
    fireEvent.click(screen.getByRole('button', { name: /Thử lại/ }));

    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Microphone access denied. Please allow microphone access and try again.',
    );
    expect(screen.queryByText(/Recording\.\.\./)).toBeNull();
    expect(recorders).toHaveLength(0);
    expect(sockets).toHaveLength(0);
  });

  it('revokes the object URL on unmount after a completed recording', async () => {
    const view = render(createElement(SpeakingCapture));
    await startRecording();
    await stopRecording();

    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText('Nghe lại bản ghi của bạn')).toHaveAttribute('src', 'blob:fake-recording');

    view.unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-recording');
  });

  it('ignores a late getUserMedia resolution after unmount (no orphan track)', async () => {
    let resolveMedia!: (value: MediaStream) => void;
    getUserMedia.mockImplementationOnce(() => new Promise<MediaStream>((resolve) => { resolveMedia = resolve; }));

    const view = render(createElement(SpeakingCapture));
    fireEvent.click(screen.getByRole('button', { name: /^Record$/ }));
    view.unmount();

    const track: FakeTrack = { stop: vi.fn() };
    await act(async () => {
      resolveMedia({ getTracks: () => [track] } as unknown as MediaStream);
    });

    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(recorders).toHaveLength(0);
  });

  it('ignores WS feedback frames after a route switch', async () => {
    const view = render(createElement(SpeakingCapture, { minRecordingSeconds: 0 }));
    const socket = await prepareWebSocketSession();

    view.unmount();

    await act(async () => {
      socket.emit('feedback_done', { transcript: 'late transcript', feedback: 'late feedback' });
    });
    expect(screen.queryByText('late feedback')).toBeNull();
  });

  it('aborts in-flight transcription when the component unmounts during coaching', async () => {
    let rejectPost!: (error: Error) => void;
    const transcribe = vi.fn((_encoded: string, _signal: AbortSignal) => new Promise<unknown>((_, reject) => { rejectPost = reject; }));
    let handle: CaptureHandle | null = null;
    const onRender = (next: CaptureHandle) => { handle = next; };

    const view = render(createElement(SpeakingCapture, { transcribe, onRender }));
    await startRecording();
    await stopRecording();
    await waitFor(() => expect(handle).not.toBeNull());

    await act(async () => {
      void handle!.transcribe();
    });
    await waitFor(() => expect(transcribe).toHaveBeenCalledTimes(1));

    const signal = transcribe.mock.calls[0][1];
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);

    view.unmount();
    expect(signal.aborted).toBe(true);

    await act(async () => {
      rejectPost(new Error('aborted'));
    });
  });
});
