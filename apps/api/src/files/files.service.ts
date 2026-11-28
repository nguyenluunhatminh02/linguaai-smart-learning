import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  StorageAdapter,
  VALIDATION_ERROR_MESSAGE,
  extensionForMimeType,
  validateUploadedFile,
  normalizeMimeType,
} from './file-validation';

/**
 * Upload service using the local storage adapter.
 * Object names are always generated here from the authenticated owner id;
 * client filenames and client-supplied keys are never accepted.
 *
 * REL-04 follow-up: replace StorageAdapter with an object-storage port that
 * stores owner/size/MIME/checksum metadata and issues short-lived signed URLs.
 * Until then /uploads/ is public static content — do not store private files.
 */
@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly storage: StorageAdapter,
  ) {}

  async uploadFile(file: Express.Multer.File, ownerId?: string): Promise<string> {
    const validated = validateUploadedFile(file);
    const userId = this.requireOwnerId(ownerId);
    const key = this.storage.generateKey(userId, validated.extension);
    try {
      await this.storage.put(key, validated.buffer);
      this.logger.log(`File saved locally for owner ${userId}: ${key}`);
    } catch (err: any) {
      this.logger.error(`Failed to save file locally: ${err.message}`, err.stack);
      throw new BadRequestException('Failed to upload file');
    }
    const apiPort = this.config.get('API_PORT', '3001');
    const apiUrl = this.config.get('API_URL', `http://localhost:${apiPort}`);
    return this.storage.urlForKey(key, apiUrl);
  }

  async assertOwner(key: string, userId: string): Promise<string> {
    const ownedKey = this.storage.assertOwner(key, this.requireOwnerId(userId));
    const head = await this.storage.head(ownedKey);
    if (!head) throw new BadRequestException('File not found or access denied');
    return ownedKey;
  }

  async deleteFile(key: string, userId: string): Promise<void> {
    await this.storage.delete(await this.assertOwner(key, userId));
  }

  async headFile(key: string, userId: string): Promise<{ key: string; size: number } | null> {
    const ownedKey = this.storage.assertOwner(key, this.requireOwnerId(userId));
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
      throw new BadRequestException('Authenticated user is required to upload files');
    }
    return ownerId;
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
    this.logger.log(`Generated TTS URL for text: "${text.substring(0, 30)}" [${langCode}]`);

    return ttsUrl;
  }
}
