/**
 * Shared speaking-feature types (roadmap FE-01).
 *
 * Single source of truth for every speaking-related shape consumed by the
 * dashboard page, the history page, the AudioRecorder/FeedbackPanel slices and
 * the TanStack Query hooks. Backend contracts (WebSocket events, REST history
 * response, topic-generation payload) are mirrored here so a drift between the
 * gateway and the UI surfaces as a type error instead of a runtime surprise.
 *
 * This module is type-only — no runtime imports, no exported values.
 */

// ---------------------------------------------------------------------------
// Domain enumerations
// ---------------------------------------------------------------------------

/**
 * Languages accepted by the speaking gateway (`ALLOWED_LANGUAGES` in
 * `apps/api/src/speaking/speaking.gateway.ts`). The Whisper language map in
 * `SpeakingService.transcribe` covers the same eight values.
 */
export type SpeakingLanguage =
  | 'english'
  | 'vietnamese'
  | 'japanese'
  | 'chinese'
  | 'korean'
  | 'spanish'
  | 'french'
  | 'german';

/** CEFR levels accepted by the gateway (`ALLOWED_LEVELS`). */
export type SpeakingLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

/** Topic categories surfaced by the dashboard page's chip row. */
export type SpeakingCategory = 'daily' | 'travel' | 'work' | 'opinion' | 'story';

/** Difficulty returned by the topic-generation endpoint. */
export type SpeakingDifficulty = 'easy' | 'medium' | 'hard';

// ---------------------------------------------------------------------------
// Topic
// ---------------------------------------------------------------------------

/**
 * Shape returned by `/api/speaking/topic` (and by the backend
 * `/speaking/topic/generate` endpoint inside `data`). Mirrors the JSON the
 * topic route validates: `topic`, `prompt`, `tips`, `samplePhrases`,
 * `duration`, `difficulty`.
 *
 * `difficulty` also accepts `string` so legacy payloads whose difficulty is
 * not one of the three known values still type-check; narrow it at the call
 * site when the strict union is required.
 */
export interface SpeakingTopic {
  topic: string;
  prompt: string;
  tips: string[];
  samplePhrases: string[];
  duration: number;
  difficulty: SpeakingDifficulty | string;
}

/** Input accepted by the topic-generation mutation. */
export interface GenerateSpeakingTopicInput {
  level: string;
  category: string;
  language: string;
}

/** Envelope returned by the topic-generation endpoint. */
export interface GenerateSpeakingTopicResult {
  data: SpeakingTopic;
  operationId: string;
  balance?: unknown;
}

// ---------------------------------------------------------------------------
// Scores
// ---------------------------------------------------------------------------

/**
 * Canonical score shape published by the speaking gateway inside
 * `feedback_done`. All values are integers on a 0–100 scale. `basis` is
 * optional because legacy history rows persisted before the transcript-basis
 * migration omit it, and the dashboard page still reads scores without it.
 */
export interface SpeakingScores {
  overall: number;
  grammar: number;
  vocabulary: number;
  basis?: 'transcript' | string;
}

// ---------------------------------------------------------------------------
// Session / WebSocket state
// ---------------------------------------------------------------------------

/**
 * Phases driven by the WebSocket events `session_ready`, `status`,
 * `transcript`, `feedback_chunk` and `feedback_done`. The dashboard page's
 * `Phase` type and `FeedbackPanel`'s `FeedbackPhase` share this union;
 * `FeedbackPanel` additionally accepts a terminal `error` state locally.
 */
export type SpeakingSessionPhase =
  | 'ready'
  | 'topic'
  | 'recording'
  | 'connecting'
  | 'transcribing'
  | 'analyzing'
  | 'streaming'
  | 'done';

/** Practice mode selected by the user on the speaking dashboard. */
export type SpeakingMode = 'topic' | 'coach';

/** WebSocket connection status tracked by the AudioRecorder slice. */
export type WsStatus = 'idle' | 'connecting' | 'open' | 'error';

/** Processing phase reported by the gateway's `status` event. */
export type SpeakingStatusPhase = 'transcribing' | 'analyzing';

/** Basis reported by `feedback_done` (currently only transcript scoring). */
export type SpeakingFeedbackBasis = 'transcript';

// ---------------------------------------------------------------------------
// Coach-mode diff
// ---------------------------------------------------------------------------

/** Per-word comparison result used by the coach-mode sentence drill. */
export interface WordDiffToken {
  word: string;
  status: 'correct' | 'incorrect';
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

/**
 * One row of the paginated speaking history returned by
 * `SpeakingService.getHistory`. `language` and `level` stay as `string`
 * because the backend stores them as free-form DB columns; narrow to
 * `SpeakingLanguage` / `SpeakingLevel` at the call site when needed.
 */
export interface SpeakingHistoryItem {
  id: string;
  topic: string | null;
  transcript: string;
  feedback: string;
  scores: SpeakingScores | null;
  language: string;
  level: string;
  durationSec: number;
  createdAt: string;
}

/** Paginated history envelope. */
export interface SpeakingHistoryResponse {
  total: number;
  page: number;
  limit: number;
  items: SpeakingHistoryItem[];
}

// ---------------------------------------------------------------------------
// Recording result (AudioRecorder slice)
// ---------------------------------------------------------------------------

/** Final payload emitted by the AudioRecorder after a successful session. */
export interface RecordingResult {
  transcript: string;
  feedback: string;
  scores: SpeakingScores | null;
}

// ---------------------------------------------------------------------------
// REST feedback (separate contract from the WebSocket score shape)
// ---------------------------------------------------------------------------

/** A detailed grammar/vocabulary score with its accompanying explanation. */
export interface SpeakingFeedbackScore {
  score: number;
  feedback: string;
}

/**
 * Structured feedback returned by the REST `/speaking/feedback` operation.
 * Distinct from `SpeakingScores`: the gateway emits a compact numeric shape,
 * while the REST contract nests `{ score, feedback }` per category and adds
 * correction and suggestion lists.
 */
export interface SpeakingFeedbackResponse {
  overallScore: number;
  grammar: SpeakingFeedbackScore;
  vocabulary: SpeakingFeedbackScore;
  corrections: string[];
  suggestions: string[];
}
