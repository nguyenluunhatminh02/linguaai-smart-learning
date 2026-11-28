import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

/** One decoded-byte budget shared by REST uploads and speaking audio. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const VALIDATION_ERROR_MESSAGE = 'Invalid file type. Only standard images and audio are allowed.';

export const IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
] as const;

export const AUDIO_MIME_TYPES = [
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/ogg',
  'audio/webm',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/aac',
  'audio/flac',
  'audio/x-flac',
] as const;

export const UPLOAD_MIME_TYPES: readonly string[] = [...IMAGE_MIME_TYPES, ...AUDIO_MIME_TYPES];

/** MIME types accepted for transcribed audio, including recorded-but-silent payloads. */
export const TRANSCRIBE_MIME_TYPES: readonly string[] = [
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/flac',
  'audio/x-flac',
  'audio/aac',
];

const MIME_TO_EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/mp4a-latm': 'm4a',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
};

export interface ValidatedUpload {
  buffer: Buffer;
  mimeType: string;
  extension: string;
  size: number;
  checksum: string;
}

export interface ValidatedAudioPayload {
  buffer: Buffer;
  mimeType: string;
  extension: string;
  size: number;
}

export interface ValidatedMediaHeader {
  mimeType: string;
  extension: string;
}

export function normalizeMimeType(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.split(';')[0].trim().toLowerCase();
}

/** Extension comes from the validated MIME type, never from the client filename. */
export function extensionForMimeType(mimeType: string): string | null {
  return MIME_TO_EXTENSION[normalizeMimeType(mimeType)] ?? null;
}

export function isAllowedUploadMimeType(mimeType: string): boolean {
  const normalized = normalizeMimeType(mimeType);
  return UPLOAD_MIME_TYPES.includes(normalized);
}

export function isAllowedAudioMimeType(mimeType: string): boolean {
  const normalized = normalizeMimeType(mimeType);
  return TRANSCRIBE_MIME_TYPES.includes(normalized);
}

export function uploadSizeLimitForMimeType(_mimeType?: string): number {
  return MAX_UPLOAD_BYTES;
}

export function validateMediaHeader(file: Express.Multer.File): ValidatedMediaHeader {
  const mimeType = normalizeMimeType(file?.mimetype);
  if (!isAllowedUploadMimeType(mimeType)) {
    throw new BadRequestException(VALIDATION_ERROR_MESSAGE);
  }
  return { mimeType, extension: extensionForMimeType(mimeType)! };
}

function startsWith(buffer: Buffer, offset: number, ascii: string): boolean {
  const needle = Buffer.from(ascii, 'ascii');
  return buffer.length >= offset + needle.length &&
    needle.every((byte, i) => buffer[offset + i] === byte);
}

function matchesImage(buffer: Buffer, mimeType: string): boolean {
  switch (mimeType) {
    case 'image/jpeg':
      return buffer.length >= 3 &&
        buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    case 'image/png':
      return buffer.length >= 8 &&
        buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case 'image/gif':
      return startsWith(buffer, 0, 'GIF87a') || startsWith(buffer, 0, 'GIF89a');
    case 'image/webp':
      return startsWith(buffer, 0, 'RIFF') && startsWith(buffer, 8, 'WEBP');
    default:
      return false;
  }
}

/** Shared audio signature check for REST uploads, REST transcription, and WS frames. */
export function hasAudioSignature(buffer: Buffer, mimeType: string): boolean {
  const normalized = normalizeMimeType(mimeType);
  return isAllowedAudioMimeType(normalized) ? matchesAudio(buffer, normalized) : false;
}

function matchesAudio(buffer: Buffer, mimeType: string): boolean {
  switch (mimeType) {
    case 'audio/mpeg':
    case 'audio/mp3':
      // ID3 tag or MPEG frame sync with a valid layer/version combination.
      return startsWith(buffer, 0, 'ID3') ||
        (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0 &&
          (buffer[1] & 0x06) !== 0x00 && (buffer[1] & 0x18) !== 0x08);
    case 'audio/wav':
    case 'audio/x-wav':
    case 'audio/wave':
      return startsWith(buffer, 0, 'RIFF') && startsWith(buffer, 8, 'WAVE');
    case 'audio/ogg':
      return startsWith(buffer, 0, 'OggS');
    case 'audio/webm':
      // EBML header only: MediaRecorder chunks may not contain the "webm"
      // DocType string in the first frame. We reject arbitrary bytes and
      // enforce the same strict base64/decoded-size budget for every frame.
      return startsWith(buffer, 0, '\x1a\x45\xdf\xa3');
    case 'audio/mp4':
    case 'audio/m4a':
    case 'audio/x-m4a':
      return buffer.length >= 12 && buffer[4] === 0x66 && buffer[5] === 0x74 &&
        buffer[6] === 0x79 && buffer[7] === 0x70 &&
        ['isom', 'iso2', 'mp41', 'mp42', 'M4A ', 'M4B ', 'dash'].includes(buffer.subarray(8, 12).toString('ascii'));
    case 'audio/aac':
      return startsWith(buffer, 0, 'ADIF') ||
        (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xf6) === 0xf0);
    case 'audio/flac':
    case 'audio/x-flac':
      return startsWith(buffer, 0, 'fLaC');
    default:
      return false;
  }
}

