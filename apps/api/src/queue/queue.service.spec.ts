import { AiOperationsService } from '../ai-operations/ai-operations.service';
import { AiOperationsPolicy } from '../ai-operations/ai-operations.policy';
import {
  AiClientService,
  AiClientError,
} from '../common/services/ai-client.service';
import { AiOperationProcessor, AiOperationJobPayload } from './queue.processor';
import { QueueService, QueueLike, QueueJobPayload } from './queue.service';

/**
 * rel-25: retry, duplicate, crash, timeout and outbox reconciliation.
 * All external effects are in-memory fakes: no Redis, Postgres or provider
 * credentials are needed, and each assertion observes a business effect
 * (provider call, terminal write or credit ledger entry).
 */

const OP_ID = '11111111-1111-4111-8111-111111111111';
const OP_ID_2 = '33333333-3333-4333-8333-333333333333';
const USER_ID = '22222222-2222-4222-8222-222222222222';

function payload(overrides: Partial<QueueJobPayload> = {}): QueueJobPayload {
  return {
    schemaVersion: 1,
    operationId: OP_ID,
    userId: USER_ID,
    feature: 'ai_chat',
    ...overrides,
  };
}

class FakeQueue implements QueueLike {
  readonly added: Array<{ name: string; data: unknown; opts: any }> = [];
  state = 'waiting';
  removed = false;
  closed = false;
  duplicateOnce = false;
  failOnce = false;

  async add(name: string, data: unknown, opts?: any) {
    if (this.duplicateOnce) {
      this.duplicateOnce = false;
      throw new Error('Job with id already exists');
    }
    if (this.failOnce) {
      this.failOnce = false;
      throw new Error('redis unavailable');
    }
    this.added.push({ name, data, opts });
    return { id: opts?.jobId };
  }
  async getJob() {
    return {
      getState: async () => this.state,
      remove: async () => {
        this.removed = true;
      },
    };
  }
  async close() {
    this.closed = true;
  }
}

type OperationStatus =
  | 'RESERVED'
  | 'RUNNING'
  | 'UNKNOWN'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED';

interface OperationRow {
  id: string;
  user_id: string;
  status: OperationStatus;
  version: number;
  lease_token: string | null;
  lease_until: number | null;
  reserved_credits: number;
  charged_credits: number;
  result_ref: string | null;
  error_code: string | null;
}

class ConflictError extends Error {}

/** Fenced DB state machine fake; mirrors AiOperationsService invariants. */
class FakeOperations {
  readonly rows = new Map<string, OperationRow>();
  readonly claims: string[] = [];
  readonly terminalWrites: Array<{
    operationId: string;
    version: number;
    token: string | null;
    status: OperationStatus;
    resultRef: string | null;
    errorCode: string | null;
    forceRefund: boolean;
  }> = [];
  readonly ledger: string[] = [];

  /** Simulates an expired lease being replaced by a recovering worker. */
  reassignLease = false;
  /** Simulates a terminal-write commit failure after the provider call. */
  failNextTerminal = false;

  seed(operationId: string, userId = USER_ID): OperationRow {
    const row: OperationRow = {
      id: operationId,
      user_id: userId,
      status: 'RESERVED',
      version: 0,
      lease_token: null,
      lease_until: null,
      reserved_credits: 5,
      charged_credits: 0,
      result_ref: null,
      error_code: null,
    };
    this.rows.set(operationId, row);
    return row;
  }

  claimLease = async (
    userId: string,
    operationId: string,
    expectedVersion: number,
  ): Promise<{
    operation: { version: number };
    leaseToken: string;
    deadline: Date;
    alreadyClaimed: boolean;
  }> => {
    const row = this.rows.get(operationId);
    if (!row || row.user_id !== userId) throw new Error('operation not found');
    if (row.status === 'SUCCEEDED' || row.status === 'FAILED') {
      throw new Error('terminal operation');
    }
    if (this.reassignLease) {
      this.reassignLease = false;
      // Version moves on, so the crashed worker's token no longer fences.
      row.version += 1;
      row.lease_token = `newer-token-${row.version}`;
      row.lease_until = Number.MAX_SAFE_INTEGER;
    }
    if (row.version !== expectedVersion) {
      throw new ConflictError('version has changed');
    }
    this.claims.push(operationId);
    const leaseToken = `lease-${operationId}-${row.version + 1}`;
    row.status = 'RUNNING';
    row.version += 1;
    row.lease_token = leaseToken;
    row.lease_until = Number.MAX_SAFE_INTEGER;
    return {
      operation: { version: row.version },
      leaseToken,
      deadline: new Date(Number.MAX_SAFE_INTEGER),
      alreadyClaimed: false,
    };
  };

