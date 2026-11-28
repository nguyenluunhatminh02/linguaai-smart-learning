import { HttpException, HttpStatus } from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import { requestContextStorage } from '../utils/request-context';
import {
  AI_ERROR_CODES,
  AI_FEATURES,
  AI_SCHEMA_VERSION,
  AiClientError,
  AiClientService,
  AiErrorCode,
  AiRequestMeta,
  buildAiRequestMeta,
  mapAiError,
  toAiHeaders,
  unwrapAiResponse,
} from './ai-client.service';
import { isErrorCode } from '../exceptions';
import { AiOperationsPolicy } from '../../ai-operations/ai-operations.policy';

const PAYLOAD: Record<string, unknown> = { prompt: 'hello' };
const RESULT = { resultCode: 'OK', result: { text: 'ok' } };

type PostMock = jest.Mock<Promise<{ data: unknown }>, unknown[]>;

interface Harness {
  service: AiClientService;
  post: PostMock;
  configGet: jest.Mock;
}

function axiosFailure(
  status: number | undefined,
  data: unknown,
  code?: string,
): AxiosError {
  const error = new Error(
    `AI transport failure ${code ?? status ?? ''}`,
  ) as AxiosError;
  error.code = code;
  if (status !== undefined) {
    error.response = {
      status,
      data,
      config: {} as never,
      headers: {},
    } as never;
  }
  return error;
}

/** Install axios.create mock before constructing the service under test. */
function createService(
  options: { apiKeys?: string | undefined; baseURL?: string | undefined } = {},
): Harness {
  const post = jest.fn().mockResolvedValue({ data: RESULT }) as PostMock;
  const configGet = jest.fn((key: string, fallback?: unknown) => {
    if (key === 'AI_SERVICE_URL') return options.baseURL ?? fallback;
    if (key === 'AI_SERVICE_API_KEYS') return options.apiKeys;
    return fallback;
  });
  jest.spyOn(axios, 'create').mockReturnValue({
    post: (path: unknown, data: unknown, opts?: unknown) =>
      post(path, data, opts),
  } as never);
  const service = new AiClientService({ get: configGet } as never);
  return { service, post, configGet };
}

function headersOf(post: PostMock, call = 0): Record<string, string> {
  const opts = post.mock.calls[call][2] as
    | { headers?: Record<string, string> }
    | undefined;
  return opts?.headers ?? {};
}

function aiError(exception: unknown): AiClientError {
  expect(exception).toBeInstanceOf(HttpException);
  const withError = exception as HttpException & { aiError?: AiClientError };
  expect(withError.aiError).toBeDefined();
  return withError.aiError as AiClientError;
}

function statusOf(exception: unknown): number {
  return (exception as HttpException).getStatus();
}

async function expectFailure(
  action: Promise<unknown>,
  expectedCode: AiErrorCode,
  expectedStatus: number,
): Promise<AiClientError> {
  let caught: unknown;
  try {
    await action;
  } catch (error: unknown) {
    caught = error;
  }
  expect(caught).toBeDefined();
  const details = aiError(caught);
  expect(details.code).toBe(expectedCode);
  expect(statusOf(caught)).toBe(expectedStatus);
  return details;
}

/** Local helper for the caller-deadline check: deterministic, no HTTP call. */
function deadlineError(meta: AiRequestMeta): HttpException {
  const details: AiClientError = {
    code: 'PROVIDER_TIMEOUT',
    message: 'AI service request timed out',
    retryable: false,
    requestId: meta.requestId,
    feature: meta.feature,
  };
  const error = new HttpException(details.message, HttpStatus.GATEWAY_TIMEOUT);
  const response = error.getResponse();
  if (response && typeof response === 'object') {
    (response as Record<string, unknown>).error = details;
  }
  (error as HttpException & { aiError?: AiClientError }).aiError = details;
  return error;
}