/**
 * Validate a complete uploaded file: declared MIME must be allowed, bytes must
 * match that MIME's signature, and size must fit the shared decoded-byte budget.
 * The client filename is deliberately ignored.
 */
export function validateUploadedFile(file: Express.Multer.File): ValidatedUpload {
  const header = validateMediaHeader(file);
  const buffer = file?.buffer;
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new BadRequestException('File is empty');
  }
  if (file.size > MAX_UPLOAD_BYTES || buffer.length > MAX_UPLOAD_BYTES) {
    throw new BadRequestException(`File size exceeds limit (${MAX_UPLOAD_BYTES / 1024 / 1024}MB).`);
  }
  const matches = IMAGE_MIME_TYPES.includes(header.mimeType as (typeof IMAGE_MIME_TYPES)[number])
    ? matchesImage(buffer, header.mimeType)
    : hasAudioSignature(buffer, header.mimeType);
  if (!matches) {
    throw new BadRequestException('File content does not match its declared type');
  }
  return {
    buffer,
    mimeType: header.mimeType,
    extension: header.extension,
    size: buffer.length,
    checksum: createHash('sha256').update(buffer).digest('hex'),
  };
}

/** Reject non-strict base64 before decoding so junk cannot bypass the byte budget. */
export function decodeStrictBase64(value: unknown): Buffer | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > (MAX_UPLOAD_BYTES + 2) / 3 * 4 + 4) {
    return null;
  }
  const candidate = value;
  if (candidate.length === 0 || candidate.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(candidate)) {
    return null;
  }
  const buffer = Buffer.from(candidate, 'base64');
  if (buffer.length === 0 || buffer.length > MAX_UPLOAD_BYTES ||
      buffer.toString('base64') !== candidate) {
    return null;
  }
  return buffer;
}

/** Validate and decode a base64 audio payload shared by REST and WebSocket. */
export function validateAudioPayload(audio: unknown, mimeType: unknown): ValidatedAudioPayload {
  const mime = normalizeMimeType(mimeType);
  if (!isAllowedAudioMimeType(mime)) {
    throw new BadRequestException('Unsupported audio format');
  }
  const buffer = decodeStrictBase64(audio);
  if (!buffer) {
    throw new BadRequestException('Audio payload is missing, malformed, or too large');
  }
  if (!hasAudioSignature(buffer, mime)) {
    throw new BadRequestException('Audio content does not match its declared type');
  }
  return { buffer, mimeType: mime, extension: extensionForMimeType(mime)!, size: buffer.length };
}

/**
 * Local filesystem storage port.
 *
 * REL-04 follow-up: replace with a S3-compatible adapter — private bucket per
 * data class, checksum/size/MIME metadata, short-lived signed read URLs and
 * orphan cleanup. Public static serving must be removed before real private
 * data is stored here; object keys remain server-generated in either case.
 */
@Injectable()
export class StorageAdapter {
  private readonly uploadDir = path.join(process.cwd(), 'uploads');

  async put(key: string, buffer: Buffer): Promise<void> {
    const relativeKey = this.assertKey(key);
    const target = path.join(this.uploadDir, relativeKey);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, buffer, { flag: 'wx' });
  }

  async head(key: string): Promise<{ key: string; size: number } | null> {
    const relativeKey = this.assertKey(key);
    try {
      const stat = await fs.stat(path.join(this.uploadDir, relativeKey));
      return stat.isFile() ? { key: relativeKey, size: stat.size } : null;
    } catch (err: any) {
      if (err?.code === 'ENOENT') return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    const relativeKey = this.assertKey(key);
    await fs.unlink(path.join(this.uploadDir, relativeKey));
  }

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
    if (!relativeKey.startsWith(`${userId}/`) || relativeKey.slice(userId.length + 1).includes('/')) {
      throw new BadRequestException('File not found or access denied');
    }
    return relativeKey;
  }

  private assertKey(key: unknown): string {
    if (typeof key !== 'string' ||
        !/^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.[a-z0-9]+$/.test(key) ||
        key.includes('..')) {
      throw new BadRequestException('Invalid object key');
    }
    return key;
  }
}
