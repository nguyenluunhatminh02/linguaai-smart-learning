import {
  Inject,
  Injectable,
  Logger,
  Module,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  AppException,
  ProviderUnavailableException,
  ValidationException,
} from '../common/exceptions';

/* ─────────────────────────── Queue contract ─────────────────────────── */

/** Stable queue names; publisher and worker must use the exact same string. */
export const QUEUE_NAMES = {
  AI_GENERATION: 'ai.generation',
  AI_FEEDBACK: 'ai.feedback',
  NOTIFICATIONS: 'notifications',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

const QUEUE_NAME_VALUES: readonly QueueName[] = Object.values(QUEUE_NAMES);

/** Literal version per queue: bump only with a coordinated worker migration. */
export const QUEUE_PAYLOAD_VERSIONS = {
  [QUEUE_NAMES.AI_GENERATION]: 1,
  [QUEUE_NAMES.AI_FEEDBACK]: 1,
  [QUEUE_NAMES.NOTIFICATIONS]: 1,
} as const;

export type PayloadVersion<Name extends QueueName> =
  (typeof QUEUE_PAYLOAD_VERSIONS)[Name];

/** Bounded retries/retention. No credentials or connection values live here. */
export const QUEUE_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 1000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600, count: 1000 },
} as const;

/** Caps the serialized payload (and the job record) to block blob smuggling. */
export const MAX_JOB_PAYLOAD_BYTES = 8 * 1024;
export const MAX_JOB_RECORD_BYTES = 32 * 1024;

export function getQueueToken(name: QueueName): string {
  return `BULLMQ_QUEUE_${name}`;
}

export const QUEUE_TOKENS: Readonly<Record<QueueName, string>> =
  QUEUE_NAME_VALUES.reduce(
    (tokens, name) => ({ ...tokens, [name]: getQueueToken(name) }),
    {} as Record<QueueName, string>,
  );

/**
 * Minimal BullMQ-compatible port. Declared locally because `bullmq` is not
 * pinned in this workspace yet: importing this file must not break the build
 * or boot. The real BullMQ `Queue` satisfies this shape directly.
 */
export interface QueueJobOptions {
  jobId?: string;
  attempts?: number;
  backoff?: { type: 'exponential' | 'fixed'; delay: number };
  removeOnComplete?: boolean | number | { age?: number; count?: number };
  removeOnFail?: boolean | number | { age?: number; count?: number };
  [key: string]: unknown;
}

export interface QueueLike {
  add(
    name: string,
    data: unknown,
    opts?: QueueJobOptions,
  ): Promise<{ id?: string }>;
  close(): Promise<void>;
}

const QUEUE_JOB_NAMES: Readonly<Record<QueueName, string>> = {
  [QUEUE_NAMES.AI_GENERATION]: 'generate',
  [QUEUE_NAMES.AI_FEEDBACK]: 'feedback',
  [QUEUE_NAMES.NOTIFICATIONS]: 'notify',
};

/**
 * Jobs carry IDs only. The worker resolves prompt text, messages, audio
 * bytes, signed URLs and provider credentials from the DB/config by ID.
 */
export interface QueuePayloadBase {
  payloadVersion: number;
  /** Also used as the BullMQ jobId, so repeated enqueues deduplicate. */
  operationId: string;
  userId: string;
  feature: string;
  resourceIds: {
    conversationId?: string;
    contentId?: string;
    objectKey?: string;
    deckId?: string;
    quizId?: string;
    lessonId?: string;
  };
  correlationId?: string;
}

export interface AiGenerationPayload extends QueuePayloadBase {
  payloadVersion: 1;
  feature:
    | 'ai_chat'
    | 'reading_generate'
    | 'grammar_explain'
    | 'listening_generate'
    | 'quiz_generate'
    | 'translation_ai'
    | 'learning_path'
    | 'cards_generate';
}

export interface AiFeedbackPayload extends QueuePayloadBase {
  payloadVersion: 1;
  feature: 'writing_feedback' | 'speaking_feedback';
  resourceIds: QueuePayloadBase['resourceIds'] & { objectKey: string };
}

export interface NotificationPayload extends QueuePayloadBase {
  payloadVersion: 1;
  feature: 'notification';
  resourceIds: QueuePayloadBase['resourceIds'] & { contentId: string };
}

