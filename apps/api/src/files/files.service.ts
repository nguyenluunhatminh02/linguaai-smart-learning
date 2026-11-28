import {
  BadRequestException,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  StorageAdapter,
  VALIDATION_ERROR_MESSAGE,
  extensionForMimeType,
  validateUploadedFile,
  normalizeMimeType,
} from './file-validation';

/**
 * Storage metadata status lifecycle for an object key:
 * PENDING -> READY after a successful storage write; PENDING -> FAILED when
 * the write or the finalize step fails; READY -> DELETING -> DELETED on delete.
 */
export const FILE_OBJECT_STATUSES = [
  'PENDING',
  'READY',
  'FAILED',
  'DELETING',
  'DELETED',
] as const;

export type FileObjectStatus = (typeof FILE_OBJECT_STATUSES)[number];

interface FileObjectIdentity {
  objectKey: string;
  ownerId: string;
  size: number;
  mimeType: string;
  checksum: string;
}

/**
 * Access `prisma.file_objects` at runtime. The generated client may not expose
 * the delegate until `db:generate` runs after the migration, so queries go
 * through a narrow interface instead of a generated type.
 */
function fileObjectsDelegate(
  prisma: PrismaService,
): Record<string, (...args: any[]) => any> {
  const delegate = (prisma as unknown as Record<string, unknown>)[
    'file_objects'
  ];
  if (!delegate) {
    throw new Error(
      'Prisma client is missing the file_objects delegate; run db:generate after the schema migration',
    );
  }
  return delegate as Record<string, (...args: any[]) => any>;
}

/**
 * Upload service using the local storage adapter.
 * Object names are always generated here from the authenticated owner id;
 * client filenames and client-supplied keys are never accepted.
 *
 * Metadata (object key, owner, size, MIME type, checksum, status) is persisted
 * before the storage write and finalized to READY only after that write
 * succeeds, so a half-written object is never exposed as usable.
 *
 * REL-04 follow-up: replace StorageAdapter with an object-storage port that
 * issues short-lived signed URLs. Until then /uploads/ is public static
 * content — do not store private files.
 */
