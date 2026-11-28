/**
 * CHAT-04 unit/regression specs for provider failure, timeout and the
 * reserve → claim → terminal state machine. No database and no live provider:
 * all collaborators are in-memory fakes.
 */

import { AiOperationsService } from '../src/ai-operations/ai-operations.service';
import { AiOperationsRepository, AiOperationRecord } from '../src/ai-operations/ai-operations.repository';
import { AiOperationsPolicy } from '../src/ai-operations/ai-operations.policy';
import { ChatService } from '../src/chat/chat.service';
import { FakeLlmProvider } from './fixtures/chat-billing.fixture';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OP_ID = '22222222-2222-4222-8222-222222222222';
const CONVERSATION_ID = '33333333-3333-4333-8333-333333333333';
const LEASE_TOKEN = 'lease-token';
const REQUEST_HASH = 'hash';

function operation(overrides: Partial<AiOperationRecord> = {}): AiOperationRecord {
  return {
    id: OP_ID,
    user_id: USER_ID,
    feature: 'ai_chat',
    client_operation_id: 'unit-key',
    request_hash: REQUEST_HASH,
    pricing_version: 'v1',
    reserved_credits: 5,
    charged_credits: 0,
    status: 'RESERVED',
    attempt_count: 0,
    lease_until: null,
    lease_token: null,
    version: 0,
    conversation_id: CONVERSATION_ID,
    result_ref: null,
    error_code: null,
    created_at: new Date(),
    updated_at: new Date(),
    finished_at: null,
    ...overrides,
  };
}

