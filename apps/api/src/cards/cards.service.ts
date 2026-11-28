import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { DecksService } from "../decks/decks.service";
import { AiClientService } from "../common/services/ai-client.service";
import { CreateCardDto, UpdateCardDto, GenerateCardsDto } from "./dto/card.dto";
import { TokensService } from "../tokens/tokens.service";
import { requestContextStorage } from "../common/utils/request-context";

@Injectable()
export class CardsService {
  private readonly logger = new Logger(CardsService.name);

  constructor(
    private prisma: PrismaService,
    private decksService: DecksService,
    private aiClient: AiClientService,
    private tokensService: TokensService,
  ) {}

  /**
   * SEC-02: mutations stay behind a service-level ownership check. `userId` is
   * required for every write so a service call without a caller fails closed.
   */
  private async requireDeckOwner(deckId: string, userId?: string) {
    if (!userId) throw new ForbiddenException();
    const deck = await this.decksService.findById(deckId, userId);
    if (deck.creator_id !== userId) throw new ForbiddenException();
    return deck;
  }

  async create(deckId: string, dto: CreateCardDto, userId?: string) {
    await this.requireDeckOwner(deckId, userId);
    // The card write and the denormalised deck count must commit together.
    return this.prisma.$transaction(async (tx) => {
      const card = await tx.cards.create({
        data: {
          deck_id: deckId,
          front_text: dto.frontText,
          back_text: dto.backText,
          ipa_pronunciation: dto.ipaPronunciation,
          audio_url: dto.audioUrl,
          example_sentence: dto.exampleSentence,
          image_url: (dto as any).imageUrl,
        },
      });
      await tx.decks.update({
        where: { id: deckId },
        data: { card_count: { increment: 1 } },
      });
      return card;
    });
  }

  async findByDeck(deckId: string, userId?: string) {
    // A private deck's contents are never public, even via its card list.
    await this.decksService.findById(deckId, userId);
    if (!userId) {
      return this.prisma.cards.findMany({
        where: { deck_id: deckId, retired_at: null },
        orderBy: { created_at: "asc" },
      });
    }

    const cards = await this.prisma.cards.findMany({
      where: { deck_id: deckId, retired_at: null },
      include: {
        user_card_progress: {
          where: { user_id: userId },
        },
      },
      orderBy: { created_at: "asc" },
    });

    return cards.map((c) => {
      const progress = c.user_card_progress?.[0];
      return {
        id: c.id,
        deck_id: c.deck_id,
        front_text: c.front_text,
        back_text: c.back_text,
        ipa_pronunciation: c.ipa_pronunciation,
        audio_url: c.audio_url,
        example_sentence: c.example_sentence,
        image_url: c.image_url,
        created_at: c.created_at,
        progress: progress
          ? {
              easeFactor: progress.ease_factor,
              difficulty: progress.difficulty,
              intervalDays: progress.interval_days,
              repetitionCount: progress.repetition_count,
              nextReviewDate: progress.next_review_date,
              lastReviewDate: progress.last_review_date,
            }
          : null,
      };
    });
  }

  /** Load a card with the deck metadata needed for the SEC-02 visibility check. */
  private async findCardWithDeck(id: string, userId?: string) {
    const card = await this.prisma.cards.findUnique({
      where: { id },
      include: { decks: { select: { creator_id: true, is_public: true } } },
    });
    if (!card) throw new NotFoundException("Card not found");
    if (!userId || !card.decks.is_public) {
      if (!userId || card.decks.creator_id !== userId) {
        throw new NotFoundException("Card not found");
      }
    }
    return card;
  }

  async findById(id: string, userId?: string) {
    const card = await this.findCardWithDeck(id, userId);
    // Keep the original public response shape: the relation was fetched only
    // to enforce visibility.
    const { decks: _decks, ...publicCard } = card;
    return publicCard;
  }

  async update(id: string, dto: UpdateCardDto, userId?: string) {
    const card = await this.findCardWithDeck(id, userId);
    if (!userId || card.decks.creator_id !== userId) throw new ForbiddenException();
    return this.prisma.cards.update({
      where: { id },
      data: {
        front_text: (dto as any).frontText,
        back_text: (dto as any).backText,
        ipa_pronunciation: (dto as any).ipaPronunciation,
        audio_url: (dto as any).audioUrl,
        example_sentence: (dto as any).exampleSentence,
        image_url: (dto as any).imageUrl,
      } as any,
    });
  }

  async remove(id: string, userId?: string) {
    const card = await this.findCardWithDeck(id, userId);
    if (!userId || card.decks.creator_id !== userId) throw new ForbiddenException();
    // Already retired: do not decrement the count a second time.
    if (card.retired_at) throw new NotFoundException("Card not found");

    // Deleting a card cascades to user_card_progress and srs_review_events.
    // If anyone has studied it, retire it instead: every SRS query filters on
    // retired_at, so the card disappears without destroying learner progress.
    const [progressCount, reviewCount] = await Promise.all([
      this.prisma.user_card_progress.count({ where: { card_id: id } }),
      this.prisma.srs_review_events.count({ where: { card_id: id } }),
    ]);
    const hasHistory = progressCount > 0 || reviewCount > 0;

    return this.prisma.$transaction(async (tx) => {
      if (hasHistory) {
        await tx.cards.update({
          where: { id },
          data: { retired_at: new Date() },
        });
      } else {
        await tx.cards.delete({ where: { id } });
      }
      await tx.decks.update({
        where: { id: card.deck_id },
        data: { card_count: { increment: -1 } },
      });
    });
  }

