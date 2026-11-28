import {
  Inject,
  Injectable,
  LoggerService,
  Optional,
  Scope,
} from '@nestjs/common';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { randomUUID } from 'crypto';
import { inspect } from 'util';
import { requestContextStorage } from '../utils/request-context';

/** Minimal Winston surface used by this service. */
interface WinstonSink {
  log?: (level: string, message: string) => void;
  info?: (message: string) => void;
  error?: (message: string) => void;
  warn?: (message: string) => void;
  debug?: (message: string) => void;
  verbose?: (message: string) => void;
}

/** Levels accepted by Nest's LoggerService and by Winston as its sink. */
export type StructuredLogLevel = 'log' | 'error' | 'warn' | 'debug' | 'verbose';

/**
 * Extra fields are opt-in only. Callers must pass values that are already
 * safe for aggregation: codes, counts, route templates and durations.
 */
export interface StructuredLogMetadata {
  operationId?: unknown;
  route?: unknown;
  duration?: unknown;
  durationMs?: unknown;
  errorCode?: unknown;
  status?: unknown;
  method?: unknown;
  feature?: unknown;
  provider?: unknown;
  attempt?: unknown;
  count?: unknown;
  [key: string]: unknown;
}

export interface StructuredLogEntry {
  timestamp: string;
  level: StructuredLogLevel;
  context: string;
  message: string;
  requestId: string;
  operationId?: string;
  route?: string;
  duration?: number;
  errorCode?: string;
  status?: number;
  method?: string;
  feature?: string;
  provider?: string;
  attempt?: number;
  count?: number;
  [key: string]: unknown;
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const OPERATION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
const ROUTE_PATTERN = /^\/?[A-Za-z0-9._~/-]{0,256}$/;
const METHOD_PATTERN = /^[A-Z]{3,10}$/;
const MAX_MESSAGE_LENGTH = 2048;
const MAX_TEXT_FOR_PII_SCAN = 4096;
const MAX_SERIALIZED_ENTRY_LENGTH = 4096;
const REDACTED = '[REDACTED]';

/**
 * Keys whose VALUES must never reach logs. Matching is case-insensitive and
 * substring-based so `userEmail`, `rawPrompt` and `x-api-key` are covered.
 */
const SENSITIVE_KEY_PATTERN =
  /(?:pass(word|phrase)?|secret|token|jwt|authorization|auth[-_ ]?header|cookie|session|credential|api[-_ ]?key|access[-_ ]?key|private[-_ ]?key|refresh|otp|totp|mfa|captcha|prompt|system[-_ ]?prompt|message|content|body|payload|transcript|audio|email|e[-_]?mail|phone|mobile|ip(?:_address)?|address|user(?:name|id)?|account|bearer|signature|webhook|recovery|answer|credit(?:card)?|cvv|pin|ssn|dob|birth(?:date)?)/i;

/** Allowlisted metadata key -> validation/serialization rule. */
type MetaRule =
  | 'string'
  | 'code'
  | 'route'
  | 'method'
  | 'duration'
  | 'count'
  | 'flag';

const META_RULES: Readonly<Record<string, MetaRule>> = {
  operationId: 'string',
  route: 'route',
  duration: 'duration',
  durationMs: 'duration',
  errorCode: 'code',
  status: 'count',
  method: 'method',
  feature: 'code',
  provider: 'string',
  attempt: 'count',
  count: 'count',
  retryable: 'flag',
};

/**
 * Detect value-level PII even under an innocuous key (e.g. `detail`). This is
 * deliberately conservative: values that merely look like an email, phone
 * number, JWT or bearer credential are replaced rather than logged.
 */
function containsPii(value: string): boolean {
  if (value.length > MAX_TEXT_FOR_PII_SCAN) return true;
  return (
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value) || // email
    /(?:\+?\d[\d\s().-]{7,}\d)/.test(value) || // phone-like digit run
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/.test(
      value,
    ) || // JWT
    /\b(?:Bearer|Basic)\s+\S+/i.test(value) ||
    /(?:sk|pk|api|secret)[-_][A-Za-z0-9]{16,}/i.test(value)
  );
}

/** Control characters can forge log lines or JSON; normalise them. */
function stripControlCharacters(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
}

/** Serialize arbitrary values without throwing on cycles, BigInt or symbols. */
function safePreview(value: unknown): string {
  try {
    return inspect(value, {
      depth: 2,
      breakLength: 120,
      maxArrayLength: 5,
      maxStringLength: 128,
    });
  } catch {
    return '<unserializable>';
  }
}

function sanitizeMessage(value: unknown): string {
  if (typeof value === 'string') {
    const clean = stripControlCharacters(value);
    // Only value-level PII is screened here. The key denylist applies to
    // metadata keys, not to benign words in an operational message.
    if (!clean || containsPii(clean)) return REDACTED;
    return clean.slice(0, MAX_MESSAGE_LENGTH);
  }
  if (value instanceof Error) {
    // Exception messages may quote prompts or user content; only the name is
    // stable and safe. Use `error(message, stack)` for diagnostics.
    return `Error: ${value.name}`;
  }
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') {
    return sanitizeMessage(safePreview(value));
  }
  return sanitizeMessage(String(value));
}

