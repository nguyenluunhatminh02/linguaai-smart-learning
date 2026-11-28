"use client";

/**
 * Selective live region for streaming status announcements.
 *
 * Streaming responses emit token-level updates many times per second. Putting
 * the growing message (or a per-token status) inside an `aria-live` region
 * makes screen readers re-announce the entire partial answer on every delta.
 * This module keeps announcements deliberately coarse: one short label per
 * stream phase, deduplicated by (phase, text), debounced for non-terminal
 * transitions and immediate for terminal ones.
 *
 * The live node is mounted once and never removed: assistive technologies
 * register live regions at insertion time, so mounting/unmounting per update
 * loses announcements entirely.
 */

/** Mirrors the chat page's `StreamState` union. Keep in sync when it grows. */
export type StreamStatus =
  | "idle"
  | "submitting"
  | "streaming"
  | "reconnecting"
  | "completed"
  | "failed"
  | "cancelled";

/** Shape consumed by the selector; `message` is a short, allowlisted label only. */
export interface StreamAnnouncement {
  status: StreamStatus;
  message: string;
}

/** The last thing actually placed in the live region. */
export interface AnnouncedStatus extends StreamAnnouncement {
  /** Terminal states bypass the debounce and are announced assertively on failure. */
  terminal: boolean;
}

const TERMINAL_STATUSES: ReadonlySet<StreamStatus> = new Set<StreamStatus>([
  "completed",
  "failed",
  "cancelled",
]);

export function isTerminalStreamStatus(status: StreamStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/**
 * Pure selector: decides whether `next` should be announced.
 *
 * Returns `null` for:
 *  - empty/missing messages (token text must never become an announcement),
 *  - consecutive duplicates of the exact same (status, message) pair,
 *  - `idle` with no message, i.e. a turn boundary reset.
 *
 * A repeated text after a different message is announced again, so a real
 * transition that happens to reuse a label is not swallowed. Comparing the
 * full pair (rather than text alone) also lets the same label be re-announced
 * when the phase genuinely changed, e.g. reconnecting -> failed.
 */
export function selectStreamAnnouncement(
  next: StreamAnnouncement | null | undefined,
  previous?: AnnouncedStatus | null,
): AnnouncedStatus | null {
  if (!next) return null;
  const message = typeof next.message === "string" ? next.message.trim() : "";
  if (!message || next.status === "idle") return null;
  if (previous && previous.status === next.status && previous.message === message) {
    return null;
  }
  return {
    status: next.status,
    message,
    terminal: isTerminalStreamStatus(next.status),
  };
}

export interface StreamStatusLiveRegionProps extends StreamAnnouncement {
  /**
   * Delay in ms before a non-terminal status reaches the live region. Token
   * events keep re-rendering with the same phase label, so only the first
   * change in a burst is scheduled and later ones replace it.
   * Default: 400ms. Terminal statuses ignore this value.
   */
  announceDelayMs?: number;
  /** Optional test hook / stable id for the live node. */
  id?: string;
}

/**
 * Renders one permanently mounted, visually hidden live region.
 *
 * Normal progress and terminal success use `role="status"` (polite).
 * Verified failures use `role="alert"` (assertive) and are announced
 * immediately. Only the text content changes between updates; the node and
 * its ARIA attributes stay in place for the lifetime of the component.
 *
 * Callers should pass coarse labels (e.g. "Sending...", "Streaming response...",
 * "Response saved."), never the partial assistant answer.
 */
export function StreamStatusLiveRegion({
  status,
  message,
  announceDelayMs = 400,
  id,
}: StreamStatusLiveRegionProps) {
  // `useState` initializer and the effect below deliberately avoid mounting a
  // new node per status: the same <div> is reused for every announcement.
  const [announcement, setAnnouncement] = useState<AnnouncedStatus | null>(null);
  const lastAnnouncedRef = useRef<AnnouncedStatus | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const clearPending = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearPending();
    };
  }, [clearPending]);

  useEffect(() => {
    clearPending();
    const selected = selectStreamAnnouncement({ status, message }, lastAnnouncedRef.current);
    if (!selected) return;

    // Failures must never be swallowed by a pending polite update.
    if (selected.terminal || status === "failed") {
      lastAnnouncedRef.current = selected;
      setAnnouncement(selected);
      return;
    }

    const delay = Math.max(0, announceDelayMs);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (!mountedRef.current) return;
      // Re-check at fire time: a newer non-terminal phase may have superseded
      // this one while the debounce window was open.
      const latest = selectStreamAnnouncement({ status, message }, lastAnnouncedRef.current);
      if (!latest) return;
      lastAnnouncedRef.current = latest;
      setAnnouncement(latest);
    }, delay);
  }, [status, message, announceDelayMs, clearPending]);

  const assertive = announcement?.status === "failed";
  const text = announcement?.message ?? "";

  return (
    <div
      id={id}
      className="sr-only"
      role={assertive ? "alert" : "status"}
      aria-live={assertive ? "assertive" : "polite"}
      aria-atomic="true"
    >
      {text}
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
