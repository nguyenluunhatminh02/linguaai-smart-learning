import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { AiClientService } from '../common/services/ai-client.service';
import { GenerateReadingDto } from './dto/reading.dto';

// Curated topic pool keyed by language and broad category
const TOPIC_POOL: Record<string, string[]> = {
  english: [
    'technology', 'climate change', 'health and medicine', 'travel', 'food culture',
    'history', 'space exploration', 'business', 'art and culture', 'sports',
    'education', 'environment', 'psychology', 'economics', 'social media',
    'artificial intelligence', 'biodiversity', 'urban living', 'music', 'cinema',
  ],
  chinese: [
    '科技', '饮食文化', '运动', '游覆', '历史', '自然', '商业', '教育', '刻分', '家庭',
    '经济', '中国传统', '健康', '环境保护', '両山',
  ],
  japanese: [
    '技術', '料理', '旅行', 'スポーツ', '歴史', '自然', 'ビジネス', '教育', '音楽', '映画',
    '伝統文化', '健康', '環境', '社会', '科学',
  ],
};

@Injectable()
export class ReadingService {
  constructor(
    private prisma: PrismaService,
    private aiClient: AiClientService,
    @Inject(CACHE_MANAGER) private cache: Cache,
  ) {}

  async generate(userId: string, dto: GenerateReadingDto) {
    const language = dto.language || 'english';
    const wordCount = dto.wordCount || 300;

    // Cache is only keyed by request parameters that affect the generated output.
    // A fresh DB row is always created below so each generation is recorded in the
    // user's history and the returned passage ID always belongs to this user.
    const cacheKey = `reading:prompt:${dto.level}:${dto.topic}:${language}:${wordCount}`;
    let cachedPrompt: { passage: string; vocabulary: unknown[]; questions: unknown[] } | undefined;
    try {
      cachedPrompt = await this.cache.get<typeof cachedPrompt>(cacheKey);
    } catch {
      // cache-manager store incompatibility – proceed without cache
    }

    type AiQuestion = {
      question: string;
      options: string[];
      correctAnswer?: string | number;
      correct_answer?: string | number;
      explanation?: string;
    };
    type AiReading = {
      passage: string;
      vocabulary: Array<{ word: string; meaning?: string; definition?: string; part_of_speech?: string }>;
      questions: AiQuestion[];
    };

    const aiResult: AiReading = cachedPrompt
      ? (cachedPrompt as AiReading)
      : await this.aiClient.post<AiReading>('/ai/reading/generate', {
          level: dto.level,
          topic: dto.topic,
          word_count: wordCount,
          language,
        });

    // Normalize AI vocabulary to unified shape
    const normalizedVocab = (aiResult.vocabulary || []).map(v => ({
      word: v.word,
      meaning: v.definition || v.meaning || '',
      definition: v.definition || v.meaning || '',
      partOfSpeech: v.part_of_speech || '',
      example: '',
    }));
    // Normalize AI questions. Only accept questions with a real answer key;
    // never invent one (defaulting to "A" would silently grade correct answers wrong).
    const normalizedQuestions: Array<{
      question: string;
      options: string[];
      correctAnswer: string;
      explanation: string;
    }> = [];
    for (const q of aiResult.questions || []) {
      if (typeof q?.question !== 'string' || !q.question.trim()) continue;
      if (!Array.isArray(q.options) || q.options.some((option) => typeof option !== 'string')) continue;
      const options = q.options.map((option) => option.trim()).filter(Boolean);
      if (options.length < 2) continue;
      const rawAnswer = q.correctAnswer ?? q.correct_answer;
      if (typeof rawAnswer !== 'string' && typeof rawAnswer !== 'number') continue;
      const answerText = String(rawAnswer).trim();
      // Accept an option index (0- or 1-based), a letter marker, or the exact option text.
      const indexMatch = answerText.match(/^(\d+)$/);
      const letterMatch = answerText.match(/^([a-z])$/i);
      let correctAnswer: string | undefined;
      if (indexMatch) {
        const index = Number(indexMatch[1]);
        correctAnswer = options[index] ?? options[index - 1];
      } else if (letterMatch) {
        correctAnswer = options[letterMatch[1].toUpperCase().charCodeAt(0) - 65];
      } else {
        correctAnswer = options.find((option) => option === answerText);
      }
      if (!correctAnswer) continue;
      normalizedQuestions.push({
        question: q.question.trim(),
        options,
        correctAnswer,
        explanation: typeof q.explanation === 'string' ? q.explanation : '',
      });
    }

    // Always persist a fresh row so the user's generation history and token
    // charge stay consistent, and the returned ID references this user's row.
    const passage = await this.prisma.reading_passages.create({
      data: {
        generated_by_user_id: userId,
        passage_text: aiResult.passage,
        vocabulary: normalizedVocab as any,
        questions: normalizedQuestions as any,
        level: dto.level,
        topic: dto.topic,
        language,
      },
    });

    // Cache only the reusable prompt output, never a user-specific passage ID.
    if (!cachedPrompt) {
      try {
        await this.cache.set(cacheKey, {
          passage: aiResult.passage,
          vocabulary: normalizedVocab,
          questions: aiResult.questions || [],
        }, 86_400_000); // 24h cache
      } catch {
        // cache-manager store incompatibility – ignore
      }
    }

    return {
      id: passage.id,
      passage: aiResult.passage,
      vocabulary: normalizedVocab,
      questions: normalizedQuestions,
    };
  }

