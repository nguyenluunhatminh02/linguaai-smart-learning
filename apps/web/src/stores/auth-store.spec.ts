import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/api-client', () => ({
  default: {
    post: vi.fn(),
    get: vi.fn(),
  },
}));

describe('useAuthStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with null user and loading true', async () => {
    const mod = await import('./auth-store');
    const { useAuthStore } = mod;
    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.isLoading).toBe(true);
  });

  it('should have login, register, logout, loadUser methods', async () => {
    const mod = await import('./auth-store');
    const { useAuthStore } = mod;
    const state = useAuthStore.getState();
    expect(typeof state.login).toBe('function');
    expect(typeof state.register).toBe('function');
    expect(typeof state.logout).toBe('function');
    expect(typeof state.loadUser).toBe('function');
  });

  it('getAccessToken should return null initially', async () => {
    const mod = await import('./auth-store');
    const { getAccessToken } = mod;
    expect(getAccessToken()).toBeNull();
  });
});