describe('Chat billing orchestrator state transitions (CHAT-04)', () => {
  let repository: {
    findByScope: jest.Mock;
    findByIdForUser: jest.Mock;
    create: jest.Mock;
    claimLease: jest.Mock;
    markTerminal: jest.Mock;
    hasActiveLease: jest.Mock;
    markUnknown: jest.Mock;
    findExpired: jest.Mock;
    isKnownRequestError: jest.Mock;
  };
  let tokens: { addTokens: jest.Mock };
  let service: AiOperationsService;
  let policy: AiOperationsPolicy;
  let llm: FakeLlmProvider;
  let prisma: {
    chat_conversations: { findFirst: jest.Mock; create: jest.Mock };
    chat_messages: { findMany: jest.Mock; create: jest.Mock };
    $transaction: jest.Mock;
  };
  let chat: ChatService;

  beforeEach(() => {
    repository = {
      findByScope: jest.fn().mockResolvedValue(null),
      findByIdForUser: jest.fn().mockResolvedValue(operation()),
      create: jest.fn().mockImplementation(async (input) => ({
        operation: operation({
          request_hash: input.requestHash,
          reserved_credits: input.reservedCredits,
        }),
        created: true,
      })),
      claimLease: jest.fn().mockImplementation(async () =>
        operation({
          status: 'RUNNING',
          version: 1,
          lease_token: LEASE_TOKEN,
          lease_until: new Date(Date.now() + 60_000),
          attempt_count: 1,
        }),
      ),
      markTerminal: jest.fn().mockImplementation(async () =>
        operation({
          status: 'SUCCEEDED',
          version: 2,
          charged_credits: 5,
          lease_token: null,
          lease_until: null,
          result_ref: '44444444-4444-4444-8444-444444444444',
        }),
      ),
      hasActiveLease: jest.fn(),
      markUnknown: jest.fn(),
      findExpired: jest.fn(),
      isKnownRequestError: jest.fn(),
    };
    tokens = { addTokens: jest.fn().mockResolvedValue({ balance: 5, added: 5 }) };
    policy = new AiOperationsPolicy();
    jest.spyOn(policy, 'computeRequestHash').mockReturnValue(REQUEST_HASH);
    service = new AiOperationsService(
      repository as unknown as AiOperationsRepository,
      policy,
      tokens as unknown as never,
    );

    llm = new FakeLlmProvider({ tokens: ['unit ', 'answer'] });
    prisma = {
      chat_conversations: {
        findFirst: jest.fn().mockResolvedValue({ id: CONVERSATION_ID }),
        create: jest.fn(),
      },
      chat_messages: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
      },
      $transaction: jest.fn().mockImplementation(async (fn: (tx: unknown) => unknown) =>
        fn(prisma),
      ),
    };
    chat = new ChatService(prisma as never, llm as never);
  });

  afterEach(() => jest.restoreAllMocks());

  /** Reserve → claim → terminal helper for state-machine tests. */
  async function reserveClaimAndStart() {
    const created = await service.findOrCreate(USER_ID, {
      feature: 'ai_chat',
      clientOperationId: 'unit-key',
      language: 'english',
      conversationId: CONVERSATION_ID,
      message: 'past simple?',
    } as never);
    expect(created.created).toBe(true);
    const claim = await service.claimLease(
      USER_ID,
      created.operation.id,
      created.operation.version,
    );
    return { operation: created.operation, claim };
  }

  it('reserves exactly once and ignores a second findOrCreate of the same key', async () => {
    const { operation: reserved } = await reserveClaimAndStart();
    // The replay row must carry the same canonical hash the real service
    // computes for this payload; a hardcoded digest would be a false 409.
    repository.findByScope.mockResolvedValueOnce(
      operation({
        status: 'RUNNING',
        version: 1,
        lease_token: LEASE_TOKEN,
        request_hash: reserved.request_hash,
      }),
    );
    const replay = await service.findOrCreate(USER_ID, {
      feature: 'ai_chat',
      clientOperationId: 'unit-key',
      language: 'english',
      conversationId: CONVERSATION_ID,
      message: 'past simple?',
    } as never);
    expect(replay.replay).toBe(true);
    expect(repository.create).toHaveBeenCalledTimes(1);
  });

  it('keeps the original operation when a key is reused with a different payload', async () => {
    await reserveClaimAndStart();
    repository.findByScope.mockResolvedValueOnce(operation({ request_hash: 'other' }));
    await expect(
      service.findOrCreate(USER_ID, {
        feature: 'ai_chat',
        clientOperationId: 'unit-key',
        language: 'english',
        conversationId: CONVERSATION_ID,
        message: 'different',
      } as never),
    ).rejects.toThrow();
    expect(repository.create).toHaveBeenCalledTimes(1);
  });

  it('T09 — provider timeout before any delta: terminal UNKNOWN/FAILED and at most one refund', async () => {
    const { operation: reserved, claim } = await reserveClaimAndStart();

    // Model timeout before delta: terminalize with no assistant output and an
    // ambiguous error code that must not be auto-refunded under policy.
    repository.findByIdForUser.mockResolvedValueOnce(
      operation({ status: 'RUNNING', version: 1, lease_token: LEASE_TOKEN }),
    );
    repository.markTerminal.mockResolvedValueOnce(
      operation({
        status: 'UNKNOWN',
        version: 2,
        error_code: 'PROVIDER_TIMEOUT',
        lease_token: null,
        lease_until: null,
      }),
    );
    const result = await service.markTerminal(
      USER_ID,
      reserved.id,
      claim.operation.version,
      claim.leaseToken,
      'UNKNOWN',
      { errorCode: 'PROVIDER_TIMEOUT' },
    );

    expect(result.operation.status).toBe('UNKNOWN');
    expect(tokens.addTokens).not.toHaveBeenCalled(); // ambiguous: no auto-refund

    // At-most-once refund: an ambiguous UNKNOWN outcome is never credited,
    // even if the recovery worker invokes the refund hook repeatedly.
    expect(await service.maybeRefund(result.operation)).toBe(false);
    expect(await service.maybeRefund(result.operation)).toBe(false);
    expect(repository.markTerminal).toHaveBeenCalledTimes(1);
    expect(tokens.addTokens).toHaveBeenCalledTimes(0);
  });

  it('T09 variant — a known provider failure refunds at most once', async () => {
    const { operation: reserved, claim } = await reserveClaimAndStart();
    repository.findByIdForUser.mockResolvedValueOnce(
      operation({ status: 'RUNNING', version: 1, lease_token: LEASE_TOKEN }),
    );
    repository.markTerminal.mockResolvedValueOnce(
      operation({
        status: 'FAILED',
        version: 2,
        error_code: 'PROVIDER_UNAVAILABLE',
        lease_token: null,
        lease_until: null,
      }),
    );
    const failed = await service.markTerminal(
      USER_ID,
      reserved.id,
      claim.operation.version,
      claim.leaseToken,
      'FAILED',
      { errorCode: 'PROVIDER_UNAVAILABLE' },
    );
    expect(failed.refunded).toBe(true);
    expect(tokens.addTokens).toHaveBeenCalledTimes(1);
    expect(tokens.addTokens).toHaveBeenCalledWith(
      USER_ID,
      5,
      'refund',
      'ai_chat',
      'refund:aiop:22222222-2222-4222-8222-222222222222',
    );

    // Re-terminalize the same operation: terminal state is immutable, so no
    // second refund is possible.
    repository.findByIdForUser.mockResolvedValueOnce(failed.operation);
    const replay = await service.markTerminal(
      USER_ID,
      reserved.id,
      2,
      LEASE_TOKEN,
      'FAILED',
    );
    expect(replay.refunded).toBe(false);
    expect(tokens.addTokens).toHaveBeenCalledTimes(1);
  });

  it('T10 — provider error after delta: no completed event and no assistant message persisted', async () => {
    llm.configure({
      tokens: ['partial ', textFixture()],
      errorAfterTokens: 1,
      error: new Error('provider exploded after delta'),
    });

    const deltas: string[] = [];
    const completed = jest.fn();
    const result = await chat.sendStream(
      USER_ID,
      {
        conversationId: CONVERSATION_ID,
        language: 'english',
        message: 'tell me about past simple',
      } as never,
      {
        onDelta: (d) => {
          deltas.push(d);
        },
        onCompleted: completed,
      },
    );

    expect(deltas).toEqual(['partial ']);
    expect(completed).not.toHaveBeenCalled();
    expect(result.errorCode).toBe('AI_FAILED');
    expect(prisma.chat_messages.create).not.toHaveBeenCalled();
  });

  it('successful stream commits before onCompleted and delegates to a saved message id', async () => {
    const assistantId = '55555555-5555-4555-8555-555555555555';
    prisma.chat_messages.create
      .mockResolvedValueOnce({ id: 'user-message' })
      .mockResolvedValueOnce({ id: assistantId });
    const completed = jest.fn();
    const deltas: string[] = [];

    const result = await chat.sendStream(
      USER_ID,
      {
        conversationId: CONVERSATION_ID,
        language: 'english',
        message: 'hello',
      } as never,
      {
        onDelta: (d) => {
          deltas.push(d);
        },
        onCompleted: completed,
      },
    );

    expect(deltas.join('')).toBe('unit answer');
    expect(completed).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: assistantId }),
    );
    expect(result.messageId).toBe(assistantId);
    expect(prisma.chat_messages.create).toHaveBeenCalledTimes(2);
  });

  it('terminalize AFTER commit from RUNNING to SUCCEEDED charges the reserved credits', async () => {
    const { operation: reserved, claim } = await reserveClaimAndStart();
    repository.findByIdForUser.mockResolvedValueOnce(
      operation({ status: 'RUNNING', version: 1, lease_token: LEASE_TOKEN }),
    );
    const done = await service.markTerminal(
      USER_ID,
      reserved.id,
      claim.operation.version,
      claim.leaseToken,
      'SUCCEEDED',
      { resultRef: '66666666-6666-4666-8666-666666666666' },
    );
    expect(done.operation.status).toBe('SUCCEEDED');
    expect(done.operation.charged_credits).toBe(5);
    expect(tokens.addTokens).not.toHaveBeenCalled();
  });

  it('stale lease token cannot commit a result after the lease moved', async () => {
    const { operation: reserved, claim } = await reserveClaimAndStart();
    repository.findByIdForUser.mockResolvedValueOnce(
      operation({ status: 'RUNNING', version: 2, lease_token: 'another-token' }),
    );
    repository.markTerminal.mockResolvedValueOnce(null);
    await expect(
      service.markTerminal(
        USER_ID,
        reserved.id,
        claim.operation.version,
        claim.leaseToken,
        'SUCCEEDED',
      ),
    ).rejects.toThrow();
  });

  it('T11 variant — a cancelled operation before commit is terminal and not re-claimable', async () => {
    const { operation: reserved, claim } = await reserveClaimAndStart();
    repository.findByIdForUser.mockResolvedValueOnce(
      operation({ status: 'RUNNING', version: 1, lease_token: LEASE_TOKEN }),
    );
    repository.markTerminal.mockResolvedValueOnce(
      operation({ status: 'CANCELLED', version: 2, lease_token: null, lease_until: null }),
    );
    const cancelled = await service.markTerminal(
      USER_ID,
      reserved.id,
      claim.operation.version,
      claim.leaseToken,
      'CANCELLED',
    );
    expect(cancelled.operation.status).toBe('CANCELLED');

    repository.findByIdForUser.mockResolvedValueOnce(cancelled.operation);
    await expect(
      service.claimLease(USER_ID, reserved.id, 2),
    ).rejects.toThrow();
  });

  it('T12 variant — terminal SUCCEEDED is immutable and a replay cannot change the result', async () => {
    const { operation: reserved, claim } = await reserveClaimAndStart();
    repository.findByIdForUser.mockResolvedValueOnce(
      operation({ status: 'RUNNING', version: 1, lease_token: LEASE_TOKEN }),
    );
    const done = await service.markTerminal(
      USER_ID,
      reserved.id,
      claim.operation.version,
      claim.leaseToken,
      'SUCCEEDED',
      { resultRef: '77777777-7777-4777-8777-777777777777' },
    );

    repository.findByIdForUser.mockResolvedValueOnce(done.operation);
    await expect(
      service.markTerminal(
        USER_ID,
        reserved.id,
        2,
        LEASE_TOKEN,
        'FAILED',
        { errorCode: 'PROVIDER_UNAVAILABLE' },
      ),
    ).rejects.toThrow();
    expect(repository.markTerminal).toHaveBeenCalledTimes(1);
    expect(tokens.addTokens).not.toHaveBeenCalled();
  });
});

function textFixture(): string {
  return 'after error';
}
