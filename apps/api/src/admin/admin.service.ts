import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../common/services/redis.service';
import { Role } from '../users/enums/role.enum';
import { CreateContentDto, UpdateContentDto } from './dto/admin.dto';

/** Upper bound for admin list pages, enforced even if controller validation is bypassed. */
const MAX_PAGE_SIZE = 100;

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  async getOverview() {
    const [totalUsers, totalDecks, totalQuizzes, totalSessions, totalContent] = await Promise.all([
      this.prisma.users.count(),
      this.prisma.decks.count(),
      this.prisma.quizzes.count(),
      this.prisma.review_sessions.count(),
      this.prisma.content_items.count(),
    ]);

    const recentUsers = await this.prisma.users.findMany({
      select: { id: true, email: true, first_name: true, last_name: true, created_at: true },
      orderBy: { created_at: 'desc' },
      take: 5,
    });

    return {
      totalUsers,
      totalDecks,
      totalQuizzes,
      totalSessions,
      totalContent,
      recentUsers: recentUsers.map((u) => ({
        id: u.id,
        email: u.email,
        displayName: `${u.first_name} ${u.last_name}`,
        createdAt: u.created_at,
      })),
    };
  }

  async getAllUsers(page: number = 1, limit: number = 20) {
    // The controller currently forwards raw query strings. Normalize here as a
    // last line of defence so skip/take can never be fractional, negative or
    // unbounded (which would let callers dump the whole users table).
    const requestedPage = Number(page);
    const requestedLimit = Number(limit);
    const safePage = Number.isFinite(requestedPage) && requestedPage >= 1
      ? Math.floor(requestedPage)
      : 1;
    const safeLimit = Number.isFinite(requestedLimit) && requestedLimit >= 1
      ? Math.min(Math.floor(requestedLimit), MAX_PAGE_SIZE)
      : 20;
    const skip = (safePage - 1) * safeLimit;
    const [users, total] = await Promise.all([
      this.prisma.users.findMany({
        select: {
          id: true,
          email: true,
          first_name: true,
          last_name: true,
          total_xp: true,
          streak_count: true,
          created_at: true,
          user_roles: { include: { roles: true } },
          token_balance: { select: { balance: true } }
        },
        skip,
        take: safeLimit,
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.users.count(),
    ]);
    const items = users.map((u) => ({
      id: u.id,
      email: u.email,
      displayName: `${u.first_name} ${u.last_name}`,
      role: u.user_roles[0]?.roles?.name || 'USER',
      totalXp: u.total_xp,
      streakCount: u.streak_count,
      createdAt: u.created_at,
      tokens: u.token_balance?.balance ?? 0,
    }));
    return {
      items,
      total,
      page: safePage,
      pageSize: safeLimit,
      totalPages: Math.ceil(total / safeLimit),
    };
  }

  async updateUserRole(userId: string, role: Role | 'USER' | 'ADMIN' | 'MODERATOR' | 'user' | 'admin' | 'moderator') {
    // Accept every role in the domain enum instead of collapsing MODERATOR to USER.
    const requested = String(role || '').toUpperCase();
    if (!Object.values(Role).includes(requested as Role)) {
      throw new BadRequestException(`Unsupported role: ${role}`);
    }
    const roleName = requested as Role;

    // Changing roles must be atomic with the "last admin" check, otherwise two
    // concurrent demotions could lock everyone out of the admin API.
    const result = await this.prisma.$transaction(async (tx) => {
      if (roleName !== Role.ADMIN) {
        const currentRoles = await tx.user_roles.findMany({
          where: { users_id: userId },
          include: { roles: true },
        });
        const isCurrentlyAdmin = currentRoles.some((ur) => ur.roles.name === Role.ADMIN);
        if (isCurrentlyAdmin) {
          const adminCount = await tx.user_roles.count({
            where: { roles: { name: Role.ADMIN } },
          });
          if (adminCount <= 1) {
            throw new BadRequestException(
              'Cannot demote the last administrator. Assign another admin first.',
            );
          }
        }
      }

      const roleRecord = await tx.roles.findUnique({ where: { name: roleName as any } });
      if (!roleRecord) {
        throw new BadRequestException(`Role ${roleName} is not configured`);
      }
      // Replace the privileged role without destroying unrelated roles such as
      // MODERATOR. Keep the role set idempotent for repeat requests.
      await tx.user_roles.deleteMany({
        where: { users_id: userId, roles: { name: { in: [Role.ADMIN, Role.USER, Role.MODERATOR] } } },
      });
      await tx.user_roles.create({ data: { users_id: userId, roles_id: roleRecord.id } });

      return tx.users.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          first_name: true,
          last_name: true,
          user_roles: { include: { roles: true } },
        },
      });
    });

    // jwt.strategy caches roles for 60s; drop the stale entry immediately.
    await this.redis.del(`cache:user:${userId}`);
    return result
      ? {
          id: result.id,
          email: result.email,
          displayName: `${result.first_name} ${result.last_name}`,
          role: result.user_roles[0]?.roles?.name || Role.USER,
        }
      : null;
  }

  async deleteUser(userId: string) {
    await this.prisma.users.update({
      where: { id: userId },
      data: {
        is_deleted: true,
        delete_status: 'DELETE_REQUESTED',
        deleted_at: new Date(),
      },
    });
    // JwtStrategy trusts the 60s cache without rechecking is_deleted, so the
    // disabled account keeps working until this entry is removed.
    await this.redis.del(`cache:user:${userId}`);
  }

  // ===== Content Management =====

  async getContent(type?: string) {
    return this.prisma.content_items.findMany({
      where: type ? { type } : {},
      orderBy: [{ sort_order: 'asc' }, { created_at: 'desc' }],
    });
  }

  async createContent(dto: CreateContentDto) {
    const data: any = {
      type: dto.type,
      title: dto.title,
      title_vi: dto.titleVi ?? '',
      level: dto.level ?? 'A1',
      category: dto.category ?? '',
      content: dto.content ?? '',
      audio_url: dto.audioUrl ?? '',
      duration: dto.duration ?? '',
      word_count: dto.wordCount ?? 0,
      published: dto.published ?? true,
      sort_order: dto.sortOrder ?? 0,
      data: dto.data ?? {},
      questions: dto.questions ?? [],
    };
    return this.prisma.content_items.create({ data });
  }

  async updateContent(id: string, dto: UpdateContentDto) {
    const data: any = {};
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.titleVi !== undefined) data.title_vi = dto.titleVi;
    if (dto.level !== undefined) data.level = dto.level;
    if (dto.category !== undefined) data.category = dto.category;
    if (dto.content !== undefined) data.content = dto.content;
    if (dto.audioUrl !== undefined) data.audio_url = dto.audioUrl;
    if (dto.duration !== undefined) data.duration = dto.duration;
    if (dto.wordCount !== undefined) data.word_count = dto.wordCount;
    if (dto.published !== undefined) data.published = dto.published;
    if (dto.sortOrder !== undefined) data.sort_order = dto.sortOrder;
    if (dto.data !== undefined) data.data = dto.data;
    if (dto.questions !== undefined) data.questions = dto.questions;
    data.updated_at = new Date();

    return this.prisma.content_items.update({ where: { id }, data });
  }

  async getContentById(id: string) {
    return this.prisma.content_items.findUnique({ where: { id } });
  }

  async deleteContent(id: string) {
    await this.prisma.content_items.delete({ where: { id } });
  }
}
