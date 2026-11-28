/**
 * Streaming SSE parser for chat responses.
 *
 * The parser is transport agnostic: feed it decoded chunks (or bytes) with
 * `push()` and call `end()` once the stream is finished. `parseSseStream()`
 * is the convenience wrapper for a fetch response body / stream reader.
 *
 * Important: neither EOF nor the legacy `[DONE]` marker is treated as a
 * successful completion. Only a well-formed `completed` event can produce a
 * `completed` outcome; everything else is `failed`, `incomplete` or
 * `cancelled` so callers cannot persist a turn that has not been committed.
 */

export type SseStatus = 'completed' | 'failed' | 'incomplete' | 'cancelled';

export type SseOutcomeReason =
  | 'completed-event'
  | 'failed-event'
  | 'cancelled-event'
  | 'legacy-done'
  | 'eof'
  | 'malformed-terminal'
  | 'buffer-overflow'
  | 'read-error'
  | 'aborted';

/** One raw SSE event. Multiple `data:` lines are joined with a newline. */
export interface SseEvent {
  /** Event name; unnamed events use the SSE default name `message`. */
  event: string;
  data: string;
  /** Last event id, retained across events as required by the SSE format. */
  id?: string;
  /** Parsed `retry:` value in milliseconds. */
  retry?: number;
}

export interface SseErrorInfo {
  code: string;
  message?: string;
}

/** Explicit stream result: callers must check `status`, not just EOF. */
export interface SseOutcome {
  status: SseStatus;
  reason: SseOutcomeReason;
  event?: SseEvent;
  error?: SseErrorInfo;
  operationId?: string;
  messageId?: string;
  balance?: number;
}

export interface SseParseResult {
  events: SseEvent[];
  outcome: SseOutcome;
}

export interface SseParserOptions {
  /** Upper bound for an unfinished event buffer, to avoid unbounded growth. */
  maxBufferSize?: number;
  /**
   * Require a completed event to carry an operationId or messageId.
   * Enabled by default so `data: {}` cannot be mistaken for a commit.
   */
  requireTerminalIdentifiers?: boolean;
  /**
   * Migration-only escape hatch for the legacy backend that ends an unnamed
   * stream with `[DONE]`. Off by default: `[DONE]` alone means `incomplete`.
   */
  treatLegacyDoneAsCompleted?: boolean;
}

export type SseChunk = string | Uint8Array | ArrayBuffer;
export type SseStreamSource =
  | ReadableStream<SseChunk>
  | ReadableStreamDefaultReader<SseChunk>;

export interface ParseSseStreamOptions extends SseParserOptions {
  /** Cancels the underlying reader and yields a `cancelled` outcome. */
  signal?: AbortSignal;
}

const DEFAULT_MAX_BUFFER_SIZE = 1_000_000;
const SAFE_CODE = /^[A-Za-z0-9_.:-]{1,64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeCode(value: unknown): string | undefined {
  return typeof value === 'string' && SAFE_CODE.test(value) ? value : undefined;
}

function payloadOf(data: string): unknown {
  if (!data) return undefined;
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return undefined;
  }
}

interface TerminalDetails {
  operationId?: string;
  messageId?: string;
  balance?: number;
}

function terminalDetails(payload: unknown): TerminalDetails {
  if (!isRecord(payload)) return {};
  const record = isRecord(payload.data) ? payload.data : payload;
  const details: TerminalDetails = {};
  if (typeof record.operationId === 'string' && record.operationId.trim()) {
    details.operationId = record.operationId;
  }
  if (typeof record.messageId === 'string' && record.messageId.trim()) {
    details.messageId = record.messageId;
  }
  if (typeof record.balance === 'number' && Number.isFinite(record.balance)) {
    details.balance = record.balance;
  }
  return details;
}

/**
 * Only a bounded, allowlisted code reaches the UI. Provider messages and
 * `String(err)` payloads are intentionally never forwarded.
 */
function errorOf(payload: unknown, fallbackCode: string): SseErrorInfo {
  const root = isRecord(payload) ? payload : undefined;
  const record = root && isRecord(root.data) ? root.data : root;
  const nested = record ? record.error : undefined;
  const code = (record ? safeCode(record.code) : undefined)
    ?? (isRecord(nested) ? safeCode(nested.code) : undefined)
    ?? fallbackCode;
  return { code };
}

