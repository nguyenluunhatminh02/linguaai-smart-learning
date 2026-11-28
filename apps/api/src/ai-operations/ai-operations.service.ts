import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AiOperationsRepository, AiOperationRecord, AiOperationScope } from './ai-operations.repository';
import {
  AiOperationsPolicy,
  AiOperationFeature,
  CanonicalOperationPayload,
  AI_OPERATION_COSTS,
} from './ai-operations.policy';
import { CreateAiOperationDto } from './dto/ai-operations.dto';
import { TokensService } from '../tokens/tokens.service';

export interface FindOrCreateResult {
  operation: AiOperationRecord;
  created: boolean;
  replay: boolean;
}

export interface ClaimLeaseResult {
  operation: AiOperationRecord;
  leaseToken: string;
  deadline: Date;
  alreadyClaimed: boolean;
}

export interface TerminalizeResult {
  operation: AiOperationRecord;
  refunded: boolean;
}

/**
 * Deterministic prefix used to build the ledger idempotency key for refunds.
 * The ledger unique constraint guarantees exactly one credit per operation,
 * regardless of how many times the caller retries the refund.
 */
const REFUND_LEDGER_KEY_PREFIX = 'refund:aiop:';
const MAX_REFUND_KEY_LENGTH = 128;

@Injectable()
export class AiOperationsService {
  private readonly logger = new Logger(AiOperationsService.name);

  constructor(
    private readonly repository: AiOperationsRepository,
    private readonly policy: AiOperationsPolicy,
    private readonly tokens: TokensService,
  ) {}

  /**
   * Idempotent reserve. Same scoped key + same hash returns the existing row
   * (replay). Same scoped key + different hash is a caller bug and must not
   * silently overwrite the original intent, so it returns HTTP 409.
   */
  async findOrCreate(userId: string, dto: CreateAiOperationDto): Promise<FindOrCreateResult> {
    const scope: AiOperationScope = {
      userId,
      feature: dto.feature as AiOperationFeature,
      clientOperationId: dto.clientOperationId,
    };

    const payload: CanonicalOperationPayload = {
      feature: dto.feature,
      language: dto.language,
      conversationId: dto.conversationId ?? null,
      message: dto.message,
    };
    const requestHash = this.policy.computeRequestHash(payload);
    const pricingVersion = this.policy.getPricingVersion();
    const reservedCredits = this.policy.getCost(dto.feature as AiOperationFeature);

    const existing = await this.repository.findByScope(scope);
    if (existing) {
      if (existing.request_hash !== requestHash) {
        throw new ConflictException(
          'Operation id already used with a different payload; use a new clientOperationId',
        );
      }
      return { operation: existing, created: false, replay: true };
    }

    const { operation, created } = await this.repository.create({
      ...scope,
      requestHash,
      pricingVersion,
      reservedCredits,
      conversationId: dto.conversationId ?? null,
    });

    return { operation, created, replay: !created };
  }

  /**
   * Acquire or re-acquire the worker lease. Idempotent for the active owner:
   * a reconnecting worker that still holds the current lease token receives
   * the same deadline back and does NOT start a second LLM call. A stale
   * worker (wrong version or expired lease) is rejected.
   */
  async claimLease(
    userId: string,
    operationId: string,
    expectedVersion: number,
    ttlMs: number = AiOperationsPolicy.DEFAULT_LEASE_TTL_MS,
  ): Promise<ClaimLeaseResult> {
    const operation = await this.repository.findByIdForUser(operationId, userId);
    if (!operation) {
      throw new NotFoundException('AI operation not found');
    }

    // Idempotent re-claim: if this caller already owns an active lease with
    // the same version, return the same token/deadline without touching the DB.
    if (
      operation.lease_token &&
      operation.version === expectedVersion &&
      operation.lease_until &&
      operation.lease_until.getTime() > Date.now() &&
      (operation.status === 'RUNNING' || operation.status === 'UNKNOWN')
    ) {
      return {
        operation,
        leaseToken: operation.lease_token,
        deadline: operation.lease_until,
        alreadyClaimed: true,
      };
    }

    if (this.policy.isTerminal(operation.status)) {
      throw new UnprocessableEntityException(
        `Operation is already in terminal state ${operation.status}`,
      );
    }

    if (operation.version !== expectedVersion) {
      throw new ConflictException(
        'Operation version has changed; refresh and retry with the current version',
      );
    }

    const leaseToken = this.policy.newLeaseToken();
    const deadline = this.policy.getLeaseDeadline(new Date(), ttlMs);

    const updated = await this.repository.claimLease({
      id: operation.id,
      userId,
      expectedVersion: operation.version,
      leaseToken,
      leaseUntil: deadline,
    });

    if (!updated) {
      // Either a concurrent claim won or the row moved. Re-read and report.
      const current = await this.repository.findByIdForUser(operation.id, userId);
      if (!current) throw new NotFoundException('AI operation not found');
      throw new ConflictException('Another worker has claimed this operation');
    }

    return { operation: updated, leaseToken, deadline, alreadyClaimed: false };
  }

