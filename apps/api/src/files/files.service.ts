import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);
  private readonly uploadDir = path.join(process.cwd(), 'uploads');

  constructor(private config: ConfigService) {
    // Đảm bảo thư mục uploads tồn tại
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
      this.logger.log(`Created local uploads directory at ${this.uploadDir}`);
    }
  }

  /**
   * Upload file to local storage (acts as fallback and default)
   */
  async uploadFile(file: Express.Multer.File): Promise<string> {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const fileExt = path.extname(file.originalname);
    const fileName = `${uuidv4()}${fileExt}`;
    const filePath = path.join(this.uploadDir, fileName);

    try {
      // Ghi file buffer vào thư mục uploads
      fs.writeFileSync(filePath, file.buffer);
      this.logger.log(`File saved locally: ${filePath}`);

      // Trả về URL tương đối
      const apiPort = this.config.get('API_PORT', '3001');
      const apiUrL = this.config.get('API_URL', `http://localhost:${apiPort}`);
      return `${apiUrL}/uploads/${fileName}`;
    } catch (err: any) {
      this.logger.error(`Failed to save file locally: ${err.message}`, err.stack);
      throw new BadRequestException('Failed to upload file');
    }
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