export interface QueuePayloadByQueue {
  [QUEUE_NAMES.AI_GENERATION]: AiGenerationPayload;
  [QUEUE_NAMES.AI_FEEDBACK]: AiFeedbackPayload;
  [QUEUE_NAMES.NOTIFICATIONS]: NotificationPayload;
}

/* ───────────────────────── Payload validation ──────────────────────── */

const PAYLOAD_FIELDS = [
  'payloadVersion',
  'operationId',
  'userId',
  'feature',
  'resourceIds',
  'correlationId',
] as const;

const RESOURCE_ID_FIELDS = [
  'conversationId',
  'contentId',
  'objectKey',
  'deckId',
  'quizId',
  'lessonId',
] as const;
const RESOURCE_ID_VALUES: ReadonlySet<string> = new Set(RESOURCE_ID_FIELDS);

/** Defence in depth: the exact-field allowlist is the primary guard. */
const FORBIDDEN_KEY_PARTS = [
  'secret',
  'token',
  'password',
  'apikey',
  'authorization',
  'audio',
  'raw',
  'message',
  'prompt',
  'signedurl',
] as const;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OBJECT_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,511}$/;

const FEATURES_BY_QUEUE: Readonly<Record<QueueName, ReadonlySet<string>>> = {
  [QUEUE_NAMES.AI_GENERATION]: new Set<string>([
    'ai_chat',
    'reading_generate',
    'grammar_explain',
    'listening_generate',
    'quiz_generate',
    'translation_ai',
    'learning_path',
    'cards_generate',
  ]),
  [QUEUE_NAMES.AI_FEEDBACK]: new Set<string>([
    'writing_feedback',
    'speaking_feedback',
  ]),
  [QUEUE_NAMES.NOTIFICATIONS]: new Set<string>(['notification']),
};

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasForbiddenKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasForbiddenKey);
  if (!isPlainObject(value)) return false;

  for (const [key, nested] of Object.entries(value)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (FORBIDDEN_KEY_PARTS.some((part) => normalized.includes(part))) {
      return true;
    }
    if (hasForbiddenKey(nested)) return true;
  }
  return false;
}

function validateResourceIds(queueName: QueueName, resourceIds: unknown): void {
  if (!isPlainObject(resourceIds)) {
    throw new ValidationException('resourceIds must be an object');
  }
  for (const key of Object.keys(resourceIds)) {
    if (!RESOURCE_ID_VALUES.has(key)) {
      throw new ValidationException('Unknown resource id field');
    }
  }

  for (const key of RESOURCE_ID_FIELDS) {
    const value = resourceIds[key];
    if (value === undefined) continue;
    if (typeof value !== 'string' || value.length === 0) {
      throw new ValidationException('Resource ids must be non-empty strings');
    }
    if (key === 'objectKey') {
      if (!OBJECT_KEY_PATTERN.test(value)) {
        throw new ValidationException('Invalid storage object key');
      }
      continue;
    }
    if (!isUuid(value)) {
      throw new ValidationException('Resource ids must be UUIDs');
    }
  }

  const required: readonly (typeof RESOURCE_ID_FIELDS)[number][] =
    queueName === QUEUE_NAMES.AI_FEEDBACK
      ? ['objectKey']
      : queueName === QUEUE_NAMES.NOTIFICATIONS
        ? ['contentId']
        : [];
  for (const key of required) {
    if (!(key in resourceIds)) {
      throw new ValidationException('Queue payload is missing required fields');
    }
  }
}

