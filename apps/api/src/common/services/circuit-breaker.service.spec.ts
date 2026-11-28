import {
  CircuitBreakerService,
  CircuitBreakerConfig,
  CircuitBreakerError,
} from './circuit-breaker.service';

/** Provider-style retryable error, shaped like ProviderException payloads. */
function providerError(
  overrides: Partial<CircuitBreakerError> = {},
): Error & CircuitBreakerError {
  const error = new Error(
    overrides.message ?? 'AI service is temporarily unavailable',
  ) as Error & CircuitBreakerError;
  error.code = overrides.code ?? 'PROVIDER_UNAVAILABLE';
  error.message = overrides.message ?? 'AI service is temporarily unavailable';
  error.retryable = overrides.retryable ?? true;
  error.aborted = overrides.aborted ?? false;
  return error;
}

/** Caller cancellation / validation failure: must never trip the breaker. */
function nonRetryableError(): Error & CircuitBreakerError {
  return providerError({
    code: 'PROVIDER_ABORTED',
    message: 'AI request was cancelled',
    retryable: false,
    aborted: true,
  });
}

const CONFIG: CircuitBreakerConfig = {
  failureThreshold: 3,
  cooldownMs: 60_000,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('CircuitBreakerService — REL-01 provider/model circuit breaker', () => {
  let service: CircuitBreakerService;

  beforeEach(() => {
    service = new CircuitBreakerService();
    jest.spyOn(Date, 'now').mockImplementation(() => 0);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('CLOSED state', () => {
    it('allows calls and records failures up to the threshold', async () => {
      const operation = jest.fn().mockRejectedValue(providerError());
      for (let i = 0; i < CONFIG.failureThreshold - 1; i++) {
        await expect(
          service.execute('groq:llama-3.3-70b', operation, CONFIG),
        ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
      }

      expect(operation).toHaveBeenCalledTimes(CONFIG.failureThreshold - 1);
      expect(service.getState('groq:llama-3.3-70b')).toBe('CLOSED');
    });

    it('clears the failure count after a success', async () => {
      const failing = jest.fn().mockRejectedValue(providerError());
      for (let i = 0; i < CONFIG.failureThreshold - 1; i++) {
        await expect(
          service.execute('groq:model', failing, CONFIG),
        ).rejects.toThrow();
      }
      await expect(
        service.execute('groq:model', async () => 'ok', CONFIG),
      ).resolves.toBe('ok');

      // If the counter had not been cleared, one more failure would open it.
      await expect(
        service.execute('groq:model', failing, CONFIG),
      ).rejects.toThrow();
      expect(service.getState('groq:model')).toBe('CLOSED');
    });
  });

  describe('OPEN state', () => {
    async function trip(key: string, config = CONFIG) {
      const operation = jest.fn().mockRejectedValue(providerError());
      for (let i = 0; i < config.failureThreshold; i++) {
        await expect(service.execute(key, operation, config)).rejects.toThrow();
      }
      return operation;
    }

    it('transitions CLOSED -> OPEN at the threshold and rejects without calling upstream', async () => {
      const operation = await trip('groq:model');

      expect(service.getState('groq:model')).toBe('OPEN');
      expect(operation).toHaveBeenCalledTimes(CONFIG.failureThreshold);

      const furtherCalls = jest.fn().mockResolvedValue('should not run');
      await expect(
        service.execute('groq:model', furtherCalls, CONFIG),
      ).rejects.toMatchObject({
        code: 'PROVIDER_UNAVAILABLE',
        retryable: true,
        aborted: false,
      });
      expect(furtherCalls).not.toHaveBeenCalled();
    });

    it('returns a safe error contract with no raw provider data', async () => {
      await trip('groq:model');

      let error: any;
      try {
        await service.execute('groq:model', async () => 'ok', CONFIG);
      } catch (err) {
        error = err;
      }

      expect(error).toBeInstanceOf(Error);
      expect(error.code).toBe('PROVIDER_UNAVAILABLE');
      expect(error.retryable).toBe(true);
      expect(error.aborted).toBe(false);
      expect(error.message).not.toMatch(/secret|token|api.?key/i);
      expect(JSON.stringify(error)).not.toMatch(/secret|token|api.?key/i);
    });

    it('isolates circuits per provider/model key', async () => {
      const openOperation = jest.fn().mockRejectedValue(providerError());
      for (let i = 0; i < CONFIG.failureThreshold; i++) {
        await expect(
          service.execute('groq:model-a', openOperation, CONFIG),
        ).rejects.toThrow();
      }
      expect(service.getState('groq:model-a')).toBe('OPEN');

      const otherOperation = jest.fn().mockResolvedValue('other provider ok');
      await expect(
        service.execute('groq:model-b', otherOperation, CONFIG),
      ).resolves.toBe('other provider ok');
      await expect(
        service.execute('openai:model-a', otherOperation, CONFIG),
      ).resolves.toBe('other provider ok');
      expect(service.getState('groq:model-b')).toBe('CLOSED');
      expect(service.getState('openai:model-a')).toBe('CLOSED');
      expect(otherOperation).toHaveBeenCalledTimes(2);
    });
  });

  describe('cooldown', () => {
    it('blocks all calls until the cooldown elapses', async () => {
      const failing = jest.fn().mockRejectedValue(providerError());
      for (let i = 0; i < CONFIG.failureThreshold; i++) {
        await expect(
          service.execute('groq:model', failing, CONFIG),
        ).rejects.toThrow();
      }

      // Just before expiry: still open, no probe.
      (Date.now as jest.Mock).mockReturnValue(CONFIG.cooldownMs - 1);
      const operation = jest.fn().mockResolvedValue('ok');
      await expect(
        service.execute('groq:model', operation, CONFIG),
      ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
      expect(operation).not.toHaveBeenCalled();
      expect(service.getState('groq:model')).toBe('OPEN');

      // Exactly at expiry: a probe is allowed.
      (Date.now as jest.Mock).mockReturnValue(CONFIG.cooldownMs);
      await expect(
        service.execute('groq:model', operation, CONFIG),
      ).resolves.toBe('ok');
    });

    it('does not allow a premature half-open probe', async () => {
      const failing = jest.fn().mockRejectedValue(providerError());
      for (let i = 0; i < CONFIG.failureThreshold; i++) {
        await expect(
          service.execute('groq:model', failing, CONFIG),
        ).rejects.toThrow();
      }

      for (const elapsed of [
        0,
        1000,
        CONFIG.cooldownMs / 2,
        CONFIG.cooldownMs - 1,
      ]) {
        (Date.now as jest.Mock).mockReturnValue(elapsed);
        const probe = jest.fn().mockResolvedValue('ok');
        await expect(
          service.execute('groq:model', probe, CONFIG),
        ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
        expect(probe).not.toHaveBeenCalled();
      }
    });
  });

  describe('HALF_OPEN state', () => {
    async function tripAndAdvance(key = 'groq:model', config = CONFIG) {
      const failing = jest.fn().mockRejectedValue(providerError());
      for (let i = 0; i < config.failureThreshold; i++) {
        await expect(service.execute(key, failing, config)).rejects.toThrow();
      }
      (Date.now as jest.Mock).mockReturnValue(config.cooldownMs);
    }

    it('allows one probe after cooldown and closes on success with counters reset', async () => {
      await tripAndAdvance();

      const probe = jest.fn().mockResolvedValue('recovered');
      await expect(service.execute('groq:model', probe, CONFIG)).resolves.toBe(
        'recovered',
      );
      expect(probe).toHaveBeenCalledTimes(1);
      expect(service.getState('groq:model')).toBe('CLOSED');

      // Counters were reset: it takes a full threshold to open again.
      const failing = jest.fn().mockRejectedValue(providerError());
      for (let i = 0; i < CONFIG.failureThreshold - 1; i++) {
        await expect(
          service.execute('groq:model', failing, CONFIG),
        ).rejects.toThrow();
      }
      expect(service.getState('groq:model')).toBe('CLOSED');
      await expect(
        service.execute('groq:model', failing, CONFIG),
      ).rejects.toThrow();
      expect(service.getState('groq:model')).toBe('OPEN');
    });

    it('reopens with a fresh cooldown when the probe fails', async () => {
      await tripAndAdvance();

      // Cooldown must be measured from the probe failure, not the old one.
      (Date.now as jest.Mock).mockReturnValue(3 * CONFIG.cooldownMs);
      const probe = jest.fn().mockRejectedValue(providerError());
      await expect(
        service.execute('groq:model', probe, CONFIG),
      ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
      expect(service.getState('groq:model')).toBe('OPEN');

      (Date.now as jest.Mock).mockReturnValue(3 * CONFIG.cooldownMs + 1000);
      const blocked = jest.fn().mockResolvedValue('ok');
      await expect(
        service.execute('groq:model', blocked, CONFIG),
      ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
      expect(blocked).not.toHaveBeenCalled();

      (Date.now as jest.Mock).mockReturnValue(4 * CONFIG.cooldownMs);
      await expect(
        service.execute('groq:model', blocked, CONFIG),
      ).resolves.toBe('ok');
    });

    it('rejects a second request arriving while the half-open probe is in flight', async () => {
      await tripAndAdvance();

      const probe = deferred<string>();
      const inFlight = service.execute(
        'groq:model',
        () => probe.promise,
        CONFIG,
      );

      const concurrent = jest.fn().mockResolvedValue('concurrent');
      await expect(
        service.execute('groq:model', concurrent, CONFIG),
      ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
      expect(concurrent).not.toHaveBeenCalled();

      probe.resolve('recovered');
      await expect(inFlight).resolves.toBe('recovered');
      expect(service.getState('groq:model')).toBe('CLOSED');
    });

    it('keeps half-open probes single-flight even when halfOpenProbes > 1', async () => {
      const config: CircuitBreakerConfig = { ...CONFIG, halfOpenProbes: 2 };
      await tripAndAdvance('groq:model', config);

      const first = deferred<string>();
      const p1 = service.execute('groq:model', () => first.promise, config);

      const concurrent = jest.fn().mockResolvedValue('concurrent');
      await expect(
        service.execute('groq:model', concurrent, config),
      ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
      expect(concurrent).not.toHaveBeenCalled();

      first.resolve('one');
      await expect(p1).resolves.toBe('one');
      expect(service.getState('groq:model')).toBe('CLOSED');
    });
  });

  describe('reset', () => {
    it('reset(key) clears failures and cooldown for that key only', async () => {
      const failing = jest.fn().mockRejectedValue(providerError());
      for (let i = 0; i < CONFIG.failureThreshold; i++) {
        await expect(
          service.execute('groq:model', failing, CONFIG),
        ).rejects.toThrow();
      }
      for (let i = 0; i < CONFIG.failureThreshold; i++) {
        await expect(
          service.execute('openai:model', failing, CONFIG),
        ).rejects.toThrow();
      }
      expect(service.getState('groq:model')).toBe('OPEN');
      expect(service.getState('openai:model')).toBe('OPEN');

      service.reset('groq:model');
      expect(service.getState('groq:model')).toBe('CLOSED');
      expect(service.getState('openai:model')).toBe('OPEN');

      const operation = jest.fn().mockResolvedValue('ok');
      await expect(
        service.execute('groq:model', operation, CONFIG),
      ).resolves.toBe('ok');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('reset() clears all circuits', async () => {
      const failing = jest.fn().mockRejectedValue(providerError());
      for (const key of ['groq:a', 'groq:b']) {
        for (let i = 0; i < CONFIG.failureThreshold; i++) {
          await expect(service.execute(key, failing, CONFIG)).rejects.toThrow();
        }
      }

      service.reset();
      expect(service.getState('groq:a')).toBe('CLOSED');
      expect(service.getState('groq:b')).toBe('CLOSED');

      const operation = jest.fn().mockResolvedValue('ok');
      await expect(service.execute('groq:a', operation, CONFIG)).resolves.toBe(
        'ok',
      );
      await expect(service.execute('groq:b', operation, CONFIG)).resolves.toBe(
        'ok',
      );
    });

    it('reset() releases an in-flight half-open probe', async () => {
      const failing = jest.fn().mockRejectedValue(providerError());
      for (let i = 0; i < CONFIG.failureThreshold; i++) {
        await expect(
          service.execute('groq:model', failing, CONFIG),
        ).rejects.toThrow();
      }
      (Date.now as jest.Mock).mockReturnValue(CONFIG.cooldownMs);

      const probe = deferred<string>();
      const inFlight = service.execute(
        'groq:model',
        () => probe.promise,
        CONFIG,
      );
      service.reset('groq:model');

      const operation = jest.fn().mockResolvedValue('ok');
      await expect(
        service.execute('groq:model', operation, CONFIG),
      ).resolves.toBe('ok');
      probe.resolve('late');
      await expect(inFlight).resolves.toBe('late');
    });
  });

  describe('failure classification', () => {
    it('does not count aborted / non-retryable errors toward the threshold', async () => {
      const operation = jest.fn().mockRejectedValue(nonRetryableError());
      for (let i = 0; i < CONFIG.failureThreshold * 2; i++) {
        await expect(
          service.execute('groq:model', operation, CONFIG),
        ).rejects.toMatchObject({ code: 'PROVIDER_ABORTED' });
      }
      expect(service.getState('groq:model')).toBe('CLOSED');

      const providerFailure = jest.fn().mockRejectedValue(providerError());
      for (let i = 0; i < CONFIG.failureThreshold; i++) {
        await expect(
          service.execute('groq:model', providerFailure, CONFIG),
        ).rejects.toThrow();
      }
      expect(service.getState('groq:model')).toBe('OPEN');
    });

    it('counts retryable timeout errors and uses a custom classifier when injected', async () => {
      const timeout = providerError({ code: 'PROVIDER_TIMEOUT' });
      const failing = jest.fn().mockRejectedValue(timeout);
      for (let i = 0; i < CONFIG.failureThreshold; i++) {
        await expect(
          service.execute('groq:model', failing, CONFIG),
        ).rejects.toThrow();
      }
      expect(service.getState('groq:model')).toBe('OPEN');

      service.reset();
      const custom = new CircuitBreakerService(
        (error) => (error as CircuitBreakerError).code === 'VALIDATION_ERROR',
      );
      const validation = providerError({
        code: 'VALIDATION_ERROR',
        retryable: false,
      });
      const customFailing = jest.fn().mockRejectedValue(validation);
      for (let i = 0; i < CONFIG.failureThreshold; i++) {
        await expect(
          custom.execute('groq:model', customFailing, CONFIG),
        ).rejects.toThrow();
      }
      expect(custom.getState('groq:model')).toBe('OPEN');

      await expect(
        custom.execute('groq:model', failing, CONFIG),
      ).rejects.toThrow();
      expect(custom.getState('groq:model')).toBe('OPEN');
    });
  });

  describe('configuration', () => {
    it('rejects non-positive thresholds, cooldowns and probe counts', async () => {
      const operation = jest.fn().mockResolvedValue('ok');

      await expect(
        service.execute('groq:model', operation, {
          ...CONFIG,
          failureThreshold: 0,
        }),
      ).rejects.toThrow(/failureThreshold/);
      await expect(
        service.execute('groq:model', operation, { ...CONFIG, cooldownMs: 0 }),
      ).rejects.toThrow(/cooldownMs/);
      await expect(
        service.execute('groq:model', operation, {
          ...CONFIG,
          halfOpenProbes: 0,
        }),
      ).rejects.toThrow(/halfOpenProbes/);
      expect(operation).not.toHaveBeenCalled();
      expect(service.getState('groq:model')).toBe('CLOSED');
    });
  });
});
