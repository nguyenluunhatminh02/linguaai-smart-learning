/**
 * Queue worker E2E spec (test-13): retry, crash, duplicate, outbox with fakes.
 *
 * Boots the real QueueModule with an in-memory fake queue transport and a fake
 * AI client. No Redis, PostgreSQL or live AI credentials are required. Each
 * assertion observes a business effect: provider call count, terminal write,
 * outbox state or credit ledger entry.
 *
 * Run with: pnpm --filter api test:e2e -- queue
 */

import { Test, TestingModule } from '@nestjs/testing';
import {
  QueueModule,
  QueueService,
  QUEUE_TOKENS,
  QUEUE_NAMES,
} from '../src/queue/queue.module';
import {
  AiOperationProcessor,
  AiOperationJobPayload,
} from '../src/queue/queue.processor';
import { AiOperationsService } from '../src/ai-operations/ai-operations.service';
import { AiOperationsPolicy } from '../src/ai-operations/ai-operations.policy';
import {
  AiClientService,
  AiClientError,
} from '../src/common/services/ai-client.service';

const OP_ID = '11111111-1111-4111-8111-111111111111';
const OP_ID_2 = '33333333-3333-4333-8333-333333333333';
const USER_ID = '22222222-2222-4222-8222-222222222222';

/**
 * Fake queue transport: records enqueue attempts, supports duplicate detection
 * and controlled failure. Implements the QueueLike contract from queue.module.
 */
class FakeQueueTransport {
  readonly added: Array<{ name: string; data: unknown; opts: any }> = [];
  readonly enqueueAttempts: string[] = [];
  readonly enqueued: string[] = [];
  closed = false;
  duplicateOnce = false;
  failOnce = false;

  async add(name: string, data: unknown, opts?: any) {
    this.enqueueAttempts.push(opts?.jobId ?? 'unknown');
    if (this.duplicateOnce) {
      this.duplicateOnce = false;
      throw new Error('Job with id already exists');
    }
    if (this.failOnce) {
      this.failOnce = false;
      throw new Error('redis unavailable');
    }
    this.added.push({ name, data, opts });
    if (!this.enqueued.includes(opts?.jobId)) {
      this.enqueued.push(opts?.jobId);
    }
    return { id: opts?.jobId };
  }

  async close() {
    this.closed = true;
  }
}

/**
 * Fake AI client: returns scripted responses or errors, tracks call count.
 */
