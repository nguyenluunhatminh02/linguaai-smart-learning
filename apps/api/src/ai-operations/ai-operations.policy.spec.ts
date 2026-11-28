import { AiOperationsPolicy } from './ai-operations.policy';
import { AI_OPERATION_STATUSES } from './ai-operations.repository';

describe('AiOperationsPolicy', () => {
  const policy = new AiOperationsPolicy();

  describe('computeRequestHash', () => {
    const payload = {
      feature: 'ai_chat',
      language: 'english',
      conversationId: 'conv-1',
      message: 'How do I use the past simple?',
    };

    it('is deterministic for validated fields only', () => {
      const first = policy.computeRequestHash(payload);
      const second = policy.computeRequestHash({ ...payload });
      expect(first).toBe(second);
      expect(first).toMatch(/^[0-9a-f]{64}$/);
    });

    it('is independent of object key order', () => {
      expect(policy.computeRequestHash(payload)).toBe(
        policy.computeRequestHash({
          message: payload.message,
          language: payload.language,
          feature: payload.feature,
          conversationId: payload.conversationId,
        }),
      );
    });

    it('changes when any validated field changes', () => {
      const original = policy.computeRequestHash(payload);
      expect(
        policy.computeRequestHash({ ...payload, message: 'different text' }),
      ).not.toBe(original);
      expect(
        policy.computeRequestHash({ ...payload, language: 'french' }),
      ).not.toBe(original);
      expect(
        policy.computeRequestHash({ ...payload, conversationId: null }),
      ).not.toBe(original);
    });
  });

  describe('transitions', () => {
    /** Every legal edge of the BILL-03 state machine, and no others. */
    const allowedTransitions = [
      ['RESERVED', 'RUNNING'],
      ['RESERVED', 'CANCELLED'],
      ['RUNNING', 'SUCCEEDED'],
      ['RUNNING', 'FAILED'],
      ['RUNNING', 'UNKNOWN'],
      ['RUNNING', 'CANCELLED'],
      ['UNKNOWN', 'SUCCEEDED'],
      ['UNKNOWN', 'FAILED'],
    ] as const;

    it('allows exactly the documented lifecycle edges', () => {
      const allowed = new Set(allowedTransitions.map(([from, to]) => `${from}->${to}`));
      for (const from of AI_OPERATION_STATUSES) {
        for (const to of AI_OPERATION_STATUSES) {
          expect(policy.canTransition(from, to)).toBe(
            allowed.has(`${from}->${to}`),
          );
        }
      }
    });

    it('never allows a self-transition, including RUNNING -> RUNNING or UNKNOWN -> UNKNOWN', () => {
      for (const status of AI_OPERATION_STATUSES) {
        expect(policy.canTransition(status, status)).toBe(false);
      }
    });

    it('allows only forward lifecycle transitions for non-terminal sources', () => {
      expect(policy.canTransition('RESERVED', 'RUNNING')).toBe(true);
      expect(policy.canTransition('RUNNING', 'UNKNOWN')).toBe(true);
      expect(policy.canTransition('UNKNOWN', 'FAILED')).toBe(true);
      expect(policy.canTransition('RUNNING', 'CANCELLED')).toBe(true);
      expect(policy.canTransition('RESERVED', 'SUCCEEDED')).toBe(false);
      expect(policy.canTransition('SUCCEEDED', 'RUNNING')).toBe(false);
    });

    it('treats terminal states as immutable for every possible target', () => {
      for (const terminal of ['SUCCEEDED', 'FAILED', 'CANCELLED'] as const) {
        expect(policy.isTerminal(terminal)).toBe(true);
        for (const to of AI_OPERATION_STATUSES) {
          expect(policy.canTransition(terminal, to)).toBe(false);
        }
      }
      // UNKNOWN is not terminal: it can be reconciled to success or failure,
      // but the normal refund hook requires explicit reconciliation first.
      expect(policy.isTerminal('UNKNOWN')).toBe(false);
      expect(policy.canTransition('UNKNOWN', 'RUNNING')).toBe(false);
      expect(policy.canTransition('UNKNOWN', 'CANCELLED')).toBe(false);
      expect(policy.isTerminal('RESERVED')).toBe(false);
      expect(policy.isTerminal('RUNNING')).toBe(false);
    });

    it('allows UNKNOWN to be reconciled only to SUCCEEDED or FAILED', () => {
      expect(policy.canTransition('UNKNOWN', 'SUCCEEDED')).toBe(true);
      expect(policy.canTransition('UNKNOWN', 'FAILED')).toBe(true);
      // A post-timeout retry must not silently re-enter the normal work path.
      expect(policy.canTransition('UNKNOWN', 'RUNNING')).toBe(false);
      expect(policy.canTransition('UNKNOWN', 'RESERVED')).toBe(false);
    });
  });

  describe('canFinalize', () => {
    const base = {
      status: 'RUNNING' as const,
      lease_token: 'token-1',
      lease_until: new Date(Date.now() + 30_000),
      attempt_count: 1,
    };

    it('accepts a current, active lease', () => {
      expect(policy.canFinalize(base, 'token-1')).toBe(true);
    });

    it('rejects expired, foreign and terminal leases', () => {
      expect(
        policy.canFinalize(
          { ...base, lease_until: new Date(Date.now() - 1) },
          'token-1',
        ),
      ).toBe(false);
      expect(policy.canFinalize(base, 'token-2')).toBe(false);
      expect(
        policy.canFinalize({ ...base, status: 'SUCCEEDED' }, 'token-1'),
      ).toBe(false);
      for (const terminal of ['SUCCEEDED', 'FAILED', 'CANCELLED'] as const) {
        expect(
          policy.canFinalize({ ...base, status: terminal }, 'token-1'),
        ).toBe(false);
      }
    });

    it('rejects a lease with no token and an attempt beyond the budget', () => {
      expect(policy.canFinalize({ ...base, lease_token: null }, 'token-1')).toBe(
        false,
      );
      expect(policy.canFinalize({ ...base, attempt_count: 5 }, 'token-1')).toBe(
        false,
      );
      expect(policy.canFinalize(base, '')).toBe(false);
    });
  });

  describe('getRefundDecision', () => {
    it('refunds known failures', () => {
      expect(
        policy.getRefundDecision('FAILED', 'INVALID_AI_OUTPUT').refund,
      ).toBe(true);
      expect(
        policy.getRefundDecision('FAILED', 'PROVIDER_UNAVAILABLE').refund,
      ).toBe(true);
    });

    it('requires reconciliation for ambiguous UNKNOWN outcomes', () => {
      const decision = policy.getRefundDecision('UNKNOWN', 'PROVIDER_TIMEOUT');
      expect(decision.refund).toBe(false);
      expect(decision.reason).toBe('requires_reconciliation');
      expect(
        policy.getRefundDecision('FAILED', 'OPERATION_UNKNOWN').reason,
      ).toBe('requires_reconciliation');
    });

    it('requires reconciliation for the UNKNOWN state regardless of error code', () => {
      // An UNKNOWN operation must always demand reconciliation, even when no
      // error code was recorded. The current policy returns 'not_refundable'
      // for a missing code; see ai-operations.policy.ts getRefundDecision.
      expect(
        policy.getRefundDecision('UNKNOWN').reason ===
          'requires_reconciliation',
      ).toBe(true);
      expect(policy.getRefundDecision('UNKNOWN', null).reason).toBe(
        'requires_reconciliation',
      );
      expect(
        policy.getRefundDecision('UNKNOWN', 'INVALID_AI_OUTPUT').refund,
      ).toBe(false);
    });

    it('refunds only verified FAILED outcomes with a known error code', () => {
      for (const code of [
        'PROVIDER_UNAVAILABLE',
        'INVALID_AI_OUTPUT',
        'VALIDATION_ERROR',
        'INSUFFICIENT_CREDITS',
        'RATE_LIMITED',
        'INTERNAL_ERROR',
      ]) {
        const decision = policy.getRefundDecision('FAILED', code);
        expect(decision.refund).toBe(true);
        expect(decision.reason).toBe('refund');
      }
      expect(policy.getRefundDecision('FAILED').refund).toBe(false);
      expect(policy.getRefundDecision('FAILED', 'UNRECOGNIZED_CODE').refund).toBe(
        false,
      );
    });

    it('never refunds a terminal state through the normal hook', () => {
      for (const terminal of ['SUCCEEDED', 'FAILED', 'CANCELLED'] as const) {
        for (const code of [null, 'PROVIDER_UNAVAILABLE', 'PROVIDER_TIMEOUT']) {
          const decision = policy.getRefundDecision(terminal, code);
          expect(decision.refund).toBe(
            terminal === 'FAILED' && code === 'PROVIDER_UNAVAILABLE',
          );
        }
      }
      expect(policy.getRefundDecision('SUCCEEDED').reason).toBe('terminal');
      expect(
        policy.getRefundDecision('CANCELLED', 'INVALID_AI_OUTPUT').refund,
      ).toBe(false);
      expect(policy.getRefundDecision('SUCCEEDED', 'PROVIDER_TIMEOUT').reason).toBe(
        'terminal',
      );
    });

    it('refuses cancellation refunds for every terminal state', () => {
      for (const terminal of ['SUCCEEDED', 'FAILED', 'CANCELLED'] as const) {
        const decision = policy.getCancellationRefundDecision(terminal);
        expect(decision.refund).toBe(false);
        expect(decision.reason).toBe('terminal');
      }
      expect(policy.getCancellationRefundDecision('UNKNOWN').refund).toBe(true);
    });

    it('supports explicit cancellation refunds', () => {
      expect(policy.getCancellationRefundDecision('RUNNING').refund).toBe(true);
      expect(policy.getCancellationRefundDecision('SUCCEEDED').refund).toBe(
        false,
      );
    });
  });

  it('uses server-side pricing, never a client value', () => {
    expect(policy.getCost('ai_chat')).toBe(5);
    expect(policy.getCost('writing_feedback')).toBe(10);
    expect(() => policy.getCost('made_up_feature' as never)).toThrow();
  });
});
