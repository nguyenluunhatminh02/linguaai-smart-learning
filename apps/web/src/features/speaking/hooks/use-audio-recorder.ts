'use client';

/**
 * Headless audio recorder for the speaking feature.
 *
 * Owns the permission → recording → encoding → ready lifecycle, the optional
 * upload phase, and every browser resource that has to be released. Transport
 * (WebSocket / REST) stays with the caller: the hook only hands out an AbortSignal
 * so an in-flight upload can be cancelled when the recorder is reset.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type PermissionState = 'unknown' | 'prompt' | 'granted' | 'denied' | 'unavailable';

export type RecorderStatus =
  | 'idle'
  | 'requesting-permission'
  | 'recording'
  | 'encoding'
  | 'ready'
  | 'uploading'
  | 'error';

export type RecorderErrorCode =
  | 'PERMISSION_DENIED'
  | 'PERMISSION_UNAVAILABLE'
  | 'NOT_SUPPORTED'
  | 'ALREADY_RECORDING'
  | 'NOT_RECORDING'
  | 'NO_AUDIO'
  | 'TOO_SHORT'
  | 'TOO_LONG'
  | 'ENCODE_FAILED'
  | 'UPLOAD_FAILED'
  | 'ABORTED'
  | 'START_FAILED'
  | 'STOP_FAILED';

export interface RecorderError {
  code: RecorderErrorCode;
  cause?: unknown;
}

export interface AudioRecording {
  blob: Blob;
  /** Object URL for <audio>. Revoked when the recording is replaced/disposed. */
  url: string;
  mimeType: string;
  durationMs: number;
  /** Lazily computes base64 (without the data: prefix) on first access. */
  encoded(): Promise<string>;
}

export interface UseAudioRecorderOptions {
  /** Minimum useful clip length; shorter clips are rejected with TOO_SHORT. Default 3000 ms. */
  minDurationMs?: number;
  /** Auto-stop and produce a recording at this length. Default 120000 ms. */
  maxDurationMs?: number;
  /** MediaStreamConstraints passed to getUserMedia. Default { audio: true }. */
  constraints?: MediaStreamConstraints;
  /** MediaRecorder timeslice in ms. Default 250. */
  timeslice?: number;
  /** Called whenever the automatic limit stops a recording. */
  onMaxDurationReached?: (durationMs: number) => void;
}

export interface UseAudioRecorderResult {
  status: RecorderStatus;
  permission: PermissionState;
  elapsedMs: number;
  recording: AudioRecording | null;
  error: RecorderError | null;
  /** Signal aborted by dispose(), start(), or a new requestPermission(). */
  signal: AbortSignal;
  isRecording: boolean;
  isUploading: boolean;
  requestPermission: () => Promise<boolean>;
  start: () => Promise<boolean>;
  /** Stops, encodes, and returns the recording. Returns null on failure. */
  stop: () => Promise<AudioRecording | null>;
  /** Runs an upload callback, tracking the uploading phase; returns its result or null if aborted/failed. */
  upload: <T>(task: (encoded: string, signal: AbortSignal) => Promise<T>) => Promise<T | null>;
  /** Releases all resources and clears the recording. Safe to call repeatedly. */
  dispose: () => void;
}

const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
];

function supportedMimeType(): string {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return 'audio/webm';
  }
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) ?? 'audio/webm';
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof FileReader === 'undefined') {
      reject(new Error('FileReader is unavailable'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Unexpected FileReader result'));
        return;
      }
      resolve(result.includes(',') ? result.slice(result.indexOf(',') + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to encode audio'));
    reader.readAsDataURL(blob);
  });
}

function normalizeError(error: unknown): RecorderErrorCode {
  const name = error instanceof DOMException ? error.name : '';
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? Number((error as { code: unknown }).code)
    : 0;
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError' || code === 1) {
    return 'PERMISSION_DENIED';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError' || code === 8) {
    return 'PERMISSION_UNAVAILABLE';
  }
  return 'START_FAILED';
}

/**
 * Hook implementing the audio capture lifecycle with strict resource cleanup.
 *
 * Phases:
 *  idle → requesting-permission → recording → encoding → ready → uploading → ready
 * Any phase may transition to error; dispose() returns to idle.
 */
