import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { TokensService } from '../tokens/tokens.service';
import Groq from 'groq-sdk';

/**
 * S6: Reads Speaking session history persisted by SpeakingGateway.
 */
@Injectable()
export class SpeakingService {
  private readonly groq: Groq;
  private readonly modelStt: string;

  /** Upper bound on the base64 audio payload accepted for a single transcription. */
  private static readonly MAX_AUDIO_BASE64_LENGTH = 2_000_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly tokensService: TokensService,
  ) {
    this.groq = new Groq({ apiKey: this.config.get<string>('GROQ_API_KEY') });
    this.modelStt = this.config.get<string>('GROQ_MODEL_STT', 'whisper-large-v3');
  }

  async getHistory(userId: string, page = 1, limit = 10) {
    const safeLimit = Math.min(Math.max(1, limit), 50);
    const safePage = Math.max(1, page);
    const skip = (safePage - 1) * safeLimit;

    const [items, total] = await Promise.all([
      this.prisma.speaking_submissions.findMany({
        where: { user_id: userId },
        orderBy: { created_at: 'desc' },
        skip,
        take: safeLimit,
        select: {
          id: true,
          topic: true,
          transcript: true,
          feedback: true,
          scores: true,
          language: true,
          level: true,
          duration_sec: true,
          created_at: true,
        },
      }),
      this.prisma.speaking_submissions.count({ where: { user_id: userId } }),
    ]);

    return {
      total,
      page: safePage,
      limit: safeLimit,
      items: items.map((it) => ({
        id: it.id,
        topic: it.topic,
        transcript: it.transcript,
        feedback: it.feedback,
        scores: (it.scores as Record<string, number> | null) ?? null,
        language: it.language,
        level: it.level,
        durationSec: it.duration_sec,
        createdAt: it.created_at,
      })),
    };
  }

  async getOne(userId: string, id: string) {
    const it = await this.prisma.speaking_submissions.findFirst({
      where: { id, user_id: userId },
    });
    if (!it) throw new NotFoundException('Speaking submission not found');
    return {
      id: it.id,
      topic: it.topic,
      transcript: it.transcript,
      feedback: it.feedback,
      scores: (it.scores as Record<string, number> | null) ?? null,
      language: it.language,
      level: it.level,
      durationSec: it.duration_sec,
      audioUrl: it.audio_url,
      createdAt: it.created_at,
    };
  }

  async transcribe(
    userId: string,
    audio: string,
    mimeType?: string,
    language?: string,
    idempotencyKey?: string,
  ) {
    // Validate the payload before doing any billable work. WebSocket frames
    // bypass Express's body limit, so the service enforces the cap itself.
    if (
      typeof audio !== 'string' ||
      audio.length === 0 ||
      audio.length > SpeakingService.MAX_AUDIO_BASE64_LENGTH
    ) {
      throw new BadRequestException('Audio payload is missing or too large');
    }

    const toLangCode = (lang?: string): string => {
      if (!lang) return 'en';
      const map: Record<string, string> = {
        english: 'en',
        vietnamese: 'vi',
        japanese: 'ja',
        chinese: 'zh',
        korean: 'ko',
        spanish: 'es',
        french: 'fr',
        german: 'de',
      };
      return map[lang.toLowerCase()] ?? lang;
    };

    const apiKey = this.config.get<string>('GROQ_API_KEY');
    const isProduction = this.config.get<string>('NODE_ENV') === 'production';
    if (isProduction && (!apiKey || apiKey === 'your-groq-api-key')) {
      // Never serve canned transcripts to real users in production.
      throw new ServiceUnavailableException('Speech transcription is unavailable');
    }
    if (!apiKey || apiKey === 'your-groq-api-key') {
      // Mock transcription in development/test environment without Groq key
      const defaultTranscripts: Record<string, string> = {
        en: 'the quick brown fox jumps over the lazy dog',
        vi: 'xin chào thế giới',
        ja: 'こんにちは世界',
      };
      const langCode = toLangCode(language);
      const transcript = defaultTranscripts[langCode] || 'the quick brown fox jumps over the lazy dog';
      return { transcript };
    }

    // 2. Transcribe using Groq Whisper
    let transcript: string;
    try {
      const buf = Buffer.from(audio, 'base64');
      const mime = mimeType || 'audio/webm';
      const ext = (mime.split('/')[1]?.split(';')[0] || 'webm').replace('mpeg', 'mp3');

      // Build a File-like object that groq-sdk accepts
      const audioFile = new File([buf], `speech.${ext}`, { type: mime });

      const transcriptionResult = await this.groq.audio.transcriptions.create({
        file: audioFile as any,
        model: this.modelStt,
        response_format: 'text',
        language: toLangCode(language),
      });

      transcript = (
        typeof transcriptionResult === 'string'
          ? transcriptionResult
          : (transcriptionResult as any).text ?? ''
      ).trim();
    } catch (err) {
      const isDev = this.config.get<string>('NODE_ENV') === 'development' || this.config.get<string>('APP_ENV') === 'development';
      if (isDev) {
        // Fallback to mock in development mode when transcription fails (e.g. dummy/empty audio in headless test)
        const defaultTranscripts: Record<string, string> = {
          en: 'the quick brown fox jumps over the lazy dog',
          vi: 'xin chào thế giới',
          ja: 'こんにちは世界',
        };
        const langCode = toLangCode(language);
        transcript = defaultTranscripts[langCode] || 'the quick brown fox jumps over the lazy dog';
      } else {
        throw err;
      }
    }

    // 3. Charge only after a transcript was produced successfully.
    await this.tokensService.consumeTokens(
      userId,
      'speaking_feedback',
      undefined,
      idempotencyKey,
    );

    return { transcript };
  }
}