/** Exported so the worker slice can apply exactly the same validation. */
export function validateQueuePayload<Name extends QueueName>(
  queueName: Name,
  payload: unknown,
): asserts payload is QueuePayloadByQueue[Name] {
  if (!QUEUE_NAME_VALUES.includes(queueName)) {
    throw new ValidationException('Unknown queue name');
  }
  if (!isPlainObject(payload)) {
    throw new ValidationException('Queue payload must be an object');
  }
  if (hasForbiddenKey(payload)) {
    throw new ValidationException('Queue payload contains a forbidden field');
  }
  if (
    Object.keys(payload).length !==
    PAYLOAD_FIELDS.filter((field) => field in payload).length
  ) {
    throw new ValidationException('Queue payload has unknown fields');
  }
  for (const field of PAYLOAD_FIELDS) {
    if (!(field in payload)) {
      throw new ValidationException('Queue payload is missing required fields');
    }
  }

  if (payload.payloadVersion !== QUEUE_PAYLOAD_VERSIONS[queueName]) {
    throw new ValidationException('Unsupported payload version for queue');
  }
  if (!isUuid(payload.operationId) || !isUuid(payload.userId)) {
    throw new ValidationException('Queue payload contains an invalid UUID');
  }
  if (payload.correlationId !== undefined && !isUuid(payload.correlationId)) {
    throw new ValidationException('Queue payload contains an invalid UUID');
  }
  if (
    typeof payload.feature !== 'string' ||
    !FEATURES_BY_QUEUE[queueName].has(payload.feature)
  ) {
    throw new ValidationException('Feature is not allowed on this queue');
  }

  validateResourceIds(queueName, payload.resourceIds);

  const payloadBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  if (
    payloadBytes > MAX_JOB_PAYLOAD_BYTES ||
    payloadBytes + 1024 > MAX_JOB_RECORD_BYTES
  ) {
    throw new ValidationException('Queue payload exceeds the size limit');
  }
}

/* ─────────────────────── Connection + lazy adapter ─────────────────── */

/**
 * Build an ioredis/BullMQ connection object from config. Values only ever go
 * into memory: nothing here logs the URL, host, password or username.
 */
export function redisConnectionOptions(
  config: ConfigService,
): Record<string, unknown> {
  const base = {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    retryStrategy: (times: number) => Math.min(100 * 2 ** times, 5000),
  };

  const url = config.get<string>('REDIS_URL');
  if (url) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      // Never echo the URL: it can embed a password.
      throw new Error('REDIS_URL is not a valid URL');
    }
    return {
      ...base,
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 6379,
      username: parsed.username || undefined,
      password: parsed.password || undefined,
    };
  }

  const configuredPort = Number(
    config.get<string | number>('REDIS_PORT') ?? 6379,
  );
  return {
    ...base,
    host: config.get<string>('REDIS_HOST') || 'localhost',
    port: Number.isFinite(configuredPort) ? configuredPort : 6379,
    password: config.get<string>('REDIS_PASSWORD') || undefined,
  };
}

/**
 * `bullmq` is not pinned in this workspace yet. The require is deferred to
 * the first enqueue (and kept untyped) so importing this module neither throws
 * at boot nor references an uninstalled package at type-check time.
 */
function createQueue(
  name: QueueName,
  connection: Record<string, unknown>,
): QueueLike {
  let queue: QueueLike | undefined;

  return {
    async add(jobName, data, opts) {
      if (!queue) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const bullmq = require('bullmq') as {
          Queue?: new (
            queueName: string,
            options: { connection: Record<string, unknown> },
          ) => QueueLike & {
            on?: (event: string, listener: () => void) => void;
          };
        };
        if (!bullmq.Queue) {
          throw new Error('bullmq is not available');
        }
        const instance = new bullmq.Queue(name, { connection });
        instance.on?.('error', () => {
          // Queue name only — never connection details or job data.
          new Logger(QueueModule.name).warn(
            `Queue connection error queue=${name}`,
          );
        });
        queue = instance;
      }
      return queue.add(jobName, data, opts);
    },
    async close() {
      if (queue) {
        await queue.close();
        queue = undefined;
      }
    },
  };
}

/* ─────────────────────────── Publisher ──────────────────────────────── */

/** Raised on enqueue failure so an outbox publisher keeps its row pending. */
export class QueueEnqueueException extends ProviderUnavailableException {
  public readonly queueName: string;
  public readonly operationId: string;