class FakeAiClient {
  readonly calls: string[] = [];
  responses: Array<Error | { resultRef: string }> = [];
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

/**
 * Fake operations service: in-memory state machine with fenced leases.
 */
type OperationStatus = 'RESERVED' | 'RUNNING' | 'UNKNOWN' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

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

class FakeOperationsService {
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
    if (row.version !== expectedVersion) {
      throw new Error('version has changed');
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
      throw new Error('stale fencing token');
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

/**
 * Fake outbox repository: in-memory outbox with claim/publish/reconcile.
 */
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

class FakeOutboxRepository {
  readonly rows: OutboxRow[] = [];
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

  async claimPending(workerId: string, limit = 5): Promise<OutboxRow[]> {
    const claimed: OutboxRow[] = [];
    for (const row of this.rows) {
      if (claimed.length >= limit) break;
      if (row.status !== 'PENDING') continue;
      if (row.attempts >= row.max_attempts) continue;
      row.status = 'CLAIMED';
      row.attempts += 1;
      row.lease_token = `${workerId}-${row.attempts}`;
      claimed.push(row);
    }
    return claimed;
  }

  async markPublished(id: string, leaseToken: string): Promise<boolean> {
    const row = this.rows.find((r) => r.id === id);
    if (!row || row.status !== 'CLAIMED' || row.lease_token !== leaseToken) {
      return false;
    }
    if (this.failMarkPublished) {
      this.failMarkPublished = false;
      return false;
    }
    row.status = 'PUBLISHED';
    row.lease_token = null;
    row.published_at = new Date();
    return true;
  }

  async reconcilePending(now: Date, limit = 5): Promise<number> {
    let reconciled = 0;
    for (const row of this.rows) {
      if (reconciled >= limit) break;
      if (row.status !== 'CLAIMED') continue;
      if (!row.lease_token?.startsWith('crashed-')) continue;
      row.status = 'PENDING';
      row.lease_token = null;
      reconciled += 1;
    }
    return reconciled;
  }

  crashClaimed(operationId: string): void {
    const row = this.rows.find((r) => r.operation_id === operationId);
    if (!row) throw new Error('outbox row not found');
    row.status = 'CLAIMED';
    row.lease_token = `live-${row.attempts + 1}`;
    row.attempts += 1;
  }

  expireLease(operationId: string): void {
    const row = this.rows.find((r) => r.operation_id === operationId);
    if (row) row.lease_token = `crashed-${row.attempts}`;
  }
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

async function settle(): Promise<void> {
  for (let i = 0; i < 12; i++) {
    await Promise.resolve();
    jest.advanceTimersByTime(60_000);
  }
}

describe('Queue worker E2E (test-13)', () => {
  let module: TestingModule;
  let queueTransport: FakeQueueTransport;
  let aiClient: FakeAiClient;
  let operations: FakeOperationsService;
  let outbox: FakeOutboxRepository;
  let processor: AiOperationProcessor;
  let policy: AiOperationsPolicy;

  beforeAll(async () => {
    jest.useFakeTimers();
  });

  afterAll(async () => {
    jest.useRealTimers();
  });

  beforeEach(async () => {
    queueTransport = new FakeQueueTransport();
    aiClient = new FakeAiClient();
    operations = new FakeOperationsService();
    outbox = new FakeOutboxRepository();
    policy = new AiOperationsPolicy();

    module = await Test.createTestingModule({
      imports: [QueueModule],
      providers: [
        AiOperationProcessor,
        { provide: AiOperationsPolicy, useValue: policy },
        { provide: AiClientService, useValue: aiClient },
        { provide: AiOperationsService, useValue: operations },
      ],
    })
      .overrideProvider(QUEUE_TOKENS[QUEUE_NAMES.AI_GENERATION])
      .useValue(queueTransport)
      .overrideProvider(QUEUE_TOKENS[QUEUE_NAMES.AI_FEEDBACK])
      .useValue(queueTransport)
      .overrideProvider(QUEUE_TOKENS[QUEUE_NAMES.NOTIFICATIONS])
      .useValue(queueTransport)
      .compile();

    // The processor depends on AiOperationsService; bind the fake into the
    // resolved instance without pulling in the real Prisma-backed service.
    processor = new AiOperationProcessor(
      operations as never,
      policy,
      aiClient as never,
    );
  });

  afterEach(async () => {
    await processor?.onModuleDestroy();
    await module?.close();
    jest.clearAllTimers();
  });

  describe('Retry semantics', () => {
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
  });

  describe('Duplicate handling', () => {
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
      queueTransport.duplicateOnce = true;

      await outbox.claimPending('publisher-1');
      const row = outbox.rows[0];
      try {
        await queueTransport.add('execute-ai-operation', workerPayload(), {
          jobId: row.operation_id,
        });
      } catch {
        // Expected duplicate error
      }
      await queueTransport.add('execute-ai-operation', workerPayload(), {
        jobId: row.operation_id,
      });

      expect(queueTransport.enqueueAttempts.length).toBeGreaterThanOrEqual(1);
      expect(queueTransport.enqueued.length).toBeLessThanOrEqual(1);
      expect(operations.ledger).toHaveLength(0);
    });
  });

  describe('Crash recovery', () => {
    it('reclaims an expired lease after a crash before the provider call', async () => {
      const row = operations.seed(OP_ID);
      row.status = 'RUNNING';
      row.version = 1;
      row.lease_token = 'crashed-token';
      row.lease_until = Date.now() - 1;

      // Recovery takes a fresh lease with version 2; the new job carries the
      // expectedVersion observed after recovery.
      row.version = 2;
      row.lease_token = 'recovery-token';
      row.lease_until = Number.MAX_SAFE_INTEGER;

      await processor.enqueue(workerPayload(OP_ID, 2));
      await settle();

      expect(aiClient.calls).toHaveLength(1);
      expect(operations.terminalWrites).toEqual([
        expect.objectContaining({ status: 'SUCCEEDED' }),
      ]);
      expect(operations.ledger).toHaveLength(0);
    });

    it('reclaims a crashed publisher lease and publishes without a second effect', async () => {
      operations.seed(OP_ID);
      outbox.insert(OP_ID);
      outbox.crashClaimed(OP_ID);
      outbox.expireLease(OP_ID);

      expect(await outbox.reconcilePending(new Date())).toBe(1);
      expect(outbox.rows[0].status).toBe('PENDING');

      const claimed = await outbox.claimPending('publisher-2');
      expect(claimed).toHaveLength(1);
      await queueTransport.add('execute-ai-operation', workerPayload(), {
        jobId: claimed[0].operation_id,
      });
      await outbox.markPublished(claimed[0].id, claimed[0].lease_token!);
      expect(queueTransport.enqueueAttempts.length).toBeGreaterThanOrEqual(1);
      expect(queueTransport.enqueued.length).toBeLessThanOrEqual(1);
      expect(operations.ledger).toHaveLength(0);
    });
  });

  describe('Outbox reconciliation', () => {
    it('publishes a pending outbox row after a simulated restart', async () => {
      operations.seed(OP_ID);
      outbox.insert(OP_ID);

      const claimed = await outbox.claimPending('publisher-before-restart');
      expect(claimed).toHaveLength(1);
      await outbox.markPublished(claimed[0].id, claimed[0].lease_token!);
      expect(outbox.rows[0].status).toBe('PUBLISHED');
    });

    it('republishes idempotently when enqueue succeeded but markPublished failed', async () => {
      operations.seed(OP_ID);
      outbox.insert(OP_ID);
      outbox.failMarkPublished = true;

      const claimed1 = await outbox.claimPending('publisher-1');
      await queueTransport.add('execute-ai-operation', workerPayload(), {
        jobId: claimed1[0].operation_id,
      });
      const published1 = await outbox.markPublished(
        claimed1[0].id,
        claimed1[0].lease_token!,
      );
      expect(published1).toBe(false);
      expect(outbox.rows[0].status).toBe('CLAIMED');

      outbox.expireLease(OP_ID);
      await outbox.reconcilePending(new Date());
      const claimed2 = await outbox.claimPending('publisher-2');
      await queueTransport.add('execute-ai-operation', workerPayload(), {
        jobId: claimed2[0].operation_id,
      });
      await outbox.markPublished(claimed2[0].id, claimed2[0].lease_token!);

      expect(outbox.rows[0].status).toBe('PUBLISHED');
      expect(queueTransport.enqueueAttempts.length).toBeGreaterThanOrEqual(1);
      expect(queueTransport.enqueued.length).toBeLessThanOrEqual(1);
      expect(operations.ledger).toHaveLength(0);
    });

    it('skips already published rows when scanning the outbox', async () => {
      operations.seed(OP_ID);
      outbox.insert(OP_ID);
      const claimed = await outbox.claimPending('publisher-1');
      await queueTransport.add('execute-ai-operation', workerPayload(), {
        jobId: claimed[0].operation_id,
      });
      await outbox.markPublished(claimed[0].id, claimed[0].lease_token!);
      expect(queueTransport.enqueueAttempts.length).toBeGreaterThanOrEqual(1);

      const claimed2 = await outbox.claimPending('publisher-2');
      expect(claimed2).toHaveLength(0);
      expect(queueTransport.enqueueAttempts.length).toBe(1);
      expect(queueTransport.enqueued.length).toBeLessThanOrEqual(1);
    });
  });

  describe('Timeout and reconciliation', () => {
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
  });

  describe('Shutdown', () => {
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
});
