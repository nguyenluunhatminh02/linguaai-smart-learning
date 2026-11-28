import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AiOperationsService } from './ai-operations.service';
import {
  AiOperationsRepository,
  AiOperationRecord,
} from './ai-operations.repository';
import { AiOperationsPolicy } from './ai-operations.policy';
import { TokensService } from '../tokens/tokens.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAiOperationDto } from './dto/ai-operations.dto';

describe('AiOperationsService', () => {
  let service: AiOperationsService;
  let repository: jest.Mocked<AiOperationsRepository>;
  let policy: AiOperationsPolicy;
  let tokens: { addTokens: jest.Mock };

  const userId = 'user-123';
  const operationId = 'op-123';
  const leaseToken = 'lease-token-123';
  const requestHash = 'expected-hash';

  const dto: CreateAiOperationDto = Object.assign(new CreateAiOperationDto(), {
    feature: 'ai_chat',
    clientOperationId: 'turn-1',
    language: 'english',
    conversationId: undefined,
    message: 'How do I use the past simple?',
  });

  function makeOperation(
    overrides: Partial<AiOperationRecord> = {},
  ): AiOperationRecord {
    return {
      id: operationId,
      user_id: userId,
      feature: 'ai_chat',
      client_operation_id: 'turn-1',
      request_hash: requestHash,
      pricing_version: 'v1',
      reserved_credits: 5,
      charged_credits: 0,
      status: 'RESERVED',
      attempt_count: 0,
      lease_until: null,
      lease_token: null,
      version: 0,
      conversation_id: null,
      result_ref: null,
      error_code: null,
      created_at: new Date(),
      updated_at: new Date(),
      finished_at: null,
      ...overrides,
    };
  }

  beforeEach(async () => {
    repository = {
      findByScope: jest.fn().mockResolvedValue(null),
      findByIdForUser: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(async (input) => ({
        operation: makeOperation({
          request_hash: input.requestHash,
          reserved_credits: input.reservedCredits,
        }),
        created: true,
      })),
      claimLease: jest.fn().mockImplementation(async (input) =>
        makeOperation({
          status: 'RUNNING',
          lease_token: input.leaseToken,
          lease_until: input.leaseUntil,
          version: input.expectedVersion + 1,
          attempt_count: 1,
        }),
      ),
      markTerminal: jest.fn().mockImplementation(async () =>
        makeOperation({
          status: 'SUCCEEDED',
          lease_token: null,
          version: 2,
          charged_credits: 5,
        }),
      ),
      hasActiveLease: jest.fn(),
      markUnknown: jest.fn(),
      findExpired: jest.fn(),
      isKnownRequestError: jest.fn(),
    } as unknown as jest.Mocked<AiOperationsRepository>;

    tokens = {
      addTokens: jest.fn().mockResolvedValue({ balance: 10, added: 5 }),
    };
    policy = new AiOperationsPolicy();
    jest.spyOn(policy, 'computeRequestHash').mockReturnValue(requestHash);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiOperationsService,
        { provide: AiOperationsRepository, useValue: repository },
        { provide: AiOperationsPolicy, useValue: policy },
        { provide: TokensService, useValue: tokens },
        { provide: PrismaService, useValue: {} },
      ],
    }).compile();

    service = module.get<AiOperationsService>(AiOperationsService);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('findOrCreate', () => {
    it('creates a new operation and hashes validated fields only', async () => {
      const result = await service.findOrCreate(userId, dto);
      expect(result.created).toBe(true);
      expect(result.replay).toBe(false);
      expect(policy.computeRequestHash).toHaveBeenCalledWith({
        feature: dto.feature,
        language: dto.language,
        conversationId: null,
        message: dto.message,
      });
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          requestHash,
          pricingVersion: 'v1',
          reservedCredits: 5,
          userId,
          clientOperationId: dto.clientOperationId,
        }),
      );
    });

    it('replays an existing operation with the same hash without creating a new row', async () => {
      repository.findByScope.mockResolvedValueOnce(makeOperation());
      const result = await service.findOrCreate(userId, dto);
      expect(result.replay).toBe(true);
      expect(result.operation.id).toBe(operationId);
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('throws 409 when the same key is reused with a different payload', async () => {
      repository.findByScope.mockResolvedValueOnce(
        makeOperation({ request_hash: 'different-hash' }),
      );
      await expect(service.findOrCreate(userId, dto)).rejects.toThrow(
        ConflictException,
      );
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('always scopes lookups to the caller so other users stay invisible', async () => {
      await service.findOrCreate(userId, dto);
      expect(repository.findByScope).toHaveBeenCalledWith(
        expect.objectContaining({ userId }),
      );
      expect(repository.findByScope).not.toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'other-user' }),
      );
    });
  });

  describe('claimLease', () => {
    it('claims a reserved operation once', async () => {
      repository.findByIdForUser.mockResolvedValueOnce(makeOperation());
      const result = await service.claimLease(userId, operationId, 0);
      expect(result.alreadyClaimed).toBe(false);
      expect(result.leaseToken).toBe(
        (repository.claimLease.mock.calls[0][0] as { leaseToken: string })
          .leaseToken,
      );
      expect(repository.claimLease).toHaveBeenCalledTimes(1);
    });

    it('is idempotent when the same worker reconnects with an active lease', async () => {
      const deadline = new Date(Date.now() + 30_000);
      repository.findByIdForUser.mockResolvedValueOnce(
        makeOperation({
          status: 'RUNNING',
          version: 1,
          lease_token: leaseToken,
          lease_until: deadline,
          attempt_count: 1,
        }),
      );
      const result = await service.claimLease(userId, operationId, 1);
      expect(result.alreadyClaimed).toBe(true);
      expect(result.leaseToken).toBe(leaseToken);
      expect(result.deadline).toBe(deadline);
      expect(repository.claimLease).not.toHaveBeenCalled();
    });

    it('rejects a stale worker whose version has moved on', async () => {
      repository.findByIdForUser.mockResolvedValueOnce(
        makeOperation({ version: 2 }),
      );
      await expect(service.claimLease(userId, operationId, 1)).rejects.toThrow(
        ConflictException,
      );
      expect(repository.claimLease).not.toHaveBeenCalled();
    });

    it('rejects a worker that cannot find the operation', async () => {
      await expect(service.claimLease(userId, operationId, 0)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('refuses to restart a terminal operation', async () => {
      repository.findByIdForUser.mockResolvedValueOnce(
        makeOperation({ status: 'SUCCEEDED', version: 1 }),
      );
      await expect(service.claimLease(userId, operationId, 1)).rejects.toThrow(
        UnprocessableEntityException,
      );
    });
  });

  describe('markTerminal', () => {
    it('refuses stale fencing tokens', async () => {
      repository.findByIdForUser.mockResolvedValueOnce(
        makeOperation({
          status: 'RUNNING',
          version: 1,
          lease_token: 'other-token',
          lease_until: new Date(Date.now() + 60_000),
        }),
      );
      repository.markTerminal.mockResolvedValueOnce(null);
      repository.findByIdForUser.mockResolvedValueOnce(
        makeOperation({
          status: 'RUNNING',
          version: 2,
          lease_token: 'newer-token',
          lease_until: new Date(Date.now() + 60_000),
        }),
      );
      await expect(
        service.markTerminal(userId, operationId, 1, leaseToken, 'SUCCEEDED'),
      ).rejects.toThrow(ConflictException);
      expect(tokens.addTokens).not.toHaveBeenCalled();
    });

    it('never lets a terminal operation return to RUNNING', async () => {
      repository.findByIdForUser.mockResolvedValueOnce(
        makeOperation({
          status: 'FAILED',
          version: 2,
          error_code: 'PROVIDER_UNAVAILABLE',
        }),
      );
      await expect(
        service.markTerminal(userId, operationId, 2, leaseToken, 'SUCCEEDED'),
      ).rejects.toThrow(ConflictException);
      expect(repository.markTerminal).not.toHaveBeenCalled();
    });

    it('refunds exactly once on a known failure', async () => {
      repository.findByIdForUser.mockResolvedValueOnce(
        makeOperation({
          status: 'RUNNING',
          version: 1,
          lease_token: leaseToken,
          lease_until: new Date(Date.now() + 60_000),
        }),
      );
      repository.markTerminal.mockResolvedValueOnce(
        makeOperation({
          status: 'FAILED',
          version: 2,
          error_code: 'INVALID_AI_OUTPUT',
          charged_credits: 0,
        }),
      );

      const result = await service.markTerminal(
        userId,
        operationId,
        1,
        leaseToken,
        'FAILED',
        {
          errorCode: 'INVALID_AI_OUTPUT',
        },
      );
      expect(result.refunded).toBe(true);
      expect(tokens.addTokens).toHaveBeenCalledTimes(1);
      expect(tokens.addTokens).toHaveBeenCalledWith(
        userId,
        5,
        'refund',
        'ai_chat',
        expect.stringContaining('refund:aiop:'),
      );
    });

    it('does not refund twice when markTerminal is replayed', async () => {
      repository.findByIdForUser.mockResolvedValueOnce(
        makeOperation({
          status: 'RUNNING',
          version: 1,
          lease_token: leaseToken,
          lease_until: new Date(Date.now() + 60_000),
        }),
      );
      repository.markTerminal.mockResolvedValueOnce(
        makeOperation({
          status: 'FAILED',
          version: 2,
          error_code: 'PROVIDER_UNAVAILABLE',
        }),
      );
      await service.markTerminal(userId, operationId, 1, leaseToken, 'FAILED', {
        errorCode: 'PROVIDER_UNAVAILABLE',
      });

      repository.findByIdForUser.mockResolvedValueOnce(
        makeOperation({
          status: 'FAILED',
          version: 2,
          error_code: 'PROVIDER_UNAVAILABLE',
        }),
      );
      const replay = await service.markTerminal(
        userId,
        operationId,
        2,
        leaseToken,
        'FAILED',
      );
      expect(replay.refunded).toBe(false);
      expect(tokens.addTokens).toHaveBeenCalledTimes(1);
    });

    it('does not refund an ambiguous UNKNOWN outcome', async () => {
      repository.findByIdForUser.mockResolvedValueOnce(
        makeOperation({
          status: 'RUNNING',
          version: 1,
          lease_token: leaseToken,
          lease_until: new Date(Date.now() + 60_000),
        }),
      );
      repository.markTerminal.mockResolvedValueOnce(
        makeOperation({
          status: 'UNKNOWN',
          version: 2,
          error_code: 'PROVIDER_TIMEOUT',
        }),
      );
      const result = await service.markTerminal(
        userId,
        operationId,
        1,
        leaseToken,
        'UNKNOWN',
        {
          errorCode: 'PROVIDER_TIMEOUT',
        },
      );
      expect(result.operation.status).toBe('UNKNOWN');
      expect(tokens.addTokens).not.toHaveBeenCalled();
    });
  });

  describe('maybeRefund', () => {
    it('builds a deterministic ledger key of at most 128 characters', async () => {
      const longId = `op-${'x'.repeat(200)}`;
      await service.maybeRefund(
        makeOperation({
          id: longId,
          status: 'FAILED',
          error_code: 'INVALID_AI_OUTPUT',
        }),
      );
      const key = tokens.addTokens.mock.calls[0][4] as string;
      expect(key.length).toBeLessThanOrEqual(128);
      expect(key).toMatch(/^refund:aiop:/);
    });
  });
});