  async bulkCreate(deckId: string, cards: CreateCardDto[], userId?: string) {
    await this.requireDeckOwner(deckId, userId);
    // Pre-generate ids so we can insert in a single statement (createMany) and
    // still return the exact rows we created (createMany does not return rows).
    const data = cards.map((dto) => ({
      id: randomUUID(),
      deck_id: deckId,
      front_text: dto.frontText,
      back_text: dto.backText,
      ipa_pronunciation: dto.ipaPronunciation,
      audio_url: dto.audioUrl,
      example_sentence: dto.exampleSentence,
      image_url: (dto as any).imageUrl,
    }));
    return this.prisma.$transaction(async (tx) => {
      await tx.cards.createMany({ data });
      await tx.decks.update({
        where: { id: deckId },
        data: { card_count: { increment: data.length } },
      });
      return tx.cards.findMany({
        where: { id: { in: data.map((d) => d.id) } },
        orderBy: { created_at: "asc" },
      });
    });
  }

  async generateFromText(
    deckId: string,
    dto: GenerateCardsDto,
    userId?: string,
    idempotencyKey?: string,
  ) {
    // Ownership is checked before the AI call and the token debit: a
    // non-owner must not be able to spend another user's deck/quota.
    await this.requireDeckOwner(deckId, userId);

    // The controller passes the header when available; otherwise the request
    // context (populated in main.ts) supplies it. Scoped to this user/feature
    // and stored on the token transaction so a retried request is charged at
    // most once even across process restarts.
    const contextKey = (requestContextStorage.getStore() as any)?.idempotencyKey;
    const rawKey = idempotencyKey ?? contextKey;
    const validKey =
      typeof rawKey === "string" && /^[A-Za-z0-9._:-]{8,64}$/.test(rawKey)
        ? rawKey
        : undefined;
    const tokenKey = userId && validKey
      ? `${userId}:cards_generate:${validKey}`.slice(0, 128)
      : undefined;
    const batchKey = tokenKey ? `cards_generate:${tokenKey}` : undefined;

    if (batchKey) {
      // A replay of an already-successful request must not create a second
      // batch (and must not be charged again).
      const existing = await this.prisma.cards.findMany({
        where: {
          deck_id: deckId,
          seed_key: { startsWith: `${batchKey}:` },
        },
        orderBy: { created_at: "asc" },
      });
      if (existing.length > 0) {
        return { generated: existing.length, cards: existing };
      }
    }

    // Call the AI first: an unavailable or timed-out service must never cost
    // the user tokens when no cards are produced.
    const aiResult = await this.aiClient.post<{
      cards: Array<{
        front: string;
        back: string;
        example: string;
        pronunciation: string;
        difficulty: number;
      }>;
    }>("/ai/content/generate-cards", {
      text: dto.text,
      language: dto.language || "english",
      count: dto.count || 10,
    });

    // LLM output is untrusted: enforce the database varchar limits before
    // createMany, otherwise one overlong field rejects the whole batch.
    const clamp = (value: unknown, max: number): string =>
      typeof value === "string" ? value.trim().slice(0, max) : "";
    const aiCards = Array.isArray(aiResult?.cards) ? aiResult.cards : [];
    const data = aiCards
      .map((c, index) => ({
        id: randomUUID(),
        deck_id: deckId,
        front_text: clamp(c?.front, 500),
        back_text: clamp(c?.back, 500),
        example_sentence: clamp(c?.example, 1000),
        ipa_pronunciation: clamp(c?.pronunciation, 255),
        // Persisting the key with the batch makes a retried request return
        // the same cards instead of charging again and duplicating the batch.
        seed_key: batchKey ? `${batchKey}:${index}` : undefined,
      }))
      .filter((c) => c.front_text.length > 0 && c.back_text.length > 0);

    if (data.length === 0) {
      // Charge only for cards that will actually be saved.
      throw new BadRequestException("AI did not generate any valid cards");
    }

    // Charge only after the AI call succeeded and validation produced usable
    // cards. The key is persisted on the token transaction, so a client retry
    // of this successful response cannot debit the user a second time.
    if (userId) {
      await this.tokensService.consumeTokens(
        userId,
        "cards_generate",
        undefined,
        tokenKey,
      );
    }

    let created: Awaited<ReturnType<PrismaService["cards"]["findMany"]>>;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        await tx.cards.createMany({ data });
        await tx.decks.update({
          where: { id: deckId },
          data: { card_count: { increment: data.length } },
        });
        return tx.cards.findMany({
          where: { id: { in: data.map((d) => d.id) } },
          orderBy: { created_at: "asc" },
        });
      });
    } catch (error: any) {
      // Do not refund here: the debit's idempotency key is still active, so a
      // refund plus a retry would let the same key yield cards with no charge.
      this.logger.error(
        `Failed to persist generated cards for deck ${deckId}: ${error?.message}`,
      );
      throw error;
    }

    return {
      generated: created.length,
      cards: created,
    };
  }
}
