import {
  Injectable,
  Logger,
  OnModuleDestroy,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AiOperationsService } from '../ai-operations/ai-operations.service';
import { AiOperationsPolicy } from '../ai-operations/ai-operations.policy';
import {
  AiClientService,
  AiClientError,
} from '../common/services/ai-client.service';

/**
 * Queue payload contract: IDs and metadata only, never secrets, raw audio or
 * provider output. The payload version allows the worker to reject jobs it
 * cannot interpret safely.
 */
export interface AiOperationJobPayload {
  version: 1;
  operationId: string;
  userId: string;
  /** Version observed when the job was enqueued; claimLease() increments it. */
  expectedVersion: number;
  feature: string;
  aiPath: string;
  context?: Record<string, unknown>;
}

/** Mutable per-job state that survives retries within this worker process. */
interface JobState {
  payload: AiOperationJobPayload;
  /** Current DB version after the most recent successful claim. */
  currentVersion: number;
  /** Lease token from the most recent successful claim. */
  leaseToken: string | null;
  attempts: number;
  lastErrorCode: string | null;
  /** True once the provider call was started, to prevent duplicate calls. */
  providerCalled: boolean;
}

/** Classification of a job outcome, used for result write and retry policy. */
export type JobErrorCode =
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_TIMEOUT'
  | 'INVALID_AI_OUTPUT'
  | 'VALIDATION_ERROR'
  | 'INSUFFICIENT_CREDITS'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'
  | 'OPERATION_CONFLICT'
  | 'OPERATION_UNKNOWN';

/** Map from AI client codes to the operation policy error code vocabulary. */
const AI_ERROR_CODE_MAP: Record<string, JobErrorCode> = {
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  PROVIDER_TIMEOUT: 'PROVIDER_TIMEOUT',
  INVALID_AI_OUTPUT: 'INVALID_AI_OUTPUT',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INSUFFICIENT_CREDITS: 'INSUFFICIENT_CREDITS',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  OPERATION_CONFLICT: 'OPERATION_CONFLICT',
  OPERATION_UNKNOWN: 'OPERATION_UNKNOWN',
};

/**
 * Worker for asynchronous AI operations. Enforces the REL-03 constraints:
 * - jobId = operationId (enqueue is idempotent by operation ID);
 * - IDs-only payload;
 * - bounded concurrency and provider timeout;
 * - fenced result writes through AiOperationsService.markTerminal;
 * - bounded retries with exponential backoff;
 * - poison-job terminalization and dead-letter logging;
 * - graceful shutdown on module destroy.
 *
 * This implementation uses an in-process queue. A Redis/BullMQ-backed queue
 * can replace the transport later without changing the processor contract.
 */
@Injectable()
export class AiOperationProcessor implements OnModuleDestroy {
  private readonly logger = new Logger(AiOperationProcessor.name);

  private readonly queue: AiOperationJobPayload[] = [];
  private readonly jobs = new Map<string, JobState>();
  private readonly poisonJobs = new Map<
    string,
    { errorCode: string; attempts: number; message: string }
  >();

  private readonly inFlight = new Set<string>();
  private processing = false;
  private shuttingDown = false;

  /** Bounded fan-out; avoids exhausting the provider or the DB pool. */
  private readonly concurrency = 5;
  /** Provider call ceiling; leaves time to write the result before lease expiry. */
  private readonly providerTimeoutMs = 55_000;
  /** Retry backoff base (exponential: base * 2^(attempt-1)). */
  private readonly backoffBaseMs = 500;
  /** Bounded wait for in-flight jobs during shutdown. */
  private readonly shutdownTimeoutMs = 30_000;

  constructor(
    private readonly operationsService: AiOperationsService,
    private readonly policy: AiOperationsPolicy,
    private readonly aiClient: AiClientService,
  ) {}

