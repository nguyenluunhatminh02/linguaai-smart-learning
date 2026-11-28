"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_INTERVAL_MS = 50;

interface UseStreamThrottleOptions {
  intervalMs?: number;
  onFlush?: (text: string) => void;
}

interface UseStreamThrottleReturn {
  push: (text: string) => void;
  flush: () => string;
  reset: () => void;
  value: string;
  pending: string;
}

/**
 * Batches bursty stream text into at most one state update per interval.
 * `value` is always the full text accumulated so far, so a caller that reads
 * `push`/`flush` synchronously never loses deltas held in the pending buffer.
 */
export function useStreamThrottle(
  options: UseStreamThrottleOptions = {},
): UseStreamThrottleReturn {
  const { intervalMs = DEFAULT_INTERVAL_MS, onFlush } = options;
  const [value, setValue] = useState("");
  const valueRef = useRef("");
  const bufferRef = useRef("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const publish = useCallback(
    (next: string) => {
      valueRef.current = next;
      if (!mountedRef.current) return;
      setValue(next);
      onFlush?.(next);
    },
    [onFlush],
  );

  const scheduleFlush = useCallback(() => {
    if (timerRef.current !== null) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const batched = bufferRef.current;
      if (!batched) return;
      bufferRef.current = "";
      publish(valueRef.current + batched);
    }, intervalMs);
  }, [intervalMs, publish]);

  const push = useCallback(
    (text: string) => {
      if (!text) return valueRef.current;
      bufferRef.current += text;
      scheduleFlush();
      return valueRef.current + bufferRef.current;
    },
    [scheduleFlush],
  );

  const flush = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const remaining = bufferRef.current;
    bufferRef.current = "";
    const next = valueRef.current + remaining;
    if (remaining) publish(next);
    return next;
  }, [publish]);

  const reset = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    bufferRef.current = "";
    valueRef.current = "";
    setValue("");
  }, []);

  return {
    push,
    flush,
    reset,
    value,
    pending: bufferRef.current,
  };
}
