import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * REL-04/BUG-09 storage port. The object key is always server-generated;
 * callers never choose a path or supply a filename.
 *
 * `signedReadUrl` is the point where an authorization-aware service hands out
 * short-lived read access. A local implementation cannot authorize by itself,
 * so it emits a URL for a dedicated read route that the API must mount before
 * private objects are stored here.
 */
export interface StoragePort {
  put(key: string, buffer: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
  head(key: string): Promise<StorageObjectHead | null>;
  signedReadUrl(key: string, expiresInSeconds?: number): Promise<string>;
}

export interface StorageObjectHead {
  key: string;
  size: number;
  checksum?: string;
  mimeType?: string;
}

export interface SignedReadOptions {
  /** Secret used to sign read URLs. Overrides STORAGE_SIGNING_SECRET. */
  secret?: string;
  /** Base URL used for generated links. Overrides API_URL / APP_BASE_URL. */
  baseUrl?: string;
}

/**
 * Accepted for forward compatibility with callers probing abort/timeout seams.
 * The local adapter intentionally does not forward them to fs/promises yet.
 */
export interface StorageCallOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export const STORAGE_PORT = Symbol('STORAGE_PORT');

const DEFAULT_SIGNED_URL_TTL_SECONDS = 300;
const MAX_SIGNED_URL_TTL_SECONDS = 900;
const SIGNED_READ_PATH = '/api/v1/files/signed';

/**
 * Local filesystem implementation of {@link StoragePort}.
 *
 * Keeps `StorageAdapter`'s existing `generateKey`, `assertOwner`, `urlForKey`,
 * `put`, `head` and `delete` signatures so current callers keep working while
 * the storage boundary is introduced. All IO is async (fs/promises).
 *
 * This is a single-host development adapter, not a multi-instance solution.
 * Signed URLs only work across replicas if they share STORAGE_SIGNING_SECRET
 * and the same mounted object store.
 */
@Injectable()
export class LocalStorageAdapter implements StoragePort {
  private readonly uploadDir: string;
  private readonly signingSecret?: string;
  private readonly baseUrl?: string;

  constructor(options: SignedReadOptions = {}) {
    this.uploadDir = path.resolve(process.cwd(), 'uploads');
    this.signingSecret = options.secret ?? process.env.STORAGE_SIGNING_SECRET;
    this.baseUrl = options.baseUrl ?? process.env.API_URL;
  }

  /** DI factory: keeps the adapter injectable without forcing a config module. */
  static fromConfig(config: ConfigService): LocalStorageAdapter {
    return new LocalStorageAdapter({
      secret: config.get<string>('STORAGE_SIGNING_SECRET'),
      baseUrl: config.get<string>('API_URL'),
    });
  }

  async put(
    key: string,
    buffer: Buffer,
    _options?: StorageCallOptions,
  ): Promise<void> {
    const relativeKey = this.assertKey(key);
    const target = this.objectPath(relativeKey);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, buffer, { flag: 'wx' });
  }

  async get(key: string): Promise<Buffer | null> {
    const relativeKey = this.assertKey(key);
    try {
      return await fs.readFile(this.objectPath(relativeKey));
    } catch (err: any) {
      if (err?.code === 'ENOENT' || err?.code === 'EISDIR') return null;
      throw err;
    }
  }

  async delete(key: string, _options?: StorageCallOptions): Promise<void> {
    const relativeKey = this.assertKey(key);
    await fs.unlink(this.objectPath(relativeKey));
  }

  async head(
    key: string,
    _options?: StorageCallOptions,
  ): Promise<StorageObjectHead | null> {
    const relativeKey = this.assertKey(key);
    try {
      const stat = await fs.stat(this.objectPath(relativeKey));
      return stat.isFile() ? { key: relativeKey, size: stat.size } : null;
    } catch (err: any) {
      if (err?.code === 'ENOENT') return null;
      throw err;
    }
  }