  /**
   * Enqueue a job. The operation ID is the job ID, so duplicate enqueues for
   * the same operation are ignored while the job is queued or in flight.
   */
  async enqueue(payload: AiOperationJobPayload): Promise<void> {
    if (payload.version !== 1) {
      throw new UnprocessableEntityException(
        `Unsupported payload version: ${payload.version}`,
      );
    }
    if (this.shuttingDown) {
      throw new UnprocessableEntityException('Processor is shutting down');
    }
    if (!payload.operationId || !payload.userId || !payload.aiPath) {
      throw new UnprocessableEntityException('Invalid queue payload');
    }

    if (this.jobs.has(payload.operationId)) {
      this.logger.log(
        `Job ${payload.operationId} already known; ignoring duplicate enqueue`,
      );
      return;
    }

    this.jobs.set(payload.operationId, {
      payload,
      currentVersion: payload.expectedVersion,
      leaseToken: null,
      attempts: 0,
      lastErrorCode: null,
      providerCalled: false,
    });
    this.queue.push(payload);

    if (!this.processing) void this.processNextBatch();
  }

  /** Drain the queue with bounded concurrency. */
  private async processNextBatch(): Promise<void> {
    if (this.processing || this.shuttingDown) return;
    this.processing = true;

    try {
      while (this.queue.length > 0 && !this.shuttingDown) {
        const batch: AiOperationJobPayload[] = [];
        while (
          batch.length < this.concurrency &&
          this.queue.length > 0 &&
          !this.shuttingDown
        ) {
          const next = this.queue.shift();
          if (next) batch.push(next);
        }
        if (batch.length === 0) break;
        await Promise.all(batch.map((payload) => this.processJob(payload)));
      }
    } finally {
      this.processing = false;
    }
  }

  /** Claim, execute, terminalize. All errors are handled inside this method. */
  private async processJob(payload: AiOperationJobPayload): Promise<void> {
    const state = this.jobs.get(payload.operationId);
    if (!state) return;

    this.inFlight.add(payload.operationId);
    try {
      if (!state.providerCalled) {
        const claim = await this.operationsService.claimLease(
          payload.userId,
          payload.operationId,
          state.currentVersion,
          AiOperationsPolicy.DEFAULT_LEASE_TTL_MS,
        );

        if (claim.alreadyClaimed) {
          // Another invocation of this worker already owns the lease and is
          // calling the provider. Never issue a duplicate provider request.
          this.logger.log(
            `Job ${payload.operationId} already claimed; skipping duplicate call`,
          );
          this.jobs.delete(payload.operationId);
          return;
        }

        state.currentVersion = claim.operation.version;
        state.leaseToken = claim.leaseToken;
        state.providerCalled = true;
      }

      state.attempts += 1;

      const result = await this.callAiProvider(
        payload.aiPath,
        payload.context ?? {},
      );
      await this.operationsService.markTerminal(
        payload.userId,
        payload.operationId,
        state.currentVersion,
        state.leaseToken as string,
        'SUCCEEDED',
        {
          resultRef: result.resultRef,
          errorCode: null,
          finishedAt: new Date(),
        },
      );

      this.logger.log(`Job ${payload.operationId} succeeded`);
      this.jobs.delete(payload.operationId);
    } catch (error) {
      await this.handleJobError(state, error as Error);
    } finally {
      this.inFlight.delete(payload.operationId);
    }
  }