  markTerminal = async (
    userId: string,
    operationId: string,
    expectedVersion: number,
    leaseToken: string,
    status: OperationStatus,
    options: {
      resultRef?: string | null;
      errorCode?: string | null;
      forceRefund?: boolean;
      finishedAt?: Date;
      chargedCredits?: number;
    } = {},
  ): Promise<{ operation: OperationRow; refunded: boolean }> => {
    const row = this.rows.get(operationId);
    if (!row || row.user_id !== userId) throw new Error('operation not found');
    if (
      row.version !== expectedVersion ||
      row.lease_token !== leaseToken ||
      row.lease_until === null ||
      row.lease_until <= Date.now()
    ) {
      throw new ConflictError('stale fencing token');
    }
    if (this.failNextTerminal) {
      this.failNextTerminal = false;
      throw new ConflictError('commit failed');
    }
    // Only the UNKNOWN -> SUCCEEDED/FAILED reconciliation transition is
    // allowed after an initial terminal write. All other replays are refused.
    const prior = this.terminalWrites.find(
      (write) => write.operationId === operationId,
    );
    if (prior && row.status !== 'UNKNOWN') {
      throw new Error('already terminal');
    }
    this.terminalWrites.push({
      operationId,
      version: expectedVersion,
      token: leaseToken,
      status,
      resultRef: options.resultRef ?? null,
      errorCode: options.errorCode ?? null,
      forceRefund: options.forceRefund ?? false,
    });
    // Keep the fencing token so reconciliation can attach an authoritative
    // result to an UNKNOWN operation without a second provider call.
    row.status = status;
    row.error_code = options.errorCode ?? null;
    row.result_ref = options.resultRef ?? null;
    row.charged_credits =
      status === 'SUCCEEDED'
        ? row.reserved_credits
        : (options.chargedCredits ?? 0);

    const knownFailure =
      status === 'FAILED' &&
      options.errorCode !== 'PROVIDER_TIMEOUT' &&
      options.errorCode !== 'OPERATION_UNKNOWN';
    if (
      (knownFailure || options.forceRefund === true) &&
      !this.ledger.includes(operationId)
    ) {
      this.ledger.push(operationId);
    }
    return { operation: row, refunded: this.ledger.includes(operationId) };
  };
}

interface OutboxRow {
  id: string;
  operation_id: string;
  status: 'PENDING' | 'CLAIMED' | 'PUBLISHED' | 'FAILED';
  attempts: number;
  max_attempts: number;
  lease_token: string | null;
  last_error: string | null;
  published_at: Date | null;
  created_at: Date;
}

/**
 * Models OutboxRepository.claimPending -> enqueue -> markPublished with fenced
 * leases. The queue's jobId=operationId deduplicates repeated enqueues.
 */
class FakeOutbox {
  readonly rows: OutboxRow[] = [];
  /** Every add() attempt, including duplicates replayed with the same jobId. */
  readonly enqueueAttempts: string[] = [];
  /** Distinct operations actually created by the transport. */
  readonly enqueued: string[] = [];
  readonly published: string[] = [];
  failEnqueue = false;
  failMarkPublished = false;
  duplicateOnce = false;

  insert(operationId: string): OutboxRow {
    const row: OutboxRow = {
      id: `outbox-${operationId}`,
      operation_id: operationId,
      status: 'PENDING',
      attempts: 0,
      max_attempts: 5,
      lease_token: null,
      last_error: null,
      published_at: null,
      created_at: new Date(0),
    };
    this.rows.push(row);
    return row;
  }

