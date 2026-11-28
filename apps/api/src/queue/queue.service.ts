import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { AiOperationsPolicy } from '../ai-operations/ai-operations.policy';
import { ValidationException } from '../common/exceptions';

/** Transport contract: only the operations QueueService actually needs. */
export interface QueueJobOptions {
  jobId?: string;
  attempts?: number;
  backoff?: { type: 'exponential' | 'fixed'; delay: number };
  removeOnComplete?: boolean | number;
  removeOnFail?: boolean | number;
  [key: string]: unknown;
}

export interface QueueJobHandle {
  getState(): Promise<string>;
  remove(): Promise<void>;
}

export interface QueueLike {
  add(
    name: string,
    data: unknown,
    opts?: QueueJobOptions,
  ): Promise<{ id?: string }>;
  getJob?(id: string): Promise<QueueJobHandle | null>;
  close(): Promise<void>;
}

/**
 * IDs-only job payload. The worker resolves the canonical operation, prompt,
 * messages and audio from PostgreSQL/server-side config. No secrets, raw
 * audio, prompts or provider responses may be added here.
 */
export interface QueueJobPayload {
  schemaVersion: number;
  operationId: string;
  userId: string;
  feature: string;
  conversationId?: string;
  version?: number;
}

export interface EnqueueOptions {
  /** Abort before enqueue rejects; abort while queued cancels a waiting job. */
  signal?: AbortSignal;
  attempts?: number;
  backoffDelayMs?: number;
}

export interface EnqueueResult {
  jobId: string;
  alreadyQueued: boolean;
}

export const AI_OPERATION_QUEUE_TOKEN = 'AI_OPERATION_QUEUE';
export const AI_OPERATION_QUEUE_NAME = 'ai-operations';
export const AI_OPERATION_QUEUE_JOB_NAME = 'execute-ai-operation';
export const AI_OPERATION_QUEUE_PAYLOAD_VERSION = 1;
export const QUEUE_INITIAL_BACKOFF_MS = 1000;
export const QUEUE_BACKOFF_CAP_MS = 30_000;
export const QUEUE_COMPLETED_RETENTION_COUNT = 1000;
export const QUEUE_FAILED_RETENTION_COUNT = 1000;

/** Only these keys may cross into Redis. */
const ALLOWED_PAYLOAD_KEYS: ReadonlySet<keyof QueueJobPayload> = new Set([
  'schemaVersion',
  'operationId',
  'userId',
  'feature',
  'conversationId',
  'version',
]);

const MAX_ID_LENGTH = 128;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface AbortLike {
  aborted: boolean;
  addEventListener?: (
    type: 'abort',
    listener: () => void,
    options?: { once?: boolean },
  ) => void;
  removeEventListener?: (type: 'abort', listener: () => void) => void;
  onabort?: (() => void) | null;
}

/**
 * Producer for asynchronous AI operation jobs. `jobId = operationId` gives
 * transport-level deduplication; the DB operation state (lease/version and
 * terminal transitions) remains authoritative for every business effect.
 */
