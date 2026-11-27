import { describe, it, expect, vi, beforeEach } from 'vitest';
import apiClient from '@/lib/api-client';

vi.mock('@/lib/api-client', () => ({
  default: {
    post: vi.fn(),
    get: vi.fn(),
  },
}));

describe('useTokenStore', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset store state before each test
    const { useTokenStore } = await import('./token-store');
    useTokenStore.setState({
      balance: 30,
      todayUsed: 0,
      isLoading: false,
      history: [],
    });
  });

  it('should initialize with default balance 30', async () => {
    const { useTokenStore } = await import('./token-store');
    const state = useTokenStore.getState();
    expect(state.balance).toBe(30);
    expect(state.todayUsed).toBe(0);
    expect(state.isLoading).toBe(false);
  });

  it('should load balance successfully from api', async () => {
    const { useTokenStore } = await import('./token-store');
    vi.mocked(apiClient.get).mockResolvedValue({
      data: {
        data: {
          balance: 150,
          todayUsed: 15,
        },
      },
    });

    const store = useTokenStore.getState();
    await store.loadBalance();

    expect(apiClient.get).toHaveBeenCalledWith('/tokens/balance');
    expect(useTokenStore.getState().balance).toBe(150);
    expect(useTokenStore.getState().todayUsed).toBe(15);
  });

  it('should consume tokens successfully and add to history', async () => {
    const { useTokenStore } = await import('./token-store');
    vi.mocked(apiClient.post).mockResolvedValue({
      data: {
        data: {
          balance: 25,
        },
      },
    });

    const store = useTokenStore.getState();
    const success = await store.consumeTokens('ai_chat');

    expect(success).toBe(true);
    expect(apiClient.post).toHaveBeenCalledWith('/tokens/consume', {
      feature: 'ai_chat',
      cost: 5,
    });
    expect(useTokenStore.getState().balance).toBe(25);
    expect(useTokenStore.getState().todayUsed).toBe(5);
    expect(useTokenStore.getState().history.length).toBe(1);
    expect(useTokenStore.getState().history[0].feature).toBe('ai_chat');
    expect(useTokenStore.getState().history[0].cost).toBe(5);
  });

  it('should return false if token consumption fails with 400', async () => {
    const { useTokenStore } = await import('./token-store');
    const errorResponse = {
      response: {
        status: 400,
      },
      message: 'Insufficient balance',
    };
    vi.mocked(apiClient.post).mockRejectedValue(errorResponse);

    const store = useTokenStore.getState();
    const success = await store.consumeTokens('writing_feedback');

    expect(success).toBe(false);
    expect(useTokenStore.getState().balance).toBe(30); // Unchanged
  });

  it('should add tokens via purchase endpoint', async () => {
    const { useTokenStore } = await import('./token-store');
    vi.mocked(apiClient.post).mockResolvedValue({
      data: {
        data: {
          balance: 530,
        },
      },
    });

    const store = useTokenStore.getState();
    await store.addTokens(500);

    expect(apiClient.post).toHaveBeenCalledWith('/tokens/purchase', { amount: 500 });
    expect(useTokenStore.getState().balance).toBe(530);
  });

  it('should correctly report canAfford based on balance', async () => {
    const { useTokenStore } = await import('./token-store');
    useTokenStore.setState({ balance: 8 });

    const store = useTokenStore.getState();
    expect(store.canAfford('writing_feedback')).toBe(false); // Cost is 10
    expect(store.canAfford('ai_chat')).toBe(true); // Cost is 5
  });
});