@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly storage: StorageAdapter,
    // Optional so the service can still be constructed in unit tests that do
    // not exercise persistence; PrismaModule is global in production.
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  async uploadFile(
    file: Express.Multer.File,
    ownerId?: string,
  ): Promise<string> {
    const validated = validateUploadedFile(file);
    const userId = this.requireOwnerId(ownerId);
    const key = this.storage.generateKey(userId, validated.extension);
    const identity: FileObjectIdentity = {
      objectKey: key,
      ownerId: userId,
      size: validated.size,
      mimeType: validated.mimeType,
      checksum: validated.checksum,
    };

    // Persist the PENDING row first: no bytes are written until the metadata
    // (including the checksum from validateUploadedFile) is durably recorded.
    const metadataId = await this.createPending(identity);

    try {
      await this.storage.put(key, validated.buffer);
      this.logger.log(`File saved locally for owner ${userId}: ${key}`);
    } catch (err: any) {
      await this.markFailedSafe(metadataId);
      this.logger.error(
        `Failed to save file locally: ${err.message}`,
        err.stack,
      );
      throw new BadRequestException('Failed to upload file');
    }

    // Finalize only after the storage write succeeded. Verify the stored
    // size/MIME/checksum in the conditional update so a mismatched row can
    // never be promoted to READY.
    try {
      await this.markReady(metadataId, identity);
    } catch (err: any) {
      await this.markFailedSafe(metadataId);
      // Best-effort cleanup of the just-written object: a failed finalize must
      // not leave an orphan that looks like a valid upload.
      try {
        await this.storage.delete(key);
      } catch (cleanupErr: any) {
        this.logger.warn(
          `Failed to clean up object ${key} after finalize failure: ${cleanupErr.message}`,
        );
      }
      this.logger.error(
        `Failed to finalize file metadata for ${key}: ${err.message}`,
        err.stack,
      );
      throw new BadRequestException('Failed to upload file');
    }

    const apiPort = this.config.get('API_PORT', '3001');
    const apiUrl = this.config.get('API_URL', `http://localhost:${apiPort}`);
    return this.storage.urlForKey(key, apiUrl);
  }

  async assertOwner(key: string, userId: string): Promise<string> {
    const owner = this.requireOwnerId(userId);
    const ownedKey = this.storage.assertOwner(key, owner);
    await this.requireReadyMetadata(ownedKey, owner);
    const head = await this.storage.head(ownedKey);
    if (!head) throw new BadRequestException('File not found or access denied');
    return ownedKey;
  }

  async deleteFile(key: string, userId: string): Promise<void> {
    const owner = this.requireOwnerId(userId);
    const ownedKey = this.storage.assertOwner(key, owner);
    await this.requireDeletableMetadata(ownedKey, owner);

    // Mark DELETING before touching storage. If the storage delete fails the
    // row stays DELETING so a cleanup job can retry without exposing it.
    await this.markDeleting(ownedKey, owner);
    await this.storage.delete(ownedKey);
    await this.markDeleted(ownedKey, owner);
  }

  async headFile(
    key: string,
    userId: string,
  ): Promise<{ key: string; size: number } | null> {
    const owner = this.requireOwnerId(userId);
    const ownedKey = this.storage.assertOwner(key, owner);
    await this.requireReadyMetadata(ownedKey, owner);
    return this.storage.head(ownedKey);
  }

  /** Extension derived from a validated MIME type, for callers that need one. */
  extensionForMime(mimeType: string): string {
    const extension = extensionForMimeType(normalizeMimeType(mimeType));
    if (!extension) throw new BadRequestException(VALIDATION_ERROR_MESSAGE);
    return extension;
  }

  private requireOwnerId(ownerId?: string): string {
    if (typeof ownerId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(ownerId)) {
      throw new BadRequestException(
        'Authenticated user is required to upload files',
      );
    }
    return ownerId;
  }

  // --- File-object metadata -------------------------------------------------

  /** Insert the initial PENDING row and return its id (or null without Prisma). */
  private async createPending(
    identity: FileObjectIdentity,
  ): Promise<string | null> {
    if (!this.prisma) return null;
    const record = await fileObjectsDelegate(this.prisma).create({
      data: {
        object_key: identity.objectKey,
        owner_id: identity.ownerId,
        size: identity.size,
        mime_type: identity.mimeType,
        checksum: identity.checksum,
        status: 'PENDING',
      },
    });
    return record?.id ?? null;
  }

  /**
   * Conditional PENDING -> READY transition that also verifies the persisted
   * size/MIME/checksum. A count other than 1 means the row changed meanwhile
   * or the metadata does not match, and the upload must not be finalized.
   */
  private async markReady(
    id: string | null,
    identity: FileObjectIdentity,
  ): Promise<void> {
    if (!this.prisma || id === null) return;
    const updated = await fileObjectsDelegate(this.prisma).updateMany({
      where: {
        id,
        status: 'PENDING',
        size: identity.size,
        mime_type: identity.mimeType,
        checksum: identity.checksum,
      },
      data: { status: 'READY', finalized_at: new Date() },
    });
    if (updated?.count !== 1) {
      throw new Error('File metadata changed before finalize');
    }
  }

  /** Best-effort PENDING -> FAILED transition; never masks the original error. */
  private async markFailedSafe(id: string | null): Promise<void> {
    if (!this.prisma || id === null) return;
    try {
      await fileObjectsDelegate(this.prisma).updateMany({
        where: { id, status: 'PENDING' },
        data: { status: 'FAILED' },
      });
    } catch (err: any) {
      this.logger.warn(
        `Failed to mark file metadata FAILED for ${id}: ${err.message}`,
      );
    }
  }

  /** Require a READY metadata row owned by the caller, in addition to key prefix. */
  private async requireReadyMetadata(
    objectKey: string,
    ownerId: string,
  ): Promise<void> {
    await this.requireMetadataStatus(objectKey, ownerId, 'READY');
  }

  /**
   * Delete retries must accept a row left in DELETING by a failed storage
   * delete, while never exposing FAILED/DELETED rows as live objects.
   */
  private async requireDeletableMetadata(
    objectKey: string,
    ownerId: string,
  ): Promise<void> {
    await this.requireMetadataStatus(objectKey, ownerId, 'DELETING', 'READY');
  }

  private async requireMetadataStatus(
    objectKey: string,
    ownerId: string,
    ...statuses: FileObjectStatus[]
  ): Promise<void> {
    if (!this.prisma) return;
    const record = await fileObjectsDelegate(this.prisma).findFirst({
      where: {
        object_key: objectKey,
        owner_id: ownerId,
        status: { in: statuses },
      },
      select: { id: true },
    });
    if (!record) {
      throw new BadRequestException('File not found or access denied');
    }
  }

  /** READY or DELETING -> DELETING, only for a row owned by the caller. */
  private async markDeleting(
    objectKey: string,
    ownerId: string,
  ): Promise<void> {
    if (!this.prisma) return;
    const updated = await fileObjectsDelegate(this.prisma).updateMany({
      where: {
        object_key: objectKey,
        owner_id: ownerId,
        status: { in: ['READY', 'DELETING'] },
      },
      data: { status: 'DELETING' },
    });
    if (updated?.count !== 1) {
      throw new BadRequestException('File not found or access denied');
    }
  }

  /** DELETING -> DELETED, only for the row moved by markDeleting. */
  private async markDeleted(objectKey: string, ownerId: string): Promise<void> {
    if (!this.prisma) return;
    await fileObjectsDelegate(this.prisma).updateMany({
      where: { object_key: objectKey, owner_id: ownerId, status: 'DELETING' },
      data: { status: 'DELETED' },
    });
  }

  /**
   * Generates a TTS (Text-to-Speech) audio URL for pronunciation.
   * Leverages a public Google Translate TTS service as a lightweight, zero-config solution.
   */
  async generateTTS(text: string, language: string): Promise<string> {
    if (!text || !language) {
      throw new BadRequestException('Text and language are required for TTS');
    }

    // Map language names or codes to standard ISO codes if needed
    let langCode = language.toLowerCase();
    if (langCode === 'english') langCode = 'en';
    if (langCode === 'vietnamese') langCode = 'vi';
    if (langCode === 'japanese') langCode = 'ja';
    if (langCode === 'korean') langCode = 'ko';
    if (langCode === 'chinese') langCode = 'zh-CN';

    // Google Translate TTS URL
    const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${langCode}&client=tw-ob&q=${encodeURIComponent(text)}`;
    this.logger.log(
      `Generated TTS URL for text: "${text.substring(0, 30)}" [${langCode}]`,
    );

    return ttsUrl;
  }
}
