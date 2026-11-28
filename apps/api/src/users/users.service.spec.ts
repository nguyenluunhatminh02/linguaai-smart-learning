import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';

// The installed bcrypt native binding is not loadable in this checkout; the
// privacy paths under test never hash passwords, so stub the module.
jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed'),
  compare: jest.fn().mockResolvedValue(true),
}));

/**
 * SEC-11: export must include the user's own data but never secrets or other
 * users' rows; purge must delete all owned tables and the avatar file.
 */
describe('UsersService privacy (SEC-11)', () => {
  const USER_ID = '11111111-1111-4111-8111-111111111111';
  const OTHER_ID = '22222222-2222-4222-8222-222222222222';
  let service: UsersService;
  let tx: Record<string, { deleteMany: jest.Mock }>;
  let prisma: any;

  const profile = {
    id: USER_ID,
    email: `owner-${USER_ID}@example.test`,
    first_name: 'Owner',
    last_name: 'User',
    phone: null,
    avatar_url: '/uploads/owner-avatar.png',
    date_of_birth: null,
    gender: null,
    language: 'en',
    timezone: 'UTC',
    provider: 'LOCAL',
    email_verified: true,
    created_at: new Date('2025-01-01T00:00:00Z'),
    updated_at: new Date('2025-01-02T00:00:00Z'),
    notification_email_enabled: true,
    notification_push_enabled: true,
    notification_in_app_enabled: true,
    notification_security_enabled: true,
    profile_public: false,
    show_email: false,
    show_phone: false,
    show_activity_status: true,
    learning_level: 'A1',
    daily_study_minutes: 10,
    daily_word_goal: 10,
    daily_goal: 20,
    native_language: 'vi',
    target_language: 'en',
    streak_count: 2,
    total_xp: 30,
    password: 'BCRYPT_HASH_SHOULD_NEVER_BE_EXPORTED',
    email_verification_token: 'VERIFY_TOKEN',
    password_reset_token: 'RESET_TOKEN',
    mfa_secret: { secret: 'TOTP_SECRET' },
    fcm_token: 'FCM_SECRET',
    user_roles: [{ roles: { name: 'USER' } }],
  };

  beforeEach(async () => {
    jest.resetAllMocks();

    tx = {} as Record<string, { deleteMany: jest.Mock }>;
    for (const model of [
      'user_badges',
      'user_streaks',
      'quiz_attempts',
      'quizzes',
      'chat_conversations',
      'reading_passages',
      'speaking_submissions',
      'writing_submissions',
      'review_sessions',
      'learning_completions',
      'srs_review_events',
      'user_card_progress',
      'decks',
      'ai_operations',
      'daily_credit_grants',
      'token_transactions',
      'user_token_balance',
      'notifications',
      'login_history',
      'login_attempts',
      'audit_logs',
      'security_questions',
      'user_devices',
      'mfa_secrets',
      'verification_tokens',
      'oauth_accounts',
      'password_history',
      'refresh_tokens',
      'user_roles',
    ]) {
      tx[model] = { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) };
    }

    prisma = {
      users: {
        // Mirror Prisma's `select`: only requested columns are returned.
        findUnique: jest.fn(async (args: any) => {
          if (!args?.select) return profile;
          const projected: Record<string, unknown> = {};
          for (const key of Object.keys(args.select)) {
            if (key === 'user_roles') {
              projected[key] = profile.user_roles;
            } else {
              projected[key] = (profile as any)[key];
            }
          }
          return projected;
        }),
        update: jest.fn().mockResolvedValue(profile),
      },
      $transaction: jest.fn(async (callback: (client: any) => Promise<void>) =>
        callback(tx),
      ),
    };

    for (const model of [
      'user_devices',
      'security_questions',
      'login_history',
      'notifications',
      'user_token_balance',
      'token_transactions',
      'decks',
      'learning_completions',
      'srs_review_events',
      'user_card_progress',
      'review_sessions',
      'writing_submissions',
      'speaking_submissions',
      'reading_passages',
      'chat_conversations',
      'quiz_attempts',
      'user_streaks',
      'user_badges',
      'ai_operations',
      'daily_credit_grants',
    ]) {
      prisma[model] = { findMany: jest.fn().mockResolvedValue([]) };
    }
    prisma.user_token_balance.findUnique = jest
      .fn()
      .mockResolvedValue({ balance: 7 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: { decode: jest.fn() } },
      ],
    }).compile();
    service = module.get(UsersService);
  });

  describe('exportUserData', () => {
    it('scopes every owned slice by the requested user and includes transcripts, tokens, and decks', async () => {
      prisma.decks.findMany.mockResolvedValue([
        {
          id: 'deck-1',
          title: 'My deck',
          cards: [{ id: 'card-1', front_text: 'hello', back_text: 'xin chao' }],
        },
      ]);
      prisma.chat_conversations.findMany.mockResolvedValue([
        {
          id: 'conv-1',
          user_id: USER_ID,
          title: 'Private chat',
          chat_messages: [
            { id: 'msg-1', role: 'user', content: 'my transcript' },
          ],
        },
      ]);
      prisma.speaking_submissions.findMany.mockResolvedValue([
        {
          id: 'sp-1',
          transcript: 'my audio transcript',
          audio_url: '/uploads/a.wav',
        },
      ]);
      prisma.token_transactions.findMany.mockResolvedValue([
        { id: 'tx-1', amount: -1, feature: 'ai_chat' },
      ]);

      const data: any = await service.exportUserData(USER_ID);

      expect(prisma.users.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: USER_ID } }),
      );
      expect(prisma.chat_conversations.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { user_id: USER_ID } }),
      );
      expect(prisma.decks.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { creator_id: USER_ID } }),
      );
      expect(prisma.reading_passages.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { generated_by_user_id: USER_ID } }),
      );
      expect(data.conversations[0].chat_messages[0].content).toBe(
        'my transcript',
      );
      expect(data.decks[0].cards).toHaveLength(1);
      expect(data.tokens.balance).toEqual({ balance: 7 });
      expect(data.tokens.transactions).toHaveLength(1);
      expect(data.speakingSubmissions[0].transcript).toBe(
        'my audio transcript',
      );
      expect(data.learningPreferences.dailyWordGoal).toBe(10);
    });

    it('never exports secrets, hashes, reset tokens or MFA material', async () => {
      const data: any = await service.exportUserData(USER_ID);
      const serialized = JSON.stringify(data);
      for (const secret of [
        profile.password,
        profile.email_verification_token,
        profile.password_reset_token,
        profile.mfa_secret.secret,
        profile.fcm_token,
      ]) {
        expect(serialized).not.toContain(secret);
      }
      expect(serialized).not.toContain('answer_hash');
      expect(data.securityQuestions).toEqual([]);
    });

    it('throws for a missing user instead of emitting an empty export', async () => {
      prisma.users.findUnique.mockResolvedValue(null);
      await expect(service.exportUserData(USER_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('purgeUserData', () => {
    it('deletes every owned table with owner-scoped where clauses', async () => {
      await service.purgeUserData(USER_ID);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.chat_conversations.deleteMany).toHaveBeenCalledWith({
        where: { user_id: USER_ID },
      });
      expect(tx.decks.deleteMany).toHaveBeenCalledWith({
        where: { creator_id: USER_ID },
      });
      expect(tx.reading_passages.deleteMany).toHaveBeenCalledWith({
        where: { generated_by_user_id: USER_ID },
      });
      expect(tx.quizzes.deleteMany).toHaveBeenCalledWith({
        where: { creator_id: USER_ID },
      });
      expect(tx.refresh_tokens.deleteMany).toHaveBeenCalledWith({
        where: { user_id: USER_ID },
      });
      expect(tx.oauth_accounts.deleteMany).toHaveBeenCalledWith({
        where: { user_id: USER_ID },
      });
      expect(tx.user_roles.deleteMany).toHaveBeenCalledWith({
        where: { users_id: USER_ID },
      });
      expect(tx.token_transactions.deleteMany).toHaveBeenCalledWith({
        where: { user_id: USER_ID },
      });
      expect(tx.ai_operations.deleteMany).toHaveBeenCalledWith({
        where: { user_id: USER_ID },
      });
      for (const [model, delegate] of Object.entries(tx)) {
        const fn = (delegate as any).deleteMany as jest.Mock;
        const arg = fn.mock.calls[0]?.[0];
        expect(`${model}: ${JSON.stringify(arg)}`).toContain(USER_ID);
        expect(`${model}: ${JSON.stringify(arg)}`).not.toContain(OTHER_ID);
      }
    });

    it('removes the avatar file and clears identifying tokens on the user row', async () => {
      const unlink = jest
        .spyOn(fs, 'unlinkSync')
        .mockImplementation(() => undefined);
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);

      await service.purgeUserData(USER_ID);

      expect(unlink).toHaveBeenCalledWith(
        path.join(process.cwd(), 'uploads', 'owner-avatar.png'),
      );
      expect(prisma.users.update).toHaveBeenCalledWith({
        where: { id: USER_ID },
        data: expect.objectContaining({ avatar_url: null, fcm_token: null }),
      });
      unlink.mockRestore();
      jest.restoreAllMocks();
    });

    it('refuses to unlink a path outside the uploads directory', async () => {
      prisma.users.findUnique.mockResolvedValue({
        ...profile,
        avatar_url: '/uploads/../../etc/passwd',
      });
      const unlink = jest
        .spyOn(fs, 'unlinkSync')
        .mockImplementation(() => undefined);
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);

      await service.purgeUserData(USER_ID);

      expect(unlink).not.toHaveBeenCalled();
      unlink.mockRestore();
      jest.restoreAllMocks();
    });
  });
});
