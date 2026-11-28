'use client';

import { AlertCircle, Loader2, Mic, RefreshCw, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { TranscriptFeedback } from '@/components/speaking/transcript-feedback';
import { cn } from '@/lib/utils';

/** Score scale published by the speaking gateway: overall/grammar/vocabulary are 0–100. */
export const SPEAKING_SCORE_SCALE = 100;

export type SpeakingScores = {
  overall: number;
  grammar: number;
  vocabulary: number;
};

/** Processing phases emitted by the speaking WebSocket, plus terminal UI states. */
export type FeedbackPhase =
  | 'ready'
  | 'topic'
  | 'recording'
  | 'connecting'
  | 'transcribing'
  | 'analyzing'
  | 'streaming'
  | 'done'
  | 'error';

export interface FeedbackPanelProps {
  /** Current session phase; determines which state the panel renders. */
  phase: FeedbackPhase;
  /** Human-readable message from a `status` WebSocket event. */
  statusMessage?: string;
  /** Error message from a failed request, WebSocket event or timeout. */
  error?: string | null;
  /** Final transcript from `feedback_done`, or the interim `transcript` event. */
  transcript?: string;
  /** Final feedback from `feedback_done`, or accumulated `feedback_chunk` text. */
  feedback?: string;
  /** Parsed scores; only displayed when the gateway marks them available. */
  scores?: SpeakingScores | null;
  /** Gateway contract flag: false means the LLM omitted the score block. */
  scoresAvailable?: boolean;
  /** Basis of the feedback; only the transcript basis has a known 0–100 scale. */
  feedbackBasis?: 'transcript' | string;
  /** Optional labels for localized pages. */
  labels?: {
    transcriptHint?: string;
    feedbackTitle?: string;
    overallLabel?: string;
    grammarLabel?: string;
    vocabularyLabel?: string;
    scoreBasis?: string;
    retry?: string;
    newTopic?: string;
  };
  /** Retry the same recording/topic after an error or missing scores. */
  onRetry?: () => void;
  /** Leave the current topic and start with a new one. */
  onNewTopic?: () => void;
}

const PROCESSING_PHASES: ReadonlySet<FeedbackPhase> = new Set([
  'connecting', 'transcribing', 'analyzing', 'streaming',
]);

const LOADING_LABELS: Record<string, string> = {
  connecting: 'Đang kết nối tới máy chủ nhận dạng...',
  transcribing: 'Groq Whisper — Đang chép lời audio...',
  analyzing: 'Llama 3.3 — Đang phân tích bài nói...',
  streaming: 'Đang truyền phản hồi AI...',
};

const DEFAULT_TRANSCRIPT_HINT =
  'Các từ ở trên là những gì hệ thống nhận ra; hãy đối chiếu với câu bạn định nói.';

/** Validates a 0–100 score without guessing a scale for missing or invalid data. */
export function isValidScore(score: unknown): score is number {
  return typeof score === 'number'
    && Number.isFinite(score)
    && score >= 0
    && score <= SPEAKING_SCORE_SCALE;
}

function scoreColor(score: number): string {
  if (score >= 80) return 'text-emerald-500';
  if (score >= 60) return 'text-amber-500';
  return 'text-red-500';
}

function scoreVariant(score: number): 'success' | 'warning' | 'default' {
  if (score >= 80) return 'success';
  if (score >= 60) return 'warning';
  return 'default';
}

function LoadingCard({ phase, statusMessage }: { phase: FeedbackPhase; statusMessage?: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 px-6 py-8 text-center" role="status" aria-live="polite">
        <div className="relative flex h-16 w-16 items-center justify-center">
          <div className="absolute inset-0 rounded-full border-2 border-primary/20 animate-ping" />
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
        <div>
          <p className="font-medium">
            {LOADING_LABELS[phase] ?? 'Đang xử lý bài nói...'}
          </p>
          {statusMessage && phase !== 'streaming' && (
            <p className="mt-1 text-sm text-muted-foreground">{statusMessage}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ErrorCard({
  message,
  transcript,
  transcriptHint,
  feedback,
  feedbackTitle,
  onRetry,
  onNewTopic,
}: {
  message: string;
  transcript?: string;
  transcriptHint?: string;
  feedback?: string;
  feedbackTitle?: string;
  onRetry?: () => void;
  onNewTopic?: () => void;
}) {
  return (
    <div className="space-y-4">
      <Card className="border-red-200 bg-red-50/40 dark:border-red-900/30 dark:bg-red-950/10">
        <CardContent className="flex items-start gap-3 px-6 py-5" role="alert">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" aria-hidden="true" />
          <div className="flex-1 space-y-3">
            <p className="text-sm font-medium text-red-700 dark:text-red-400">{message}</p>
            {(onRetry || onNewTopic) && (
              <div className="flex flex-wrap gap-2">
                {onRetry && (
                  <Button size="sm" variant="outline" onClick={onRetry}>Thử lại</Button>
                )}
                {onNewTopic && (
                  <Button size="sm" variant="outline" onClick={onNewTopic}>Chủ đề mới</Button>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
      {transcript && <TranscriptCard transcript={transcript} hint={transcriptHint} />}
      {feedback && <FeedbackCard feedback={feedback} title={feedbackTitle} streaming={false} />}
    </div>
  );
}

function TranscriptCard({ transcript, hint = DEFAULT_TRANSCRIPT_HINT }: { transcript: string; hint?: string }) {
  return (
    <Card className="border-blue-200/50 bg-blue-50/30 dark:border-blue-900/30 dark:bg-blue-950/10">
      <CardContent className="px-6 py-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">
          Nội dung hệ thống nhận dạng
        </p>
        <p className="text-sm italic text-foreground/90">&ldquo;{transcript}&rdquo;</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {transcript.split(/\s+/).filter(Boolean).map((word, index) => (
            <span
              key={`${word}-${index}`}
              className="rounded-md bg-blue-500/10 px-2 py-0.5 text-xs text-blue-700 dark:text-blue-300"
            >
              {word.replace(/[.,!?;:]+$/, '')}
            </span>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

function FeedbackCard({
  feedback,
  title = 'Phản hồi dựa trên bản chép lời',
  streaming,
}: {
  feedback: string;
  title?: string;
  streaming: boolean;
}) {
  return (
    <Card>
      <CardHeader className="px-6 pt-5 pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-primary" />
          {title}
          {streaming && (
            <span className="ml-auto flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
              <span className="inline-block h-3.5 w-0.5 animate-pulse rounded-full bg-primary" />
              Typing...
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-6 pb-5">
        <div className="space-y-1">
          <TranscriptFeedback text={feedback} />
          {streaming && (
            <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse rounded-full bg-primary align-middle" />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ScoreValue({ score, size = 'large' }: { score: number; size?: 'large' | 'small' }) {
  return (
    <span className={cn(
      'font-bold tabular-nums',
      size === 'large' ? 'text-6xl' : 'text-2xl',
      scoreColor(score),
    )}
    >
      {score}
      <span className={cn(
        'font-medium text-muted-foreground',
        size === 'large' ? 'text-2xl' : 'text-sm',
      )}
      >
        /{SPEAKING_SCORE_SCALE}
      </span>
    </span>
  );
}

function ScoresCard({
  scores,
  overallLabel,
  grammarLabel,
  vocabularyLabel,
  scoreBasis,
}: {
  scores: SpeakingScores;
  overallLabel: string;
  grammarLabel: string;
  vocabularyLabel: string;
  scoreBasis: string;
}) {
  const breakdown = [
    { label: grammarLabel, score: scores.grammar, icon: '📝' },
    { label: vocabularyLabel, score: scores.vocabulary, icon: '📚' },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-col items-center gap-3 px-6 py-6 text-center">
          <ScoreValue score={scores.overall} />
          <p className="text-sm font-medium text-muted-foreground">{overallLabel}</p>
          <Badge variant="outline" className="border-blue-200 text-blue-600 dark:border-blue-900/30 dark:text-blue-400">
            {scoreBasis}
          </Badge>
          <Progress
            value={scores.overall}
            max={SPEAKING_SCORE_SCALE}
            variant={scoreVariant(scores.overall)}
            size="lg"
            className="max-w-xs"
          />
        </CardContent>
      </Card>
      <div className="grid grid-cols-2 gap-3">
        {breakdown.map((item) => (
          <Card key={item.label}>
            <CardContent className="flex flex-col items-center gap-2 p-4">
              <span aria-hidden="true" className="text-2xl">{item.icon}</span>
              <ScoreValue score={item.score} size="small" />
              <p className="text-center text-xs text-muted-foreground">{item.label}</p>
              <Progress
                value={item.score}
                max={SPEAKING_SCORE_SCALE}
                variant={scoreVariant(item.score)}
                size="sm"
                className="w-full"
              />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

/**
 * Presentational feedback panel for speaking sessions.
 *
 * Renders loading, error, partial and success states from the session phase.
 * Scores are shown only for the `transcript` basis with a declared 0–100 scale;
 * no score is inferred from magnitude or from the presence of a number.
 */
export function FeedbackPanel({
  phase,
  statusMessage = '',
  error = null,
  transcript = '',
  feedback = '',
  scores = null,
  scoresAvailable = false,
  feedbackBasis,
  labels = {},
  onRetry,
  onNewTopic,
}: FeedbackPanelProps) {
  const text = {
    transcriptHint: labels.transcriptHint ?? DEFAULT_TRANSCRIPT_HINT,
    feedbackTitle: labels.feedbackTitle ?? 'Phản hồi dựa trên bản chép lời',
    overallLabel: labels.overallLabel ?? 'Điểm nội dung bản chép lời',
    grammarLabel: labels.grammarLabel ?? 'Ngữ pháp',
    vocabularyLabel: labels.vocabularyLabel ?? 'Từ vựng',
    scoreBasis: labels.scoreBasis ?? 'Thang điểm: 0–100 · Nội dung bản chép lời',
    retry: labels.retry ?? 'Thử ghi âm lại',
    newTopic: labels.newTopic ?? 'Chủ đề mới',
  };

  const showTranscript = Boolean(transcript)
    && (PROCESSING_PHASES.has(phase) || phase === 'done' || phase === 'error');
  const showFeedback = Boolean(feedback)
    && (phase === 'streaming' || phase === 'done' || phase === 'error');
  const hasScores = scoresAvailable
    && feedbackBasis === 'transcript'
    && scores !== null
    && isValidScore(scores.overall)
    && isValidScore(scores.grammar)
    && isValidScore(scores.vocabulary);

  if (error || phase === 'error') {
    return (
      <ErrorCard
        message={error ?? 'Đã xảy ra lỗi khi xử lý bài nói. Vui lòng thử lại.'}
        transcript={showTranscript ? transcript : undefined}
        transcriptHint={text.transcriptHint}
        feedback={showFeedback ? feedback : undefined}
        feedbackTitle={text.feedbackTitle}
        onRetry={onRetry}
        onNewTopic={onNewTopic}
      />
    );
  }

  if (PROCESSING_PHASES.has(phase)) {
    return (
      <div className="space-y-4">
        <LoadingCard phase={phase} statusMessage={statusMessage} />
        {showTranscript && (
          <TranscriptCard transcript={transcript} hint={text.transcriptHint} />
        )}
      </div>
    );
  }

  if (phase !== 'done') return null;

  return (
    <div className="space-y-4">
      {showTranscript && <TranscriptCard transcript={transcript} hint={text.transcriptHint} />}
      {showFeedback && (
        <FeedbackCard
          feedback={feedback}
          title={text.feedbackTitle}
          streaming={false}
        />
      )}
      {hasScores ? (
        <ScoresCard
          scores={scores}
          overallLabel={text.overallLabel}
          grammarLabel={text.grammarLabel}
          vocabularyLabel={text.vocabularyLabel}
          scoreBasis={text.scoreBasis}
        />
      ) : (
        <Card className="border-amber-200 bg-amber-50/40 dark:border-amber-900/30 dark:bg-amber-950/10">
          <CardContent className="flex items-start gap-3 px-6 py-5" role="status">
            <span aria-hidden="true" className="text-2xl">⚠️</span>
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                Không rõ thang điểm cho lần này (AI bỏ qua khối điểm số). Phần feedback ở trên vẫn dùng được.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
      {(onRetry || onNewTopic) && (
        <div className="flex gap-3">
          {onRetry && (
            <Button variant="gradient" onClick={onRetry} className="flex-1">
              <Mic className="mr-2 h-4 w-4" /> {text.retry}
            </Button>
          )}
          {onNewTopic && (
            <Button variant="outline" onClick={onNewTopic} className="flex-1">
              <RefreshCw className="mr-2 h-4 w-4" /> {text.newTopic}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export default FeedbackPanel;