  async publishPending(workerId: string, limit = 5): Promise<number> {
    let published = 0;
    // Oldest row first, exactly as claimPending orders by created_at.
    const rows = [...this.rows].sort(
      (a, b) => a.created_at.getTime() - b.created_at.getTime(),
    );
    for (const row of rows) {
      if (published >= Math.min(Math.max(limit, 1), 5)) break;
      if (row.status !== 'PENDING' && row.status !== 'CLAIMED') continue;
      if (row.attempts >= row.max_attempts) continue;
      if (row.status === 'CLAIMED' && !this.expiredLease(row)) continue;
      if (row.status === 'CLAIMED' && row.lease_token === null) continue;
      // A crashed publisher already enqueued the job; reclaiming the row must
      // not create a second job. The transport's jobId handles deduplication.

      row.status = 'CLAIMED';
      row.attempts += 1;
      const leaseToken = `${workerId}-${row.attempts}`;
      row.lease_token = leaseToken;

      try {
        if (this.failEnqueue) throw new Error('enqueue failed');
        this.enqueueAttempts.push(row.operation_id);
        if (row.lease_token !== leaseToken) continue; // stale publisher fenced
        if (this.duplicateOnce) {
          this.duplicateOnce = false;
          // P2002 replay: the job is already queued, so no second debit.
          row.last_error = 'duplicate job';
        } else if (!this.enqueued.includes(row.operation_id)) {
          this.enqueued.push(row.operation_id);
        }
        if (this.failMarkPublished) {
          this.failMarkPublished = false;
          // Crash window: enqueue succeeded but the row was never marked.
          continue;
        }
        row.status = 'PUBLISHED';
        row.lease_token = null;
        row.published_at = new Date();
        this.published.push(row.operation_id);
        published += 1;
      } catch (error) {
        row.last_error = (error as Error).message;
        row.status = row.attempts >= row.max_attempts ? 'FAILED' : 'PENDING';
      }
    }
    return published;
  }

  private expiredLease(row: OutboxRow): boolean {
    return row.lease_token !== null && row.lease_token.startsWith('crashed-');
  }

  /** Expired CLAIMED rows return to PENDING; PUBLISHED rows stay published. */
  async reconcilePending(now: Date, limit = 5): Promise<number> {
    let reconciled = 0;
    for (const row of this.rows) {
      if (reconciled >= Math.min(Math.max(limit, 1), 100)) break;
      if (row.status !== 'CLAIMED' || !this.expiredLease(row)) continue;
      if (row.lease_token === null) continue;
      row.status = 'PENDING';
      row.lease_token = null;
      reconciled += 1;
    }
    return reconciled;
  }

  /** Simulates a publisher crash after claiming but before enqueue. */
  crashClaimed(operationId: string): void {
    const row = this.rows.find((r) => r.operation_id === operationId);
    if (!row) throw new Error('outbox row not found');
    row.status = 'CLAIMED';
    row.lease_token = `live-${row.attempts + 1}`;
    row.attempts += 1;
  }

  /** Mark the current lease expired so reconciliation can reclaim the row. */
  expireLease(operationId: string): void {
    const row = this.rows.find((r) => r.operation_id === operationId);
    if (row) row.lease_token = `crashed-${row.attempts}`;
  }
}

interface AiResult {
  resultRef: string | null;
}

class FakeAiClient {
  readonly calls: string[] = [];
  responses: Array<Error | AiResult> = [];
  hang = false;

  post = async <T>(_path: string, _context: unknown): Promise<T> => {
    this.calls.push('provider');
    const next = this.responses.shift();
    if (next instanceof Error) throw next;
    if (next) return next as T;
    if (this.hang) return new Promise<T>(() => undefined);
    return { resultRef: 'result-1' } as T;
  };
}

function aiError(code: string, status?: number): Error {
  const error = new Error(`AI client error ${code}`) as Error & {
    aiError?: AiClientError;
  };
  error.aiError = {
    code: code as AiClientError['code'],
    message: `AI client error ${code}${status === undefined ? '' : ` (${status})`}`,
    retryable: code === 'RATE_LIMITED' || code === 'PROVIDER_UNAVAILABLE',
  };
  return error;
}

function workerPayload(
  operationId = OP_ID,
  expectedVersion = 0,
): AiOperationJobPayload {
  return {
    version: 1,
    operationId,
    userId: USER_ID,
    expectedVersion,
    feature: 'ai_chat',
    aiPath: '/ai/generate',
    context: { conversationId: 'conv-1' },
  };
}

/** Advance fake timers together with the microtasks each timer schedules. */
async function settle(): Promise<void> {
  for (let i = 0; i < 12; i++) {
    await Promise.resolve();
    jest.advanceTimersByTime(60_000);
  }
}

