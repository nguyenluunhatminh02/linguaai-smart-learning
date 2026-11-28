import { describe, it, expect, vi, beforeEach } from 'vitest';
import apiClient from '@/lib/api-client';
import { useTokenStore } from './token-store';

vi.mock('@/lib/api-client', () => ({
  default: {
    post: vi.fn(),
    get: vi.fn(),
  },
}));

const serverRow = {
  id: 'tx-1',
  amount: -5,
  type: 'debit',
  feature: 'ai_chat',
  balanceAfter: 95,
  createdAt: '2026-11-28T00:00:00.000Z',
};

describe('useTokenStore (server balance read model)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTokenStore.getState().clear();
  });

  it('starts empty and never fabricates a free allowance', () => {
    const state = useTokenStore.getState();
    expect(state.balance).toBe(0);
    expect(state.todayUsed).toBe(0);
    expect(state.history).toEqual([]);
    expect(state.transactions).toEqual([]);
  });

  it('adopts the server balance verbatim, including todayUsed', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: { data: { balance: 150, todayUsed: 15 } },
    });

    await useTokenStore.getState().loadBalance();

    expect(apiClient.get).toHaveBeenCalledWith('/tokens/balance');
    expect(useTokenStore.getState().balance).toBe(150);
    expect(useTokenStore.getState().todayUsed).toBe(15);
    expect(useTokenStore.getState().isLoading).toBe(false);
  });

  it('keeps the last server value when the balance fetch fails', async () => {
    useTokenStore.getState().syncBalance(42);
    vi.mocked(apiClient.get).mockRejectedValue(new Error('offline'));

    await useTokenStore.getState().loadBalance();

    expect(useTokenStore.getState().balance).toBe(42);
    expect(useTokenStore.getState().isLoading).toBe(false);
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('does not decrement or default on missing/invalid server values', async () => {
    useTokenStore.getState().syncBalance(42);
    vi.mocked(apiClient.get).mockResolvedValue({
      data: { data: { balance: undefined, todayUsed: '15' } },
    });

    await useTokenStore.getState().loadBalance();

    expect(useTokenStore.getState().balance).toBe(42);
    expect(useTokenStore.getState().todayUsed).toBe(0);
  });

  it('ignores non-numeric, negative, and non-finite syncBalance values', () => {
    useTokenStore.getState().syncBalance(17);

    for (const bad of [undefined, null, '99', -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      useTokenStore.getState().syncBalance(bad, bad);
    }

    expect(useTokenStore.getState().balance).toBe(17);
    expect(useTokenStore.getState().todayUsed).toBe(0);
  });

  it('adopts authoritative balances delivered by server operation results', () => {
    useTokenStore.getState().syncBalance(73, 27);
    expect(useTokenStore.getState().balance).toBe(73);
    expect(useTokenStore.getState().todayUsed).toBe(27);
  });

  it('stores only server ledger rows and appends no synthetic history', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { data: [serverRow] } });

    await useTokenStore.getState().loadHistory();

    expect(apiClient.get).toHaveBeenCalledWith('/tokens/history');
    expect(useTokenStore.getState().transactions).toEqual([serverRow]);
    expect(useTokenStore.getState().history).toEqual([]);
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('clear() wipes cached state and issues no request', async () => {
    useTokenStore.setState({ balance: 90, todayUsed: 10, isLoading: true, history: [
      { id: 'local', feature: 'ai_chat', cost: 5, createdAt: 'now' },
    ], transactions: [serverRow] });

    useTokenStore.getState().clear();

    const state = useTokenStore.getState();
    expect(state.balance).toBe(0);
    expect(state.todayUsed).toBe(0);
    expect(state.isLoading).toBe(false);
    expect(state.history).toEqual([]);
    expect(state.transactions).toEqual([]);
    expect(apiClient.get).not.toHaveBeenCalled();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('exposes no client-side debit or purchase methods', () => {
    const state = useTokenStore.getState() as unknown as Record<string, unknown>;
    expect(state.consumeTokens).toBeUndefined();
    expect(state.addTokens).toBeUndefined();
    expect(typeof state.syncBalance).toBe('function');
    expect(typeof state.clear).toBe('function');
  });

  it('canAfford is only a display hint based on the known balance', () => {
    useTokenStore.getState().syncBalance(8);
    expect(useTokenStore.getState().canAfford('writing_feedback')).toBe(false);
    expect(useTokenStore.getState().canAfford('ai_chat')).toBe(true);
  });
});
