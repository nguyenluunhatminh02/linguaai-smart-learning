"use client";

import { useCallback, useEffect, useRef } from "react";

export function useActivityDuration(activityId?: string) {
  const startedAt = useRef(new Map<string, number>());

  useEffect(() => {
    if (!activityId) return;
    const starts = startedAt.current;
    if (!starts.has(activityId)) starts.set(activityId, Date.now());
  }, [activityId]);

  return useCallback(() => {
    if (!activityId) return 0;
    const starts = startedAt.current;
    const started = starts.get(activityId) ?? Date.now();
    starts.set(activityId, started);
    return Math.max(0, Math.floor((Date.now() - started) / 1000));
  }, [activityId]);
}