@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly signalListeners = new Map<
    string,
    { signal: AbortLike; listener: () => void }
  >();
  private destroyed = false;

  constructor(
    @Inject(AI_OPERATION_QUEUE_TOKEN)
    private readonly queue: QueueLike,
    private readonly policy: AiOperationsPolicy = new AiOperationsPolicy(),
  ) {}

  /**
   * Validate and enqueue. An already-aborted signal rejects before touching
   * Redis; an abort while queued removes only a waiting/delayed job. An abort
   * after a worker locked the job is left to the worker's cancellation hook.
   */
  async enqueue(
    payload: QueueJobPayload,
    options: EnqueueOptions = {},
  ): Promise<EnqueueResult> {
    if (this.destroyed) {
      throw new ValidationException('Queue is shutting down');
    }
    this.validatePayload(payload);

    const operationId = payload.operationId;
    const signal = options.signal as AbortLike | undefined;
    if (signal?.aborted) {
      throw new ValidationException('Enqueue was cancelled');
    }

    const attempts = this.boundedAttempts(options.attempts);
    const delay = this.boundedBackoff(options.backoffDelayMs);
    let cancelledBySignal = false;

    if (signal) {
      this.replaceListener(operationId, signal, () => {
        cancelledBySignal = true;
        // An abort must not leave the enqueue caller hanging while add() runs.
        void this.cancel(operationId).catch((error: unknown) => {
          this.logger.warn(
            `Could not cancel queued job ${operationId}: ${(error as Error).message}`,
          );
        });
      });
    }

    try {
      if (cancelledBySignal) {
        throw new ValidationException('Enqueue was cancelled');
      }
      // Give a listener registered in the same tick as add() a chance to run.
      // The check after add() is the authoritative race guard.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      const job = await this.queue.add(AI_OPERATION_QUEUE_JOB_NAME, payload, {
        jobId: operationId,
        attempts,
        backoff: { type: 'exponential', delay },
        removeOnComplete: QUEUE_COMPLETED_RETENTION_COUNT,
        removeOnFail: QUEUE_FAILED_RETENTION_COUNT,
      });

      if (signal && (cancelledBySignal || signal.aborted)) {
        await this.cancel(operationId);
        throw new ValidationException('Enqueue was cancelled');
      }
      return { jobId: job.id ?? operationId, alreadyQueued: false };
    } catch (error) {
      if (this.isDuplicateJobError(error)) {
        if (!signal || (!cancelledBySignal && !signal.aborted)) {
          return { jobId: operationId, alreadyQueued: true };
        }
        await this.cancel(operationId);
        this.removeListener(operationId);
        throw new ValidationException('Enqueue was cancelled');
      }
      this.removeListener(operationId);
      throw error;
    }
  }

  /**
   * Cancel only while queued (waiting or delayed). Removing an active/locked
   * job would bypass the DB terminal transition and refund, so it is refused.
   */
  async cancel(operationId: string): Promise<boolean> {
    if (!this.queue.getJob) {
      this.logger.warn('Queue does not support state-aware cancellation');
      return false;
    }
    const job = await this.queue.getJob(operationId);
    if (!job) return false;
    const state = await job.getState();
    if (state !== 'waiting' && state !== 'delayed') {
      this.logger.warn(
        `Ignoring cancellation of job ${operationId} in state ${state}`,
      );
      return false;
    }
    // A worker may acquire the job between getState() and remove(); BullMQ
    // then makes remove() a no-op rather than cancelling an active job.
    await job.remove();
    return true;
  }

  /** Drop abort bookkeeping after the operation reaches a terminal state. */
  async forget(operationId: string): Promise<void> {
    this.removeListener(operationId);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const { signal, listener } of [...this.signalListeners.values()]) {
      this.detach(signal, listener);
    }
    this.signalListeners.clear();
    await this.queue.close();
  }

  private validatePayload(payload: QueueJobPayload): void {
    if (
      payload === null ||
      typeof payload !== 'object' ||
      payload.schemaVersion !== AI_OPERATION_QUEUE_PAYLOAD_VERSION ||
      typeof payload.operationId !== 'string' ||
      payload.operationId.length > MAX_ID_LENGTH ||
      !UUID_PATTERN.test(payload.operationId) ||
      typeof payload.userId !== 'string' ||
      payload.userId.length === 0 ||
      typeof payload.feature !== 'string' ||
      payload.feature.length === 0 ||
      (payload.conversationId !== undefined &&
        (typeof payload.conversationId !== 'string' ||
          payload.conversationId.length > MAX_ID_LENGTH)) ||
      (payload.version !== undefined &&
        (!Number.isInteger(payload.version) || payload.version < 0))
    ) {
      throw new ValidationException('Invalid AI operation queue payload');
    }
    for (const key of Object.keys(payload)) {
      if (!ALLOWED_PAYLOAD_KEYS.has(key as keyof QueueJobPayload)) {
        throw new ValidationException('Invalid AI operation queue payload');
      }
    }
  }

  private boundedAttempts(attempts?: number): number {
    const ceiling = Math.min(
      AiOperationsPolicy.DEFAULT_MAX_ATTEMPTS,
      QUEUE_MAX_ATTEMPTS,
    );
    if (attempts === undefined) return ceiling;
    if (!Number.isFinite(attempts)) {
      throw new ValidationException('Invalid attempt count');
    }
    return Math.min(ceiling, Math.max(1, Math.trunc(attempts)));
  }

  private boundedBackoff(delay?: number): number {
    if (delay === undefined) return QUEUE_INITIAL_BACKOFF_MS;
    if (!Number.isFinite(delay)) {
      throw new ValidationException('Invalid backoff delay');
    }
    return Math.min(QUEUE_BACKOFF_CAP_MS, Math.max(1, Math.trunc(delay)));
  }

  private replaceListener(
    operationId: string,
    signal: AbortLike,
    listener: () => void,
  ): void {
    this.removeListener(operationId);
    this.signalListeners.set(operationId, { signal, listener });
    if (typeof signal.addEventListener === 'function') {
      signal.addEventListener('abort', listener, { once: true });
    } else if ('onabort' in signal) {
      signal.onabort = listener;
    }
  }

  private removeListener(operationId: string): void {
    const entry = this.signalListeners.get(operationId);
    if (!entry) return;
    this.signalListeners.delete(operationId);
    this.detach(entry.signal, entry.listener);
  }

  private detach(signal: AbortLike, listener: () => void): void {
    if (typeof signal.removeEventListener === 'function') {
      signal.removeEventListener('abort', listener);
    } else if (signal.onabort === listener) {
      signal.onabort = null;
    }
  }

  private isDuplicateJobError(error: unknown): boolean {
    const message = (error as { message?: string } | null)?.message ?? '';
    return /job .* already exists|already exists|EVAL .* 0/i.test(message);
  }
}

/** Hard ceiling independent of policy changes. */
const QUEUE_MAX_ATTEMPTS = 3;
