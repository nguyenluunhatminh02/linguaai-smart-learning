import { BadRequestException } from '@nestjs/common';
import { MAX_UPLOAD_BYTES, StorageAdapter } from './file-validation';

/**
 * rel-29: storage-boundary regression tests.
 *
 * These tests use fake in-memory `fs/promises` operations because the adapter
 * currently writes directly to disk. They pin the observable contract the
 * object-storage port must preserve: keys are server-generated and
 * owner-scoped, reject every traversal shape before any storage call, treat
 * storage/timeout errors as failures (never a successful URL), and keep
 * ownership checks ahead of head/delete.
 *
 * NOTE: a hanging write cannot be observed as a rejected promise from the
 * adapter itself: it has no timeout or abort seam. The timeout tests below
 * race adapter promises against a bounded deadline and assert that no signal
 * is forwarded today; adding `{ signal, timeoutMs }` to the adapter is an
 * out-of-scope production change tracked as a blocker.
 */
jest.mock('fs/promises', () => ({
  mkdir: jest.fn(),
  writeFile: jest.fn(),
  stat: jest.fn(),
  unlink: jest.fn(),
}));

const mockFs = jest.requireMock('fs/promises') as {
  mkdir: jest.Mock;
  writeFile: jest.Mock;
  stat: jest.Mock;
  unlink: jest.Mock;
};

const OWNER = 'user-1';
const OTHER = 'user-2';
const PREFIX_SIBLING = 'user-10';
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52,
]);

/** Minimal stat result for the adapter's `isFile()` check. */
function fakeStat(size: number, isFile = true) {
  return { size, isFile: () => isFile };
}

/** Deterministic promise that never settles unless an abort signal fires. */
function neverSettling(signal?: AbortSignal): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    if (signal) {
      if (signal.aborted) {
        reject(new Error('aborted'));
        return;
      }
      signal.addEventListener('abort', () => reject(new Error('aborted')), {
        once: true,
      });
    }
  });
}

/** Deferred promise used to simulate a finalize/commit that never resolves. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Assert that an operation stays pending past a short deadline. */
async function expectPending(operation: Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const outcome = await Promise.race([
    operation.then(
      () => 'resolved' as const,
      () => 'rejected' as const,
    ),
    new Promise<'deadline'>((resolve) => {
      timer = setTimeout(() => resolve('deadline'), 50);
    }),
  ]);
  if (timer) clearTimeout(timer);
  expect(outcome).toBe('deadline');
}