  /**
   * Build a short-lived read URL. The signature covers the object key and an
   * absolute expiry, so neither can be altered without the shared secret.
   */
  async signedReadUrl(
    key: string,
    expiresInSeconds: number = DEFAULT_SIGNED_URL_TTL_SECONDS,
  ): Promise<string> {
    const relativeKey = this.assertKey(key);
    if (!this.signingSecret) {
      throw new Error(
        'STORAGE_SIGNING_SECRET is required to issue signed read URLs',
      );
    }
    const ttl = this.validateTtl(expiresInSeconds);
    const expiresAt = Math.floor(Date.now() / 1000) + ttl;
    const signature = createHmac('sha256', this.signingSecret)
      .update(`${relativeKey}\n${expiresAt}`)
      .digest('base64url');
    const query = new URLSearchParams({
      key: relativeKey,
      expires: String(expiresAt),
      signature,
    });
    return `${this.baseUrlOrDefault()}${SIGNED_READ_PATH}?${query.toString()}`;
  }

  /** Verify a signature produced by `signedReadUrl`. Used by the read route. */
  verifySignedRead(key: string, expires: string, signature: string): boolean {
    const relativeKey = this.assertKey(key);
    const expiresAt = Number(expires);
    if (
      !Number.isSafeInteger(expiresAt) ||
      expiresAt <= Math.floor(Date.now() / 1000)
    ) {
      return false;
    }
    if (!this.signingSecret || typeof signature !== 'string') return false;
    const expected = createHmac('sha256', this.signingSecret)
      .update(`${relativeKey}\n${expiresAt}`)
      .digest('base64url');
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** Legacy public URL. Keep only until private read routes are mounted. */
  urlForKey(key: string, baseUrl: string): string {
    // Keys contain only [a-z0-9/_-], so no query/fragment escaping is needed.
    return `${baseUrl.replace(/\/$/, '')}/uploads/${this.assertKey(key)}`;
  }

  /** Server-generated, owner-scoped object name. Client input never selects a key. */
  generateKey(userId: string, extension: string): string {
    if (!/^[A-Za-z0-9_-]+$/.test(userId) || !/^[a-z0-9]+$/.test(extension)) {
      throw new BadRequestException('Invalid upload owner or extension');
    }
    return `${userId}/${randomUUID()}.${extension}`;
  }

  /** Verify a caller-supplied key stays inside its owner's prefix. */
  assertOwner(key: string, userId: string): string {
    const relativeKey = this.assertKey(key);
    if (
      !relativeKey.startsWith(`${userId}/`) ||
      relativeKey.slice(userId.length + 1).includes('/')
    ) {
      throw new BadRequestException('File not found or access denied');
    }
    return relativeKey;
  }

  /** Convenience for callers that need a content hash. */
  checksum(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
  }

  /** Resolve a validated signature to an object, throwing 404 when it is gone. */
  async getVerified(
    key: string,
    expires: string,
    signature: string,
  ): Promise<{ key: string; buffer: Buffer }> {
    if (!this.verifySignedRead(key, expires, signature)) {
      throw new NotFoundException('Signed read URL is invalid or expired');
    }
    const relativeKey = this.assertKey(key);
    const buffer = await this.get(relativeKey);
    if (!buffer) throw new NotFoundException('File not found');
    return { key: relativeKey, buffer };
  }

  private objectPath(relativeKey: string): string {
    return path.join(this.uploadDir, relativeKey);
  }

  private validateTtl(ttl: number): number {
    if (
      !Number.isInteger(ttl) ||
      ttl <= 0 ||
      ttl > MAX_SIGNED_URL_TTL_SECONDS
    ) {
      throw new BadRequestException('Invalid signed URL expiry');
    }
    return ttl;
  }

  private baseUrlOrDefault(): string {
    return (this.baseUrl ?? 'http://localhost:3001').replace(/\/$/, '');
  }

  private assertKey(key: unknown): string {
    if (
      typeof key !== 'string' ||
      !/^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.[a-z0-9]+$/.test(key) ||
      key.includes('..')
    ) {
      throw new BadRequestException('Invalid object key');
    }
    return key;
  }
}

/** Backwards-compatible alias for existing imports from `file-validation`. */
export { LocalStorageAdapter as StorageAdapter };