  constructor(queueName: string, operationId = 'unknown') {
    // Do not include the Redis URL, credentials or the original error message.
    super('Background job could not be enqueued; it will be retried');
    this.queueName = queueName;
    this.operationId = operationId;
  }
}

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    @Inject(QUEUE_TOKENS[QUEUE_NAMES.AI_GENERATION])
    private readonly generationQueue: QueueLike,
    @Inject(QUEUE_TOKENS[QUEUE_NAMES.AI_FEEDBACK])
    private readonly feedbackQueue: QueueLike,
    @Inject(QUEUE_TOKENS[QUEUE_NAMES.NOTIFICATIONS])
    private readonly notificationQueue: QueueLike,
  ) {}

  private queueFor(name: QueueName): QueueLike {
    switch (name) {
      case QUEUE_NAMES.AI_GENERATION:
        return this.generationQueue;
      case QUEUE_NAMES.AI_FEEDBACK:
        return this.feedbackQueue;
      case QUEUE_NAMES.NOTIFICATIONS:
        return this.notificationQueue;
      default:
        throw new AppException('Unknown queue name', 400, 'VALIDATION_ERROR');
    }
  }

  /**
   * Validate → enqueue with jobId = operationId. Caller overrides are limited
   * to bounded retry knobs; the job id, payload and retention cannot change.
   */
  async enqueue<Name extends QueueName>(
    queueName: Name,
    payload: QueuePayloadByQueue[Name],
    overrides?: Partial<QueueJobOptions>,
  ): Promise<string> {
    validateQueuePayload(queueName, payload);

    const safeOverrides: QueueJobOptions = {};
    if (overrides?.attempts !== undefined) {
      const attempts = overrides.attempts;
      if (Number.isInteger(attempts) && attempts >= 1 && attempts <= 5) {
        safeOverrides.attempts = attempts;
      }
    }
    if (overrides?.backoff !== undefined) {
      const backoff = overrides.backoff;
      if (
        backoff &&
        (backoff.type === 'exponential' || backoff.type === 'fixed') &&
        Number.isInteger(backoff.delay) &&
        backoff.delay >= 100 &&
        backoff.delay <= 60_000
      ) {
        safeOverrides.backoff = backoff;
      }
    }

    try {
      const job = await this.queueFor(queueName).add(
        QUEUE_JOB_NAMES[queueName],
        payload,
        { ...QUEUE_JOB_OPTIONS, ...safeOverrides, jobId: payload.operationId },
      );
      // Identifiers only: never log the payload or connection options.
      this.logger.log(
        `Enqueued queue=${queueName} operationId=${payload.operationId}`,
      );
      return job.id ?? payload.operationId;
    } catch {
      this.logger.error(
        `Enqueue failed queue=${queueName} operationId=${payload.operationId}`,
      );
      throw new QueueEnqueueException(queueName, payload.operationId);
    }
  }
}

/* ──────────────────────────── Module ────────────────────────────────── */

/**
 * Producers only. No Worker is started here: processors and concurrency
 * belong to the worker slice. Shutdown closes all queue connections.
 */
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: QUEUE_TOKENS[QUEUE_NAMES.AI_GENERATION],
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createQueue(QUEUE_NAMES.AI_GENERATION, redisConnectionOptions(config)),
    },
    {
      provide: QUEUE_TOKENS[QUEUE_NAMES.AI_FEEDBACK],
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createQueue(QUEUE_NAMES.AI_FEEDBACK, redisConnectionOptions(config)),
    },
    {
      provide: QUEUE_TOKENS[QUEUE_NAMES.NOTIFICATIONS],
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createQueue(QUEUE_NAMES.NOTIFICATIONS, redisConnectionOptions(config)),
    },
    QueueService,
  ],
  exports: [
    QueueService,
    ...QUEUE_NAME_VALUES.map((name) => QUEUE_TOKENS[name]),
  ],
})
export class QueueModule implements OnModuleDestroy {
  private readonly logger = new Logger(QueueModule.name);

  constructor(
    @Inject(QUEUE_TOKENS[QUEUE_NAMES.AI_GENERATION])
    private readonly generationQueue: QueueLike,
    @Inject(QUEUE_TOKENS[QUEUE_NAMES.AI_FEEDBACK])
    private readonly feedbackQueue: QueueLike,
    @Inject(QUEUE_TOKENS[QUEUE_NAMES.NOTIFICATIONS])
    private readonly notificationQueue: QueueLike,
  ) {}

  async onModuleDestroy(): Promise<void> {
    const queues: readonly [QueueName, QueueLike][] = [
      [QUEUE_NAMES.AI_GENERATION, this.generationQueue],
      [QUEUE_NAMES.AI_FEEDBACK, this.feedbackQueue],
      [QUEUE_NAMES.NOTIFICATIONS, this.notificationQueue],
    ];
    const results = await Promise.allSettled(
      queues.map(async ([, queue]) => queue.close()),
    );
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        // Names only; a close error may contain connection details.
        this.logger.error(`Queue shutdown failed queue=${queues[index][0]}`);
      }
    });
  }
}
