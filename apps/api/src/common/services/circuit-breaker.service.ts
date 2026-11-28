import { Injectable, Logger } from '@nestjs/common';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  failureThreshold: number;
  cooldownMs: number;
  halfOpenProbes?: number;
}

export interface CircuitBreakerError {
  code: string;
  message: string;
  retryable: boolean;
  aborted: boolean;
}

/**
 * Classifies whether an error should count toward the failure threshold.
 * Non-retryable errors (validation, auth) and aborted requests do not count.
 */
export type FailureClassifier = (error: unknown) => boolean;

/** Events emitted through CircuitBreakerMetrics. */
export type CircuitBreakerEvent =
  | 'state_change'
  | 'call_success'
  | 'call_failure'
  | 'call_rejected';

/**
 * Optional observability hooks. Every callback is isolated: a broken metrics
 * backend can never change the outcome of a provider call.
 */
export interface CircuitBreakerMetrics {
  onStateChange?(
    key: string,
    from: CircuitState,
    to: CircuitState,
  ): void | Promise<void>;
  onCallSuccess?(key: string, durationMs: number): void | Promise<void>;
  onCallFailure?(
    key: string,
    durationMs: number,
    error: unknown,
  ): void | Promise<void>;
  onCallRejected?(key: string): void | Promise<void>;
}

/** DI token for injecting custom metrics without changing the constructor. */
export const CIRCUIT_BREAKER_METRICS = Symbol('CIRCUIT_BREAKER_METRICS');

/** No-op implementation used when no metrics provider is registered. */
export const noopCircuitBreakerMetrics: CircuitBreakerMetrics = {};

interface CircuitState_ {
  state: CircuitState;
  failureCount: number;
  lastFailureTime: number;
  halfOpenProbesUsed: number;
  halfOpenProbeInFlight: boolean;
}

/**
 * Circuit breaker per provider/model key (REL-01).
 * Tracks open/half-open/closed states with cooldown periods.
 * In-memory implementation suitable for single-process deployment.
 */
@Injectable()
export class CircuitBreakerService {
  private readonly circuits = new Map<string, CircuitState_>();
  private readonly logger = new Logger(CircuitBreakerService.name);

  /**
   * Default classifier: counts retryable provider errors, excludes aborted/non-retryable.
   */
  private readonly defaultClassifier: FailureClassifier = (error: unknown) => {
    if (!error || typeof error !== 'object') return false;
    const err = error as CircuitBreakerError;
    // Aborted requests (user cancellation) do not count
    if (err.aborted) return false;
    // Non-retryable errors (validation, auth) do not count
    if (err.retryable === false) return false;
    // Retryable provider errors count
    return err.retryable === true;
  };

  constructor(
    private readonly classifier: FailureClassifier = this.defaultClassifier,
    private readonly metrics: CircuitBreakerMetrics = noopCircuitBreakerMetrics,
  ) {}

