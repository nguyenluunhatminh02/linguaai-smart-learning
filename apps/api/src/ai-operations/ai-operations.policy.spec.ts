import { AiOperationsPolicy } from './ai-operations.policy';

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
      expect(
        policy.computeRequestHash(payload),
      ).toBe(
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
      expect(policy.computeRequestHash({ ...payload, message: 'different text' })).not.toBe(original);
      expect(policy.computeRequestHash({ ...payload, language: 'french' })).not.toBe(original);
      expect(policy.computeRequestHash({ ...payload, conversationId: null })).not.toBe(original);
    });
  });

  describe('transitions', () => {
    it('allows only forward lifecycle transitions', () => {
      expect(policy.canTransition('RESERVED', 'RUNNING')).toBe(true);
      expect(policy.canTransition('RUNNING', 'UNKNOWN')).toBe(true);
      expect(policy.canTransition('UNKNOWN', 'FAILED')).toBe(true);
      expect(policy.canTransition('RUNNING', 'CANCELLED')).toBe(true);
      expect(policy.canTransition('RESERVED', 'SUCCEEDED')).toBe(false);
      expect(policy.canTransition('SUCCEEDED', 'RUNNING')).toBe(false);
    });

    it('treats terminal states as immutable', () => {
      for (const terminal of ['SUCCEEDED', 'FAILED', 'CANCELLED'] as const) {
        expect(policy.isTerminal(terminal)).toBe(true);
        expect(policy.canTransition(terminal, 'RUNNING')).toBe(false);
      }
      // UNKNOWN is not terminal: it can be reconciled to success or failure,
      // but the normal refund hook requires explicit reconciliation first.
      expect(policy.isTerminal('UNKNOWN')).toBe(false);
      expect(policy.canTransition('UNKNOWN', 'RUNNING')).toBe(false);
      expect(policy.isTerminal('RESERVED')).toBe(false);
      expect(policy.isTerminal('RUNNING')).toBe(false);
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
      expect(policy.canFinalize({ ...base, lease_until: new Date(Date.now() - 1) }, 'token-1')).toBe(false);
      expect(policy.canFinalize(base, 'token-2')).toBe(false);
      expect(policy.canFinalize({ ...base, status: 'SUCCEEDED' }, 'token-1')).toBe(false);
    });
  });

  describe('getRefundDecision', () => {
    it('refunds known failures', () => {
      expect(policy.getRefundDecision('FAILED', 'INVALID_AI_OUTPUT').refund).toBe(true);
      expect(policy.getRefundDecision('FAILED', 'PROVIDER_UNAVAILABLE').refund).toBe(true);
    });

    it('requires reconciliation for ambiguous UNKNOWN outcomes', () => {
      const decision = policy.getRefundDecision('UNKNOWN', 'PROVIDER_TIMEOUT');
      expect(decision.refund).toBe(false);
      expect(decision.reason).toBe('requires_reconciliation');
      expect(policy.getRefundDecision('FAILED', 'OPERATION_UNKNOWN').reason).toBe(
        'requires_reconciliation',
      );
    });

    it('never refunds a terminal state through the normal hook', () => {
      expect(policy.getRefundDecision('SUCCEEDED').reason).toBe('terminal');
      expect(policy.getRefundDecision('CANCELLED', 'INVALID_AI_OUTPUT').refund).toBe(false);
    });

    it('supports explicit cancellation refunds', () => {
      expect(policy.getCancellationRefundDecision('RUNNING').refund).toBe(true);
      expect(policy.getCancellationRefundDecision('SUCCEEDED').refund).toBe(false);
    });
  });

  it('uses server-side pricing, never a client value', () => {
    expect(policy.getCost('ai_chat')).toBe(5);
    expect(policy.getCost('writing_feedback')).toBe(10);
    expect(() => policy.getCost('made_up_feature' as never)).toThrow();
  });
});
