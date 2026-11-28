import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import {
  DEFAULTS,
  SseLineParser,
  buildConfig,
  createMeasurements,
  isLoopbackUrl,
  isTerminalEvent,
  parseArgs,
  parseSseEvents,
  parseSteps,
  percentile,
  redact,
  recordOutcome,
  resetMeasurements,
  runSseRequest,
  summarize,
} from './benchmark.mjs';

test('parseArgs handles --flag=value, separate values and booleans', () => {
  assert.deepEqual(
    parseArgs(['--steps', '10,25', '--mode=fake', '--dry-run', '--json']),
    { steps: '10,25', mode: 'fake', 'dry-run': true, json: true },
  );
});

test('parseArgs rejects unknown flags, missing values and bare arguments', () => {
  assert.throws(() => parseArgs(['--nope']), /Unknown option/);
  assert.throws(() => parseArgs(['--steps']), /requires a value/);
  assert.throws(() => parseArgs(['extra']), /Unexpected argument/);
  assert.throws(() => parseArgs(['--dry-run=x']), /does not take a value/);
});

test('parseSteps parses, sorts and validates concurrency steps', () => {
  assert.deepEqual(parseSteps('100,10,25'), [10, 25, 100]);
  assert.deepEqual(parseSteps('1'), [1]);
  assert.throws(() => parseSteps(''), /at least one/);
  assert.throws(() => parseSteps('abc'), /Invalid concurrency/);
  assert.throws(() => parseSteps('0'), /out of range/);
  assert.throws(() => parseSteps('-1'), /Invalid concurrency/);
  assert.throws(() => parseSteps('10,10'), /duplicate/);
});

test('buildConfig defaults to fake mode, loopback URL and no live calls', () => {
  const config = buildConfig([]);
  assert.equal(config.mode, 'fake');
  assert.equal(config.allowLive, false);
  assert.equal(config.baseUrl, DEFAULTS.baseUrl);
  assert.deepEqual(config.steps, [10, 25, 50, 100]);
  assert.equal(config.maxRequests, DEFAULTS.maxRequests);
});

test('buildConfig rejects live mode without all explicit guards', () => {
  assert.throws(() => buildConfig(['--mode', 'live']), /--allow-live/);
  assert.throws(
    () => buildConfig(['--mode', 'live', '--allow-live']),
    /--max-requests/,
  );
  assert.throws(
    () => buildConfig([
      '--mode', 'live', '--allow-live', '--max-requests', '5',
      '--base-url', 'https://api.example.com', '--allow-non-loopback',
    ]),
    /non-production base URL/,
  );
  assert.throws(
    () => buildConfig([
      '--mode', 'live', '--allow-live', '--max-requests', '0',
    ]),
    /greater than zero/,
  );
});

test('buildConfig requires non-loopback acknowledgement in fake mode too', () => {
  assert.throws(
    () => buildConfig(['--base-url', 'http://10.0.0.1:3000']),
    /--allow-non-loopback/,
  );
  assert.equal(
    buildConfig(['--base-url', 'http://10.0.0.1:3000', '--allow-non-loopback']).baseUrl,
    'http://10.0.0.1:3000',
  );
});

test('buildConfig rejects step beyond concurrency cap and invalid durations', () => {
  assert.throws(() => buildConfig(['--concurrency-cap', '5']), /exceeds --concurrency-cap/);
  assert.throws(() => buildConfig(['--warmup-ms', '1.5']), /non-negative integer/);
  assert.throws(() => buildConfig(['--steady-ms', '-1']), /non-negative integer/);
  assert.throws(() => buildConfig(['--warmup-ms', '0', '--steady-ms', '0']), /cannot both be zero/);
  assert.throws(() => buildConfig(['--scenario', 'nope']), /--scenario/);
});

test('isLoopbackUrl recognizes loopback hosts and rejects embedded credentials', () => {
  assert.equal(isLoopbackUrl('http://127.0.0.1:3001'), true);
  assert.equal(isLoopbackUrl('http://localhost:3000'), true);
  assert.equal(isLoopbackUrl('http://[::1]:3000'), true);
  assert.equal(isLoopbackUrl('https://api.example.test'), false);
  assert.throws(() => buildConfig(['--base-url', 'http://user:pass@127.0.0.1']), /credentials/);
  assert.throws(() => buildConfig(['--base-url', 'ftp://127.0.0.1']), /http or https/);
});

test('percentile uses nearest rank and rejects invalid inputs', () => {
  const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(percentile(sorted, 0.5), 5);
  assert.equal(percentile(sorted, 0.95), 10);
  assert.equal(percentile(sorted, 0.99), 10);
  assert.equal(percentile([10], 0.5), 10);
  assert.throws(() => percentile([], 0.5), /non-empty/);
  assert.throws(() => percentile(sorted, 1), /strictly between/);
});

test('resetMeasurements clears samples and counters between warm-up and steady state', () => {
  const measurements = createMeasurements();
  measurements.samples.push(123);
  recordOutcome(measurements, 'server_error', '500');
  measurements.statuses['GET:200'] = 3;
  measurements.bytes = 999;
  assert.equal(summarize(measurements).count, 1);
  resetMeasurements(measurements);
  const summary = summarize(measurements);
  assert.equal(summary.count, 0);
  assert.deepEqual(summary.outcomes, {});
  assert.deepEqual(summary.errors, {});
  assert.deepEqual(summary.statuses, {});
  assert.equal(summary.bytes, 0);
});