  /**
   * Call the provider with a hard deadline. A timeout does not abort the
   * underlying HTTP request, but the code maps it to an ambiguous terminal
   * state so a later worker never repeats a possibly-billed generation.
   */
  private async callAiProvider(
    aiPath: string,
    context: Record<string, unknown>,
  ): Promise<{ resultRef: string | null }> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('PROVIDER_TIMEOUT')),
        this.providerTimeoutMs,
      );
    });

    try {
      const result = await Promise.race([
        this.aiClient.post<Record<string, unknown>>(aiPath, context),
        timeout,
      ]);
      const resultRef =
        result && typeof result === 'object' && 'resultRef' in result
          ? String((result as Record<string, unknown>).resultRef)
          : result && typeof result === 'object' && 'id' in result
            ? String((result as Record<string, unknown>).id)
            : null;
      return { resultRef };
    } catch (error) {
      throw this.classifyProviderError(error);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Classify failures into the operation error code vocabulary. Errors that
   * may have reached the provider are ambiguous and must not be retried.
   */
  private classifyProviderError(error: unknown): Error {
    const aiError = (error as { aiError?: AiClientError } | null)?.aiError;
    if (aiError?.code && AI_ERROR_CODE_MAP[aiError.code]) {
      return new Error(AI_ERROR_CODE_MAP[aiError.code]);
    }
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('timeout') || message.includes('TIMEOUT'))
      return new Error('PROVIDER_TIMEOUT');
    if (message.includes('ECONNREFUSED') || message.includes('ENOTFOUND'))
      return new Error('PROVIDER_UNAVAILABLE');
    if (message.includes('429') || message.toLowerCase().includes('rate limit'))
      return new Error('RATE_LIMITED');
    if (message.includes('400') || message.includes('validation'))
      return new Error('VALIDATION_ERROR');
    return new Error('INTERNAL_ERROR');
  }

  /**
   * Retry known-safe failures with exponential backoff; terminalize the job
   * once the attempt budget is exhausted (poison job).
   */
  private async handleJobError(state: JobState, error: Error): Promise<void> {
    const { operationId, userId } = state.payload;
    const errorCode = (AI_ERROR_CODE_MAP[error.message] ??
      error.message) as JobErrorCode;
    state.lastErrorCode = errorCode;

    this.logger.error(
      `Job ${operationId} failed (attempt ${state.attempts}): ${errorCode}`,
    );

    const retryable =
      errorCode !== 'PROVIDER_TIMEOUT' &&
      errorCode !== 'INVALID_AI_OUTPUT' &&
      errorCode !== 'OPERATION_UNKNOWN';

    if (retryable && state.attempts < AiOperationsPolicy.DEFAULT_MAX_ATTEMPTS) {
      const delay = this.backoffBaseMs * 2 ** (state.attempts - 1);
      this.logger.log(
        `Retrying job ${operationId} in ${delay}ms (${state.attempts}/${AiOperationsPolicy.DEFAULT_MAX_ATTEMPTS})`,
      );
      setTimeout(() => {
        if (this.shuttingDown) return;
        this.queue.push(state.payload);
        if (!this.processing) void this.processNextBatch();
      }, delay);
      return;
    }

    // Poison job: dead-letter log + terminal write. Use the fenced version and
    // token from the last successful claim; never call the provider again.
    this.poisonJobs.set(operationId, {
      errorCode,
      attempts: state.attempts,
      message: error.message,
    });
    this.logger.warn(
      `Dead letter: job ${operationId} exhausted after ${state.attempts} attempt(s) with ${errorCode}`,
    );

    const ambiguous =
      this.policy.getRefundDecision('FAILED', errorCode).reason ===
      'requires_reconciliation';
    const status = ambiguous ? 'UNKNOWN' : 'FAILED';

    try {
      if (state.leaseToken) {
        await this.operationsService.markTerminal(
          userId,
          operationId,
          state.currentVersion,
          state.leaseToken,
          status,
          {
            chargedCredits: 0,
            resultRef: null,
            errorCode,
            finishedAt: new Date(),
            forceRefund: !ambiguous,
          },
        );
      } else {
        this.logger.warn(
          `No lease token for job ${operationId}; leaving it for lease recovery`,
        );
      }
    } catch (terminalError) {
      // A lost lease means a newer worker owns the operation. Do not retry the
      // write; the expiry/reconciler path will settle it safely.
      this.logger.error(
        `Could not terminalize job ${operationId}: ${(terminalError as Error).message}`,
      );
    }

    this.jobs.delete(operationId);
  }

  /**
   * Stop taking new work, wait for in-flight jobs up to a bound, and leave any
   * remaining live leases to expire and be reconciled after restart.
   */
  async onModuleDestroy(): Promise<void> {
    this.shuttingDown = true;
    const deadline = Date.now() + this.shutdownTimeoutMs;

    while (this.inFlight.size > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    if (this.inFlight.size > 0) {
      this.logger.warn(
        `Shutdown deadline reached with ${this.inFlight.size} in-flight job(s); leases will expire naturally`,
      );
    }
    this.logger.log(
      `Processor stopped. Dead-lettered jobs: ${this.poisonJobs.size}`,
    );
  }

  /** Observability hook for monitoring and tests. */
  getStats(): {
    queued: number;
    active: number;
    inFlight: number;
    deadLettered: number;
    shuttingDown: boolean;
  } {
    return {
      queued: this.queue.length,
      active: this.jobs.size,
      inFlight: this.inFlight.size,
      deadLettered: this.poisonJobs.size,
      shuttingDown: this.shuttingDown,
    };
  }
}