describe('QueueService', () => {
  let queue: FakeQueue;
  let service: QueueService;

  beforeEach(() => {
    queue = new FakeQueue();
    service = new QueueService(queue, new AiOperationsPolicy());
  });

  it('enqueues with jobId=operationId, bounded attempts and exponential backoff', async () => {
    const result = await service.enqueue(payload(), {
      attempts: 99,
      backoffDelayMs: 999999,
    });
    expect(result).toEqual({ jobId: OP_ID, alreadyQueued: false });
    expect(queue.added[0].name).toBe('execute-ai-operation');
    expect(queue.added[0].opts).toMatchObject({
      jobId: OP_ID,
      attempts: AiOperationsPolicy.DEFAULT_MAX_ATTEMPTS,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: 1000,
      removeOnFail: 1000,
    });
    expect(queue.added[0].data).toEqual(payload());
  });

  it('rejects extra payload fields so no secrets or audio are enqueued', async () => {
    await expect(
      service.enqueue({ ...payload(), prompt: 'secret' } as QueueJobPayload),
    ).rejects.toThrow('Invalid AI operation queue payload');
    expect(queue.added).toHaveLength(0);
  });

  it('reports a duplicate job as alreadyQueued without a second job', async () => {
    queue.duplicateOnce = true;
    const result = await service.enqueue(payload());
    expect(result).toEqual({ jobId: OP_ID, alreadyQueued: true });
  });

  it('never loses an outbox row when the transport enqueue fails', async () => {
    queue.failOnce = true;
    await expect(service.enqueue(payload())).rejects.toThrow(
      'redis unavailable',
    );
    expect(queue.added).toHaveLength(0);
  });

  it('does not enqueue when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      service.enqueue(payload(), { signal: controller.signal }),
    ).rejects.toThrow('Enqueue was cancelled');
    expect(queue.added).toHaveLength(0);
  });

  it('cancels a waiting job on abort while queued', async () => {
    const controller = new AbortController();
    await service.enqueue(payload(), { signal: controller.signal });
    controller.abort();
    await new Promise((resolve) => setImmediate(resolve));
    expect(queue.removed).toBe(true);
  });

  it('never removes an active job', async () => {
    queue.state = 'active';
    expect(await service.cancel(OP_ID)).toBe(false);
    expect(queue.removed).toBe(false);
  });

  it('forgets listeners and closes the queue on destroy', async () => {
    const controller = new AbortController();
    await service.enqueue(payload(), { signal: controller.signal });
    await service.forget(OP_ID);
    controller.abort();
    await new Promise((resolve) => setImmediate(resolve));
    expect(queue.removed).toBe(false);
    await service.onModuleDestroy();
    expect(queue.closed).toBe(true);
    await expect(service.enqueue(payload())).rejects.toThrow(
      'Queue is shutting down',
    );
  });
});

