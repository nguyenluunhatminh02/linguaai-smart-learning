// @ts-nocheck
/**
 * AuthService Unit Tests
 *
 * AuthService is a facade that orchestrates a Prisma session, TokenService,
 * device + login attempt tracking, MFA, email and audit logging. Most
 * Password / Email-verification / MFA management endpoints simply delegate to
 * the corresponding sub-service, so those tests just assert the delegation
 * contract. The orchestration-heavy paths (register, login, refresh, OAuth)
 * exercise the full happy-path and key error branches.
 *
 * ESM modules (otplib, qrcode) are mocked at module level so Jest can load.
 */
jest.mock("otplib", () => ({
  authenticator: {
    generateSecret: jest.fn().mockReturnValue("MOCK_SECRET"),
    keyuri: jest.fn().mockReturnValue("otpauth://totp/mock"),
    verify: jest.fn().mockReturnValue(true),
  },
}));
jest.mock("qrcode", () => ({
  toDataURL: jest.fn().mockResolvedValue("data:image/png;base64,qr"),
}));

import { Test, TestingModule } from "@nestjs/testing";
import {
  UnauthorizedException,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import * as bcrypt from "bcrypt";

import { AuthService } from "./auth.service";
import { PrismaService } from "../../prisma/prisma.service";
import { TokenService } from "./token.service";
import { TokenBlacklistService } from "./token-blacklist.service";
import { LoginAttemptService } from "./login-attempt.service";
import { DeviceService } from "./device.service";
import { MfaService } from "./mfa.service";
import { EmailService } from "../../email/email.service";
import { SessionService } from "./session.service";
import { EmailVerificationService } from "./email-verification.service";
import { PasswordService } from "./password.service";
import { AuditLogService } from "../../common/services/audit-log.service";
import {
  BadCredentialsException,
  EmailNotVerifiedException,
  AccountLockedException,
} from "../../common/exceptions";

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const mockReq = (overrides: any = {}) =>
  ({
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
    get: jest.fn(),
    ...overrides,
  }) as any;

const makeDbUser = (o: any = {}) => ({
  id: "user-123",
  email: "john@example.com",
  first_name: "John",
  last_name: "Doe",
  password: null,
  provider: "LOCAL",
  is_active: true,
  is_locked: false,
  is_deleted: false,
  email_verified: true,
  email_verification_token: null,
  email_verification_expiry: null,
  password_reset_token: null,
  password_reset_expiry: null,
  two_factor_enabled: false,
  failed_login_attempts: 0,
  lock_time: null,
  last_login_at: null,
  last_login_ip: null,
  deleted_at: null,
  delete_status: "ACTIVE",
  delete_requested_at: null,
  language: "en",
  timezone: "UTC",
  notification_email_enabled: true,
  notification_push_enabled: true,
  notification_in_app_enabled: true,
  notification_security_enabled: true,
  profile_public: false,
  show_email: false,
  show_phone: false,
  show_activity_status: true,
  avatar_url: null,
  date_of_birth: null,
  gender: null,
  phone: null,
  provider_id: null,
  fcm_token: null,
  created_at: new Date("2024-01-01"),
  updated_at: new Date("2024-01-01"),
  user_roles: [{ roles: { name: "ROLE_CUSTOMER" } }],
  ...o,
});

const makeAppUser = (o: any = {}) => ({
  id: "user-123",
  email: "john@example.com",
  firstName: "John",
  lastName: "Doe",
  password: null,
  provider: "LOCAL",
  isActive: true,
  isLocked: false,
  isDeleted: false,
  emailVerified: true,
  twoFactorEnabled: false,
  twoFactorSecret: null,
  failedLoginAttempts: 0,
  lockTime: null,
  deleteStatus: "ACTIVE",
  roles: ["ROLE_CUSTOMER"],
  createdAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-01"),
  ...o,
});

// ─── Test Suite ────────────────────────────────────────────────────────────────

describe("AuthService", () => {
  let service: AuthService;

  const mockPrisma = {
    users: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    verification_tokens: { create: jest.fn().mockResolvedValue({}) },
    oauth_accounts: {
      findUnique: jest.fn(),
      create: jest.fn().mockResolvedValue({}),
    },
    refresh_tokens: { updateMany: jest.fn() },
    login_history: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn(),
  };

  const mockTokenService = {
    generateAccessToken: jest.fn().mockReturnValue("mock.access.token"),
    generateRefreshToken: jest.fn().mockReturnValue({
      token: "mock.refresh.token",
      jti: "jti-1",
      ttlSec: 3600,
    }),
    storeRefreshToken: jest.fn().mockResolvedValue(undefined),
    blacklistToken: jest.fn().mockResolvedValue(undefined),
    validateRefreshToken: jest.fn(),
    revokeDeviceSession: jest.fn().mockResolvedValue(undefined),
    revokeAllSessions: jest.fn().mockResolvedValue(undefined),
    generateMfaToken: jest.fn().mockReturnValue("mock.mfa.token"),
    decodeMfaToken: jest.fn().mockReturnValue({ userId: "user-123" }),
    getAccessTtlMs: jest.fn().mockReturnValue(900_000),
  };

  const mockTokenBlacklist = {
    addToBlacklist: jest.fn().mockResolvedValue(undefined),
    isBlacklisted: jest.fn().mockResolvedValue(false),
  };

  const mockLoginAttempt = {
    checkBruteForce: jest.fn().mockResolvedValue(undefined),
    recordFailedLogin: jest.fn().mockResolvedValue(undefined),
    recordSuccessfulLogin: jest.fn().mockResolvedValue(undefined),
  };

  const mockDevice = {
    isDeviceTrusted: jest.fn().mockResolvedValue(false),
    registerDevice: jest.fn().mockResolvedValue({ device_id: "dev-1" }),
  };

  const mockMfa = {
    setupMfa: jest.fn(),
    verifyAndEnableMfa: jest.fn(),
    disableMfa: jest.fn(),
    verifyCodeOrBackup: jest.fn().mockResolvedValue(true),
  };

  const mockEmail = {
    sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
    sendWelcomeEmail: jest.fn().mockResolvedValue(undefined),
  };

  const mockSession = {
    deleteAccount: jest.fn().mockResolvedValue(undefined),
    cancelDeleteAccount: jest.fn().mockResolvedValue(undefined),
  };

  const mockEmailVerification = {
    verifyEmail: jest.fn(),
    resendVerificationEmail: jest.fn(),
  };

  const mockPasswordService = {
    forgotPassword: jest.fn(),
    resetPassword: jest.fn(),
    changePassword: jest.fn(),
  };

  const mockAuditLog = {
    recordAuditLog: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: TokenService, useValue: mockTokenService },
        { provide: TokenBlacklistService, useValue: mockTokenBlacklist },
        { provide: LoginAttemptService, useValue: mockLoginAttempt },
        { provide: DeviceService, useValue: mockDevice },
        { provide: MfaService, useValue: mockMfa },
        { provide: EmailService, useValue: mockEmail },
        { provide: SessionService, useValue: mockSession },
        { provide: EmailVerificationService, useValue: mockEmailVerification },
        { provide: PasswordService, useValue: mockPasswordService },
        { provide: AuditLogService, useValue: mockAuditLog },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── register ────────────────────────────────────────────────────────────────

  describe("register", () => {
    const dto = {
      firstName: "John",
      lastName: "Doe",
      email: "john@example.com",
      password: "Password123!",
    } as any;

    it("creates user, persists verification token, and returns success message", async () => {
      mockPrisma.users.create.mockResolvedValue(makeDbUser());

      const result = await service.register(dto, mockReq());

      expect(mockPrisma.users.create).toHaveBeenCalled();
      expect(mockPrisma.verification_tokens.create).toHaveBeenCalled();
      expect(result).toMatchObject({
        message: expect.stringMatching(/verify your email/i),
      });
    });

    it("fires verification + welcome emails asynchronously after register", async () => {
      mockPrisma.users.create.mockResolvedValue(makeDbUser());

      await service.register(dto, mockReq());
      await new Promise((r) => setTimeout(r, 10));

      expect(mockEmail.sendVerificationEmail).toHaveBeenCalledWith(
        "john@example.com",
        "John",
        expect.any(String),
      );
      expect(mockEmail.sendWelcomeEmail).toHaveBeenCalledWith(
        "john@example.com",
        "John",
      );
    });

    it("throws ConflictException when email already in use (P2002)", async () => {
      const p2002 = Object.assign(new Error("Unique"), { code: "P2002" });
      mockPrisma.users.create.mockRejectedValue(p2002);
      await expect(service.register(dto, mockReq())).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // ─── verifyEmail / resendVerificationEmail ───────────────────────────────────

  describe("verifyEmail", () => {
    it("delegates to emailVerificationService.verifyEmail", async () => {
      mockEmailVerification.verifyEmail.mockResolvedValue({ message: "ok" });
      await expect(service.verifyEmail("tok")).resolves.toEqual({
        message: "ok",
      });
      expect(mockEmailVerification.verifyEmail).toHaveBeenCalledWith("tok");
    });
  });

  describe("resendVerificationEmail", () => {
    it("delegates to emailVerificationService.resendVerificationEmail", async () => {
      mockEmailVerification.resendVerificationEmail.mockResolvedValue({
        message: "ok",
      });
      await expect(service.resendVerificationEmail("a@b.com")).resolves.toEqual(
        { message: "ok" },
      );
      expect(
        mockEmailVerification.resendVerificationEmail,
      ).toHaveBeenCalledWith("a@b.com");
    });
  });

  // ─── login ───────────────────────────────────────────────────────────────────

  describe("login", () => {
    const rawPw = "Password123!";
    let hashed: string;
    beforeAll(async () => {
      hashed = await bcrypt.hash(rawPw, 4);
    });

    const dto = (over: any = {}) => ({
      email: "john@example.com",
      password: rawPw,
      ...over,
    });

    it("issues access + refresh tokens for valid credentials", async () => {
      mockPrisma.users.findFirst.mockResolvedValue(
        makeDbUser({ password: hashed }),
      );

      const result = await service.login(dto(), mockReq());

      expect(result).toMatchObject({
        accessToken: "mock.access.token",
        refreshToken: "mock.refresh.token",
        tokenType: "Bearer",
        user: expect.objectContaining({ id: "user-123", emailVerified: true }),
      });
      expect(mockTokenService.storeRefreshToken).toHaveBeenCalled();
      expect(mockLoginAttempt.recordSuccessfulLogin).toHaveBeenCalled();
      expect(mockAuditLog.recordAuditLog).toHaveBeenCalledWith(
        "user-123",
        "LOGIN",
        expect.anything(),
      );
    });

    it("throws BadCredentialsException for unknown user", async () => {
      mockPrisma.users.findFirst.mockResolvedValue(null);
      await expect(
        service.login(dto({ email: "x@x.com" }), mockReq()),
      ).rejects.toThrow(BadCredentialsException);
      expect(mockLoginAttempt.recordFailedLogin).toHaveBeenCalled();
    });

    it("throws BadCredentialsException for wrong password", async () => {
      mockPrisma.users.findFirst.mockResolvedValue(
        makeDbUser({ password: hashed }),
      );
      await expect(
        service.login(dto({ password: "WrongPass1!" }), mockReq()),
      ).rejects.toThrow(BadCredentialsException);
      expect(mockLoginAttempt.recordFailedLogin).toHaveBeenCalledWith(
        "john@example.com",
        expect.any(String),
        "user-123",
        expect.any(String),
      );
    });

    it("propagates brute force throw from loginAttemptService", async () => {
      mockLoginAttempt.checkBruteForce.mockRejectedValueOnce(
        new UnauthorizedException("locked"),
      );
      await expect(service.login(dto(), mockReq())).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it("throws EmailNotVerifiedException when email not verified", async () => {
      mockPrisma.users.findFirst.mockResolvedValue(
        makeDbUser({ password: hashed, email_verified: false }),
      );
      await expect(service.login(dto(), mockReq())).rejects.toThrow(
        EmailNotVerifiedException,
      );
    });

    it("throws UnauthorizedException for inactive account", async () => {
      mockPrisma.users.findFirst.mockResolvedValue(
        makeDbUser({ password: hashed, is_active: false }),
      );
      await expect(service.login(dto(), mockReq())).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it("throws AccountLockedException for locked account", async () => {
      mockPrisma.users.findFirst.mockResolvedValue(
        makeDbUser({ password: hashed, is_locked: true }),
      );
      await expect(service.login(dto(), mockReq())).rejects.toThrow(
        AccountLockedException,
      );
    });

    it("returns mfaRequired + mfaToken when 2FA enabled and device not trusted", async () => {
      mockPrisma.users.findFirst.mockResolvedValue(
        makeDbUser({ password: hashed, two_factor_enabled: true }),
      );
      mockDevice.isDeviceTrusted.mockResolvedValue(false);

      const result = await service.login(
        dto({ deviceId: "untrusted" }),
        mockReq(),
      );

      expect(result).toEqual({ mfaRequired: true, mfaToken: "mock.mfa.token" });
      expect(mockTokenService.generateAccessToken).not.toHaveBeenCalled();
    });

    it("skips MFA when device is trusted", async () => {
      mockPrisma.users.findFirst.mockResolvedValue(
        makeDbUser({ password: hashed, two_factor_enabled: true }),
      );
      mockDevice.isDeviceTrusted.mockResolvedValue(true);

      const result = await service.login(
        dto({ deviceId: "trusted" }),
        mockReq(),
      );

      expect(result).toMatchObject({ accessToken: "mock.access.token" });
    });
  });

  // ─── validateMfaLogin ────────────────────────────────────────────────────────

  describe("validateMfaLogin", () => {
    it("issues tokens after a valid TOTP code", async () => {
      mockTokenService.decodeMfaToken.mockReturnValue({ userId: "user-123" });
      mockPrisma.users.findFirst.mockResolvedValue(makeDbUser());
      mockMfa.verifyCodeOrBackup.mockResolvedValue(true);

      const result = await service.validateMfaLogin(
        "mfa.tok",
        "123456",
        mockReq(),
      );

      expect(result).toMatchObject({ accessToken: "mock.access.token" });
      expect(mockAuditLog.recordAuditLog).toHaveBeenCalledWith(
        "user-123",
        "MFA_LOGIN",
        expect.anything(),
      );
    });

    it("throws UnauthorizedException when MFA token is invalid", async () => {
      mockTokenService.decodeMfaToken.mockReturnValue(null);
      await expect(
        service.validateMfaLogin("bad", "000000", mockReq()),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("throws UnauthorizedException for wrong TOTP code", async () => {
      mockTokenService.decodeMfaToken.mockReturnValue({ userId: "user-123" });
      mockPrisma.users.findFirst.mockResolvedValue(makeDbUser());
      mockMfa.verifyCodeOrBackup.mockResolvedValue(false);

      await expect(
        service.validateMfaLogin("mfa.tok", "999999", mockReq()),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // ─── refreshToken ─────────────────────────────────────────────────────────────

  describe("refreshToken", () => {
    it("rotates tokens for valid refresh token", async () => {
      mockTokenService.validateRefreshToken.mockResolvedValue({
        userId: "user-123",
        deviceId: "dev-1",
      });
      mockPrisma.users.findFirst.mockResolvedValue(makeDbUser());

      const result = await service.refreshToken("valid.rt", mockReq());

      expect(result).toMatchObject({ accessToken: "mock.access.token" });
      expect(mockTokenService.blacklistToken).toHaveBeenCalledWith("valid.rt");
      expect(mockTokenService.storeRefreshToken).toHaveBeenCalled();
    });

    it("throws UnauthorizedException for invalid refresh token", async () => {
      mockTokenService.validateRefreshToken.mockResolvedValue(null);
      await expect(service.refreshToken("bad", mockReq())).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it("throws UnauthorizedException when user is not found / inactive", async () => {
      mockTokenService.validateRefreshToken.mockResolvedValue({
        userId: "user-123",
        deviceId: "dev-1",
      });
      mockPrisma.users.findFirst.mockResolvedValue(null);
      await expect(service.refreshToken("valid.rt", mockReq())).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // ─── logout / logoutAll / logoutSession ──────────────────────────────────────

  describe("logout", () => {
    it("blacklists access token and revokes the refresh-token device session", async () => {
      mockTokenService.validateRefreshToken.mockResolvedValue({
        userId: "user-123",
        deviceId: "dev-1",
      });
      await service.logout("at", "rt", makeAppUser() as any, mockReq());
      expect(mockTokenService.blacklistToken).toHaveBeenCalledWith("at");
      expect(mockTokenService.revokeDeviceSession).toHaveBeenCalledWith(
        "user-123",
        "dev-1",
      );
      expect(mockAuditLog.recordAuditLog).toHaveBeenCalledWith(
        "user-123",
        "LOGOUT",
        expect.anything(),
      );
    });
  });

  describe("logoutAll", () => {
    it("blacklists current access token and revokes all sessions", async () => {
      await service.logoutAll("at", makeAppUser() as any, mockReq());
      expect(mockTokenService.blacklistToken).toHaveBeenCalledWith("at");
      expect(mockTokenService.revokeAllSessions).toHaveBeenCalledWith(
        "user-123",
      );
    });
  });

  describe("logoutSession", () => {
    it("revokes the targeted device session", async () => {
      await service.logoutSession(
        "at",
        "dev-9",
        makeAppUser() as any,
        mockReq(),
      );
      expect(mockTokenService.revokeDeviceSession).toHaveBeenCalledWith(
        "user-123",
        "dev-9",
      );
    });
  });

  // ─── delegated wrappers ──────────────────────────────────────────────────────

  describe("password delegation", () => {
    it("forgotPassword → passwordService.forgotPassword", async () => {
      mockPasswordService.forgotPassword.mockResolvedValue({ message: "sent" });
      await expect(
        service.forgotPassword({ email: "a@b.com" }),
      ).resolves.toEqual({
        message: "sent",
      });
      expect(mockPasswordService.forgotPassword).toHaveBeenCalledWith({
        email: "a@b.com",
      });
    });

    it("resetPassword → passwordService.resetPassword", async () => {
      mockPasswordService.resetPassword.mockResolvedValue({ message: "ok" });
      await expect(
        service.resetPassword({ token: "tok", newPassword: "NewPass1!" }),
      ).resolves.toEqual({ message: "ok" });
    });

    it("resetPassword propagates BadRequestException", async () => {
      mockPasswordService.resetPassword.mockRejectedValue(
        new BadRequestException("bad"),
      );
      await expect(
        service.resetPassword({ token: "bad", newPassword: "New1!" }),
      ).rejects.toThrow(BadRequestException);
    });

    it("changePassword → passwordService.changePassword", async () => {
      const user = makeAppUser();
      const req = mockReq();
      const dto = { currentPassword: "OldPass1!", newPassword: "NewPass1!" };
      mockPasswordService.changePassword.mockResolvedValue({ message: "ok" });

      await service.changePassword(dto, user as any, req);

      expect(mockPasswordService.changePassword).toHaveBeenCalledWith(
        dto,
        user,
        req,
      );
    });
  });

  describe("mfa delegation", () => {
    it("setupMfa → mfaService.setupMfa", async () => {
      mockMfa.setupMfa.mockResolvedValue({
        secret: "S",
        qrCodeUri: "q",
        backupCodes: [],
      });
      const user = makeAppUser();
      await service.setupMfa(user as any);
      expect(mockMfa.setupMfa).toHaveBeenCalledWith(user);
    });

    it("verifyAndEnableMfa → mfaService.verifyAndEnableMfa", async () => {
      mockMfa.verifyAndEnableMfa.mockResolvedValue({ message: "enabled" });
      const user = makeAppUser();
      const req = mockReq();
      await service.verifyAndEnableMfa({ code: "123456" }, user as any, req);
      expect(mockMfa.verifyAndEnableMfa).toHaveBeenCalledWith(
        { code: "123456" },
        user,
        req,
      );
    });

    it("disableMfa propagates BadRequestException", async () => {
      mockMfa.disableMfa.mockRejectedValue(
        new BadRequestException("not enabled"),
      );
      await expect(
        service.disableMfa({ code: "000000" }, makeAppUser() as any, mockReq()),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("account delegation", () => {
    it("deleteAccount → sessionService.deleteAccount", async () => {
      const user = makeAppUser();
      const req = mockReq();
      await service.deleteAccount(user as any, "at", req);
      expect(mockSession.deleteAccount).toHaveBeenCalledWith(user, "at", req);
    });

    it("cancelDeleteAccount propagates BadRequestException", async () => {
      mockSession.cancelDeleteAccount.mockRejectedValue(
        new BadRequestException("No pending delete request"),
      );
      await expect(
        service.cancelDeleteAccount(makeAppUser() as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── handleOAuthLogin ─────────────────────────────────────────────────────────

  describe("handleOAuthLogin", () => {
    const profile = {
      provider: "GOOGLE",
      providerId: "goog-1",
      email: "g@example.com",
      firstName: "G",
      lastName: "L",
      avatarUrl: null,
    } as any;

    it("creates a new user + oauth_account when neither exists", async () => {
      mockPrisma.oauth_accounts.findUnique.mockResolvedValue(null);
      mockPrisma.users.findUnique
        .mockResolvedValueOnce(null) // first lookup by email
        .mockResolvedValueOnce(
          makeDbUser({ id: "user-new", email: "g@example.com" }),
        ); // re-load
      mockPrisma.users.create.mockResolvedValue(
        makeDbUser({ id: "user-new", email: "g@example.com" }),
      );

      const result = await service.handleOAuthLogin(profile, mockReq());

      expect(mockPrisma.users.create).toHaveBeenCalled();
      expect(mockPrisma.oauth_accounts.create).toHaveBeenCalled();
      expect(result).toMatchObject({ accessToken: "mock.access.token" });
    });

    it("reuses linked OAuth account on subsequent logins", async () => {
      mockPrisma.oauth_accounts.findUnique.mockResolvedValue({
        users: makeDbUser({ id: "user-existing" }),
      });

      const result = await service.handleOAuthLogin(profile, mockReq());

      expect(mockPrisma.users.create).not.toHaveBeenCalled();
      expect(result).toMatchObject({ accessToken: "mock.access.token" });
    });

    it("refuses to auto-link when an active LOCAL account exists with the same email", async () => {
      mockPrisma.oauth_accounts.findUnique.mockResolvedValue(null);
      mockPrisma.users.findUnique.mockResolvedValueOnce(
        makeDbUser({ provider: "LOCAL", email: "g@example.com" }),
      );

      await expect(
        service.handleOAuthLogin(profile, mockReq()),
      ).rejects.toThrow(ConflictException);
    });

    it("refuses login for inactive / deleted accounts", async () => {
      mockPrisma.oauth_accounts.findUnique.mockResolvedValue({
        users: makeDbUser({ is_active: false }),
      });
      await expect(
        service.handleOAuthLogin(profile, mockReq()),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
