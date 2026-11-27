import { Test, TestingModule } from "@nestjs/testing";
import { TokensService } from "./tokens.service";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../common/services/redis.service";
import { ForbiddenException } from "@nestjs/common";

describe("TokensService", () => {
  let service: TokensService;
  let prisma: PrismaService;
  let redis: RedisService;

  const mockPrismaService = {
    user_token_balance: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
    },
    token_transactions: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      aggregate: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockRedisService = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TokensService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: RedisService, useValue: mockRedisService },
      ],
    }).compile();

    service = module.get<TokensService>(TokensService);
    prisma = module.get<PrismaService>(PrismaService);
    redis = module.get<RedisService>(RedisService);

    // Default mock behavior
    mockRedisService.get.mockImplementation(async (key: string) => {
      const today = new Date().toISOString().slice(0, 10);
      if (key.includes("last_topup")) return today; // already topped up
      if (key.includes("checkin")) return null; // not checked in
      if (key.includes("balance")) return null; // cache miss
      return null;
    });

    mockPrismaService.user_token_balance.findUnique.mockImplementation(async () => ({
      user_id: "user-123",
      balance: 100,
    }));

    mockPrismaService.user_token_balance.create.mockImplementation(async (args) => ({
      user_id: args.data.user_id,
      balance: args.data.balance,
    }));

    mockPrismaService.user_token_balance.upsert.mockImplementation(async (args) => {
      const balanceVal = args.update?.balance;
      let newBal = 100;
      if (balanceVal?.decrement !== undefined) {
        newBal = 100 - balanceVal.decrement;
      } else if (balanceVal?.increment !== undefined) {
        newBal = 100 + balanceVal.increment;
      } else if (typeof balanceVal === "number") {
        newBal = balanceVal;
      }
      return {
        user_id: args.where.user_id,
        balance: newBal,
      };
    });

    mockPrismaService.token_transactions.findUnique.mockResolvedValue(null);
    mockPrismaService.token_transactions.create.mockImplementation(async (args) => ({
      id: "tx-uuid",
      ...args.data,
    }));
    mockPrismaService.token_transactions.aggregate.mockResolvedValue({
      _sum: { amount: 0 },
    });

    mockPrismaService.$transaction.mockImplementation(async (cb) => {
      return cb(mockPrismaService);
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("getBalance", () => {
    const userId = "user-123";

    it("should return balance from Redis cache if present", async () => {
      mockRedisService.get.mockImplementation(async (key: string) => {
        const today = new Date().toISOString().slice(0, 10);
        if (key.includes("last_topup")) return today;
        if (key.includes("balance")) return "45";
        return null;
      });
      mockPrismaService.token_transactions.aggregate.mockResolvedValueOnce({
        _sum: { amount: -15 },
      });

      const result = await service.getBalance(userId);

      expect(result.balance).toBe(45);
      expect(result.todayUsed).toBe(15);
      expect(mockRedisService.get).toHaveBeenCalledWith(`token:balance:${userId}`);
    });

    it("should fallback to DB and update cache if Redis cache is missing", async () => {
      mockRedisService.get.mockImplementation(async (key: string) => {
        const today = new Date().toISOString().slice(0, 10);
        if (key.includes("last_topup")) return today;
        return null; // cache miss
      });
      mockPrismaService.user_token_balance.findUnique.mockResolvedValueOnce({
        user_id: userId,
        balance: 60,
      });

      const result = await service.getBalance(userId);

      expect(result.balance).toBe(60);
      expect(result.todayUsed).toBe(0);
      expect(mockRedisService.set).toHaveBeenCalledWith(
        `token:balance:${userId}`,
        "60",
        300,
      );
    });
  });

  describe("consumeTokens", () => {
    const userId = "user-123";
    const idempotencyKey = "key-abc";

    it("should return cached result if idempotency key exists", async () => {
      mockPrismaService.token_transactions.findUnique.mockResolvedValueOnce({
        id: "tx-789",
        amount: -5,
        balance_after: 25,
      });

      const result = await service.consumeTokens(userId, "ai_chat", 5, idempotencyKey);

      expect(result.balance).toBe(25);
      expect(result.cost).toBe(5);
      expect(mockPrismaService.token_transactions.findUnique).toHaveBeenCalledWith({
        where: { idempotency_key: idempotencyKey },
      });
      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });

    it("should consume tokens and invalidate cache on success", async () => {
      mockPrismaService.user_token_balance.findUnique.mockResolvedValueOnce({ balance: 35 });
      mockPrismaService.user_token_balance.upsert.mockResolvedValueOnce({ balance: 30 });

      const result = await service.consumeTokens(userId, "ai_chat", 5);

      expect(result.balance).toBe(30);
      expect(result.cost).toBe(5);
      expect(mockRedisService.del).toHaveBeenCalledWith(`token:balance:${userId}`);
    });

    it("should throw ForbiddenException if balance is insufficient", async () => {
      mockPrismaService.user_token_balance.findUnique.mockResolvedValueOnce({ balance: 2 });

      await expect(
        service.consumeTokens(userId, "ai_chat", 5),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe("addTokens", () => {
    const userId = "user-123";

    it("should increment balance and create transaction", async () => {
      mockPrismaService.user_token_balance.findUnique.mockResolvedValueOnce({ balance: 10 });
      mockPrismaService.user_token_balance.upsert.mockResolvedValueOnce({ balance: 110 });

      const result = await service.addTokens(userId, 100, "purchase");

      expect(result.balance).toBe(110);
      expect(result.added).toBe(100);
      expect(mockRedisService.del).toHaveBeenCalledWith(`token:balance:${userId}`);
    });
  });

  describe("dailyCheckIn", () => {
    const userId = "user-123";

    it("should grant bonus if not checked in today", async () => {
      mockRedisService.get.mockImplementation(async (key: string) => {
        const today = new Date().toISOString().slice(0, 10);
        if (key.includes("last_topup")) return today;
        if (key.includes("checkin")) return null; // not checked in today
        if (key.includes("balance")) return "105"; // balance after reward
        return null;
      });

      mockPrismaService.user_token_balance.findUnique.mockResolvedValueOnce({ balance: 100 });
      mockPrismaService.user_token_balance.upsert.mockResolvedValueOnce({ balance: 105 });

      const result = await service.dailyCheckIn(userId);

      expect(result.alreadyCheckedIn).toBe(false);
      expect(result.tokensEarned).toBe(5);
      expect(result.balance).toBe(105);
      expect(mockRedisService.set).toHaveBeenCalledWith(
        expect.stringContaining(`checkin:${userId}:`),
        "1",
        86400,
      );
    });

    it("should return alreadyCheckedIn if already done today", async () => {
      mockRedisService.get.mockImplementation(async (key: string) => {
        const today = new Date().toISOString().slice(0, 10);
        if (key.includes("last_topup")) return today;
        if (key.includes("checkin")) return "1"; // already checked in today
        if (key.includes("balance")) return "100";
        return null;
      });

      const result = await service.dailyCheckIn(userId);

      expect(result.alreadyCheckedIn).toBe(true);
      expect(result.tokensEarned).toBe(0);
      expect(result.balance).toBe(100);
    });
  });
});