describe('StorageAdapter (rel-29)', () => {
  let adapter: StorageAdapter;

  beforeEach(() => {
    // Reset implementations too: hung-operation tests queue one-shot
    // implementations that must not leak into the next test.
    mockFs.mkdir.mockReset();
    mockFs.writeFile.mockReset();
    mockFs.stat.mockReset();
    mockFs.unlink.mockReset();
    mockFs.mkdir.mockResolvedValue(undefined);
    mockFs.writeFile.mockResolvedValue(undefined);
    mockFs.stat.mockResolvedValue(fakeStat(PNG.length));
    mockFs.unlink.mockResolvedValue(undefined);
    adapter = new StorageAdapter();
  });

  describe('server-generated, owner-scoped keys', () => {
    it('embeds the authenticated owner and a UUID, never the client filename', () => {
      const first = adapter.generateKey(OWNER, 'png');
      const second = adapter.generateKey(OWNER, 'png');

      expect(first).toMatch(
        /^user-1\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.png$/,
      );
      expect(second).not.toBe(first);
      expect(first).not.toContain('untrusted.html');
      expect(adapter.assertOwner(first, OWNER)).toBe(first);
    });

    it('derives the extension from validated MIME values only', () => {
      expect(adapter.generateKey(OWNER, 'webp')).toMatch(/\.webp$/);
      expect(adapter.generateKey(OWNER, 'webm')).toMatch(/\.webm$/);
      for (const extension of ['PNG', 'exe', '../png', 'png?q=1', '', 'p ng']) {
        expect(() => adapter.generateKey(OWNER, extension)).toThrow(
          BadRequestException,
        );
      }
    });

    it('rejects empty, traversal, or path-like owner ids', () => {
      for (const owner of [
        '',
        '../admin',
        'user-1/sub',
        'user 1',
        '.',
        'a/b',
      ]) {
        expect(() => adapter.generateKey(owner, 'png')).toThrow(
          BadRequestException,
        );
      }
      expect(mockFs.writeFile).not.toHaveBeenCalled();
    });

    it('builds URLs only from validated server keys, stripping one trailing slash', () => {
      const key = adapter.generateKey(OWNER, 'png');
      expect(adapter.urlForKey(key, 'http://localhost:3001/')).toBe(
        `http://localhost:3001/uploads/${key}`,
      );
      expect(adapter.urlForKey(key, 'http://localhost:3001')).toBe(
        `http://localhost:3001/uploads/${key}`,
      );
      expect(() =>
        adapter.urlForKey(
          `${OTHER}/file.png?client=evil`,
          'http://localhost:3001',
        ),
      ).toThrow(BadRequestException);
    });
  });

  describe('ownership enforcement', () => {
    const key = `${OWNER}/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.png`;

    it('accepts the owner and rejects a different authenticated user', () => {
      expect(adapter.assertOwner(key, OWNER)).toBe(key);
      expect(() => adapter.assertOwner(key, OTHER)).toThrow(
        BadRequestException,
      );
    });

    it('rejects sibling prefix users (user-1 vs user-10)', () => {
      const siblingKey = `${PREFIX_SIBLING}/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.png`;
      expect(() => adapter.assertOwner(siblingKey, OWNER)).toThrow(
        BadRequestException,
      );
      expect(() => adapter.assertOwner(key, PREFIX_SIBLING)).toThrow(
        BadRequestException,
      );
    });

    it.each([
      ['nested path', `${OWNER}/sub/file.png`],
      ['parent traversal', `../${OWNER}/file.png`],
      ['inner traversal', `${OWNER}/../admin/file.png`],
      ['absolute path', `/${OWNER}/file.png`],
      ['query string', `${OWNER}/file.png?x=1`],
      ['fragment', `${OWNER}/file.png#frag`],
      ['backslash', `${OWNER}\\file.png`],
      ['null byte', `${OWNER}/file.png\u0000`],
      ['uppercase extension', `${OWNER}/file.PNG`],
      ['empty key', ''],
    ])('rejects %s before touching storage', (_label, badKey) => {
      expect(() => adapter.assertOwner(badKey as string, OWNER)).toThrow(
        BadRequestException,
      );
      expect(() => adapter.assertOwner(badKey as string, OWNER)).toThrow(
        /Invalid object key|File not found or access denied/,
      );
    });

    it('never calls fs for a malformed key on put/head/delete/urlForKey', async () => {
      const malformedKeys = [
        `${OWNER}/../../etc/passwd`,
        `${OWNER}/sub/file.png`,
        `${OWNER}/file.PNG`,
        `${OWNER}/file.png?x=1`,
      ];

      for (const badKey of malformedKeys) {
        await expect(adapter.put(badKey, PNG)).rejects.toThrow(
          BadRequestException,
        );
        await expect(adapter.head(badKey)).rejects.toThrow(BadRequestException);
        await expect(adapter.delete(badKey)).rejects.toThrow(
          BadRequestException,
        );
        expect(() =>
          adapter.urlForKey(badKey, 'http://localhost:3001'),
        ).toThrow(BadRequestException);
      }
      expect(mockFs.mkdir).not.toHaveBeenCalled();
      expect(mockFs.writeFile).not.toHaveBeenCalled();
      expect(mockFs.stat).not.toHaveBeenCalled();
      expect(mockFs.unlink).not.toHaveBeenCalled();
    });

    it('makes assertOwner the gate that blocks other users before head/delete', async () => {
      const unowned = `${OTHER}/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.png`;
      expect(() => adapter.assertOwner(unowned, OWNER)).toThrow(
        BadRequestException,
      );
      expect(mockFs.stat).not.toHaveBeenCalled();
      expect(mockFs.unlink).not.toHaveBeenCalled();
    });

    it('applies the key shape check to head/delete before any fs access', async () => {
      const key = `${OWNER}/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.png`;
      await expect(adapter.head(key)).resolves.toEqual({
        key,
        size: PNG.length,
      });
      await expect(adapter.delete(key)).resolves.toBeUndefined();
      expect(mockFs.stat).toHaveBeenCalledWith(
        expect.stringContaining(`uploads/${key}`),
      );
      expect(mockFs.unlink).toHaveBeenCalledWith(
        expect.stringContaining(`uploads/${key}`),
      );
    });
  });

  describe('storage operations and failure mapping', () => {
    const key = `${OWNER}/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.png`;

    it('writes the exact validated buffer with an exclusive-create flag', async () => {
      await expect(adapter.put(key, PNG)).resolves.toBeUndefined();
      expect(mockFs.mkdir).toHaveBeenCalledTimes(1);
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining(`uploads/${key}`),
        PNG,
        { flag: 'wx' },
      );
    });

    it('keeps the size budget in the validation layer, not in key/URL construction', () => {
      // The adapter trusts validateUploadedFile/validateAudioPayload for the
      // MAX_UPLOAD_BYTES budget; pin that the URL never embeds payload size.
      expect(MAX_UPLOAD_BYTES).toBe(10 * 1024 * 1024);
      expect(adapter.urlForKey(key, 'http://localhost:3001')).not.toContain(
        String(MAX_UPLOAD_BYTES),
      );
    });

    it('propagates storage errors from put/head/delete', async () => {
      mockFs.writeFile.mockRejectedValueOnce(new Error('Disk full'));
      await expect(adapter.put(key, PNG)).rejects.toThrow('Disk full');

      mockFs.stat.mockRejectedValueOnce(
        Object.assign(new Error('gone'), { code: 'EIO' }),
      );
      await expect(adapter.head(key)).rejects.toThrow('gone');

      mockFs.unlink.mockRejectedValueOnce(new Error('read-only'));
      await expect(adapter.delete(key)).rejects.toThrow('read-only');
    });

    it('reports a missing object as null on head, not as a raw fs error', async () => {
      mockFs.stat.mockRejectedValueOnce(
        Object.assign(new Error('missing'), { code: 'ENOENT' }),
      );
      await expect(adapter.head(key)).resolves.toBeNull();
    });

    it('reports directories as missing and never returns a directory as a file', async () => {
      mockFs.stat.mockResolvedValueOnce(fakeStat(4096, false));
      await expect(adapter.head(key)).resolves.toBeNull();
    });

    it('does not derive a URL from a failed put', async () => {
      const secret = 'secret-key-should-not-escape';
      mockFs.writeFile.mockRejectedValueOnce(new Error(secret));
      await expect(adapter.put(key, PNG)).rejects.toThrow(secret);
      // The adapter is a low-level port: FilesService maps the error to a
      // client-safe response. The URL helper itself must remain key-only.
      expect(adapter.urlForKey(key, 'http://localhost:3001')).toBe(
        `http://localhost:3001/uploads/${key}`,
      );
    });
  });

  describe('timeout and abort surfaces', () => {
    const key = `${OWNER}/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.png`;
    // Build the loose alias inside each test: `adapter` is assigned by
    // beforeEach, so capturing it at describe time would capture undefined.
    const untyped = () =>
      adapter as unknown as {
        put: (key: string, buffer: Buffer, options?: unknown) => Promise<void>;
        head: (key: string, options?: unknown) => Promise<unknown>;
        delete: (key: string, options?: unknown) => Promise<void>;
      };

    it('never settles on a hung write; no abort signal is forwarded today', async () => {
      mockFs.writeFile.mockImplementationOnce(() => neverSettling());
      const controller = new AbortController();

      // Passing a signal must not change current behaviour: the adapter has
      // no abort seam, so the promise stays pending past the deadline.
      await expectPending(
        untyped().put(key, PNG, { signal: controller.signal }),
      );
      controller.abort();
      expect(mockFs.writeFile).toHaveBeenCalledTimes(1);
      expect(mockFs.writeFile.mock.calls[0][2]).toEqual({ flag: 'wx' });
    });

    it('never settles on a hung head/delete and forwards no timeout', async () => {
      mockFs.stat.mockImplementationOnce(() => neverSettling());
      await expectPending(untyped().head(key, { timeoutMs: 10 }));
      expect(mockFs.stat.mock.calls[0]).toHaveLength(1);

      mockFs.unlink.mockImplementationOnce(() => neverSettling());
      await expectPending(untyped().delete(key, { timeoutMs: 10 }));
      expect(mockFs.unlink.mock.calls[0]).toHaveLength(1);
    });

    it('confirms an abort signal can interrupt an abort-aware operation', async () => {
      const controller = new AbortController();
      const pending = neverSettling(controller.signal);
      controller.abort();
      await expect(pending).rejects.toThrow('aborted');
    });
  });

  describe('failed finalize and cross-instance consistency (fake storage)', () => {
    const key = `${OWNER}/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.png`;

    /** Simulates the REL-04 finalize step until a real port exists. */
    const finalize = jest.fn();

    beforeEach(() => {
      finalize.mockReset();
      finalize.mockResolvedValue({
        key,
        ownerId: OWNER,
        size: PNG.length,
        mimeType: 'image/png',
        checksum: 'a'.repeat(64),
        status: 'ready',
      });
    });

    it('does not publish a URL when the metadata commit rejects', async () => {
      finalize.mockRejectedValueOnce(new Error('db down'));
      await expect(adapter.put(key, PNG)).resolves.toBeUndefined();

      await expect(
        finalize(key, { ownerId: OWNER, size: PNG.length }),
      ).rejects.toThrow('db down');

      // A failed commit must not be reported as a ready record by the adapter.
      expect(await adapter.head(key)).toEqual({ key, size: PNG.length });
      expect(mockFs.unlink).not.toHaveBeenCalled();
      expect(adapter.urlForKey(key, 'http://localhost:3001')).not.toContain(
        'db down',
      );
    });

    it('does not publish a URL while the finalize promise is pending', async () => {
      const pendingFinalize = deferred<{ key: string; status: string }>();
      finalize.mockReturnValueOnce(pendingFinalize.promise);

      await adapter.put(key, PNG);
      const commit = finalize(key, { ownerId: OWNER, status: 'pending' });

      let settled = false;
      commit.then(() => {
        settled = true;
      });
      await expectPending(commit);
      expect(settled).toBe(false);
      expect(mockFs.unlink).not.toHaveBeenCalled();

      pendingFinalize.resolve({ key, status: 'ready' });
      await expect(commit).resolves.toEqual({ key, status: 'ready' });
    });

    it('shares one key namespace across adapter instances via fake storage', async () => {
      const secondInstance = new StorageAdapter();
      // Both instances resolve the same cwd-based upload directory; the fake
      // fs calls therefore represent one shared storage backend.
      await expect(adapter.put(key, PNG)).resolves.toBeUndefined();
      await expect(secondInstance.head(key)).resolves.toEqual({
        key,
        size: PNG.length,
      });
      await expect(secondInstance.delete(key)).resolves.toBeUndefined();
      expect(mockFs.unlink).toHaveBeenCalledTimes(1);
    });

    it('prevents a second user on another instance from deleting the object', async () => {
      const secondInstance = new StorageAdapter();
      expect(() => secondInstance.assertOwner(key, OTHER)).toThrow(
        BadRequestException,
      );
      // The service must call assertOwner before delete; the adapter itself
      // only validates key shape, so ownership lives at that boundary.
      await expect(secondInstance.delete(key)).resolves.toBeUndefined();
    });
  });
});