test('recordOutcome tracks error breakdown separately from success', () => {
  const measurements = createMeasurements();
  recordOutcome(measurements, 'success');
  recordOutcome(measurements, 'rate_limited', 'chat.stream:429');
  recordOutcome(measurements, 'transport_error', 'ECONNRESET');
  const summary = summarize(measurements);
  assert.deepEqual(summary.outcomes, {
    success: 1,
    rate_limited: 1,
    transport_error: 1,
  });
  assert.deepEqual(summary.errors, {
    'chat.stream:429': 1,
    ECONNRESET: 1,
  });
});

test('SseLineParser handles CRLF, split lines and multibyte UTF-8', () => {
  const parser = new SseLineParser(1024);
  const encoder = new TextEncoder();
  const chunks = [
    encoder.encode('event: accept'),
    encoder.encode('ed\r\ndata: {"a":"'),
    encoder.encode('xéy"}\r\n\r\nevent: compl'),
    encoder.encode('eted\ndata: {"ok":true}\n\n'),
  ];
  const lines = chunks.flatMap((chunk) => parser.push(chunk)).concat(parser.flush());
  const events = parseSseEvents(lines);
  assert.deepEqual(events, [
    { event: 'accepted', data: { a: 'xéy' } },
    { event: 'completed', data: { ok: true } },
  ]);
});

test('SseLineParser splits a multibyte character across chunks', () => {
  const parser = new SseLineParser(1024);
  const bytes = new TextEncoder().encode('data: 😀\n\n');
  const lines = [
    ...parser.push(bytes.subarray(0, 7)),
    ...parser.push(bytes.subarray(7)),
    ...parser.flush(),
  ];
  assert.deepEqual(parseSseEvents(lines), [{ event: 'message', data: '😀' }]);
});

test('parseSseEvents ignores comments and non-data fields', () => {
  const lines = [': ping', 'id: 7', 'retry: 1000', 'event: delta', 'data: {"seq":1}', '', 'data: plain', ''];
  assert.deepEqual(parseSseEvents(lines), [
    { event: 'delta', data: { seq: 1 } },
    { event: 'message', data: 'plain' },
  ]);
});

test('parseSseEvents keeps multiline data as newline-joined JSON', () => {
  const lines = ['event: failed', 'data: {"code":', 'data: "X"}', ''];
  assert.deepEqual(parseSseEvents(lines), [
    { event: 'failed', data: { code: 'X' } },
  ]);
});

test('terminal detection accepts completed/failed only', () => {
  assert.equal(isTerminalEvent('completed'), true);
  assert.equal(isTerminalEvent('failed'), true);
  assert.equal(isTerminalEvent('accepted'), false);
  assert.equal(isTerminalEvent('delta'), false);
  assert.equal(isTerminalEvent('message'), false);
});

test('SseLineParser flags oversized responses', () => {
  const parser = new SseLineParser(4);
  assert.deepEqual(parser.push(new TextEncoder().encode('0123456789')), []);
  assert.equal(parser.overflow, true);
});

test('redact removes bearer tokens, key assignments and known secrets', () => {
  const sample = 'Authorization: Bearer abc.def-123 req api_key: sk-abcdefgh1234 token=zzzz9999';
  const result = redact(sample, ['zzzz9999']);
  assert.doesNotMatch(result, /abc\.def-123/);
  assert.doesNotMatch(result, /sk-abcdefgh1234/);
  assert.doesNotMatch(result, /zzzz9999/);
  assert.match(result, /REDACTED/);
});

test('runSseRequest reads a terminal event from a local mock stream', async (t) => {
  const server = http.createServer((req, res) => {
    assert.equal(req.headers['idempotency-key'], 'test-key');
    assert.equal(req.headers.authorization, 'Bearer test-token');
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    });
    res.write('event: accepted\r\ndata: {"operationId":"op-1"}\r\n\r\n');
    res.write('event: delta\ndata: {"seq":1,"text":"hello"}\n\n');
    res.end('event: completed\ndata: {"operationId":"op-1"}\n\n');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const events = [];
  const result = await runSseRequest({
    url: `http://127.0.0.1:${port}/api/v1/chat/stream`,
    token: 'test-token',
    key: 'test-key',
    timeoutMs: 2000,
    terminalTimeoutMs: 2000,
    maxBytes: 65536,
    body: { message: 'hi' },
    onEvent: (event) => events.push(event.event),
  });
  assert.equal(result.terminal, 'completed');
  assert.equal(result.status, 200);
  assert.equal(result.deltas, 1);
  assert.equal(result.seqGaps, 0);
  assert.ok(result.ttftMs !== null);
  assert.deepEqual(events, ['accepted', 'delta', 'completed']);
});

test('runSseRequest reports EOF without a terminal event', async (t) => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end('event: accepted\ndata: {}\n\n');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const result = await runSseRequest({
    url: `http://127.0.0.1:${port}/stream`,
    token: 'test-token',
    key: 'test-key',
    timeoutMs: 2000,
    terminalTimeoutMs: 2000,
    maxBytes: 65536,
    body: {},
  });
  assert.equal(result.terminal, 'eof_without_terminal');
});

test('runSseRequest reports a non-2xx HTTP response', async (t) => {
  const server = http.createServer((req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end('{"message":"unauthorized"}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const result = await runSseRequest({
    url: `http://127.0.0.1:${port}/stream`,
    token: 'test-token',
    key: 'test-key',
    timeoutMs: 2000,
    terminalTimeoutMs: 2000,
    maxBytes: 65536,
    body: {},
  });
  assert.equal(result.terminal, 'http_401');
});
