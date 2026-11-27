import { Injectable, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { AiClientService } from '../common/services/ai-client.service';
import { ExplainGrammarDto } from './dto/grammar.dto';

@Injectable()
export class GrammarService {
  constructor(
    private aiClient: AiClientService,
    @Inject(CACHE_MANAGER) private cache: Cache,
  ) {}

  async explain(dto: ExplainGrammarDto, userId?: string) {
    const lang = dto.language || 'english';
    // The user's question can influence (or inject into) the AI response, so a
    // response produced for one user must never be served to another. When a
    // userId is available, scope the cache key to that user. For callers that
    // don't supply one, skip caching entirely for user-supplied questions;
    // only generic explanations (no userQuestion) are safe to share.
    const point = dto.grammarPoint.toLowerCase().replace(/\s+/g, '_');
    const hasUserQuestion = Boolean(dto.userQuestion);
    const cacheKey = userId
      ? `grammar:${lang}:${userId}:${point}:${(dto.userQuestion || '').toLowerCase().replace(/\s+/g, '_')}`
      : hasUserQuestion
        ? null
        : `grammar:${lang}:${point}`;

    if (cacheKey) {
      try {
        const cached = await this.cache.get(cacheKey);
        if (cached) return cached;
      } catch {
        // Cache unavailable — continue without it
      }
    }

    const result = await this.aiClient.post('/ai/grammar/explain', {
      grammar_point: dto.grammarPoint,
      language: lang,
      user_question: dto.userQuestion,
    });

    if (cacheKey) {
      try {
        // Cache grammar explanations for 1 hour (3_600_000 ms)
        await this.cache.set(cacheKey, result, 3_600_000);
      } catch {
        // Cache write failed — ignore
      }
    }

    return result;
  }
}
