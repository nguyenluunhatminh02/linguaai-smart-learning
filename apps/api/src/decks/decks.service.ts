import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDeckDto, UpdateDeckDto } from './dto/deck.dto';

@Injectable()
export class DecksService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: CreateDeckDto) {
    const { isPublic, ...rest } = dto;
    return this.prisma.decks.create({
      data: {
        ...rest,
        is_public: isPublic ?? false,
        creator_id: userId,
      },
    });
  }

  async findAll(userId: string, page = 1, limit = 20, language?: string) {
    const skip = (page - 1) * limit;
    const where: any = {
      OR: [{ creator_id: userId }, { is_public: true }],
    };
    if (language) {
      where.language = language;
    }
    const [items, total] = await Promise.all([
      this.prisma.decks.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.decks.count({
        where,
      }),
    ]);
    return { items, total, page, pageSize: limit, totalPages: Math.ceil(total / limit) };
  }

  async findById(id: string) {
    const deck = await this.prisma.decks.findUnique({ where: { id } });
    if (!deck) throw new NotFoundException('Deck not found');
    return deck;
  }

  async findByUser(userId: string, page = 1, limit = 20) {
    // Bound the result set: GET /decks/my must not be able to return an
    // arbitrarily large number of decks. Keep the array response shape —
    // web pages consume it directly as an array.
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const safePage = Math.max(page, 1);
    return this.prisma.decks.findMany({
      where: { creator_id: userId },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
      orderBy: { created_at: 'desc' },
    });
  }

  async update(id: string, userId: string, dto: UpdateDeckDto) {
    const deck = await this.findById(id);
    if (deck.creator_id !== userId) throw new ForbiddenException();
    const { isPublic, ...rest } = dto;
    return this.prisma.decks.update({
      where: { id },
      data: {
        ...rest,
        ...(isPublic !== undefined ? { is_public: isPublic } : {}),
      },
    });
  }

  async remove(id: string, userId: string) {
    const deck = await this.findById(id);
    if (deck.creator_id !== userId) throw new ForbiddenException();

    // Deleting a deck cascades to its cards, and from there to every learner's
    // SRS progress and review events. Refuse to destroy other users' study data:
    // unlist the deck instead so existing progress stays intact.
    const cardIds = await this.prisma.cards.findMany({
      where: { deck_id: id },
      select: { id: true },
    });
    const ids = cardIds.map((card) => card.id);

    const [foreignSessions, foreignProgress, foreignReviews] = await Promise.all([
      this.prisma.review_sessions.count({
        where: { deck_id: id, user_id: { not: userId } },
      }),
      ids.length
        ? this.prisma.user_card_progress.count({
            where: { card_id: { in: ids }, user_id: { not: userId } },
          })
        : Promise.resolve(0),
      ids.length
        ? this.prisma.srs_review_events.count({
            where: { card_id: { in: ids }, user_id: { not: userId } },
          })
        : Promise.resolve(0),
    ]);

    if (foreignSessions + foreignProgress + foreignReviews > 0) {
      if (deck.is_public) {
        // Soft delete: unlist the shared deck while preserving all learners' data.
        return this.prisma.decks.update({
          where: { id },
          data: { is_public: false },
        });
      }
      throw new ConflictException(
        'Cannot delete a deck that other learners have studied; unlist it first to preserve their progress.',
      );
    }

    await this.prisma.decks.delete({ where: { id } });
  }

  async updateCardCount(deckId: string, delta: number) {
    await this.prisma.decks.update({
      where: { id: deckId },
      data: { card_count: { increment: delta } },
    });
  }
}