  async getHistory(userId: string, page = 1, limit = 10) {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.prisma.reading_passages.findMany({
        where: { generated_by_user_id: userId },
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.reading_passages.count({ where: { generated_by_user_id: userId } }),
    ]);
    return { items, total, page, pageSize: limit, totalPages: Math.ceil(total / limit) };
  }

  /**
   * SEC-02: a passage belongs to the user who generated it. The ownership
   * predicate lives in the repository query, so another user's valid UUID is
   * indistinguishable from a missing one (404, never the passage body).
   */
  async getById(userId: string, id: string) {
    const passage = await this.prisma.reading_passages.findFirst({
      where: { id, generated_by_user_id: userId },
    });
    if (!passage) {
      throw new NotFoundException('Reading passage not found');
    }
    return passage;
  }

  /**
   * Personalized topic recommendations.
   *
   * Strategy:
   *  1. Exclude topics the user has already read recently (avoid repetition)
   *  2. Score remaining topics by novelty
   *  3. Return top N with rationale
   */
  async getRecommendations(userId: string, language = 'english', limit = 5) {
    const cacheKey = `recommendations:${userId}:${language}`;
    const cached = await this.cache.get<{ topics: unknown[] }>(cacheKey);
    if (cached) return cached;

    // Get recently read topics
    const recentPassages = await this.prisma.reading_passages.findMany({
      where: { generated_by_user_id: userId },
      select: { topic: true, level: true, created_at: true },
      orderBy: { created_at: 'desc' },
      take: 50,
    });

    const recentTopics = new Set(
      recentPassages.slice(0, 10).map((p) => (p.topic || '').toLowerCase()),
    );

    // Determine topic frequency to find undercovered areas
    const topicFrequency: Record<string, number> = {};
    for (const p of recentPassages) {
      const t = (p.topic || '').toLowerCase();
      topicFrequency[t] = (topicFrequency[t] || 0) + 1;
    }

    const pool = TOPIC_POOL[language] || TOPIC_POOL['english'];

    // Score each topic: lower score = higher priority (less seen)
    const scored = pool.map((topic) => ({
      topic,
      score: topicFrequency[topic.toLowerCase()] || 0,
      isNew: !recentTopics.has(topic.toLowerCase()),
    }));

    // Sort: unseen topics first, then least-read, shuffle within same score
    scored.sort((a, b) => {
      if (a.isNew !== b.isNew) return a.isNew ? -1 : 1;
      return a.score - b.score;
    });

    const mostReadLevel = this._inferLevel(recentPassages);
    const recommendations = scored.slice(0, limit).map((s, i) => ({
      rank: i + 1,
      topic: s.topic,
      suggestedLevel: mostReadLevel,
      reason: s.isNew ? 'New topic — broaden your vocabulary' : 'Revisit to deepen comprehension',
      timesRead: s.score,
    }));

    const result = { language, recommendations, basedOn: recentPassages.length };
    await this.cache.set(cacheKey, result, 3_600_000); // 1h cache
    return result;
  }

  private _inferLevel(passages: { level: string | null }[]): string {
    if (passages.length === 0) return 'B1';
    const levelOrder = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
    const counts: Record<string, number> = {};
    for (const p of passages) {
      const l = (p.level || 'B1').toUpperCase();
      counts[l] = (counts[l] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'B1';
  }

  /**
   * NLP Enhancement: analyze a text to understand its linguistic complexity
   * before generating study materials from it.
   */
  async analyzeText(text: string, language = 'english') {
    return this.aiClient.post<Record<string, unknown>>('/ai/nlp/analyze', {
      text,
      language,
    });
  }
}
