#!/usr/bin/env node
/**
 * OPS-15 benchmark harness (PERF-01).
 *
 * Design constraints:
 * - Zero runtime dependencies (node:http/node:https + node:test in Node 22+).
 * - Fake provider is the default; live provider requires explicit opt-in, a
 *   non-production base URL and a positive request cap.
 * - Bounded virtual-user workers, per-step AbortController and drain.
 * - Reports are written only when a run actually happens; --dry-run writes
 *   nothing and makes no network calls.
 *
 * This script measures what the server reports. It does NOT by itself verify
 * server-side invariants (ledger, SRS events, duplicate settlement). See
 * docs/benchmarks/README.md and docs/load-test-plan.md for the manual checks.
 */

import http from 'node:http';
import https from 'node:https';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

export const DEFAULTS = Object.freeze({
  baseUrl: 'http://127.0.0.1:3001',
  steps: [10, 25, 50, 100],
  warmupMs: 1000,
  steadyMs: 3000,
  rampMs: 500,
  scenario: 'all',
  mode: 'fake',
  out: 'docs/benchmarks',
  concurrencyCap: 100,
  requestTimeoutMs: 10000,
  maxSseBytes: 1048576,
  maxRequests: 200,
  sseTerminalTimeoutMs: 15000,
  seed: 'ops-15',
});

const SCENARIOS = new Set(['read', 'srs', 'chat-sse', 'all']);
const MODES = new Set(['fake', 'live']);
const STRING_FLAGS = new Set([
  'base-url',
  'steps',
  'warmup-ms',
  'steady-ms',
  'ramp-ms',
  'scenario',
  'mode',
  'out',
  'concurrency-cap',
  'request-timeout-ms',
  'max-sse-bytes',
  'max-requests',
  'sse-terminal-timeout-ms',
  'seed',
  'login-email',
  'login-password-env',
  'deck-id',
]);
const BOOL_FLAGS = new Set([
  'dry-run',
  'json',
  'allow-live',
  'allow-non-loopback',
  'help',
]);

export const HELP = `Usage: node scripts/benchmark.mjs [options]

Benchmark scenarios with bounded concurrency steps. No network calls in
--dry-run. Fake provider mode is the default; live provider calls require
--mode live --allow-live --max-requests <n> and an explicit non-production
base URL.

Options:
  --base-url URL            Target API origin (default ${DEFAULTS.baseUrl})
  --steps 10,25,50,100      Concurrent virtual users per step
  --warmup-ms N             Warm-up duration per step, ms (default ${DEFAULTS.warmupMs})
  --steady-ms N             Measured steady-state duration per step, ms (default ${DEFAULTS.steadyMs})
  --ramp-ms N               Worker start spacing per step, ms (default ${DEFAULTS.rampMs})
  --scenario read|srs|chat-sse|all   Scenario set (default all)
  --mode fake|live          fake = local/mock provider; live = real provider
  --allow-live              Required acknowledgement for live mode
  --allow-non-loopback      Required acknowledgement for non-loopback base URL
  --max-requests N          Positive global request cap; required in live mode
  --login-email EMAIL       Test user email (fake default: benchmark@example.test)
  --login-password-env NAME Env var NAME holding the test password; value is never printed
  --deck-id UUID            Test deck UUID for srs scenario
  --out DIR                 Report directory (default ${DEFAULTS.out})
  --concurrency-cap N       Max simultaneous VU workers across a step
  --request-timeout-ms N    Per-request timeout
  --sse-terminal-timeout-ms N  Max time to wait for terminal SSE event
  --max-sse-bytes N         Max bytes per SSE response
  --seed TEXT               Synthetic-data seed (no real user data)
  --json                    Emit machine-readable JSON summary on stdout
  --dry-run                 Validate config and print it; no network, no files
  --help                    Show this help
`;

/** Parse argv into a plain object. Unknown flags and bare arguments are errors. */
export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    const eq = arg.indexOf('=');
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    const inline = eq === -1 ? undefined : arg.slice(eq + 1);
    if (BOOL_FLAGS.has(name)) {
      if (inline !== undefined) {
        throw new Error(`--${name} does not take a value`);
      }
      out[name] = true;
      continue;
    }
    if (!STRING_FLAGS.has(name)) {
      throw new Error(`Unknown option: --${name}`);
    }
    const value = inline !== undefined ? inline : argv[++i];
    if (value === undefined || value === '' || value.startsWith('--')) {
      throw new Error(`--${name} requires a value`);
    }
    out[name] = value;
  }
  return out;
}

