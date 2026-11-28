import { describe, expect, it, vi } from 'vitest';
import {
  SseParser,
  parseSseStream,
  type SseChunk,
  type SseOutcome,
} from './sse-parser';

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

interface FakeReader extends ReadableStreamDefaultReader<SseChunk> {
  enqueue(value: SseChunk): void;
  close(): void;
}

function fakeReader(): FakeReader {
  const values: SseChunk[] = [];
  let index = 0;
  let closed = false;
  let waiters: Array<(result: { done: boolean; value?: SseChunk }) => void> = [];
  return {
    read: async () => {
      if (index < values.length) return { done: false, value: values[index++] };
      if (closed) return { done: true };
      return new Promise((resolve) => { waiters.push(resolve); });
    },
    cancel: vi.fn(async () => {
      const pending = waiters;
      waiters = [];
      for (const resolve of pending) resolve({ done: true });
    }),
    releaseLock: vi.fn(),
    enqueue(value: SseChunk) {
      const waiter = waiters.shift();
      if (waiter) waiter({ done: false, value });
      else values.push(value);
    },
    close() {
      closed = true;
      const pending = waiters;
      waiters = [];
      for (const resolve of pending) resolve({ done: true });
    },
  } as unknown as FakeReader;
}

function parseChunks(chunks: SseChunk[]): SseOutcome {
  const parser = new SseParser();
  for (const chunk of chunks) parser.push(chunk);
  return parser.end().outcome;
}

describe('SseParser', () => {
  it('parses multiple events in one chunk and preserves multi-line data', () => {
    const parser = new SseParser();
    const emitted = parser.push(bytes(
      'id: 7\r\nevent: delta\r\ndata: first\r\ndata: second\r\n\r\n'
      + 'event: completed\r\ndata: {"operationId":"op-1","messageId":"msg-1"}\r\n\r\n',
    ));

    expect(emitted).toEqual([
      { event: 'delta', data: 'first\nsecond', id: '7' },
      { event: 'completed', data: '{"operationId":"op-1","messageId":"msg-1"}', id: '7' },
    ]);
    expect(parser.end().outcome).toEqual({
      status: 'completed',
      reason: 'completed-event',
      event: emitted[1],
      operationId: 'op-1',
      messageId: 'msg-1',
    });
  });

  it('reassembles events and multi-byte text split across arbitrary byte boundaries', () => {
    const text = 'event: delta\ndata: {"text":"Xin chào 🌍"}\n\n'
      + 'data: {"operationId":"op-2"}\nevent: completed\n\n';
    const parser = new SseParser();
    for (const byte of bytes(text)) parser.push(Uint8Array.of(byte));

    expect(parser.events).toHaveLength(2);
    expect(parser.events[0].data).toBe('{"text":"Xin chào 🌍"}');
    expect(parser.events[1].event).toBe('completed');
    expect(parser.end().outcome).toMatchObject({ status: 'completed', operationId: 'op-2' });
  });

  it('accepts bare CR line endings and ignores comments and unknown fields', () => {
    const parser = new SseParser();
    parser.push(': heartbeat\rretry: 500\rping: ignored\rdata: partial\rdata: done\r\r');
    const events = parser.push('data: {"operationId":"op-cr"}\revent: completed\r\r');

    expect(events.map((event) => event.event)).toEqual(['message']);
    expect(events[0]).toMatchObject({ data: 'partial\ndone', retry: 500 });
    // A trailing CR is held until the next chunk; EOF flushes the terminal event.
    const result = parser.end();
    expect(result.events.map((event) => event.event)).toEqual(['message', 'completed']);
    expect(result.outcome).toMatchObject({ status: 'completed', operationId: 'op-cr' });
  });

  it('flushes a decoder with a trailing incomplete UTF-8 sequence at EOF', () => {
    const parser = new SseParser();
    parser.push(bytes('data: "'));
    parser.push(Uint8Array.from([0xe2, 0x82]));
    parser.push(Uint8Array.from([0xac, 0x22, 0x0a, 0x0a]));
    expect(parser.end().events[0].data).toBe('"€"');
  });

  it('does not treat EOF or a legacy [DONE] marker as success', () => {
    const parser = new SseParser();
    parser.push(bytes('data: {"token":"half"}\n\n'));
    expect(parser.end().outcome).toEqual({ status: 'incomplete', reason: 'eof' });

    expect(parseChunks([bytes('data: {"token":"half"}\n\ndata: [DONE]\n\n')])).toMatchObject({
      status: 'incomplete',
      reason: 'legacy-done',
    });
  });

  it('supports legacy completion only when explicitly enabled', () => {
    expect(parseChunks([bytes('data: [DONE]\n\n')]).status).toBe('incomplete');

    const parser = new SseParser({ treatLegacyDoneAsCompleted: true });
    parser.push('data: [DONE]\n\n');
    expect(parser.end().outcome.status).toBe('completed');
  });

  it('rejects malformed terminal events instead of skipping them as success', () => {
    for (const payload of ['{}', 'not-json', '[]']) {
      const parser = new SseParser();
      parser.push(`event: completed\ndata: ${payload}\n\n`);
      expect(parser.end().outcome).toMatchObject({
        status: 'failed',
        reason: 'malformed-terminal',
        error: { code: 'INVALID_TERMINAL_EVENT' },
      });
    }
  });

  it('accepts a completed event with identifiers inside a data envelope', () => {
    const parser = new SseParser();
    parser.push('event: completed\ndata: {"data":{"operationId":"op-env","balance":25}}\n\n');
    expect(parser.end().outcome).toMatchObject({
      status: 'completed',
      operationId: 'op-env',
      balance: 25,
    });
  });

  it('parses safe failed and cancelled events without echoing raw provider errors', () => {
    const failed = parseChunks([bytes(
      'event: delta\ndata: {"text":"partial"}\n\n'
      + 'event: failed\ndata: {"code":"QUOTA_EXCEEDED","error":{"message":"secret provider stack trace"}}\n\n',
    )]);
    expect(failed).toMatchObject({
      status: 'failed',
      reason: 'failed-event',
      error: { code: 'QUOTA_EXCEEDED' },
    });
    // The user-facing error field must never echo raw provider details.
    expect(JSON.stringify({ status: failed.status, error: failed.error })).not.toContain(
      'secret provider stack trace',
    );

    expect(parseChunks([bytes('event: cancelled\n\n')])).toMatchObject({
      status: 'cancelled',
      reason: 'cancelled-event',
    });
  });

  it('handles legacy unnamed error payloads and rejects unsafe codes', () => {
    expect(parseChunks([bytes('data: {"error":{"code":"QUOTA"}}\n\n')])).toMatchObject({
      status: 'failed',
      error: { code: 'QUOTA' },
    });
    // An unsafe error code is rejected rather than echoed verbatim.
    expect(parseChunks([bytes(`data: {"error":{"code":"${'A'.repeat(100)}"}}\n\n`)])).toMatchObject({
      status: 'failed',
      error: { code: 'STREAM_FAILED' },
    });
  });

  it('stops emitting events once a terminal outcome is reached', () => {
    const parser = new SseParser();
    parser.push('event: completed\ndata: {"operationId":"op-1"}\n\n');
    expect(parser.push('event: delta\ndata: {"text":"late"}\n\n')).toEqual([]);
    expect(parser.events).toHaveLength(1);
    expect(parser.end().outcome.status).toBe('completed');
  });

  it('fails instead of growing an unbounded partial buffer', () => {
    const parser = new SseParser({ maxBufferSize: 16 });
    parser.push(bytes('data: ' + 'x'.repeat(20)));
    expect(parser.end().outcome).toMatchObject({
      status: 'failed',
      reason: 'buffer-overflow',
      error: { code: 'BUFFER_TOO_LARGE' },
    });
  });
});