function readErrorInfo(error: unknown): SseErrorInfo {
  const code = isRecord(error) ? safeCode(error.code) : undefined;
  return { code: code ?? 'STREAM_ERROR' };
}

export class SseParser {
  readonly events: SseEvent[] = [];

  private readonly decoder = new TextDecoder('utf-8');
  private readonly maxBufferSize: number;
  private readonly requireTerminalIdentifiers: boolean;
  private readonly treatLegacyDoneAsCompleted: boolean;

  private textBuffer = '';
  private dataLines: string[] = [];
  private eventType = '';
  private lastEventId = '';
  private retry: number | undefined;
  private finished = false;
  private terminal: SseOutcome | null = null;

  constructor(options: SseParserOptions = {}) {
    this.maxBufferSize = options.maxBufferSize ?? DEFAULT_MAX_BUFFER_SIZE;
    this.requireTerminalIdentifiers = options.requireTerminalIdentifiers ?? true;
    this.treatLegacyDoneAsCompleted = options.treatLegacyDoneAsCompleted ?? false;
  }

  get isTerminal(): boolean {
    return this.terminal !== null;
  }

  /** Feed bytes or text into the parser; returns events completed by this chunk. */
  push(chunk?: SseChunk | null): SseEvent[] {
    if (!chunk || this.terminal || this.finished) return [];
    const emitted: SseEvent[] = [];
    const text = typeof chunk === 'string'
      ? chunk
      : this.decoder.decode(chunk, { stream: true });
    this.append(text);
    this.drain(emitted, false);
    return emitted;
  }

  /**
   * Flush the decoder and finish parsing. The outcome is authoritative:
   * an unfinished stream is always `incomplete`, never `completed`.
   */
  end(): SseParseResult {
    if (!this.finished) {
      this.finished = true;
      if (!this.terminal) {
        // drain() appends to this.events; do not append the same events twice.
        this.append(this.decoder.decode());
        this.drain([], true);
      }
    }
    return this.result();
  }

  result(): SseParseResult {
    return {
      events: [...this.events],
      outcome: this.terminal ?? { status: 'incomplete', reason: 'eof' },
    };
  }

  private append(text: string): boolean {
    if (!text || this.terminal) return false;
    if (this.textBuffer.length + text.length > this.maxBufferSize) {
      this.terminal = {
        status: 'failed',
        reason: 'buffer-overflow',
        error: { code: 'BUFFER_TOO_LARGE' },
      };
      this.textBuffer = '';
      this.dataLines = [];
      return false;
    }
    this.textBuffer += text;
    return true;
  }

  /** Split on LF, CRLF or bare CR; a trailing CR waits for the next chunk. */
  private drain(emitted: SseEvent[], atEof: boolean): void {
    while (this.textBuffer.length > 0 && !this.terminal) {
      const cr = this.textBuffer.indexOf('\r');
      const lf = this.textBuffer.indexOf('\n');
      let index = -1;
      let separatorLength = 0;

      if (cr >= 0 && (lf < 0 || cr < lf)) {
        if (cr === this.textBuffer.length - 1 && !atEof) break;
        index = cr;
        separatorLength = this.textBuffer[cr + 1] === '\n' ? 2 : 1;
      } else if (lf >= 0) {
        index = lf;
        separatorLength = 1;
      }

      if (index < 0) {
        // A bare CR may be the first half of CRLF, and a bare LF may be the
        // second half. Only the final, complete line can be consumed here.
        if (!atEof) break;
        const line = this.textBuffer;
        this.textBuffer = '';
        this.consumeLine(line, emitted);
        break;
      }

      const line = this.textBuffer.slice(0, index);
      this.textBuffer = this.textBuffer.slice(index + separatorLength);
      this.consumeLine(line, emitted);
    }
  }

  private consumeLine(line: string, emitted: SseEvent[]): void {
    if (!line) {
      this.dispatch(emitted);
      return;
    }
    if (line.startsWith(':')) return; // comment / heartbeat

    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);