/** Parse and validate a comma-separated list of concurrency steps. */
export function parseSteps(input = DEFAULTS.steps.join(',')) {
  const parts = String(input)
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) {
    throw new Error('--steps must contain at least one concurrency value');
  }
  const steps = parts.map((part) => {
    if (!/^\d+$/.test(part)) {
      throw new Error(`Invalid concurrency step: ${part}`);
    }
    const value = Number(part);
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error(`Concurrency step out of range: ${part}`);
    }
    return value;
  });
  if (new Set(steps).size !== steps.length) {
    throw new Error('--steps contains duplicate values');
  }
  return steps.sort((a, b) => a - b);
}

/** Parse a non-negative finite integer option. */
export function parseNonNegativeInt(value, label) {
  const text = String(value);
  if (!/^\d+$/.test(text)) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${label} is out of range`);
  }
  return parsed;
}

/** Parse a positive finite integer option. */
export function parsePositiveInt(value, label) {
  const parsed = parseNonNegativeInt(value, label);
  if (parsed <= 0) {
    throw new Error(`${label} must be greater than zero`);
  }
  return parsed;
}

function readEnvValue(name) {
  if (!name || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error('--login-password-env must be a valid environment variable name');
  }
  return process.env[name] ?? '';
}

export function isLoopbackUrl(baseUrl) {
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error('--base-url must be an absolute URL');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('--base-url must use http or https');
  }
  if (url.username || url.password) {
    throw new Error('--base-url must not contain credentials');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host.endsWith('.localhost')
  );
}

function isProductionLikeUrl(baseUrl) {
  let host;
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return true;
  }
  host = host.replace(/^\[|\]$/g, '');
  if (isLoopbackUrl(baseUrl)) return false;
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.test')) {
    return false;
  }
  // Conservative deny-by-default: unknown hosts cannot opt into live mode.
  return true;
}

/**
 * Validate all CLI flags and return a normalized config. No I/O is performed.
 * Environment variable *values* are never echoed into the config object.
 */
export function buildConfig(argv = []) {
  const raw = parseArgs(argv);
  if (raw.help) return { help: true };
  const config = {
    baseUrl: raw['base-url'] ?? DEFAULTS.baseUrl,
    steps: parseSteps(raw.steps ?? DEFAULTS.steps.join(',')),
    warmupMs: parseNonNegativeInt(raw['warmup-ms'] ?? DEFAULTS.warmupMs, '--warmup-ms'),
    steadyMs: parseNonNegativeInt(raw['steady-ms'] ?? DEFAULTS.steadyMs, '--steady-ms'),
    rampMs: parseNonNegativeInt(raw['ramp-ms'] ?? DEFAULTS.rampMs, '--ramp-ms'),
    scenario: raw.scenario ?? DEFAULTS.scenario,
    mode: raw.mode ?? DEFAULTS.mode,
    out: raw.out ?? DEFAULTS.out,
    concurrencyCap: parsePositiveInt(raw['concurrency-cap'] ?? DEFAULTS.concurrencyCap, '--concurrency-cap'),
    requestTimeoutMs: parsePositiveInt(raw['request-timeout-ms'] ?? DEFAULTS.requestTimeoutMs, '--request-timeout-ms'),
    maxSseBytes: parsePositiveInt(raw['max-sse-bytes'] ?? DEFAULTS.maxSseBytes, '--max-sse-bytes'),
    maxRequests: raw['max-requests'] === undefined
      ? DEFAULTS.maxRequests
      : parsePositiveInt(raw['max-requests'], '--max-requests'),
    sseTerminalTimeoutMs: parsePositiveInt(raw['sse-terminal-timeout-ms'] ?? DEFAULTS.sseTerminalTimeoutMs, '--sse-terminal-timeout-ms'),
    seed: raw.seed ?? DEFAULTS.seed,
    loginEmail: raw['login-email'] ?? 'benchmark@example.test',
    loginPasswordEnv: raw['login-password-env'] ?? null,
    deckId: raw['deck-id'] ?? null,
    allowLive: Boolean(raw['allow-live']),
    allowNonLoopback: Boolean(raw['allow-non-loopback']),
    dryRun: Boolean(raw['dry-run']),
    json: Boolean(raw.json),
  };

  if (!SCENARIOS.has(config.scenario)) {
    throw new Error(`--scenario must be one of ${[...SCENARIOS].join(', ')}`);
  }
  if (!MODES.has(config.mode)) {
    throw new Error('--mode must be fake or live');
  }
  if (config.steadyMs === 0 && config.warmupMs === 0) {
    throw new Error('--steady-ms and --warmup-ms cannot both be zero');
  }
  const maxStep = Math.max(...config.steps);
  if (maxStep > config.concurrencyCap) {
    throw new Error(
      `Concurrency step ${maxStep} exceeds --concurrency-cap ${config.concurrencyCap}`,
    );
  }

  const loopback = isLoopbackUrl(config.baseUrl);
  if (!loopback && !config.allowNonLoopback) {
    throw new Error(
      'Non-loopback base URL requires --allow-non-loopback; benchmark targets must be explicitly authorized',
    );
  }

  if (config.mode === 'live') {
    if (!config.allowLive) {
      throw new Error('Live provider mode requires --allow-live');
    }
    if (isProductionLikeUrl(config.baseUrl)) {
      throw new Error(
        'Live provider mode requires an explicit non-production base URL (loopback, .local, .internal or .test)',
      );
    }
    if (raw['max-requests'] === undefined) {
      throw new Error('Live provider mode requires an explicit --max-requests <n>');
    }
    if (!config.loginPasswordEnv) {
      throw new Error('Live provider mode requires --login-password-env <NAME> for a dedicated test account');
    }
    if (!readEnvValue(config.loginPasswordEnv)) {
      throw new Error(`Environment variable ${config.loginPasswordEnv} is empty or missing`);
    }
    config.warnings = [
      'LIVE PROVIDER MODE: requests may incur real cost.',
      'Only use an authorized test account and a pre-approved quota.',
      'Review docs/benchmarks/README.md before proceeding.',
    ];
  } else {
    if (config.allowLive) {
      throw new Error('--allow-live is only meaningful with --mode live; no automatic fallback exists');
    }
    config.loginPasswordEnv ??= 'BENCHMARK_LOGIN_PASSWORD';
    config.warnings = [];
  }

  config.loopback = loopback;
  return config;
}

/** Nearest-rank percentile on an ascending sorted numeric array. */
export function percentile(sortedValues, q) {
  if (!Array.isArray(sortedValues) || sortedValues.length === 0) {
    throw new Error('percentile requires a non-empty array');
  }
  if (!Number.isFinite(q) || q <= 0 || q >= 1) {
    throw new Error('percentile q must be strictly between 0 and 1');
  }
  const rank = Math.ceil(q * sortedValues.length);
  return sortedValues[Math.max(0, Math.min(sortedValues.length - 1, rank - 1))];
}

/** Reset counters so one percentile report describes exactly one time window. */
export function resetMeasurements(measurements) {
  measurements.samples = [];
  measurements.outcomes = Object.create(null);
  measurements.errors = Object.create(null);
  measurements.statuses = Object.create(null);
  measurements.bytes = 0;
  measurements.startedAt = performance.now();
}

export function createMeasurements() {
  const measurements = {
    samples: [],
    outcomes: Object.create(null),
    errors: Object.create(null),
    statuses: Object.create(null),
    bytes: 0,
    startedAt: performance.now(),
  };
  return measurements;
}

function increment(bucket, key) {
  bucket[key] = (bucket[key] ?? 0) + 1;
}

export function recordOutcome(measurements, outcome, detail = '') {
  increment(measurements.outcomes, outcome);
  if (detail) increment(measurements.errors, detail);
}

export function summarize(measurements) {
  const sorted = measurements.samples.slice().sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  const durationMs = Math.max(0, performance.now() - measurements.startedAt);
  return {
    count: sorted.length,
    durationMs: round(durationMs),
    throughputPerSec: durationMs > 0 ? round((sorted.length * 1000) / durationMs) : 0,
    latencyMs: sorted.length
      ? {
          p50: round(percentile(sorted, 0.5)),
          p95: round(percentile(sorted, 0.95)),
          p99: round(percentile(sorted, 0.99)),
          mean: round(total / sorted.length),
          max: round(sorted[sorted.length - 1]),
        }
      : null,
    outcomes: { ...measurements.outcomes },
    errors: { ...measurements.errors },
    statuses: { ...measurements.statuses },
    bytes: measurements.bytes,
  };
}

function round(value) {
  return Math.round(value * 100) / 100;
}

/** Buffer arbitrary TCP chunks into SSE lines; handles CRLF and split UTF-8. */
export class SseLineParser {
  constructor(maxBytes = DEFAULTS.maxSseBytes) {
    this.decoder = new TextDecoder('utf-8');
    this.buffer = '';
    this.bytes = 0;
    this.maxBytes = maxBytes;
    this.overflow = false;
  }

  push(chunk) {
    this.bytes += chunk.byteLength;
    if (this.bytes > this.maxBytes) {
      this.overflow = true;
      return [];
    }
    const text = this.decoder.decode(chunk, { stream: true });
    this.buffer += text;
    const lines = [];
    let index;
    while ((index = this.buffer.indexOf('\n')) !== -1) {
      let line = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      lines.push(line);
    }
    return lines;
  }

  flush() {
    const text = this.decoder.decode();
    this.buffer += text;
    if (this.buffer.length === 0) return [];
    const line = this.buffer.endsWith('\r')
      ? this.buffer.slice(0, -1)
      : this.buffer;
    this.buffer = '';
    return [line];
  }
}

/**
 * Parse SSE lines into events. Event sequences are stable across chunk
 * boundaries. Terminal events are `completed` and `failed`; comments and
 * unknown fields are ignored. Emits `{ event, data }` objects.
 */
export function parseSseEvents(lines) {
  const events = [];
  let event = 'message';
  let dataLines = [];
  for (const line of lines) {
    if (line === '') {
      if (dataLines.length > 0) {
        let data = dataLines.join('\n');
        dataLines = [];
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = data;
        }
        events.push({ event, data: parsed });
      }
      event = 'message';
      continue;
    }
    if (line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') dataLines.push(value);
    // id/retry fields are intentionally ignored; they do not affect results.
  }
  return events;
}

export function isTerminalEvent(event) {
  return event === 'completed' || event === 'failed';
}

/** Remove secrets and identifiers from strings before writing them to a report. */
export function redact(text, secrets = []) {
  let result = String(text);
  const patterns = [
    /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
    /(api[_-]?key|token|password|secret|authorization)\s*[:=]\s*["']?[^"'\s,;}]+/gi,
    /sk-[A-Za-z0-9_-]{8,}/gi,
    /gsk_[A-Za-z0-9_-]{8,}/gi,
  ];
  for (const pattern of patterns) {
    result = result.replace(pattern, (match, group) =>
      group ? `${group}: [REDACTED]` : '[REDACTED]',
    );
  }
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length >= 4) {
      result = result.split(secret).join('[REDACTED]');
    }
  }
  return result;
}

function safeErrorMessage(error) {
  if (!error) return 'unknown';
  return redact(String(error?.message ?? error));
}

/** Perform an HTTP request with a timeout, byte cap and AbortSignal support. */
function request({ url, method, headers = {}, body, signal, timeoutMs, maxBytes }) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;
    const controller = new AbortController();
    const onOuterAbort = () => controller.abort();
    signal?.addEventListener('abort', onOuterAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onOuterAbort);
      fn(value);
    };

    const req = transport.request(
      parsed,
      {
        method,
        headers: { Accept: 'application/json', ...headers },
        signal: controller.signal,
      },
      (res) => {
        const chunks = [];
        let bytes = 0;
        let overflow = false;
        res.on('data', (chunk) => {
          bytes += chunk.byteLength;
          if (bytes > maxBytes) {
            overflow = true;
            controller.abort();
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          if (overflow) {
            finish(reject, new Error(`Response exceeded ${maxBytes} bytes`));
            return;
          }
          finish(resolve, {
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
        res.on('error', (error) => finish(reject, error));
      },
    );
    req.on('error', (error) => {
      finish(reject, controller.signal.aborted && !signal?.aborted
        ? new Error(`Request timeout after ${timeoutMs}ms`)
        : error);
    });
    if (body !== undefined) req.write(body);
    req.end();
  });
}

function jsonBody(response) {
  try {
    return JSON.parse(response.body.toString('utf8'));
  } catch {
    return null;
  }
}

async function login(config, signal) {
  const password = readEnvValue(config.loginPasswordEnv);
  const response = await request({
    url: new URL('/api/v1/auth/login', config.baseUrl).toString(),
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: config.loginEmail, password }),
    signal,
    timeoutMs: config.requestTimeoutMs,
    maxBytes: config.maxSseBytes,
  });
  if (response.status !== 200) {
    throw new Error(`Login failed with HTTP ${response.status}`);
  }
  const payload = jsonBody(response);
  const token = payload?.accessToken ?? payload?.access_token ?? payload?.token;
  if (!token) throw new Error('Login response did not contain an access token');
  return token;
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

function syntheticDeckId(config, token) {
  if (config.deckId) return config.deckId;
  // Deterministic UUID-shaped value derived from the seed; the operator must
  // seed this deck. No real user data is used or printed.
  let hash = 2166136261;
  for (const char of `${config.seed}:${token.slice(0, 0)}`) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  }
  const hex = hash.toString(16).padStart(8, '0').repeat(4).slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

async function timedRequest(measurements, config, args, token, label) {
  const started = performance.now();
  try {
    const response = await request({
      ...args,
      headers: { ...authHeaders(token), ...args.headers },
      timeoutMs: config.requestTimeoutMs,
      maxBytes: config.maxSseBytes,
    });
    measurements.samples.push(performance.now() - started);
    const key = `${label}:${response.status}`;
    increment(measurements.statuses, key);
    if (response.status >= 500) {
      recordOutcome(measurements, 'server_error', key);
    } else if (response.status === 429) {
      recordOutcome(measurements, 'rate_limited', key);
    } else if (response.status >= 400) {
      recordOutcome(measurements, 'client_error', key);
    } else {
      recordOutcome(measurements, 'success');
    }
    return response;
  } catch (error) {
    recordOutcome(measurements, 'transport_error', safeErrorMessage(error));
    return null;
  }
}

async function runReadIteration(config, token, measurements, signal, vuIndex, iteration) {
  const url = new URL('/api/v1/tokens/balance', config.baseUrl).toString();
  const response = await timedRequest(
    measurements,
    config,
    { url, method: 'GET' },
    token,
    'tokens.balance',
  );
  if (response && iteration % 20 === 0) {
    const url2 = new URL('/api/v1/tokens/history', config.baseUrl).toString();
    await timedRequest(measurements, config, { url: url2, method: 'GET' }, token, 'tokens.history');
  }
  void vuIndex;
}

async function runSrsIteration(config, token, measurements, signal, vuIndex) {
  const deck = syntheticDeckId(config, token);
  const url = new URL('/api/v1/srs/due-cards', config.baseUrl);
  url.searchParams.set('deckId', deck);
  url.searchParams.set('limit', '20');
  await timedRequest(
    measurements,
    config,
    { url: url.toString(), method: 'GET' },
    token,
    'srs.dueCards',
  );
  void vuIndex;
}

/**
 * POST /api/v1/chat/stream and read to a terminal SSE event. TTFT is recorded
 * separately from the request total. `signal` aborts on timeout/step stop.
 * Returns { terminal, ttftMs, totalMs, deltas, seqGaps }.
 */
export async function runSseRequest({ url, token, key, signal, timeoutMs, terminalTimeoutMs, maxBytes, body, onEvent }) {
  const started = performance.now();
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  // One overall timer: the terminal timeout bounds how long we wait after
  // headers are flushed; the request timeout bounds connection setup + body.
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, Math.max(timeoutMs, terminalTimeoutMs));
  let timedOut = false;

  let bytes = 0;
  let ttftMs = null;
  let firstEventSeen = false;
  let terminal = null;
  let status = 0;
  let seqGaps = 0;
  let lastSeq = 0;
  let deltas = 0;

  try {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;
    await new Promise((resolve, reject) => {
      const req = transport.request(
        parsed,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
            'Idempotency-Key': key,
            ...authHeaders(token),
          },
          signal: controller.signal,
        },
        (res) => {
          status = res.statusCode ?? 0;
          if (status < 200 || status >= 300) {
            res.resume();
            resolve();
            return;
          }
          const parser = new SseLineParser(maxBytes);
          let settled = false;
          const done = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve();
          };
          res.on('data', (chunk) => {
            bytes += chunk.byteLength;
            if (parser.bytes > maxBytes) {
              timedOut = false;
              done();
              controller.abort();
              res.destroy();
              return;
            }
            const lines = parser.push(chunk);
            for (const event of parseSseEvents(lines)) {
              if (!firstEventSeen) {
                firstEventSeen = true;
                ttftMs = performance.now() - started;
              }
              onEvent?.(event);
              if (event.event === 'delta') {
                deltas += 1;
                const seq = Number(event.data?.seq);
                if (Number.isFinite(seq)) {
                  if (seq !== lastSeq + 1) seqGaps += 1;
                  lastSeq = seq;
                }
              }
              if (isTerminalEvent(event.event)) {
                terminal = event.event;
                done();
                res.destroy();
                return;
              }
            }
          });
          res.on('end', done);
          res.on('error', (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(error);
          });
          res.on('aborted', done);
        },
      );
      req.on('error', (error) => reject(error));
      req.end(typeof body === 'string' ? body : JSON.stringify(body));
    });
  } catch (error) {
    if (timedOut) terminal = 'timeout';
    else if (terminal === null) terminal = safeErrorMessage(error);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
  if (terminal === null && timedOut) terminal = 'timeout';
  if (terminal === null && (status < 200 || status >= 300)) {
    terminal = `http_${status}`;
  }
  if (terminal === null) terminal = 'eof_without_terminal';
  return {
    terminal,
    status,
    ttftMs: ttftMs === null ? null : round(ttftMs),
    totalMs: round(performance.now() - started),
    deltas,
    seqGaps,
    bytes,
  };
}

async function runChatSseIteration(config, token, measurements, signal, vuIndex, iteration, sseStats) {
  const key = `bench-${config.seed}-${vuIndex}-${iteration}-${randomUUID().slice(0, 8)}`;
  const url = new URL('/api/v1/chat/stream', config.baseUrl).toString();
  const result = await runSseRequest({
    url,
    token,
    key,
    signal,
    timeoutMs: config.requestTimeoutMs,
    terminalTimeoutMs: config.sseTerminalTimeoutMs,
    maxBytes: config.maxSseBytes,
    body: {
      message: 'Say hello in the target language.',
      language: 'english',
      idempotencyKey: key,
    },
  });
  measurements.samples.push(result.totalMs);
  measurements.bytes += result.bytes;
  if (result.ttftMs !== null) sseStats.ttft.push(result.ttftMs);
  increment(measurements.statuses, `chat.stream:${result.terminal}`);
  if (result.terminal === 'completed') {
    recordOutcome(measurements, 'success');
  } else if (result.terminal === 'failed') {
    recordOutcome(measurements, 'sse_failed_event');
  } else {
    recordOutcome(measurements, 'sse_incomplete', redact(String(result.terminal)));
  }
  if (result.seqGaps > 0) {
    recordOutcome(measurements, 'sse_seq_gap', String(result.seqGaps));
  }
  sseStats.deltas += result.deltas;
  sseStats.gaps += result.seqGaps;
}

const SCENARIO_RUNNERS = {
  read: runReadIteration,
  srs: runSrsIteration,
  'chat-sse': runChatSseIteration,
};

function selectRunners(scenario) {
  if (scenario === 'all') {
    return [runReadIteration, runSrsIteration, runChatSseIteration];
  }
  return [SCENARIO_RUNNERS[scenario]];
}

const sleep = (ms, signal) => new Promise((resolve) => {
  if (ms <= 0) return resolve();
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => {
    clearTimeout(timer);
    resolve();
  }, { once: true });
});

/**
 * Run one concurrency step. Workers are bounded by `step` and by
 * `config.concurrencyCap`; each worker loops until the AbortController fires.
 */
async function runStep(config, step, token, phases, requestCounter) {
  const controller = new AbortController();
  const measurements = createMeasurements();
  const sseStats = { ttft: [], deltas: 0, gaps: 0 };
  const runners = selectRunners(config.scenario);
  const started = performance.now();
  const stopAt = started
    + (config.rampMs * Math.max(0, step - 1))
    + phases.warmupMs
    + phases.steadyMs;

  const abortTimer = setTimeout(() => controller.abort(), stopAt);
  const phaseTimer = setTimeout(() => resetMeasurements(measurements),
    started + config.rampMs * Math.max(0, step - 1) + phases.warmupMs);

  const workers = [];
  for (let vu = 0; vu < step; vu += 1) {
    workers.push((async () => {
      await sleep(config.rampMs * vu, controller.signal);
      let iteration = 0;
      let runnerIndex = vu % runners.length;
      while (!controller.signal.aborted && requestCounter.value < config.maxRequests) {
        const runner = runners[runnerIndex % runners.length];
        runnerIndex += 1;
        iteration += 1;
        if (!config.dryRun) {
          requestCounter.value += 1;
          await runner(config, token, measurements, controller.signal, vu, iteration, sseStats);
        }
        await sleep(5, controller.signal);
      }
    })());
  }
  await Promise.allSettled(workers);
  clearTimeout(abortTimer);
  clearTimeout(phaseTimer);

  const summary = summarize(measurements);
  const ttftSorted = sseStats.ttft.slice().sort((a, b) => a - b);
  return {
    concurrency: step,
    summary,
    sse: {
      ttftMs: ttftSorted.length
        ? {
            p50: round(percentile(ttftSorted, 0.5)),
            p95: round(percentile(ttftSorted, 0.95)),
            p99: round(percentile(ttftSorted, 0.99)),
          }
        : null,
      deltas: sseStats.deltas,
      sequenceGaps: sseStats.gaps,
    },
    latencyNote:
      'Latency is measured client-side and includes network + server time; '
      + 'no p95 SLO is asserted by this harness.',
  };
}

/** Collect local resource signals. Not a substitute for server-side metrics. */
function resourceSnapshot() {
  const lag = process.resourceUsage?.().userCPUTime ?? 0;
  return {
    rssBytes: process.memoryUsage().rss,
    heapUsedBytes: process.memoryUsage().heapUsed,
    userCpuMicros: round(lag / 1000),
    eventLoopLagMs: round(performance.now() - Math.round(performance.now())),
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    cpus: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
  };
}

function gitMeta() {
  const run = (args) => {
    try {
      return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      return 'unknown';
    }
  };
  return { head: run(['rev-parse', 'HEAD']), branch: run(['rev-parse', '--abbrev-ref', 'HEAD']) };
}

function toolVersions() {
  return {
    node: process.version,
    pnpm: (() => {
      const env = process.env.npm_config_user_agent ?? '';
      const match = /pnpm\/([^\s]+)/.exec(env);
      return match ? match[1] : 'not detected (run via pnpm to record version)';
    })(),
  };
}

async function packageDescription(dir) {
  try {
    const raw = await readFile(path.join(dir, 'package.json'), 'utf8');
    const pkg = JSON.parse(raw);
    return pkg.name ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function configForReport(config) {
  return {
    baseUrl: new URL(config.baseUrl).origin,
    mode: config.mode,
    scenario: config.scenario,
    steps: config.steps,
    warmupMs: config.warmupMs,
    steadyMs: config.steadyMs,
    rampMs: config.rampMs,
    concurrencyCap: config.concurrencyCap,
    requestTimeoutMs: config.requestTimeoutMs,
    maxSseBytes: config.maxSseBytes,
    maxRequests: config.maxRequests,
    sseTerminalTimeoutMs: config.sseTerminalTimeoutMs,
    seed: config.seed,
    loginEmail: config.loginEmail,
    loginPasswordEnvName: config.loginPasswordEnv,
    deckId: config.deckId ?? 'not set',
    allowNonLoopback: config.allowNonLoopback,
    allowLive: config.allowLive,
  };
}

function printLines(lines) {
  for (const line of lines) process.stdout.write(`${line}\n`);
}

function formatSummary(report) {
  const lines = [
    `Benchmark config: ${report.config.mode}/${report.config.scenario} steps=${report.config.steps.join(',')}`,
    `HEAD ${report.provenance.git.head} (${report.provenance.git.branch})`,
  ];
  for (const step of report.steps) {
    const s = step.summary;
    lines.push(
      `  ${step.concurrency} VU: n=${s.count} p50=${s.latencyMs?.p50 ?? '-'}ms `
      + `p95=${s.latencyMs?.p95 ?? '-'}ms p99=${s.latencyMs?.p99 ?? '-'}ms `
      + `rps=${s.throughputPerSec} outcomes=${JSON.stringify(s.outcomes)}`,
    );
  }
  lines.push(`Report: ${report.reportPath ?? 'not written'}`);
  return lines;
}

export async function main(argv = process.argv.slice(2)) {
  let config;
  try {
    config = buildConfig(argv);
  } catch (error) {
    process.stderr.write(`benchmark: ${safeErrorMessage(error)}\n`);
    return 2;
  }
  if (config.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (config.json) {
    // --json with --dry-run emits the full config; with a real run the report
    // object is emitted after completion.
    if (config.dryRun) {
      process.stdout.write(`${JSON.stringify({
        dryRun: true,
        config: configForReport(config),
        warnings: config.warnings,
        loops: config.steps.map((concurrency) => ({
          concurrency,
          warmupMs: config.warmupMs,
          steadyMs: config.steadyMs,
          rampMs: config.rampMs,
        })),
      }, null, 2)}\n`);
      return 0;
    }
  }

  if (config.dryRun) {
    printLines([
      'DRY RUN — no network requests, no report files written.',
      ...config.warnings,
      ...formatSummary({
        config: configForReport(config),
        provenance: { git: gitMeta() },
        steps: config.steps.map((concurrency) => ({
          concurrency,
          summary: { count: 0, throughputPerSec: 0, latencyMs: null, outcomes: {} },
        })),
      }),
      `Loops: ${config.steps.map((c) => `${c} VU (warmup ${config.warmupMs}ms steady ${config.steadyMs}ms ramp ${config.rampMs}ms)`).join(' | ')}`,
    ]);
    return 0;
  }

  const requestCounter = { value: 0 };
  const phases = { warmupMs: config.warmupMs, steadyMs: config.steadyMs };
  const startedAt = new Date().toISOString();
  const token = await login(config, null);
  const steps = [];
  for (const step of config.steps) {
    if (requestCounter.value >= config.maxRequests) {
      process.stderr.write(`benchmark: request cap ${config.maxRequests} reached; skipping remaining steps\n`);
      break;
    }
    const result = await runStep(config, step, token, phases, requestCounter);
    steps.push(result);
  }

  const report = {
    schema: 'ops-15-benchmark/v1',
    status: 'RUN_FAKE_PROVIDER_OR_LIVE_OPT_IN',
    provenance: {
      roadmap: 'PERF-01 / OPS-15',
      git: gitMeta(),
      startedAt,
      finishedAt: new Date().toISOString(),
      tools: toolVersions(),
      machine: {
        platform: os.platform(),
        arch: os.arch(),
        osRelease: os.release(),
        cpus: os.cpus().length,
        totalMemoryBytes: os.totalmem(),
      },
      envVariableNames: ['NODE_ENV', 'APP_ENV', config.loginPasswordEnv],
      note: 'Only environment variable NAMES are recorded; values are never stored.',
      dataset: {
        seed: config.seed,
        description: 'Synthetic fixtures only; no production data. Deck/user/card seeding is operator responsibility.',
        apiPackage: await packageDescription(path.resolve('apps/api')),
        aiServicePackage: await packageDescription(path.resolve('apps/ai-service')),
      },
      command: process.argv.slice(2).map((arg) => redact(arg)),
      limitations: [
        'Client-side latency only; server-side DB pool, queue depth and GC need separate instrumentation.',
        'No automatic SLO pass/fail: thresholds are proposed and must be reviewed against provenance.',
        'Invariants (ledger, SRS events, duplicate settlement) require manual checks per docs/load-test-plan.md.',
        'VU workers use a small fixed pacing delay and are not a full browser/js workload model.',
      ],
    },
    config: configForReport(config),
    warnings: config.warnings,
    resource: resourceSnapshot(),
    steps,
  };

  if (config.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  }

  let reportPath = null;
  try {
    const { mkdir, writeFile } = await import('node:fs/promises');
    const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${config.mode}-${config.scenario}`;
    const dir = path.resolve(config.out);
    await mkdir(dir, { recursive: true });
    reportPath = path.join(dir, `${runId}.json`);
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  } catch (error) {
    process.stderr.write(`benchmark: could not write report: ${safeErrorMessage(error)}\n`);
    return 1;
  }
  printLines(formatSummary({ ...report, reportPath }));
  return 0;
}

import { fileURLToPath } from 'node:url';
const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  process.exitCode = await main();
}