  /**
   * Execute an operation through the circuit breaker.
   * Returns the operation result if the circuit allows it.
   * Throws PROVIDER_UNAVAILABLE-style error if circuit is OPEN.
   */
  async execute<T>(
    key: string,
    operation: () => Promise<T>,
    config: CircuitBreakerConfig,
  ): Promise<T> {
    this.validateConfig(config);

    const circuit = this.getOrCreateCircuit(key);

    // OPEN state: check if cooldown has elapsed
    if (circuit.state === 'OPEN') {
      const now = Date.now();
      const timeSinceFailure = now - circuit.lastFailureTime;

      if (timeSinceFailure < config.cooldownMs) {
        // Still in cooldown, reject immediately
        this.reject(key);
      }

      // Cooldown elapsed, transition to HALF_OPEN
      circuit.state = 'HALF_OPEN';
      circuit.halfOpenProbesUsed = 0;
      circuit.halfOpenProbeInFlight = false;
      this.logger.log(`Circuit ${key}: OPEN -> HALF_OPEN after cooldown`);
      this.safe(() => this.metrics.onStateChange?.(key, 'OPEN', 'HALF_OPEN'));
    }

    // HALF_OPEN state: allow bounded probes
    if (circuit.state === 'HALF_OPEN') {
      const maxProbes = config.halfOpenProbes ?? 1;

      // Single-flight: reject if a probe is already in flight
      if (circuit.halfOpenProbeInFlight) {
        this.reject(key);
      }

      // Reject if we've used all allowed probes
      if (circuit.halfOpenProbesUsed >= maxProbes) {
        this.reject(key);
      }

      circuit.halfOpenProbesUsed += 1;
      circuit.halfOpenProbeInFlight = true;
      const startedAt = Date.now();

      try {
        const result = await operation();
        // Probe succeeded: transition to CLOSED
        circuit.state = 'CLOSED';
        circuit.failureCount = 0;
        circuit.halfOpenProbeInFlight = false;
        this.logger.log(
          `Circuit ${key}: HALF_OPEN -> CLOSED (probe succeeded)`,
        );
        this.safe(() =>
          this.metrics.onCallSuccess?.(key, Date.now() - startedAt),
        );
        this.safe(() =>
          this.metrics.onStateChange?.(key, 'HALF_OPEN', 'CLOSED'),
        );
        return result;
      } catch (error) {
        circuit.halfOpenProbeInFlight = false;
        this.safe(() =>
          this.metrics.onCallFailure?.(key, Date.now() - startedAt, error),
        );
        // Probe failed: transition back to OPEN with a fresh cooldown.
        // Non-retryable errors must not keep the circuit open forever;
        // keep the existing cooldown timestamp in that case.
        circuit.state = 'OPEN';
        if (this.classifier(error)) {
          circuit.lastFailureTime = Date.now();
          this.logger.warn(`Circuit ${key}: HALF_OPEN -> OPEN (probe failed)`);
        } else {
          this.logger.warn(
            `Circuit ${key}: HALF_OPEN -> OPEN (probe non-retryable, keeping cooldown)`,
          );
        }
        this.safe(() => this.metrics.onStateChange?.(key, 'HALF_OPEN', 'OPEN'));
        throw error;
      }
    }

    // CLOSED state: execute normally
    const startedAt = Date.now();
    try {
      const result = await operation();
      // Success clears failure count
      circuit.failureCount = 0;
      this.safe(() =>
        this.metrics.onCallSuccess?.(key, Date.now() - startedAt),
      );
      return result;
    } catch (error) {
      // Classify the error
      if (this.classifier(error)) {
        circuit.failureCount += 1;

        // Threshold breach: transition to OPEN
        if (circuit.failureCount >= config.failureThreshold) {
          circuit.state = 'OPEN';
          circuit.lastFailureTime = Date.now();
          this.logger.warn(
            `Circuit ${key}: CLOSED -> OPEN (failures=${circuit.failureCount}/${config.failureThreshold})`,
          );
          this.safe(() => this.metrics.onStateChange?.(key, 'CLOSED', 'OPEN'));
        }
      }
      this.safe(() =>
        this.metrics.onCallFailure?.(key, Date.now() - startedAt, error),
      );
      throw error;
    }
  }

  /**
   * Get the current state of a circuit.
   */
  getState(key: string): CircuitState {
    const circuit = this.circuits.get(key);
    return circuit?.state ?? 'CLOSED';
  }

  /**
   * Reset a specific circuit or all circuits.
   * Clears failure counts and restores CLOSED state.
   */
  reset(key?: string): void {
    if (key) {
      const circuit = this.circuits.get(key);
      if (circuit) {
        const previous = circuit.state;
        circuit.state = 'CLOSED';
        circuit.failureCount = 0;
        circuit.lastFailureTime = 0;
        circuit.halfOpenProbesUsed = 0;
        circuit.halfOpenProbeInFlight = false;
        this.logger.log(`Circuit ${key} reset to CLOSED`);
        this.safe(() => this.metrics.onStateChange?.(key, previous, 'CLOSED'));
      }
    } else {
      this.circuits.clear();
      this.logger.log('All circuits reset');
    }
  }

  private getOrCreateCircuit(key: string): CircuitState_ {
    let circuit = this.circuits.get(key);
    if (!circuit) {
      circuit = {
        state: 'CLOSED',
        failureCount: 0,
        lastFailureTime: 0,
        halfOpenProbesUsed: 0,
        halfOpenProbeInFlight: false,
      };
      this.circuits.set(key, circuit);
    }
    return circuit;
  }

  private validateConfig(config: CircuitBreakerConfig): void {
    if (!config.failureThreshold || config.failureThreshold <= 0) {
      throw new Error('failureThreshold must be a positive number');
    }
    if (!config.cooldownMs || config.cooldownMs <= 0) {
      throw new Error('cooldownMs must be a positive number');
    }
    if (config.halfOpenProbes !== undefined && config.halfOpenProbes <= 0) {
      throw new Error('halfOpenProbes must be a positive number');
    }
  }

  private createProviderUnavailableError(_key: string): Error {
    const error = new Error('Provider temporarily unavailable') as Error &
      CircuitBreakerError;
    error.code = 'PROVIDER_UNAVAILABLE';
    error.message = 'Provider temporarily unavailable';
    error.retryable = true;
    error.aborted = false;
    return error;
  }

  /** Reject a call without invoking the provider, recording the decision. */
  private reject(key: string): never {
    this.safe(() => this.metrics.onCallRejected?.(key));
    throw this.createProviderUnavailableError(key);
  }

  /** Metrics callbacks must never change the outcome of a provider call. */
  private safe(callback: () => void | Promise<void>): void {
    try {
      const result = callback();
      if (result && typeof result.then === 'function') {
        result.catch((error: unknown) => {
          this.logger.error(
            `Circuit breaker metrics callback failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
      }
    } catch (error) {
      this.logger.error(
        `Circuit breaker metrics callback failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
