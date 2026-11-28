/**
 * Pure formatting and safety helpers for the speaking feature (roadmap FE-10).
 *
 * Nothing in this module owns imperative resources: no React, no stores, no
 * timers, no WebSockets. Callers keep ownership of capture lifecycle and UI
 * state; these functions only normalize or format values.
 */

/** A word as rendered by the coach-mode transcript diff. */
export interface WordDiff {
  word: string;
  status: 'correct' | 'incorrect';
}

/** Result of comparing a target sentence with a recognized transcript. */
export type TranscriptComparison = {
  score: number;
  diff: WordDiff[];
} | null;

const RECOGNITION_LANGUAGES: Record<string, string> = {
  english: 'en-US',
  vietnamese: 'vi-VN',
  japanese: 'ja-JP',
  korean: 'ko-KR',
  chinese: 'zh-CN',
  spanish: 'es-ES',
  french: 'fr-FR',
  german: 'de-DE',
};

/** Map a learning-language code to the BCP-47 tag used by Web Speech. */
export function getRecognitionLang(language: string): string {
  if (typeof language !== 'string') return 'en-US';
  return RECOGNITION_LANGUAGES[language.toLowerCase()] ?? 'en-US';
}

/**
 * Format a timer as `m:ss`. Non-finite and negative inputs are treated as 0
 * so an invalid counter can never render `NaN:NaN` or `-1:-1`.
 */
export function formatDuration(totalSeconds: number): string {
  const seconds = Number.isFinite(totalSeconds) ? Math.max(0, totalSeconds) : 0;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0');
  return `${minutes}:${remainder}`;
}

const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
];

/** Pick the first MediaRecorder MIME type supported by this browser. */
export function getSupportedMimeType(): string {
  if (typeof window === 'undefined' || typeof MediaRecorder === 'undefined') {
    return 'audio/webm';
  }
  if (typeof MediaRecorder.isTypeSupported !== 'function') {
    return 'audio/webm';
  }
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) ?? 'audio/webm';
}

/** Read a recording as base64 payload (without the data-URL prefix). */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    if (typeof FileReader === 'undefined') {
      reject(new Error('FileReader is unavailable'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const comma = result.indexOf(',');
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to encode audio'));
    reader.readAsDataURL(blob);
  });
}

/** Split text into word-like segments, with an Intl.Segmenter fallback. */
export function segmentWords(value: string, locale: string): string[] {
  if (typeof value !== 'string' || value.length === 0) return [];
  if (typeof Intl.Segmenter === 'function') {
    try {
      return Array.from(new Intl.Segmenter(locale || undefined, { granularity: 'word' }).segment(value))
        .filter((part) => part.isWordLike)
        .map((part) => part.segment);
    } catch {
      // An unsupported/invalid locale must not break the comparison.
    }
  }
  return value.match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
}

function normalizeWord(word: string, locale: string): string {
  return word.normalize('NFKC').replace(/’/g, "'").toLocaleLowerCase(locale || undefined);
}

function longestCommonSubsequence(target: string[], spoken: string[]): Set<number> {
  const rows = target.length;
  const columns = spoken.length;
  const dp: number[][] = Array.from({ length: rows + 1 }, () => Array<number>(columns + 1).fill(0));

  for (let i = 1; i <= rows; i++) {
    for (let j = 1; j <= columns; j++) {
      dp[i][j] = target[i - 1] === spoken[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  const matches = new Set<number>();
  let i = rows;
  let j = columns;
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
  return matches;
}

/**
 * Score a recognized transcript against a target sentence and mark which
 * target words were recognized. Returns `null` when either side has no words.
 */
export function compareTranscript(
  target: string,
  transcript: string,
  locale: string,
): TranscriptComparison {
  const targetWords = segmentWords(target, locale);
  const spokenWords = segmentWords(transcript, locale);
  if (targetWords.length === 0 || spokenWords.length === 0) return null;

  const matches = longestCommonSubsequence(
    targetWords.map((word) => normalizeWord(word, locale)),
    spokenWords.map((word) => normalizeWord(word, locale)),
  );
  return {
    score: Math.round((matches.size / targetWords.length) * 100),
    diff: targetWords.map((word, index) => ({
      word,
      status: matches.has(index) ? ('correct' as const) : ('incorrect' as const),
    })),
  };
}

/** Coerce a score to the 0–100 range used by Progress and score labels. */
export function clampScore(value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/** Tailwind text color for a score, using the existing 80/60 thresholds. */
export function getScoreClass(score: number): string {
  const value = clampScore(score);
  return value >= 80 ? 'text-emerald-500' : value >= 60 ? 'text-amber-500' : 'text-red-500';
}

/** Progress variant for a score, using the existing 80/60 thresholds. */
export function getScoreVariant(score: number): 'success' | 'warning' | 'default' {
  const value = clampScore(score);
  return value >= 80 ? 'success' : value >= 60 ? 'warning' : 'default';
}

const INVALID_DATE_LABEL = '—';

/** Format a history timestamp, returning a stable placeholder for bad dates. */
export function formatHistoryDate(iso: string, locale?: string): string {
  if (typeof iso !== 'string' || iso.trim() === '') return INVALID_DATE_LABEL;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return INVALID_DATE_LABEL;
  return date.toLocaleString(locale || undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Legacy filter that removes pronunciation/fluency blocks from feedback when
 * no transcript-basis score is available. Non-string values are ignored.
 */
export function stripPronunciationBlocks(feedback: string): string {
  if (typeof feedback !== 'string' || feedback.length === 0) return '';
  return feedback.replace(
    /^\*\*[^\n]*(?:pronunciation|fluency)[^\n]*\*\*\n[\s\S]*?(?=^\*\*|$)/gim,
    '',
  );
}

/** Build the speaking WebSocket URL, encoding the token when present. */
export function buildSpeakingWsUrl(apiBase: string | undefined, token: string | undefined): string {
  const base = (apiBase || 'http://localhost:3001/api/v1')
    .replace(/\/api(?:\/v\d+)?\/?$/, '')
    .replace(/\/+$/, '');
  const wsBase = base
    .replace(/^https/i, 'wss')
    .replace(/^http/i, 'ws');
  const url = `${wsBase}/speaking-ws`;
  return token && token.length > 0 ? `${url}?token=${encodeURIComponent(token)}` : url;
}

/** Normalize arbitrary feedback text before splitting it into segments. */
export function normalizeFeedbackText(text: string): string {
  return (typeof text === 'string' ? text : '').trim();
}
