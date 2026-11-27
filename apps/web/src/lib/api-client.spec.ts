import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';

interface RequestConfig {
  url?: string;
  headers: Record<string, string>;
  _retry?: boolean;
}

interface ApiError extends Error {
  config: RequestConfig;
  response?: { status: number };
}

// Capture the interceptor callbacks so the refresh/retry logic is actually
// exercised instead of only asserting the axios.create configuration.
const interceptors = {
  request: { use: vi.fn() },
  response: { use: vi.fn() },
};

const mockClient = Object.assign(vi.fn(), {
  interceptors,
  get: vi.fn(),
  post: vi.fn(),
});

const mockGetAccessToken = vi.fn(() => null as string | null);
const mockSetAccessToken = vi.fn();

vi.mock('axios', () => ({
  default: { create: vi.fn(() => mockClient), post: vi.fn() },
  __esModule: true,
}));

vi.mock('@/stores/auth-store', () => ({
  getAccessToken: () => mockGetAccessToken(),
  setAccessToken: (token: string | null) => mockSetAccessToken(token),
}));

// Import once so the top-level `axios` binding and the api-client instance
// refer to the same mock object. The interceptor callbacks are captured from
// the recorded calls before any clearAllMocks() runs.
await import('./api-client');
const requestFn = interceptors.request.use.mock.calls[0][0] as (config: RequestConfig) => RequestConfig;
const [onSuccess, onError] = interceptors.response.use.mock.calls[0] as [
  (response: { data: unknown }) => { data: unknown },
  (error: ApiError) => Promise<unknown>,
];

function errorResponse(url = '/users/me', status = 401): ApiError {
  const error = new Error('request failed') as ApiError;
  error.config = { url, headers: {}, _retry: false };
  error.response = { status };
  return error;
}

describe('apiClient', () => {
  beforeEach(() => {
    mockGetAccessToken.mockReturnValue(null);
    mockGetAccessToken.mockClear();
    mockSetAccessToken.mockClear();
    mockClient.mockReset();
    vi.stubGlobal('fetch', vi.fn());
    vi.stubGlobal('window', { location: { href: '' } });
  });

  it('should create axios instance with correct base URL', () => {
    expect(axios.create).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: expect.any(String),
        timeout: 60000,
        withCredentials: true,
      }),
    );
    expect(typeof requestFn).toBe('function');
    expect(typeof onError).toBe('function');
  });

  it('attaches the in-memory token and timezone offset on each request', () => {
    mockGetAccessToken.mockReturnValueOnce('access-token');
    const config = { headers: {} as Record<string, string> };
    const result = requestFn(config);
    expect(result.headers.Authorization).toBe('Bearer access-token');
    expect(result.headers['x-timezone-offset']).toBeDefined();
  });

  it('removes a stale Authorization header when no token is in memory', () => {
    const config = { headers: { Authorization: 'Bearer old' } as Record<string, string> };
    const result = requestFn(config);
    expect(result.headers.Authorization).toBeUndefined();
  });

  it('unwraps the success envelope and camelizes nested keys', () => {
    const response = {
      data: {
        success: true,
        data: { user_name: 'Jane', nested_value: { created_at: 'now' } },
      },
    };
    expect(onSuccess(response).data).toEqual({
      userName: 'Jane',
      nestedValue: { createdAt: 'now' },
    });
  });

  it('refreshes once and retries with the new token for a 401', async () => {
    let currentToken: string | null = 'expired-token';
    mockGetAccessToken.mockImplementation(() => currentToken);
    mockSetAccessToken.mockImplementation((token: string | null) => {
      currentToken = token;
    });
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ data: { accessToken: 'fresh-token' } }),
    } as unknown as Response);
    mockClient.mockImplementation((config: RequestConfig) => ({ config }));

    const error = errorResponse();
    const retry = await onError(error);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(error.config._retry).toBe(true);
    expect(error.config.headers.Authorization).toBeUndefined();
    expect(mockClient).toHaveBeenCalledTimes(1);
    expect(retry).toEqual({ config: error.config });
  });

  it('shares a single refresh between concurrent 401 responses', async () => {
    let currentToken: string | null = 'expired-token';
    mockGetAccessToken.mockImplementation(() => currentToken);
    mockSetAccessToken.mockImplementation((token: string | null) => {
      currentToken = token;
    });
    let resolveFetch: (value: unknown) => void = () => {};
    vi.mocked(fetch).mockImplementation(
      () => new Promise((resolve) => { resolveFetch = resolve; }),
    );
    mockClient.mockImplementation((config: RequestConfig) => ({ config }));

    const first = onError(errorResponse('/users/me'));
    const second = onError(errorResponse('/courses'));
    expect(fetch).toHaveBeenCalledTimes(1);

    resolveFetch({
      ok: true,
      json: async () => ({ data: { accessToken: 'fresh-token' } }),
    });
    await Promise.all([first, second]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('never retries with the stale token when the refresh has no token', async () => {
    let currentToken: string | null = 'expired-token';
    mockGetAccessToken.mockImplementation(() => currentToken);
    mockSetAccessToken.mockImplementation((token: string | null) => {
      currentToken = token;
    });
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ data: {} }),
    } as unknown as Response);

    const error = errorResponse();
    await expect(onError(error)).rejects.toBe(error);

    expect(currentToken).toBeNull();
    expect(mockClient).not.toHaveBeenCalled();
    expect(error.config.headers.Authorization).toBeUndefined();
  });

  it('rejects a 401 without refreshing when no session token exists', async () => {
    // Login/register 401s must reject normally so the UI can show the server
    // error instead of attempting a refresh and redirecting to /login.
    mockGetAccessToken.mockReturnValue(null);
    const error = errorResponse('/auth/login');
    await expect(onError(error)).rejects.toBe(error);
    expect(mockClient).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