    switch (field) {
      case 'data':
        this.dataLines.push(value);
        break;
      case 'event':
        this.eventType = value;
        break;
      case 'id':
        if (!value.includes('\0')) this.lastEventId = value;
        break;
      case 'retry':
        if (/^\d+$/.test(value)) this.retry = Number(value);
        break;
      default:
        break;
    }
  }

  private dispatch(emitted: SseEvent[]): void {
    const hasPayload = this.dataLines.length > 0 || this.eventType.length > 0;
    const event: SseEvent = {
      event: this.eventType || 'message',
      data: this.dataLines.join('\n'),
    };
    if (this.lastEventId) event.id = this.lastEventId;
    if (this.retry !== undefined) event.retry = this.retry;

    this.dataLines = [];
    this.eventType = '';
    this.retry = undefined;
    if (!hasPayload || this.terminal) return;

    this.events.push(event);
    emitted.push(event);

    const outcome = this.classify(event);
    if (outcome) this.terminal = outcome;
  }

  private classify(event: SseEvent): SseOutcome | null {
    const details = terminalDetails(payloadOf(event.data));

    switch (event.event) {
      case 'completed': {
        const payload = payloadOf(event.data);
        if (
          !isRecord(payload)
          || (this.requireTerminalIdentifiers && !details.operationId && !details.messageId)
        ) {
          return {
            status: 'failed',
            reason: 'malformed-terminal',
            event,
            error: { code: 'INVALID_TERMINAL_EVENT' },
          };
        }
        return { status: 'completed', reason: 'completed-event', event, ...details };
      }
      case 'failed':
      case 'error':
        return {
          status: 'failed',
          reason: 'failed-event',
          event,
          error: errorOf(payloadOf(event.data), 'STREAM_FAILED'),
          ...details,
        };
      case 'cancelled':
      case 'aborted':
        return { status: 'cancelled', reason: 'cancelled-event', event, ...details };
      case 'message': {
        if (event.data.trim() === '[DONE]') {
          return {
            status: this.treatLegacyDoneAsCompleted ? 'completed' : 'incomplete',
            reason: 'legacy-done',
            event,
          };
        }
        const payload = payloadOf(event.data);
        if (isRecord(payload) && (payload.error !== undefined || payload.status === 'failed')) {
          return {
            status: 'failed',
            reason: 'failed-event',
            event,
            error: errorOf(payload, 'STREAM_FAILED'),
            ...details,
          };
        }
        return null;
      }
      default:
        return null;
    }
  }
}

function isReader(source: SseStreamSource): source is ReadableStreamDefaultReader<SseChunk> {
  return typeof (source as ReadableStreamDefaultReader<SseChunk>).read === 'function';
}

/**
 * Consume a response body (or an existing reader) with streaming decoding.
 * Reading stops at the first terminal event, so a server that keeps the
 * socket open after `completed` cannot stall the caller.
 */
export async function parseSseStream(
  source: SseStreamSource,
  options: ParseSseStreamOptions = {},
): Promise<SseParseResult> {
  const parser = new SseParser(options);
  const reader = isReader(source) ? source : source.getReader();
  const { signal } = options;
  let cancelled = signal?.aborted ?? false;

  const requestCancel = () => {
    try {
      void Promise.resolve(reader.cancel()).catch(() => undefined);
    } catch {
      // The reader may already be closed; nothing to cancel.
    }
  };
  const onAbort = () => {
    cancelled = true;
    requestCancel();
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  const cancellation = (): SseParseResult => ({
    events: [...parser.events],
    outcome: { status: 'cancelled', reason: 'aborted' },
  });

  try {
    if (cancelled) return cancellation();
    while (!parser.isTerminal) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(value);
    }
    if (cancelled || signal?.aborted) return cancellation();
    return parser.end();
  } catch (error) {
    if (cancelled || signal?.aborted) return cancellation();
    return {
      events: [...parser.events],
      outcome: {
        status: 'failed',
        reason: 'read-error',
        error: readErrorInfo(error),
      },
    };
  } finally {
    signal?.removeEventListener('abort', onAbort);
    if (parser.isTerminal || cancelled || signal?.aborted) requestCancel();
    try {
      reader.releaseLock();
    } catch {
      // A pending read can still hold the lock; cancel() unblocks it.
    }
  }
}