export function useAudioRecorder(options: UseAudioRecorderOptions = {}): UseAudioRecorderResult {
  const {
    minDurationMs = 3000,
    maxDurationMs = 120_000,
    constraints = { audio: true },
    timeslice = 250,
    onMaxDurationReached,
  } = options;

  const [status, setStatus] = useState<RecorderStatus>('idle');
  const [permission, setPermission] = useState<PermissionState>('unknown');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [recording, setRecordingState] = useState<AudioRecording | null>(null);
  const [error, setError] = useState<RecorderError | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const urlRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAtRef = useRef(0);
  const stoppingRef = useRef(false);
  const operationRef = useRef(0);
  const permissionPromiseRef = useRef<Promise<boolean> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const signal = useMemo(() => {
    if (!abortRef.current || abortRef.current.signal.aborted) {
      abortRef.current = new AbortController();
    }
    return abortRef.current.signal;
  }, []);

  const fail = useCallback((code: RecorderErrorCode, cause?: unknown) => {
    setError({ code, cause });
    setStatus('error');
  }, []);

  const clearTimers = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (maxTimerRef.current !== null) {
      clearTimeout(maxTimerRef.current);
      maxTimerRef.current = null;
    }
  }, []);

  const releaseMedia = useCallback(() => {
    clearTimers();
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onerror = null;
      recorder.onstop = null;
      if (recorder.state !== 'inactive') {
        try { recorder.stop(); } catch { /* already stopped */ }
      }
    }
    const stream = streamRef.current;
    streamRef.current = null;
    stream?.getTracks().forEach((track) => {
      try { track.stop(); } catch { /* already stopped */ }
    });
  }, [clearTimers]);

  const releaseRecording = useCallback(() => {
    if (urlRef.current) {
      try { URL.revokeObjectURL(urlRef.current); } catch { /* already revoked */ }
      urlRef.current = null;
    }
    setRecordingState(null);
  }, []);

  const dispose = useCallback(() => {
    operationRef.current += 1;
    abortRef.current?.abort();
    releaseMedia();
    releaseRecording();
    stoppingRef.current = false;
    chunksRef.current = [];
    setElapsedMs(0);
    setError(null);
    setStatus('idle');
  }, [releaseMedia, releaseRecording]);

  const probePermission = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices) {
      setPermission('unavailable');
      return false;
    }
    if (!navigator.permissions?.query) {
      setPermission((current) => (current === 'denied' ? 'denied' : 'prompt'));
      return true;
    }
    try {
      const result = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      setPermission(result.state === 'prompt' ? 'prompt' : result.state);
      result.onchange = () => {
        setPermission(result.state === 'prompt' ? 'prompt' : result.state);
      };
      return result.state !== 'denied';
    } catch {
      // Firefox/Safari throw for unknown descriptors; probing getUserMedia is
      // still possible, so do not mark the device as denied here.
      setPermission((current) => (current === 'denied' ? 'denied' : 'prompt'));
      return true;
    }
  }, []);

  const requestPermission = useCallback(async () => {
    if (permissionPromiseRef.current) return permissionPromiseRef.current;
    const promise = (async () => {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setPermission('unavailable');
        fail('PERMISSION_UNAVAILABLE');
        return false;
      }
      const allowed = await probePermission();
      if (!allowed) {
        setPermission('denied');
        fail('PERMISSION_DENIED');
        return false;
      }
      // A permission query alone does not grant microphone access: request the
      // device and release the probe stream immediately.
      let probe: MediaStream | null = null;
      try {
        probe = await navigator.mediaDevices.getUserMedia(constraints);
        setPermission('granted');
        setError(null);
        return true;
      } catch (cause) {
        const code = normalizeError(cause);
        setPermission(code === 'PERMISSION_DENIED' ? 'denied' : 'unavailable');
        fail(code, cause);
        return false;
      } finally {
        probe?.getTracks().forEach((track) => {
          try { track.stop(); } catch { /* already stopped */ }
        });
        permissionPromiseRef.current = null;
      }
    })();
    permissionPromiseRef.current = promise;
    return promise;
  }, [constraints, fail, probePermission]);

  const stop = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder || stoppingRef.current || recorder.state === 'inactive') {
      if (!recorder) fail('NOT_RECORDING');
      return null;
    }
    stoppingRef.current = true;
    const operation = operationRef.current;
    const mimeType = recorder.mimeType || supportedMimeType();
    clearTimers();
    setStatus('encoding');

    const onstop = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });
    try {
      recorder.stop();
    } catch (cause) {
      stoppingRef.current = false;
      fail('STOP_FAILED', cause);
      return null;
    }

    await onstop;
    if (operationRef.current !== operation) return null;
    const durationMs = Math.max(1, Date.now() - startedAtRef.current);
    const blob = new Blob(chunksRef.current, { type: mimeType });
    chunksRef.current = [];
    releaseMedia();
    stoppingRef.current = false;

    if (blob.size === 0) {
      releaseRecording();
      fail('NO_AUDIO');
      return null;
    }
    if (durationMs < minDurationMs) {
      releaseRecording();
      fail('TOO_SHORT');
      return null;
    }

    let encoded: string | null = null;
    const encode = async () => {
      if (encoded === null) encoded = await blobToBase64(blob);
      return encoded;
    };
    try {
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      const result: AudioRecording = {
        blob,
        url,
        mimeType,
        durationMs,
        encoded: encode,
      };
      setRecordingState(result);
      setElapsedMs(durationMs);
      setError(null);
      setStatus('ready');
      return result;
    } catch (cause) {
      releaseRecording();
      fail('ENCODE_FAILED', cause);
      return null;
    }
  }, [clearTimers, fail, minDurationMs, releaseMedia, releaseRecording]);

  const start = useCallback(async () => {
    if (status === 'recording' || recorderRef.current) {
      fail('ALREADY_RECORDING');
      return false;
    }
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setPermission('unavailable');
      fail('PERMISSION_UNAVAILABLE');
      return false;
    }
    const operation = ++operationRef.current;
    // Starting implies asking for permission; never leave the UI in 'prompt' here.
    setStatus('requesting-permission');
    setError(null);
    releaseMedia();
    releaseRecording();
    chunksRef.current = [];
    setElapsedMs(0);
    stoppingRef.current = false;
    if (!abortRef.current || abortRef.current.signal.aborted) {
      abortRef.current = new AbortController();
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (cause) {
      if (operationRef.current !== operation) return false;
      const code = normalizeError(cause);
      setPermission(code === 'PERMISSION_DENIED' ? 'denied' : 'unavailable');
      fail(code, cause);
      return false;
    }
    if (operationRef.current !== operation) {
      stream.getTracks().forEach((track) => {
        try { track.stop(); } catch { /* already stopped */ }
      });
      return false;
    }

    const mimeType = supportedMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType });
    } catch (cause) {
      stream.getTracks().forEach((track) => {
        try { track.stop(); } catch { /* already stopped */ }
      });
      if (operationRef.current !== operation) return false;
      fail('NOT_SUPPORTED', cause);
      return false;
    }

    streamRef.current = stream;
    recorderRef.current = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data?.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onerror = () => {
      if (operationRef.current !== operation) return;
      releaseMedia();
      fail('START_FAILED');
    };

    try {
      recorder.start(timeslice);
    } catch (cause) {
      releaseMedia();
      if (operationRef.current !== operation) return false;
      fail('START_FAILED', cause);
      return false;
    }

    setPermission('granted');
    setStatus('recording');
    startedAtRef.current = Date.now();
    timerRef.current = setInterval(() => {
      setElapsedMs(Date.now() - startedAtRef.current);
    }, 250);
    maxTimerRef.current = setTimeout(() => {
      if (recorderRef.current !== recorder || stoppingRef.current) return;
      onMaxDurationReached?.(Date.now() - startedAtRef.current);
      void stop();
    }, maxDurationMs);
    return true;
  }, [constraints, fail, maxDurationMs, onMaxDurationReached, releaseMedia, releaseRecording, status, stop, timeslice]);

  const upload = useCallback(async <T,>(task: (encoded: string, signal: AbortSignal) => Promise<T>): Promise<T | null> => {
    if (!recording || !urlRef.current) {
      fail('NOT_RECORDING');
      return null;
    }
    const operation = operationRef.current;
    setStatus('uploading');
    try {
      const encoded = await recording.encoded();
      if (operationRef.current !== operation || signal.aborted) {
        fail('ABORTED');
        return null;
      }
      const result = await task(encoded, signal);
      if (operationRef.current !== operation || signal.aborted) {
        fail('ABORTED');
        return null;
      }
      setStatus('ready');
      return result;
    } catch (cause) {
      if (operationRef.current !== operation || signal.aborted) {
        fail('ABORTED', cause);
        return null;
      }
      fail('UPLOAD_FAILED', cause);
      return null;
    }
  }, [fail, recording, signal]);

  useEffect(() => () => {
    operationRef.current += 1;
    abortRef.current?.abort();
    releaseMedia();
    if (urlRef.current) {
      try { URL.revokeObjectURL(urlRef.current); } catch { /* already revoked */ }
      urlRef.current = null;
    }
  }, [releaseMedia]);

  return {
    status,
    permission,
    elapsedMs,
    recording,
    error,
    signal,
    isRecording: status === 'recording',
    isUploading: status === 'uploading',
    requestPermission,
    start,
    stop,
    upload,
    dispose,
  };
}

export default useAudioRecorder;