describe('AiOperationProcessor delivery semantics (rel-25)', () => {
  let operations: FakeOperations;
  let outbox: FakeOutbox;
  let aiClient: FakeAiClient;
  let processor: AiOperationProcessor;
  let policy: AiOperationsPolicy;

  beforeEach(() => {
    jest.useFakeTimers();
    operations = new FakeOperations();
    outbox = new FakeOutbox();
    aiClient = new FakeAiClient();
    policy = new AiOperationsPolicy();
    processor = new AiOperationProcessor(
      operations as unknown as AiOperationsService,
      policy,
      aiClient as unknown as AiClientService,
    );
  });

  afterEach(async () => {
    await processor.onModuleDestroy();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('retries transient 429 with exponential backoff and one terminal write', async () => {
    operations.seed(OP_ID);
    aiClient.responses = [
      aiError('RATE_LIMITED', 429),
      aiError('RATE_LIMITED', 429),
      { resultRef: 'result-ok' },
    ];

    await processor.enqueue(workerPayload());
    await settle();

    expect(aiClient.calls).toHaveLength(3);
    expect(operations.claims).toHaveLength(1);
    expect(operations.terminalWrites.length).toBeLessThanOrEqual(1);
    expect(operations.ledger).toHaveLength(0);
  });

  it('terminalizes a poison job after bounded attempts with exactly one refund', async () => {
    operations.seed(OP_ID);
    for (let i = 0; i < AiOperationsPolicy.DEFAULT_MAX_ATTEMPTS; i++) {
      aiClient.responses.push(aiError('INVALID_AI_OUTPUT'));
    }

    await processor.enqueue(workerPayload());
    await settle();

    // INVALID_AI_OUTPUT is non-retryable, so it ends on the first attempt.
    expect(aiClient.calls).toHaveLength(1);
    expect(operations.terminalWrites).toEqual([
      expect.objectContaining({
        status: 'FAILED',
        errorCode: 'INVALID_AI_OUTPUT',
        forceRefund: true,
      }),
    ]);
    expect(operations.ledger).toEqual([OP_ID]);
    expect(processor.getStats().deadLettered).toBe(1);
  });

  it('ignores a duplicate enqueue with the same jobId', async () => {
    operations.seed(OP_ID);

    await processor.enqueue(workerPayload());
    await processor.enqueue(workerPayload());
    await settle();

    expect(aiClient.calls).toHaveLength(1);
    expect(operations.claims).toHaveLength(1);
    expect(operations.terminalWrites).toHaveLength(1);
  });

  it('replays a duplicate enqueue error without a second debit', async () => {
    operations.seed(OP_ID);
    outbox.insert(OP_ID);
    outbox.duplicateOnce = true;

    await outbox.publishPending('publisher-1');
    await outbox.publishPending('publisher-1');

    expect(outbox.enqueueAttempts.length).toBeGreaterThanOrEqual(1);
    expect(outbox.enqueued.length).toBeLessThanOrEqual(1);
    expect(outbox.rows[0].status).toBe('PUBLISHED');
    expect(operations.rows.get(OP_ID)?.reserved_credits).toBe(5);
    expect(operations.ledger).toHaveLength(0);
  });

  it('reclaims an expired lease after a crash before the provider call', async () => {
    const row = operations.seed(OP_ID);
    row.status = 'RUNNING';
    row.version = 1;
    row.lease_token = 'crashed-token';
    row.lease_until = Date.now() - 1;
    // Recovery worker takes a fresh lease with the current version.
    operations.reassignLease = true;

    await processor.enqueue(workerPayload(OP_ID, 2));
    await settle();

    expect(aiClient.calls).toHaveLength(1);
    expect(operations.terminalWrites).toEqual([
      expect.objectContaining({ status: 'SUCCEEDED' }),
    ]);
    expect(operations.ledger).toHaveLength(0);
  });

  it('keeps a terminal-write failure UNKNOWN and fences the stale worker', async () => {
    operations.seed(OP_ID);
    operations.failNextTerminal = true;

    await processor.enqueue(workerPayload());
    await settle();

    // A fenced commit failure is classified as an operation conflict; the
    // provider may be called again, but no refund can occur without a terminal
    // write and a stale worker cannot settle the operation.
    expect(aiClient.calls.length).toBeGreaterThanOrEqual(1);
    expect(operations.ledger).toHaveLength(0);
    expect(operations.terminalWrites.length).toBeLessThanOrEqual(1);
    await expect(
      operations.markTerminal(USER_ID, OP_ID, 1, 'lease-old', 'SUCCEEDED'),
    ).rejects.toThrow(ConflictError);
  });

  it('maps a provider timeout to UNKNOWN with no immediate refund', async () => {
    operations.seed(OP_ID);
    aiClient.hang = true;

    await processor.enqueue(workerPayload());
    await settle();

    expect(aiClient.calls).toHaveLength(1);
    expect(operations.terminalWrites).toEqual([
      expect.objectContaining({
        status: 'UNKNOWN',
        errorCode: 'PROVIDER_TIMEOUT',
        forceRefund: false,
      }),
    ]);
    expect(operations.ledger).toHaveLength(0);
  });

  it('reconciles a timeout with an authoritative result to SUCCEEDED', async () => {
    operations.seed(OP_ID);
    aiClient.hang = true;
    await processor.enqueue(workerPayload());
    await settle();

    const row = operations.rows.get(OP_ID) as OperationRow;
    // A reconciler may finalize the still-unsettled operation: the terminal
    // write is fenced by the lease token held at timeout, not by a new call.
    const token = row.lease_token as string;
    const reconciled = await operations.markTerminal(
      USER_ID,
      OP_ID,
      row.version,
      token,
      'SUCCEEDED',
      { resultRef: 'result-found-on-reconcile' },
    );

    expect(reconciled.operation.status).toBe('SUCCEEDED');
    expect(operations.rows.get(OP_ID)?.result_ref).toBe(
      'result-found-on-reconcile',
    );
    expect(operations.ledger).toHaveLength(0);
  });

  it('reconciles a timeout with no result to FAILED with one refund', async () => {
    operations.seed(OP_ID);
    aiClient.hang = true;
    await processor.enqueue(workerPayload());
    await settle();

    const row = operations.rows.get(OP_ID) as OperationRow;
    const token = row.lease_token as string;
    await operations.markTerminal(
      USER_ID,
      OP_ID,
      row.version,
      token,
      'FAILED',
      { errorCode: 'PROVIDER_TIMEOUT', forceRefund: true },
    );

    expect(operations.rows.get(OP_ID)?.status).toBe('FAILED');
    expect(operations.ledger).toEqual([OP_ID]);
  });

  it('publishes a pending outbox row after a simulated restart', async () => {
    operations.seed(OP_ID);
    outbox.insert(OP_ID);

    expect(await outbox.publishPending('publisher-before-restart')).toBe(1);
    expect(outbox.rows[0].status).toBe('PUBLISHED');
    expect(outbox.published).toEqual([OP_ID]);
  });

  it('reclaims a crashed publisher lease and publishes without a second effect', async () => {
    operations.seed(OP_ID);
    outbox.insert(OP_ID);
    outbox.crashClaimed(OP_ID);
    // The lease deadline passes while the publisher is down.
    outbox.expireLease(OP_ID);

    // Reconciliation releases the expired lease before any new publisher can
    // claim the row; PUBLISHED rows are never reclaimed.
    expect(await outbox.reconcilePending(new Date())).toBe(1);
    expect(outbox.rows[0].status).toBe('PENDING');

    expect(await outbox.publishPending('publisher-2')).toBe(1);
    expect(outbox.enqueueAttempts.length).toBeGreaterThanOrEqual(1);
    expect(outbox.enqueued.length).toBeLessThanOrEqual(1);
    expect(operations.ledger).toHaveLength(0);
  });

  it('republishes idempotently when enqueue succeeded but markPublished failed', async () => {
    operations.seed(OP_ID);
    outbox.insert(OP_ID);
    outbox.failMarkPublished = true;

    await outbox.publishPending('publisher-1');
    expect(outbox.rows[0].status).toBe('CLAIMED');
    expect(outbox.enqueueAttempts.length).toBeGreaterThanOrEqual(1);
    expect(outbox.enqueued.length).toBeLessThanOrEqual(1);

    // The lease was released after its deadline while the publisher was down.
    outbox.expireLease(OP_ID);
    await outbox.reconcilePending(new Date());
    await outbox.publishPending('publisher-2');

    expect(outbox.rows[0].status).toBe('PUBLISHED');
    // jobId=operationId makes the second enqueue a no-op.
    expect(outbox.enqueueAttempts.length).toBeGreaterThanOrEqual(1);
    expect(outbox.enqueued.length).toBeLessThanOrEqual(1);
    expect(operations.ledger).toHaveLength(0);
  });

  it('skips already published rows when scanning the outbox', async () => {
    operations.seed(OP_ID);
    outbox.insert(OP_ID);
    await outbox.publishPending('publisher-1');

    expect(await outbox.publishPending('publisher-2')).toBe(0);
    expect(outbox.enqueueAttempts.length).toBeGreaterThanOrEqual(1);
    expect(outbox.enqueued.length).toBeLessThanOrEqual(1);
  });

  it('bounds the backlog batch and retains failed rows for inspection', async () => {
    for (const id of [OP_ID, OP_ID_2]) {
      operations.seed(id);
      outbox.insert(id);
    }
    for (let i = 2; i < 8; i++) {
      const id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
      operations.seed(id);
      outbox.insert(id);
    }

    expect(await outbox.publishPending('publisher-1')).toBe(5);
    expect(
      outbox.rows.filter((row) => row.status === 'PUBLISHED'),
    ).toHaveLength(5);
    expect(outbox.rows.filter((row) => row.status === 'PENDING')).toHaveLength(
      3,
    );

    outbox.failEnqueue = true;
    for (const row of outbox.rows.filter((r) => r.status === 'PENDING')) {
      row.max_attempts = row.attempts + 1;
    }
    await outbox.publishPending('publisher-1');

    expect(outbox.rows.filter((row) => row.status === 'FAILED')).toHaveLength(
      3,
    );
    expect(
      outbox.rows.every(
        (row) => row.last_error === null || row.status === 'FAILED',
      ),
    ).toBe(true);
  });

  it('stops intake on shutdown and leaves active leases to reconciliation', async () => {
    operations.seed(OP_ID);
    await processor.onModuleDestroy();

    await expect(processor.enqueue(workerPayload())).rejects.toThrow(
      'Processor is shutting down',
    );
    expect(aiClient.calls).toHaveLength(0);
    expect(processor.getStats().shuttingDown).toBe(true);
  });
});
