import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { Request } from 'express';
import { SessionService } from './session.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TokenService } from './token.service';
import { TokenBlacklistService } from './token-blacklist.service';
import { RedisService } from '../../common/services/redis.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { DeleteStatus } from '../../users/enums/delete-status.enum';
import { User } from '../../users/entities/user.entity';

/** SEC-11: account delete/cancel must invalidate every per-user cache family, never revocation markers. */
describe('SessionService privacy (SEC-11)', () => {
  const USER_ID = '11111111-1111-4111-8111-111111111111';
  const OTHER_ID = '22222222-2222-4222-8222-222222222222';
  const user = { id: USER_ID } as User;
  const req = {
    socket: { remoteAddress: '203.0.113.7' },
    headers: {},
  } as unknown as Request;

  let service: SessionService;
  let redis: any;
  let prisma: any;
  let audit: any;
  let tokens: any;

  const ownedKeys = [
    `cache:user:${USER_ID}`,
    `token:balance:${USER_ID}`,
    `checkin:${USER_ID}:2026-11-28`,
    `token:last_topup:${USER_ID}`,
    `mfa:fail:login:${USER_ID}`,
    `mfa:laststep:${USER_ID}`,
    `grammar:en:${USER_ID}:past_simple:question`,
    `learning-path:${USER_ID}`,
    `recommendations:${USER_ID}:english`,
  ];

  beforeEach(async () => {
    jest.resetAllMocks();
    redis = {
      del: jest.fn().mockResolvedValue(undefined),
      delMany: jest.fn().mockResolvedValue(undefined),
      keys: jest.fn(async (pattern: string) =>
        ownedKeys.filter((key) => {
          // Match the same glob semantics as Redis: `*` spans any characters.
          const regex = new RegExp(
            `^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`,
          );
          return regex.test(key);
        }),
      ),
    };
    prisma = {
      users: {
        update: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue({
          delete_status: DeleteStatus.DELETE_REQUESTED,
        }),
      },
    };
    audit = { recordAuditLog: jest.fn().mockResolvedValue(undefined) };
    tokens = {
      revokeAllSessions: jest.fn().mockResolvedValue(undefined),
      blacklistToken: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionService,
        { provide: PrismaService, useValue: prisma },
        { provide: TokenService, useValue: tokens },
        { provide: TokenBlacklistService, useValue: { clearUserBlacklist: jest.fn() } },
        { provide: AuditLogService, useValue: audit },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();
    service = module.get(SessionService);
  });

  it('deleteAccount invalidates all owned cache families but preserves revocation markers', async () => {
    await service.deleteAccount(user, 'header.payload.signature', req);

    expect(redis.del).toHaveBeenCalledWith(`cache:user:${USER_ID}`);
    const deleted = (redis.delMany as jest.Mock).mock.calls[0][0] as string[];
    expect(deleted).toEqual(expect.arrayContaining(ownedKeys.slice(1)));
    expect(deleted).not.toContain(`cache:user:${USER_ID}`);
    expect(deleted).not.toContain(`revoked-user:${USER_ID}`);
    expect(deleted).not.toContain(`blacklist:user:${USER_ID}`);
    expect(deleted).not.toContain(`cache:user:${OTHER_ID}`);
    expect(redis.keys).toHaveBeenCalledWith(`checkin:${USER_ID}:*`);
    expect(redis.keys).toHaveBeenCalledWith(`grammar:*:${USER_ID}:*`);
    expect(tokens.revokeAllSessions).toHaveBeenCalledWith(USER_ID);
    expect(audit.recordAuditLog).toHaveBeenCalledWith(
      USER_ID,
      'ACCOUNT_DELETE_REQUESTED',
      '203.0.113.7',
    );
  });

  it('cancelDeleteAccount invalidates caches and records an audit entry', async () => {
    await service.cancelDeleteAccount(user, req);

    expect(prisma.users.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: expect.objectContaining({ delete_status: DeleteStatus.ACTIVE }),
    });
    expect(redis.del).toHaveBeenCalledWith(`cache:user:${USER_ID}`);
    expect(redis.delMany).toHaveBeenCalled();
    expect(audit.recordAuditLog).toHaveBeenCalledWith(
      USER_ID,
      'ACCOUNT_DELETE_CANCELLED',
      '203.0.113.7',
    );
  });

  it('cancelDeleteAccount still works with no request argument (existing callers)', async () => {
    await expect(service.cancelDeleteAccount(user)).resolves.toBeUndefined();
    expect(redis.del).toHaveBeenCalledWith(`cache:user:${USER_ID}`);
  });

  it('does not cancel an account with no pending deletion', async () => {
    prisma.users.findUnique.mockResolvedValue({ delete_status: DeleteStatus.ACTIVE });
    await expect(service.cancelDeleteAccount(user, req)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(redis.del).not.toHaveBeenCalled();
    expect(audit.recordAuditLog).not.toHaveBeenCalled();
  });

  it('never deletes another user’s keys even if a Redis response contains them', async () => {
    redis.keys.mockResolvedValue([
      `checkin:${USER_ID}:2026-11-28`,
      `checkin:${OTHER_ID}:2026-11-28`,
      `cache:user:${OTHER_ID}`,
    ]);
    await service.cancelDeleteAccount(user, req);
    const deleted = (redis.delMany as jest.Mock).mock.calls[0][0] as string[];
    expect(deleted).toContain(`checkin:${USER_ID}:2026-11-28`);
    expect(deleted).not.toContain(`checkin:${OTHER_ID}:2026-11-28`);
    expect(deleted).not.toContain(`cache:user:${OTHER_ID}`);
  });
});