function fromContext<T extends string | number | boolean>(
  store: Record<string, unknown> | undefined,
  keys: readonly string[],
  validate: (value: unknown) => T | undefined,
): T | undefined {
  if (!store) return undefined;
  for (const key of keys) {
    const result = validate(store[key]);
    if (result !== undefined) return result;
  }
  return undefined;
}

function validateRequestId(value: unknown): string | undefined {
  return typeof value === 'string' && REQUEST_ID_PATTERN.test(value)
    ? value
    : undefined;
}

function validateOperationId(value: unknown): string | undefined {
  return typeof value === 'string' && OPERATION_ID_PATTERN.test(value)
    ? value
    : undefined;
}

function validateCode(value: unknown): string | undefined {
  return typeof value === 'string' && CODE_PATTERN.test(value)
    ? value
    : undefined;
}

function validateRoute(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 256) return undefined;
  // Only route templates with static segments are accepted. Raw URLs, query
  // strings, path parameters and user-entered path segments are rejected.
  if (!ROUTE_PATTERN.test(value)) return undefined;
  return value.startsWith('/') ? value : `/${value}`;
}

function validateCount(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const rounded = Math.round(value);
  return rounded >= 0 && rounded <= Number.MAX_SAFE_INTEGER
    ? rounded
    : undefined;
}

function applyRule(
  rule: MetaRule,
  value: unknown,
): string | number | boolean | undefined {
  switch (rule) {
    case 'string':
      return validateOperationId(value);
    case 'code':
      return validateCode(value);
    case 'route':
      return validateRoute(value);
    case 'method':
      return typeof value === 'string' && METHOD_PATTERN.test(value)
        ? value
        : undefined;
    case 'duration':
    case 'count':
      return validateCount(value);
    case 'flag':
      return typeof value === 'boolean' ? value : undefined;
  }
}

/**
 * Apply a rule to an untrusted value. Known keys are validated and coerced;
 * unknown keys are never emitted, so arbitrary caller objects cannot smuggle
 * prompts, credentials or PII into the structured record.
 *
 * Sensitive metadata keys are dropped wholesale instead of being stringified:
 * even a harmless-looking value (a count, a boolean) is ignored when its key
 * suggests prompt/content/credential/PII data.
 */
function sanitizeMetadata(
  metadata: StructuredLogMetadata,
  requestId: string,
  operationId: string | undefined,
): Partial<StructuredLogEntry> {
  const result: Partial<StructuredLogEntry> = {};
  for (const [key, rule] of Object.entries(META_RULES)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) continue;
    const raw = metadata[key];
    if (raw === undefined || raw === null) continue;
    const safe = applyRule(rule, raw);
    if (safe === undefined) continue;
    if (key === 'durationMs' && result.duration === undefined) {
      result.duration = safe as number;
    } else {
      (result as Record<string, unknown>)[key] = safe;
    }
  }

  // An explicit operationId in metadata wins; otherwise inherit the one
  // established by the request context. Idempotency-Key is never used here.
  const explicitOperation = validateOperationId(metadata.operationId);
  const correlated = explicitOperation ?? operationId;
  if (correlated) result.operationId = correlated;
  if (result.route === undefined) {
    // Defensive only: context-derived route must also pass the template check.
    const route = validateRoute(metadata.route);
    if (route) result.route = route;
  }
  if (result.route === undefined) result.route = '<unmatched>';
  result.requestId = requestId;
  return result;
}

function readStore(): Record<string, unknown> | undefined {
  return requestContextStorage.getStore() as
    | Record<string, unknown>
    | undefined;
}

/**
 * JSON logger with a fixed schema and PII-safe metadata.
 *
 * Every emitted line is parseable JSON containing at least `timestamp`,
 * `level`, `context`, `message` and `requestId`. Correlation IDs come from
 * AsyncLocalStorage when available; missing/invalid values fall back to a
 * freshly generated ID. Winston remains the transport configured in main.ts.
 */
@Injectable({ scope: Scope.DEFAULT })
export class StructuredLoggerService implements LoggerService {
  constructor(
    @Optional()
    @Inject(WINSTON_MODULE_PROVIDER)
    private readonly winston?: WinstonSink,
  ) {}

  private resolveContext(context?: string): string {
    if (typeof context !== 'string' || !context.trim()) return 'Application';
    const clean = stripControlCharacters(context).slice(0, MAX_MESSAGE_LENGTH);
    return clean || 'Application';
  }

  private emit(
    level: StructuredLogLevel,
    message: unknown,
    context?: string,
    meta: StructuredLogMetadata = {},
    ...optionalParams: unknown[]
  ): void {
    const store = readStore();
    const requestId =
      fromContext(store, ['requestId'], validateRequestId) ?? randomUUID();
    const operationId = fromContext(
      store,
      ['operationId'],
      validateOperationId,
    );

    const entry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      context: this.resolveContext(context),
      message: sanitizeMessage(message),
      requestId,
      ...sanitizeMetadata(meta, requestId, operationId),
    };