describe('parseSseStream', () => {
  it('consumes a successful stream and stops at the terminal event', async () => {
    const reader = fakeReader();
    reader.enqueue(bytes('event: accepted\ndata: {"operationId":"op-3"}\n\n'));
    reader.enqueue(bytes('event: delta\ndata: {"seq":1,"text":"h"}\n\n'));
    reader.enqueue(bytes('event: delta\ndata: {"seq":2,"text":"i"}\n\n'));
    reader.enqueue(bytes('event: completed\ndata: {"operationId":"op-3","messageId":"msg-3"}\n\n'));
    reader.enqueue(bytes('event: delta\ndata: {"text":"never"}\n\n'));
    reader.close();

    const result = await parseSseStream(reader);
    expect(result.events.map((event) => event.event)).toEqual([
      'accepted', 'delta', 'delta', 'completed',
    ]);
    expect(result.outcome).toMatchObject({ status: 'completed', messageId: 'msg-3' });
    expect(reader.cancel).toHaveBeenCalled();
  });

  it('reports an incomplete stream when the reader ends without terminal event', async () => {
    const reader = fakeReader();
    reader.enqueue(bytes('data: {"token":"partial"}\n\n'));
    reader.close();
    const result = await parseSseStream(reader);
    expect(result.outcome).toEqual({ status: 'incomplete', reason: 'eof' });
    expect(result.events).toHaveLength(1);
  });

  it('reports read errors with a safe code', async () => {
    const reader = fakeReader();
    reader.read = (async () => {
      throw Object.assign(new Error('secret connection detail'), { code: 'ECONNRESET' });
    }) as typeof reader.read;
    const result = await parseSseStream(reader);
    expect(result.outcome).toMatchObject({
      status: 'failed',
      reason: 'read-error',
      error: { code: 'ECONNRESET' },
    });
    expect(result.outcome.error?.message).toBeUndefined();
  });

  it('cancels the reader when an abort signal fires', async () => {
    const controller = new AbortController();
    const reader = fakeReader();
    const pending = parseSseStream(reader, { signal: controller.signal });
    controller.abort();

    expect(await pending).toEqual({
      events: [],
      outcome: { status: 'cancelled', reason: 'aborted' },
    });
    expect(reader.cancel).toHaveBeenCalled();
  });

  it('does not overwrite a terminal outcome when abort fires after completion', async () => {
    const controller = new AbortController();
    const reader = fakeReader();
    reader.enqueue(bytes('event: completed\ndata: {"operationId":"op-4"}\n\n'));
    reader.close();

    const result = await parseSseStream(reader, { signal: controller.signal });
    controller.abort();
    expect(result.outcome).toMatchObject({ status: 'completed', operationId: 'op-4' });
  });
});
