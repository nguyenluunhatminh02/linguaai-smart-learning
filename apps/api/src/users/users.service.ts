import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as fs from 'fs';
import * as path from 'path';
import { User } from './entities/user.entity';
import {
  UserResponse,
  UserSessionResponse,
  LoginHistoryResponse,
  NotificationPreferencesResponse,
  PrivacySettingsResponse,
  DeviceFingerprintResponse,
} from '../auth/dto/auth-response.dto';
import {
  PageResponse,
  buildPageResponse,
} from '../common/utils/pagination.util';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { toAppUser, mapToUserResponse } from '../common/mappers/user.mapper';
import type { UpdateLearningPreferencesDto } from './dto/update-learning-preferences.dto';

const learningPreferencesSelect = {
  learning_level: true,
  daily_study_minutes: true,
  daily_word_goal: true,
  daily_goal: true,
} as const;

function mapLearningPreferences(settings: {
  learning_level: string | null;
  daily_study_minutes: number | null;
  daily_word_goal: number;
  daily_goal: number;
}) {
  return {
    level: settings.learning_level === 'A2' ? 'A2' : 'A1',
    dailyStudyMinutes: settings.daily_study_minutes ?? 10,
    dailyWordGoal: settings.daily_word_goal,
    dailyReviewGoal: settings.daily_goal,
    configured:
      settings.learning_level !== null && settings.daily_study_minutes !== null,
  };
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  // ── Profile ────────────────────────────────────────────────────────────────

  /** Lấy full profile của user (dùng cho GET /users/me) */
  async getProfile(userId: string): Promise<UserResponse> {
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      include: {
        user_roles: { include: { roles: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return mapToUserResponse(toAppUser(user));
  }

  async getLearningPreferences(userId: string) {
    const settings = await this.prisma.users.findUnique({
      where: { id: userId },
      select: learningPreferencesSelect,
    });
    if (!settings) throw new NotFoundException('User not found');
    return mapLearningPreferences(settings);
  }

  async updateLearningPreferences(
    userId: string,
    dto: UpdateLearningPreferencesDto,
  ) {
    const settings = await this.prisma.users.update({
      where: { id: userId },
      data: {
        learning_level: dto.level,
        daily_study_minutes: dto.dailyStudyMinutes,
        daily_word_goal: dto.dailyWordGoal,
        daily_goal: dto.dailyReviewGoal,
      },
      select: learningPreferencesSelect,
    });
    return mapLearningPreferences(settings);
  }

  /** Upload avatar — trả về URL mới */
  async uploadAvatar(
    userId: string,
    file:
      | { originalname?: string; mimetype?: string; size?: number }
      | undefined,
  ): Promise<{ avatarUrl: string }> {
    // Đơn giản: lưu file vào uploads/ và trả URL
    // Trong production dùng FilesService (MinIO)
    if (!file || !file.originalname) {
      throw new BadRequestException('Avatar file is required');
    }
    const allowedMime = new Set([
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
    ]);
    if (!file.mimetype || !allowedMime.has(file.mimetype)) {
      throw new BadRequestException('Unsupported avatar mime type');
    }
    if (file.size != null && file.size > 5 * 1024 * 1024) {
      throw new BadRequestException('Avatar must be ≤ 5MB');
    }
    const extByMime: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
    };
    // Derive extension from mime, never from user-controlled filename, to avoid
    // path traversal / spoofed extensions. Also sanitize the userId segment.
    const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, '');
    const ext = extByMime[file.mimetype];
    const filename = `${safeUserId}-${Date.now()}.${ext}`;
    const avatarUrl = `/uploads/${filename}`;
    await this.prisma.users.update({
      where: { id: userId },
      data: { avatar_url: avatarUrl },
    });
    return { avatarUrl };
  }

  /** Xóa avatar */
  async deleteAvatar(userId: string): Promise<{ message: string }> {
    // Fetch current avatar URL before nulling it so we can unlink the file.
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      select: { avatar_url: true },
    });
    if (!user) throw new NotFoundException('User not found');

    // Remove the physical file if it exists and is under the uploads directory.
    if (user.avatar_url) {
      const filename = user.avatar_url.replace(/^\/uploads\//, '');
      const uploadDir = path.join(process.cwd(), 'uploads');
      const filePath = path.join(uploadDir, filename);
      // Validate the resolved path is still under uploads to prevent traversal.
      const resolvedPath = path.resolve(filePath);
      const resolvedUploadDir = path.resolve(uploadDir);
      if (resolvedPath.startsWith(resolvedUploadDir + path.sep)) {
        try {
          if (fs.existsSync(resolvedPath)) {
            fs.unlinkSync(resolvedPath);
          }
        } catch (err) {
          this.logger.warn(`Failed to delete avatar file: ${err}`);
        }
      }
    }

    await this.prisma.users.update({
      where: { id: userId },
      data: { avatar_url: null },
    });
    return { message: 'Avatar deleted' };
  }

  /** Deactivate account (soft) */
  async deactivateAccount(userId: string): Promise<{ message: string }> {
    await this.prisma.users.update({
      where: { id: userId },
      data: { is_active: false },
    });
    return { message: 'Account deactivated' };
  }

  async updateProfile(
    userId: string,
    dto: {
      firstName?: string;
      lastName?: string;
      phone?: string;
      dateOfBirth?: Date;
      gender?: string;
      language?: string;
      timezone?: string;
      nativeLanguage?: string | null;
      targetLanguage?: string | null;
    },
  ): Promise<User> {
    const user = await this.prisma.users.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const updated = await this.prisma.users.update({
      where: { id: userId },
      data: {
        first_name: dto.firstName,
        last_name: dto.lastName,
        phone: dto.phone,
        date_of_birth: dto.dateOfBirth,
        gender: dto.gender,
        language: dto.language,
        timezone: dto.timezone,
        native_language: dto.nativeLanguage,
        target_language: dto.targetLanguage,
      },
      include: {
        user_roles: { include: { roles: true } },
      },
    });

    return toAppUser(updated);
  }

  async updateAvatar(userId: string, avatarUrl: string): Promise<User> {
    const user = await this.prisma.users.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const updated = await this.prisma.users.update({
      where: { id: userId },
      data: { avatar_url: avatarUrl },
      include: {
        user_roles: { include: { roles: true } },
      },
    });

    return toAppUser(updated);
  }

  // ── Notification preferences ──────────────────────────────────────────────────

  async getNotificationPreferences(
    userId: string,
  ): Promise<NotificationPreferencesResponse> {
    const user = await this.prisma.users.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    return {
      notificationEmailEnabled: user.notification_email_enabled,
      notificationPushEnabled: user.notification_push_enabled,
      notificationInAppEnabled: user.notification_in_app_enabled,
      notificationSecurityEnabled: user.notification_security_enabled,
    };
  }

  async updateNotificationPreferences(
    userId: string,
    dto: Partial<{
      notificationEmailEnabled: boolean;
      notificationPushEnabled: boolean;
      notificationInAppEnabled: boolean;
      notificationSecurityEnabled: boolean;
    }>,
  ): Promise<NotificationPreferencesResponse> {
    const user = await this.prisma.users.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    await this.prisma.users.update({
      where: { id: userId },
      data: {
        notification_email_enabled: dto.notificationEmailEnabled,
        notification_push_enabled: dto.notificationPushEnabled,
        notification_in_app_enabled: dto.notificationInAppEnabled,
        notification_security_enabled: dto.notificationSecurityEnabled,
      },
    });

    return this.getNotificationPreferences(userId);
  }

  // ── Privacy settings ──────────────────────────────────────────────────────────

  async getPrivacySettings(userId: string): Promise<PrivacySettingsResponse> {
    const user = await this.prisma.users.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    return {
      profilePublic: user.profile_public,
      showEmail: user.show_email,
      showPhone: user.show_phone,
      showActivityStatus: user.show_activity_status,
    };
  }

  async updatePrivacySettings(
    userId: string,
    dto: Partial<{
      profilePublic: boolean;
      showEmail: boolean;
      showPhone: boolean;
      showActivityStatus: boolean;
    }>,
  ): Promise<PrivacySettingsResponse> {
    const user = await this.prisma.users.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    await this.prisma.users.update({
      where: { id: userId },
      data: {
        profile_public: dto.profilePublic,
        show_email: dto.showEmail,
        show_phone: dto.showPhone,
        show_activity_status: dto.showActivityStatus,
      },
    });

    return this.getPrivacySettings(userId);
  }

  // ── FCM token ─────────────────────────────────────────────────────────────────

  async updateFcmToken(userId: string, fcmToken: string): Promise<void> {
    const user = await this.prisma.users.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    await this.prisma.users.update({
      where: { id: userId },
      data: { fcm_token: fcmToken },
    });
  }

  // ── Device fingerprints ───────────────────────────────────────────────────────

  async getDevices(userId: string): Promise<DeviceFingerprintResponse[]> {
    const devices = await this.prisma.user_devices.findMany({
      where: { user_id: userId },
      orderBy: { last_active_at: 'desc' },
    });
    return devices.map((d) => ({
      id: d.id,
      fingerprint: d.fingerprint ?? '',
      deviceName: d.device_name ?? undefined,
      browser: d.browser ?? undefined,
      os: d.operating_system ?? undefined,
      ipAddress: d.ip_address ?? undefined,
      isTrusted: d.trusted,
      lastSeenAt: d.last_active_at ?? undefined,
      createdAt: d.created_at,
    }));
  }

  async trustDevice(userId: string, deviceId: string): Promise<void> {
    const device = await this.prisma.user_devices.findFirst({
      where: { id: deviceId, user_id: userId },
    });
    if (!device) throw new NotFoundException('Device not found');
    await this.prisma.user_devices.update({
      where: { id: deviceId },
      data: { trusted: true },
    });
  }

  async untrustDevice(userId: string, deviceId: string): Promise<void> {
    const device = await this.prisma.user_devices.findFirst({
      where: { id: deviceId, user_id: userId },
    });
    if (!device) throw new NotFoundException('Device not found');
    await this.prisma.user_devices.update({
      where: { id: deviceId },
      data: { trusted: false },
    });
  }

  async removeDevice(userId: string, deviceId: string): Promise<void> {
    const result = await this.prisma.user_devices.deleteMany({
      where: { id: deviceId, user_id: userId },
    });
    if (!result.count) throw new NotFoundException('Device not found');
  }

  // ── Security questions ────────────────────────────────────────────────────────

  async setupSecurityQuestions(
    userId: string,
    questions: { question: string; answer: string }[],
  ): Promise<void> {
    if (!questions.length || questions.length > 3) {
      throw new BadRequestException(
        'Provide between 1 and 3 security questions',
      );
    }

    // Enforce minimum answer length to prevent trivially guessable answers.
    // After lowercasing and trimming, the effective secret space must be large
    // enough to resist offline brute-force of the bcrypt hash.
    for (const q of questions) {
      const normalizedAnswer = q.answer.toLowerCase().trim();
      if (normalizedAnswer.length < 8) {
        throw new BadRequestException(
          'Security question answers must be at least 8 characters',
        );
      }
      if (!q.question || q.question.trim().length < 10) {
        throw new BadRequestException(
          'Security questions must be at least 10 characters',
        );
      }
    }

    const user = await this.prisma.users.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    // Replace existing questions atomically so a partial failure never leaves
    // the user with fewer questions than they submitted.
    await this.prisma.$transaction(async (tx) => {
      await tx.security_questions.deleteMany({ where: { user_id: userId } });

      for (let i = 0; i < questions.length; i += 1) {
        const q = questions[i];
        const answerHash = await bcrypt.hash(q.answer.toLowerCase().trim(), 10);
        await tx.security_questions.create({
          data: {
            user_id: userId,
            question: q.question,
            answer_hash: answerHash,
            sort_order: i,
          },
        });
      }
    });
  }

  async getSecurityQuestions(userId: string): Promise<string[]> {
    const sqs = await this.prisma.security_questions.findMany({
      where: { user_id: userId },
      orderBy: { sort_order: 'asc' },
    });
    return sqs.map((s) => s.question);
  }

  // ── Sessions ──────────────────────────────────────────────────────────────────

  async getActiveSessions(
    userId: string,
    currentAccessToken: string,
  ): Promise<UserSessionResponse[]> {
    const sessions = await this.prisma.refresh_tokens.findMany({
      where: { user_id: userId, is_revoked: false },
      orderBy: { last_active_at: 'desc' },
    });

    const decodeJti = (token: string): string | null => {
      try {
        const decoded = this.jwtService.decode(token);
        if (decoded && typeof decoded === 'object' && 'jti' in decoded) {
          const jti = (decoded as { jti?: unknown }).jti;
          return typeof jti === 'string' ? jti : null;
        }
        return null;
      } catch (error) {
        this.logger.debug(
          `Failed to decode JWT: ${error instanceof Error ? error.message : 'unknown'}`,
        );
        return null;
      }
    };

    const currentTokenId = decodeJti(currentAccessToken);

    return sessions.map((s) => {
      let isCurrent = false;
      if (currentTokenId && s.device_info) {
        isCurrent = decodeJti(s.device_info) === currentTokenId;
      }
      return {
        id: s.id,
        deviceInfo: s.device_info ?? 'Unknown',
        ipAddress: s.ip_address ?? 'Unknown',
        userAgent: s.user_agent ?? '',
        createdAt: s.created_at,
        lastActiveAt: s.last_active_at ?? s.created_at,
        current: isCurrent,
      };
    });
  }

  // ── Login history ─────────────────────────────────────────────────────────────

  // ── Privacy: data export and purge (SEC-11) ─────────────────────────────────

  /**
   * Build a portable copy of everything the user owns. Every query is scoped
   * to `userId`; nested chat messages are fetched through the caller's own
   * conversation ids, so another user's transcript can never be included.
   * Secrets (password hashes, MFA secrets, backup codes, reset/verification
   * tokens and security-question answers) are never exported.
   */
  async exportUserData(userId: string): Promise<Record<string, unknown>> {
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        first_name: true,
        last_name: true,
        phone: true,
        avatar_url: true,
        date_of_birth: true,
        gender: true,
        language: true,
        timezone: true,
        provider: true,
        email_verified: true,
        created_at: true,
        updated_at: true,
        notification_email_enabled: true,
        notification_push_enabled: true,
        notification_in_app_enabled: true,
        notification_security_enabled: true,
        profile_public: true,
        show_email: true,
        show_phone: true,
        show_activity_status: true,
        learning_level: true,
        daily_study_minutes: true,
        daily_word_goal: true,
        daily_goal: true,
        native_language: true,
        target_language: true,
        streak_count: true,
        total_xp: true,
        user_roles: { select: { roles: { select: { name: true } } } },
      },
    });
    if (!user) throw new NotFoundException('User not found');

    const [
      devices,
      securityQuestions,
      loginHistory,
      notifications,
      tokenBalance,
      tokenTransactions,
      decks,
      completions,
      srsEvents,
      cardProgress,
      reviewSessions,
      writingSubmissions,
      speakingSubmissions,
      readingPassages,
      conversations,
      quizAttempts,
      streaks,
      badges,
      aiOperations,
      creditGrants,
    ] = await Promise.all([
      this.prisma.user_devices.findMany({ where: { user_id: userId } }),
      this.prisma.security_questions.findMany({
        where: { user_id: userId },
        select: { question: true, sort_order: true },
      }),
      this.prisma.login_history.findMany({ where: { user_id: userId } }),
      this.prisma.notifications.findMany({ where: { user_id: userId } }),
      this.prisma.user_token_balance.findUnique({ where: { user_id: userId } }),
      this.prisma.token_transactions.findMany({ where: { user_id: userId } }),
      this.prisma.decks.findMany({
        where: { creator_id: userId },
        include: { cards: true },
      }),
      this.prisma.learning_completions.findMany({ where: { user_id: userId } }),
      this.prisma.srs_review_events.findMany({ where: { user_id: userId } }),
      this.prisma.user_card_progress.findMany({ where: { user_id: userId } }),
      this.prisma.review_sessions.findMany({ where: { user_id: userId } }),
      this.prisma.writing_submissions.findMany({ where: { user_id: userId } }),
      this.prisma.speaking_submissions.findMany({ where: { user_id: userId } }),
      this.prisma.reading_passages.findMany({
        where: { generated_by_user_id: userId },
      }),
      this.prisma.chat_conversations.findMany({
        where: { user_id: userId },
        include: { chat_messages: true },
      }),
      this.prisma.quiz_attempts.findMany({ where: { user_id: userId } }),
      this.prisma.user_streaks.findMany({ where: { user_id: userId } }),
      this.prisma.user_badges.findMany({ where: { user_id: userId } }),
      this.prisma.ai_operations.findMany({ where: { user_id: userId } }),
      // Generated Prisma client predates the BILL-05 model; see the same
      // narrow-delegate workaround in tokens.service.ts (grantDelegate).
      (this.prisma as any).daily_credit_grants?.findMany({
        where: { user_id: userId },
      }) ?? Promise.resolve([]),
    ]);

    return {
      exportedAt: new Date().toISOString(),
      profile: user,
      learningPreferences: mapLearningPreferences(user),
      devices: devices.map((d: any) => ({
        id: d.id,
        deviceName: d.device_name,
        browser: d.browser,
        os: d.operating_system,
        ipAddress: d.ip_address,
        isTrusted: d.trusted,
        lastSeenAt: d.last_active_at,
        createdAt: d.created_at,
      })),
      securityQuestions,
      loginHistory,
      notifications,
      tokens: { balance: tokenBalance, transactions: tokenTransactions },
      decks,
      learningCompletions: completions,
      srsReviewEvents: srsEvents,
      cardProgress,
      reviewSessions,
      writingSubmissions,
      speakingSubmissions,
      readingPassages,
      conversations,
      quizAttempts,
      streaks,
      badges,
      aiOperations,
      dailyCreditGrants: creditGrants,
    };
  }

  /**
   * Delete every row owned by the user, including auth records the scheduled
   * purge does not cover and learning rows that would otherwise survive the
   * soft-delete/anonymize flow. Only the users row itself is left for the
   * scheduler to finalize; FK cascades remove nested cards/messages once the
   * parent decks/conversations are gone.
   */
  async purgeUserData(userId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.user_badges.deleteMany({ where: { user_id: userId } });
      await tx.user_streaks.deleteMany({ where: { user_id: userId } });
      await tx.quiz_attempts.deleteMany({ where: { user_id: userId } });
      await tx.quizzes.deleteMany({ where: { creator_id: userId } });
      await tx.chat_conversations.deleteMany({ where: { user_id: userId } });
      await tx.reading_passages.deleteMany({
        where: { generated_by_user_id: userId },
      });
      await tx.speaking_submissions.deleteMany({ where: { user_id: userId } });
      await tx.writing_submissions.deleteMany({ where: { user_id: userId } });
      await tx.review_sessions.deleteMany({ where: { user_id: userId } });
      await tx.learning_completions.deleteMany({ where: { user_id: userId } });
      await tx.srs_review_events.deleteMany({ where: { user_id: userId } });
      await tx.user_card_progress.deleteMany({ where: { user_id: userId } });
      await tx.decks.deleteMany({ where: { creator_id: userId } });
      await tx.ai_operations.deleteMany({ where: { user_id: userId } });
      // Stale generated client: optional narrow delegate (see export above).
      await (tx as any).daily_credit_grants?.deleteMany({
        where: { user_id: userId },
      });
      await tx.token_transactions.deleteMany({ where: { user_id: userId } });
      await tx.user_token_balance.deleteMany({ where: { user_id: userId } });
      await tx.notifications.deleteMany({ where: { user_id: userId } });
      await tx.login_history.deleteMany({ where: { user_id: userId } });
      await tx.login_attempts.deleteMany({ where: { user_id: userId } });
      await tx.audit_logs.deleteMany({ where: { user_id: userId } });
      await tx.security_questions.deleteMany({ where: { user_id: userId } });
      await tx.user_devices.deleteMany({ where: { user_id: userId } });
      await tx.mfa_secrets.deleteMany({ where: { user_id: userId } });
      await tx.verification_tokens.deleteMany({ where: { user_id: userId } });
      await tx.oauth_accounts.deleteMany({ where: { user_id: userId } });
      await tx.password_history.deleteMany({ where: { user_id: userId } });
      await tx.refresh_tokens.deleteMany({ where: { user_id: userId } });
      await tx.user_roles.deleteMany({ where: { users_id: userId } });
    });

    // The avatar is the only user-owned file outside the DB. Reuse the
    // validated unlink logic so a crafted avatar_url cannot traverse paths.
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      select: { avatar_url: true },
    });
    if (user?.avatar_url) {
      const filename = user.avatar_url.replace(/^\/uploads\//, '');
      const uploadDir = path.join(process.cwd(), 'uploads');
      const resolvedPath = path.resolve(uploadDir, filename);
      if (resolvedPath.startsWith(path.resolve(uploadDir) + path.sep)) {
        try {
          if (fs.existsSync(resolvedPath)) fs.unlinkSync(resolvedPath);
        } catch (err) {
          this.logger.warn(`Failed to delete avatar file: ${err}`);
        }
      }
    }
    await this.prisma.users.update({
      where: { id: userId },
      data: { avatar_url: null, fcm_token: null, is_active: false },
    });
  }

  async getLoginHistory(
    userId: string,
    page: number,
    size: number,
  ): Promise<PageResponse<LoginHistoryResponse>> {
    const total = await this.prisma.login_history.count({
      where: { user_id: userId },
    });
    const items = await this.prisma.login_history.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      skip: page * size,
      take: size,
    });

    return buildPageResponse(
      items,
      (h) => ({
        id: h.id,
        action: h.action as string,
        ipAddress: h.ip_address ?? 'Unknown',
        userAgent: h.user_agent ?? '',
        deviceInfo: h.device_info ?? 'Unknown',
        success: h.success ?? true,
        failureReason: h.failure_reason ?? undefined,
        createdAt: h.created_at,
      }),
      page,
      size,
      total,
    );
  }
}