    // Nest passes error stacks as the second argument to error()/warn(). A
    // stack can contain source paths but never arbitrary request content; keep
    // it bounded and only when explicitly supplied by the caller.
    const stack = optionalParams.find(
      (param): param is string => typeof param === 'string',
    );
    if (stack && (level === 'error' || level === 'warn')) {
      const clean = stripControlCharacters(stack).slice(0, 2048);
      if (clean && !containsPii(clean)) entry.stack = clean;
    }

    // Last-resort guard: screen individual string fields. Screening the whole
    // JSON string would false-positive on ISO timestamps and UUIDs (both look
    // like long digit runs to a phone-number regex).
    if (containsPii(entry.message) || containsPii(entry.context)) {
      entry.message = REDACTED;
      if (containsPii(entry.context)) entry.context = 'Application';
    }
    const serialized = safelyStringify(entry);

    let output = serialized;
    if (output.length > MAX_SERIALIZED_ENTRY_LENGTH) {
      // Oversized payloads are truncated to the required fixed fields only.
      const minimal: StructuredLogEntry = {
        timestamp: entry.timestamp,
        level,
        context: entry.context,
        message: entry.message.slice(0, MAX_MESSAGE_LENGTH),
        requestId,
      };
      if (entry.operationId) minimal.operationId = entry.operationId;
      if (entry.route) minimal.route = entry.route;
      if (entry.duration !== undefined) minimal.duration = entry.duration;
      if (entry.errorCode) minimal.errorCode = entry.errorCode;
      output = safelyStringify(minimal);
    }

    // Route through Winston when Nest injects it, so transports/severity
    // filters in main.ts remain effective. Without DI (jobs, unit tests),
    // write one JSON line directly.
    if (this.winston && typeof this.winston.log === 'function') {
      this.winston.log(level, output);
    } else {
      process.stdout.write(`${output}\n`);
    }
  }

  log(message: unknown, context?: string): void;
  log(message: unknown, context?: string, meta?: StructuredLogMetadata): void;
  log(
    message: unknown,
    context?: string,
    meta: StructuredLogMetadata = {},
    ...optionalParams: unknown[]
  ): void {
    this.emit('log', message, context, meta, ...optionalParams);
  }

  error(message: unknown, context?: string): void;
  error(message: unknown, stack?: string, context?: string): void;
  error(
    message: unknown,
    stackOrContext?: string,
    contextOrMeta?: string | StructuredLogMetadata,
    ...optionalParams: unknown[]
  ): void {
    const { context, meta } = normalizeErrorArgs(stackOrContext, contextOrMeta);
    this.emit('error', message, context, meta, ...optionalParams);
  }

  warn(message: unknown, context?: string): void;
  warn(message: unknown, stack?: string, context?: string): void;
  warn(
    message: unknown,
    stackOrContext?: string,
    contextOrMeta?: string | StructuredLogMetadata,
    ...optionalParams: unknown[]
  ): void {
    const { context, meta } = normalizeErrorArgs(stackOrContext, contextOrMeta);
    this.emit('warn', message, context, meta, ...optionalParams);
  }

  debug(message: unknown, context?: string): void;
  debug(message: unknown, context?: string, meta?: StructuredLogMetadata): void;
  debug(
    message: unknown,
    context?: string,
    meta: StructuredLogMetadata = {},
    ...optionalParams: unknown[]
  ): void {
    this.emit('debug', message, context, meta, ...optionalParams);
  }

  verbose(message: unknown, context?: string): void;
  verbose(
    message: unknown,
    context?: string,
    meta: StructuredLogMetadata = {},
    ...optionalParams: unknown[]
  ): void {
    this.emit('verbose', message, context, meta, ...optionalParams);
  }

  /** Emit a lifecycle event with an explicit route template and duration. */
  logRequest(
    level: StructuredLogLevel,
    message: string,
    meta: StructuredLogMetadata,
    context = 'Http',
  ): void {
    this.emit(level, message, context, meta);
  }

  /** Emit a redacted error event identified by a stable error code. */
  logError(
    errorCode: string,
    context = 'Error',
    meta: StructuredLogMetadata = {},
  ): void {
    this.emit('error', errorCode, context, {
      ...meta,
      errorCode,
    });
  }
}

/** Stringify without throwing on BigInt, circular values or symbols. */
function safelyStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(value, (_key, item: unknown) => {
      if (typeof item === 'bigint') return item.toString();
      if (typeof item === 'symbol') return item.toString();
      if (item && typeof item === 'object') {
        if (seen.has(item)) return '[Circular]';
        seen.add(item);
      }
      return item;
    });
  } catch {
    return '{"level":"error","context":"Logger","message":"[unserializable]"}';
  }
}

/** Make Nest's `error`/`warn` stack overloads safe for structured metadata. */
function normalizeErrorArgs(
  stackOrContext?: string,
  contextOrMeta?: string | StructuredLogMetadata,
): { context?: string; meta: StructuredLogMetadata } {
  if (contextOrMeta && typeof contextOrMeta === 'object') {
    return { context: stackOrContext, meta: contextOrMeta };
  }
  return { context: contextOrMeta ?? stackOrContext, meta: {} };
}