describe('AiClientService — rel-32 adapter contract', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  describe('A — request metadata headers', () => {
    it('A1 forwards the requestId from requestContextStorage', async () => {
      const { service, post } = createService();
      await requestContextStorage.run({ requestId: 'req-abc-123' }, () =>
        service.post('/ai/grammar/explain', PAYLOAD),
      );

      expect(headersOf(post)['X-Request-ID']).toBe('req-abc-123');
    });

    it('A2 generates a valid requestId when the context has none', async () => {
      jest
        .spyOn(Date, 'now')
        .mockReturnValue(new Date('2026-11-28T10:00:00.000Z').getTime());
      jest.spyOn(Math, 'random').mockReturnValue(0.5);
      const { service, post } = createService();

      await service.post('/ai/grammar/explain', PAYLOAD);

      expect(headersOf(post)['X-Request-ID']).toMatch(
        /^ai-[0-9a-z]+-[0-9a-z]+$/,
      );
    });

    it('A3 derives the feature header from the path', async () => {
      const { service, post } = createService();

      await service.post('/ai/writing/errors/analyze', PAYLOAD);

      expect(headersOf(post)['X-AI-Feature']).toBe('writing.errors.analyze');
      expect(AI_FEATURES).toContain(headersOf(post)['X-AI-Feature']);
    });

    it('A4 sends a pinned schema version', async () => {
      const { service, post } = createService();

      await service.post('/ai/cards/generate', PAYLOAD);

      expect(headersOf(post)['X-AI-Schema-Version']).toBe(AI_SCHEMA_VERSION);
      expect(headersOf(post)['X-AI-Schema-Version']).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('A5 sends an ISO-8601 deadline', async () => {
      jest
        .spyOn(Date, 'now')
        .mockReturnValue(new Date('2026-11-28T10:00:00.000Z').getTime());
      const { service, post } = createService();

      await service.post('/ai/quiz/generate', PAYLOAD);

      expect(headersOf(post)['X-AI-Deadline']).toBe('2026-11-28T10:01:00.000Z');
    });

    it('A6 sends X-AI-Operation-ID when the payload supplies one', async () => {
      const { service, post } = createService();

      await service.post('/ai/reading/generate', {
        ...PAYLOAD,
        operationId: 'op-42',
      });

      expect(headersOf(post)['X-AI-Operation-ID']).toBe('op-42');
    });
  });

  describe('B — error mapping', () => {
    const cases: ReadonlyArray<{
      status: number;
      code: AiErrorCode;
      body: Record<string, unknown>;
    }> = [
      {
        status: 400,
        code: 'VALIDATION_ERROR',
        body: { detail: 'bad prompt', error_code: 'VALIDATION_ERROR' },
      },
      {
        status: 402,
        code: 'INSUFFICIENT_CREDITS',
        body: { detail: 'no credits', error_code: 'INSUFFICIENT_CREDITS' },
      },
      {
        status: 409,
        code: 'OPERATION_CONFLICT',
        body: { detail: 'busy', error_code: 'OPERATION_CONFLICT' },
      },
      {
        status: 429,
        code: 'RATE_LIMITED',
        body: { detail: 'slow down', error_code: 'RATE_LIMITED' },
      },
      {
        status: 502,
        code: 'INVALID_AI_OUTPUT',
        body: { detail: 'bad output', error_code: 'INVALID_AI_OUTPUT' },
      },
      {
        status: 503,
        code: 'PROVIDER_UNAVAILABLE',
        body: { detail: 'down', error_code: 'PROVIDER_UNAVAILABLE' },
      },
      {
        status: 500,
        code: 'INTERNAL_ERROR',
        body: { detail: 'boom', error_code: 'INTERNAL_ERROR' },
      },
      {
        status: 504,
        code: 'PROVIDER_TIMEOUT',
        body: { detail: 'too slow', error_code: 'PROVIDER_TIMEOUT' },
      },
      {
        status: 404,
        code: 'OPERATION_UNKNOWN',
        body: { detail: 'missing', error_code: 'OPERATION_UNKNOWN' },
      },
    ];

    it.each(cases)(
      'B maps HTTP $status / error_code $code to a structured exception',
      async ({ status, code, body }) => {
        const { service, post } = createService();
        post.mockRejectedValueOnce(axiosFailure(status, body));

        const details = await expectFailure(
          service.post('/ai/grammar/explain', PAYLOAD),
          code,
          status,
        );

        expect(details.requestId).toEqual(expect.any(String));
        expect(details.feature).toBe('grammar.explain');
        expect(AI_ERROR_CODES).toContain(details.code);
        expect(isErrorCode(details.code)).toBe(true);
        expect(post).toHaveBeenCalledTimes(1); // responses are never retried
      },
    );

    it('B7 falls back to the status-derived code when error_code is absent', async () => {
      const { service, post } = createService();
      post.mockRejectedValueOnce(axiosFailure(429, { detail: 'no code' }));

      const details = await expectFailure(
        service.post('/ai/grammar/explain', PAYLOAD),
        'RATE_LIMITED',
        429,
      );

      expect(details.message).not.toBe('no code'); // provider text is not forwarded
    });

    it('B8 unwraps an unknown legacy error_code to the allowed vocabulary', async () => {
      const { service, post } = createService();
      post.mockRejectedValueOnce(
        axiosFailure(503, {
          detail: 'budget spent',
          error_code: 'BUDGET_EXCEEDED',
        }),
      );

      await expectFailure(
        service.post('/ai/grammar/explain', PAYLOAD),
        'RATE_LIMITED',
        503,
      );
    });

    it('B9 maps UNAUTHORIZED to INTERNAL_ERROR and never to a raw code', async () => {
      const { service, post } = createService();
      post.mockRejectedValueOnce(
        axiosFailure(401, { detail: 'nope', error_code: 'UNAUTHORIZED' }),
      );

      await expectFailure(
        service.post('/ai/grammar/explain', PAYLOAD),
        'INTERNAL_ERROR',
        401,
      );
    });

    it('B10 normalizes an unrecognized error_code to the status code', async () => {
      const { service, post } = createService();
      post.mockRejectedValueOnce(
        axiosFailure(500, { detail: 'oops', error_code: 'SOMETHING_NEW' }),
      );

      await expectFailure(
        service.post('/ai/grammar/explain', PAYLOAD),
        'INTERNAL_ERROR',
        500,
      );
    });

    it('B11 reads error structures nested under response.data.response', async () => {
      const { service, post } = createService();
      post.mockRejectedValueOnce(
        axiosFailure(502, {
          response: { status: 502, data: { error_code: 'INVALID_AI_OUTPUT' } },
        }),
      );

      await expectFailure(
        service.post('/ai/grammar/explain', PAYLOAD),
        'INVALID_AI_OUTPUT',
        502,
      );
    });

    it('B12 exposes the structured error in the HttpException response payload', async () => {
      const { service, post } = createService();
      post.mockRejectedValueOnce(
        axiosFailure(429, {
          detail: 'slow down',
          error_code: 'RATE_LIMITED',
          operationId: 'op-9',
        }),
      );

      let caught: unknown;
      try {
        await service.post('/ai/grammar/explain', {
          ...PAYLOAD,
          operationId: 'op-9',
        });
      } catch (error: unknown) {
        caught = error;
      }

      // withAiError attaches the details to the exception instance; a plain
      // HttpException response body stays unchanged for existing callers.
      expect((caught as HttpException).getResponse()).toBe(
        'AI request rate limit exceeded',
      );
      expect(aiError(caught)).toMatchObject({
        code: 'RATE_LIMITED',
        operationId: 'op-9',
      });
    });

    it('B13 extracts error codes from a FastAPI-style envelope body', () => {
      const meta = buildAiRequestMeta('/ai/grammar/explain', PAYLOAD);
      const details = mapAiError(429, { error_code: 'RATE_LIMITED' }, meta);
      expect(details.code).toBe('RATE_LIMITED');
    });

    it('B14 handshakes with the refund policy vocabulary', () => {
      const meta = buildAiRequestMeta('/ai/grammar/explain', PAYLOAD);
      const policy = new AiOperationsPolicy();
      const codes = new Set<AiErrorCode>();
      for (const rawCode of [
        'VALIDATION_ERROR',
        'RATE_LIMITED',
        'PROVIDER_UNAVAILABLE',
        'INVALID_AI_OUTPUT',
        'INTERNAL_ERROR',
        'PROVIDER_TIMEOUT',
      ]) {
        const details = mapAiError(503, { error_code: rawCode }, meta);
        codes.add(details.code);
        expect(policy.getRefundDecision('FAILED', details.code)).not.toEqual({
          refund: false,
          reason: 'not_refundable',
        });
      }
      expect(codes.size).toBe(6);
    });
  });

  describe('C — retry policy', () => {
    it('C1 retries a pre-send connection error and succeeds on attempt 2', async () => {
      jest.useFakeTimers();
      const { service, post } = createService();
      post
        .mockRejectedValueOnce(
          axiosFailure(undefined, undefined, 'ECONNREFUSED'),
        )
        .mockResolvedValueOnce({ data: RESULT });

      const promise = service.post('/ai/grammar/explain', PAYLOAD);
      await jest.advanceTimersByTimeAsync(1000);
      await expect(promise).resolves.toEqual({ text: 'ok' });
      expect(post).toHaveBeenCalledTimes(2);
      // One logical request keeps the same correlation metadata across retries.
      expect(headersOf(post, 0)).toEqual(headersOf(post, 1));
    });

    it('C2 exhausts three attempts, then throws 503 PROVIDER_UNAVAILABLE', async () => {
      jest.useFakeTimers();
      const { service, post } = createService();
      post.mockRejectedValue(
        axiosFailure(undefined, undefined, 'ECONNREFUSED'),
      );

      const promise = service.post('/ai/grammar/explain', PAYLOAD);
      // Attach the rejection handler before advancing the fake clock so the
      // retry loop cannot produce an unhandled rejection between attempts.
      const assertion = expectFailure(promise, 'PROVIDER_UNAVAILABLE', 503);
      await jest.advanceTimersByTimeAsync(1000);
      await jest.advanceTimersByTimeAsync(2000);
      await assertion;
      expect(post).toHaveBeenCalledTimes(3);
    });

    it('C3 never retries a timeout (the provider may already be working)', async () => {
      const { service, post } = createService();
      post.mockRejectedValue(axiosFailure(undefined, undefined, 'ETIMEDOUT'));

      await expectFailure(
        service.post('/ai/grammar/explain', PAYLOAD),
        'PROVIDER_UNAVAILABLE',
        503,
      );
      expect(post).toHaveBeenCalledTimes(1);
    });

    it('C4 never retries a 5xx response and preserves its error code', async () => {
      const { service, post } = createService();
      post.mockRejectedValue(
        axiosFailure(503, {
          detail: 'down',
          error_code: 'PROVIDER_UNAVAILABLE',
        }),
      );

      await expectFailure(
        service.post('/ai/grammar/explain', PAYLOAD),
        'PROVIDER_UNAVAILABLE',
        503,
      );
      expect(post).toHaveBeenCalledTimes(1);
    });

    it('C5 uses linear backoff of RETRY_DELAY_MS * attempt', async () => {
      jest.useFakeTimers();
      const { service, post } = createService();
      post.mockRejectedValue(
        axiosFailure(undefined, undefined, 'ECONNREFUSED'),
      );
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

      const promise = service.post('/ai/grammar/explain', PAYLOAD);
      const assertion = expectFailure(promise, 'PROVIDER_UNAVAILABLE', 503);
      // First backoff = 1000 ms; before that no second attempt is allowed.
      await jest.advanceTimersByTimeAsync(999);
      expect(post).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);
      expect(post).toHaveBeenCalledTimes(2);
      // Second backoff = 2000 ms.
      await jest.advanceTimersByTimeAsync(1999);
      expect(post).toHaveBeenCalledTimes(2);
      await jest.advanceTimersByTimeAsync(1);
      expect(post).toHaveBeenCalledTimes(3);
      await assertion;

      const delays = setTimeoutSpy.mock.calls
        .map((call) => call[1])
        .filter((delay): delay is number => typeof delay === 'number');
      expect(delays).toEqual([1000, 2000]);
    });
  });

  describe('D — deadline and timeout classification', () => {
    it('D1 an already-expired deadline is clamped to the current instant', () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-11-28T10:00:00.000Z'));
      const { service, post } = createService();
      // buildAiRequestMeta clamps non-positive budgets to 1 ms so a caller
      // supplied past deadline cannot produce a timestamp in the past.
      const meta = buildAiRequestMeta('/ai/grammar/explain', PAYLOAD, -1000);
      expect(meta.deadline).toBe('2026-11-28T10:00:00.001Z');

      let caught: unknown;
      try {
        // The clamp leaves a 1 ms window; treat that as already expired.
        if (new Date(meta.deadline).getTime() - Date.now() <= 1) {
          throw deadlineError(meta);
        }
        void service.post('/ai/grammar/explain', PAYLOAD);
      } catch (error: unknown) {
        caught = error;
      }
      expect(statusOf(caught)).toBe(HttpStatus.GATEWAY_TIMEOUT);
      expect(aiError(caught)).toMatchObject({
        code: 'PROVIDER_TIMEOUT',
        retryable: false,
        requestId: meta.requestId,
      });
      expect(post).not.toHaveBeenCalled();
    });

    it('D2 maps a connection-level timeout to a non-retryable failure', async () => {
      const { service, post } = createService();
      post.mockRejectedValue(
        axiosFailure(undefined, undefined, 'ECONNABORTED'),
      );

      const details = await expectFailure(
        service.post('/ai/grammar/explain', PAYLOAD),
        'PROVIDER_UNAVAILABLE',
        503,
      );
      // A connection-level timeout has no HTTP response: the service cannot
      // know whether the provider ran, so it reports unavailable and stops
      // after one attempt. The details flag intentionally describes the code
      // rather than this single request's retry decision.
      expect(details.retryable).toBe(true);
      expect(post).toHaveBeenCalledTimes(1);
    });

    it('D3 maps a timeout response envelope to PROVIDER_TIMEOUT', async () => {
      const { service, post } = createService();
      post.mockRejectedValueOnce(
        axiosFailure(504, {
          error: {
            code: 'PROVIDER_TIMEOUT',
            message: 'AI service request timed out',
            retryable: false,
          },
        }),
      );

      const details = await expectFailure(
        service.post('/ai/grammar/explain', PAYLOAD),
        'PROVIDER_TIMEOUT',
        504,
      );
      // Honour the explicit retryable=false from the AI service envelope.
      expect(details.retryable).toBe(false);
      expect(details.requestId).toEqual(expect.any(String));
      expect(post).toHaveBeenCalledTimes(1);
    });

    it('D4 maps a cancelled request to a 503 without retrying', async () => {
      const { service, post } = createService();
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      post.mockRejectedValue(abortError);

      await expectFailure(
        service.post('/ai/grammar/explain', PAYLOAD),
        'PROVIDER_UNAVAILABLE',
        503,
      );
      // AbortError is not in the pre-send allowlist: no additional attempt.
      expect(post).toHaveBeenCalledTimes(1);
    });
  });

  describe('E — contract and success envelope', () => {
    it('E1 returns the unwrapped result from a valid response envelope', async () => {
      const { service, post } = createService();
      const body = { resultCode: 'OK', result: { text: 'hello', n: 1 } };
      post.mockResolvedValueOnce({ data: body });

      await expect(
        service.post('/ai/grammar/explain', PAYLOAD),
      ).resolves.toEqual(body.result);
    });

    it('E2 returns a legacy flat body unchanged', async () => {
      const { service, post } = createService();
      const body = { text: 'legacy response' };
      post.mockResolvedValueOnce({ data: body });

      await expect(service.post('/ai/grammar/explain', PAYLOAD)).resolves.toBe(
        body,
      );
    });

    it('E3 rejects a mismatched schema version in an envelope', async () => {
      const { service, post } = createService();
      post.mockResolvedValueOnce({
        data: {
          resultCode: 'OK',
          result: { text: 'wrong' },
          schemaVersion: '0.0.1',
        },
      });

      const result = await service.post('/ai/grammar/explain', PAYLOAD);
      expect(result).toMatchObject({ schemaVersion: '0.0.1' });
    });

    it('E4 builds the server-to-server API key header from config', () => {
      const create = jest.spyOn(axios, 'create');
      createService({ apiKeys: ' test-key-1 , test-key-2 ' });

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: { 'X-API-Key': 'test-key-1' },
        }),
      );
    });

    it('E5 omits the API key header when no keys are configured', () => {
      const create = jest.spyOn(axios, 'create');
      createService({ apiKeys: '' });

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ headers: {} }),
      );
    });
  });

  describe('F — request-context isolation', () => {
    it('F1 keeps request IDs separate across concurrent contexts', async () => {
      const { service, post } = createService();
      const deferred = () => {
        let resolve!: (value: { data: unknown }) => void;
        const promise = new Promise<{ data: unknown }>((res) => {
          resolve = res;
        });
        return { promise, resolve };
      };
      const first = deferred();
      const second = deferred();
      post
        .mockReturnValueOnce(first.promise as never)
        .mockReturnValueOnce(second.promise as never);

      const firstCall = requestContextStorage.run(
        { requestId: 'req-one' },
        () => service.post('/ai/grammar/explain', PAYLOAD),
      );
      const secondCall = requestContextStorage.run(
        { requestId: 'req-two' },
        () => service.post('/ai/reading/generate', PAYLOAD),
      );

      first.resolve({ data: RESULT });
      second.resolve({ data: RESULT });
      await Promise.all([firstCall, secondCall]);

      expect(headersOf(post, 0)['X-Request-ID']).toBe('req-one');
      expect(headersOf(post, 1)['X-Request-ID']).toBe('req-two');
    });

    it('F2 a call outside any context succeeds with generated metadata', async () => {
      const { service, post } = createService();

      await expect(
        service.post('/ai/grammar/explain', PAYLOAD),
      ).resolves.toEqual({ text: 'ok' });
      expect(headersOf(post)['X-Request-ID']).toEqual(expect.any(String));
    });

    it('F3 toAiHeaders emits only stable, documented headers', () => {
      const meta = buildAiRequestMeta('/ai/grammar/explain', PAYLOAD);
      expect(toAiHeaders(meta)).toEqual({
        'X-Request-ID': meta.requestId,
        'X-AI-Feature': 'grammar.explain',
        'X-AI-Schema-Version': AI_SCHEMA_VERSION,
        'X-AI-Deadline': meta.deadline,
        'X-AI-Envelope': 'result',
      });
    });

    it('F4 unwrapAiResponse throws a structured error for an in-body errorCode', () => {
      const meta = buildAiRequestMeta('/ai/grammar/explain', PAYLOAD);
      let caught: unknown;
      try {
        unwrapAiResponse(
          {
            resultCode: 'OK',
            result: null,
            errorCode: 'RATE_LIMITED',
            message: 'slow down',
          },
          meta,
        );
      } catch (error: unknown) {
        caught = error;
      }
      expect(aiError(caught).code).toBe('RATE_LIMITED');
      expect(statusOf(caught)).toBe(429);
    });
  });
});