  /**
   * Move an operation to a terminal state. The update is fenced by version
   * and lease token, so a stale worker cannot commit a result after losing
   * its lease. Terminal states are immutable: a second call with the same
   * status returns the row unchanged, a different status is rejected.
   */
  async markTerminal(
    userId: string,
    operationId: string,
    expectedVersion: number,
    leaseToken: string,
    status: 'SUCCEEDED' | 'FAILED' | 'UNKNOWN' | 'CANCELLED',
    options: {
      chargedCredits?: number;
      resultRef?: string | null;
      errorCode?: string | null;
      finishedAt?: Date;
      forceRefund?: boolean;
    } = {},
  ): Promise<TerminalizeResult> {
    const operation = await this.repository.findByIdForUser(operationId, userId);
    if (!operation) {
      throw new NotFoundException('AI operation not found');
    }

    // Terminal immutability: once finished, the row never re-enters work.
    if (this.policy.isTerminal(operation.status)) {
      if (operation.status === status) {
        return { operation, refunded: false };
      }
      throw new ConflictException(
        `Operation is already in terminal state ${operation.status}`,
      );
    }

    if (!this.policy.canTransition(operation.status, status)) {
      throw new UnprocessableEntityException(
        `Transition ${operation.status} -> ${status} is not allowed`,
      );
    }

    const chargedCredits =
      options.chargedCredits ?? (status === 'SUCCEEDED' ? operation.reserved_credits : 0);

    const updated = await this.repository.markTerminal({
      id: operation.id,
      userId,
      expectedVersion,
      leaseToken,
      status,
      chargedCredits,
      resultRef: options.resultRef ?? null,
      errorCode: options.errorCode ?? null,
      finishedAt: options.finishedAt,
    });

    if (!updated) {
      // Fencing rejected the write: either the version/lease moved or the
      // row is already terminal. Re-read and surface the actual state.
      const current = await this.repository.findByIdForUser(operation.id, userId);
      if (!current) throw new NotFoundException('AI operation not found');
      if (this.policy.isTerminal(current.status)) {
        if (current.status === status) return { operation: current, refunded: false };
        throw new ConflictException(
          `Operation is already in terminal state ${current.status}`,
        );
      }
      throw new ConflictException('Lease or version no longer valid for this operation');
    }

    const refunded = await this.maybeRefund(updated, options.forceRefund === true, {
      status,
      errorCode: options.errorCode ?? null,
    });
    return { operation: updated, refunded };
  }

  /**
   * Refund hook. The ledger idempotency key is derived from the operation id,
   * so a retried refund cannot credit the user twice even if the caller
   * invokes this method multiple times.
   */
  async maybeRefund(
    operation: AiOperationRecord,
    force = false,
    context: { status?: AiOperationRecord['status']; errorCode?: string | null } = {},
  ): Promise<boolean> {
    if (operation.reserved_credits <= 0) return false;
    if (operation.charged_credits >= operation.reserved_credits && !force) {
      // The operation was billed as successful; no refund unless the caller
      // explicitly overrides (e.g. verified cancellation after the fact).
      return false;
    }

    const decision = force
      ? { refund: true as const, reason: 'refund' as const }
      : this.policy.getRefundDecision(
          context.status ?? operation.status,
          context.errorCode !== undefined ? context.errorCode : operation.error_code,
        );

    if (!decision.refund) {
      this.logger.log(
        `Refund skipped for operation ${operation.id}: ${decision.reason}`,
      );
      return false;
    }

    const refundAmount = Math.max(0, operation.reserved_credits - operation.charged_credits);
    if (refundAmount <= 0) return false;

    const ledgerKey = this.buildRefundLedgerKey(operation.id);
    try {
      await this.tokens.addTokens(
        operation.user_id,
        refundAmount,
        'refund',
        operation.feature,
        ledgerKey,
      );
      this.logger.log(
        `Refunded ${refundAmount} credits for operation ${operation.id} (${operation.error_code ?? 'no-code'})`,
      );
      return true;
    } catch (error) {
      // TokensService already treats the ledger key as idempotent; a duplicate
      // call returns { duplicate: true } rather than throwing. Surface any
      // other failure so the caller can retry or escalate.
      this.logger.error(
        `Refund failed for operation ${operation.id}: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  /** Short, deterministic, unique-per-operation ledger key for refunds. */
  private buildRefundLedgerKey(operationId: string): string {
    const key = `${REFUND_LEDGER_KEY_PREFIX}${operationId}`;
    return key.length > MAX_REFUND_KEY_LENGTH ? key.slice(0, MAX_REFUND_KEY_LENGTH) : key;
  }

  /** Expose the pricing catalog read-only; cost is never client-supplied. */
  getCost(feature: string): number {
    const cost = AI_OPERATION_COSTS[feature as AiOperationFeature];
    if (cost === undefined) {
      throw new ConflictException(`Unsupported AI operation feature: ${feature}`);
    }
    return cost;
  }
}
