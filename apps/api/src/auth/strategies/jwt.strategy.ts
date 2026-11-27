import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { ConfigService } from "@nestjs/config";
import { TokenService } from "../services/token.service";
import { PrismaService } from "../../prisma/prisma.service";
import { RedisService } from "../../common/services/redis.service";
import { toAppUser } from "../../common/mappers/user.mapper";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly redis: RedisService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: (() => {
        const secret = config.get<string>("JWT_SECRET");
        if (!secret) {
          throw new Error(
            "JWT_SECRET must be defined. Set it in your .env file.",
          );
        }
        return secret;
      })(),
      passReqToCallback: true,
    });
  }

  async validate(req: any, payload: any) {
    // 1. Only explicitly-typed ACCESS tokens are accepted. Tokens signed with
    //    the same secret but without a type claim (REFRESH/MFA_PENDING fallbacks
    //    or forged tokens) must not be usable as access tokens.
    if (payload.type !== "ACCESS") {
      throw new UnauthorizedException("Invalid token type");
    }

    // Every access token is issued with a jti. Requiring it keeps the
    // blacklist check below effective: without a jti a token could never be
    // revoked.
    if (!payload.jti) {
      throw new UnauthorizedException("Invalid token");
    }

    // 2. Kiá»ƒm tra blacklist theo JTI
    const token = ExtractJwt.fromAuthHeaderAsBearerToken()(req);
    if (token) {
      const isBlacklisted = await this.tokenService.isTokenBlacklisted(token);
      if (isBlacklisted)
        throw new UnauthorizedException("Token has been revoked");
    }

    // 3. Load user tá»« DB vá»›i roles + permissions (cache 60s in Redis)
    const cacheKey = `cache:user:${payload.sub}`;
    let userRecord: any;
    let cachedRoles: string[] | null = null;

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        userRecord = parsed.user;
        cachedRoles = parsed.roles;
      } catch {
        // corrupt cache entry — fall through to DB
      }
    }

    if (!userRecord) {
      userRecord = await this.prisma.users.findFirst({
        where: { id: payload.sub, is_deleted: false },
        include: {
          user_roles: {
            include: { roles: true },
          },
        },
      });
      if (userRecord) {
        const roles = userRecord.user_roles.map(
          (ur: any) => ur.roles.name as string,
        );
        await this.redis.set(
          cacheKey,
          JSON.stringify({ user: userRecord, roles }),
          60,
        );
        cachedRoles = roles;
      }
    }

    // A cached record can be up to 60s old and may not have been evicted when
    // the account was locked, disabled or deleted. If the cached snapshot is
    // not clean, evict it and re-read the authoritative state from the DB.
    // This also avoids keeping a user locked out after lock_time has passed.
    if (
      cached &&
      userRecord &&
      (!userRecord.is_active ||
        userRecord.is_deleted ||
        (userRecord.is_locked &&
          userRecord.lock_time &&
          new Date(userRecord.lock_time) > new Date()))
    ) {
      await this.redis.del(cacheKey);
      userRecord = await this.prisma.users.findFirst({
        where: { id: payload.sub, is_deleted: false },
        include: { user_roles: { include: { roles: true } } },
      });
      cachedRoles = null;
      if (userRecord) {
        const roles = userRecord.user_roles.map(
          (ur: any) => ur.roles.name as string,
        );
        await this.redis.set(
          cacheKey,
          JSON.stringify({ user: userRecord, roles }),
          60,
        );
        cachedRoles = roles;
      }
    }

    if (!userRecord) throw new UnauthorizedException("User not found");
    if (!userRecord.is_active)
      throw new UnauthorizedException("Account is disabled");
    if (userRecord.is_deleted)
      throw new UnauthorizedException("User not found");
    if (userRecord.is_locked && userRecord.lock_time && new Date(userRecord.lock_time) > new Date())
      throw new UnauthorizedException("Account is locked");

    const appUser = toAppUser(userRecord);
    const roles =
      cachedRoles ??
      userRecord.user_roles.map((ur: any) => ur.roles.name as string);

    // 4. A deviceId claim must correspond to an active session of this user.
    //    Otherwise a forged/stale claim could be used to log out or revoke
    //    another device via @CurrentUser('deviceId') controllers.
    let deviceId: string | null = null;
    if (payload.deviceId) {
      const deviceSession = await this.prisma.user_devices.findFirst({
        where: {
          user_id: payload.sub,
          device_id: payload.deviceId,
          active: true,
        },
        select: { device_id: true },
      });
      if (!deviceSession)
        throw new UnauthorizedException("Device session is no longer active");
      deviceId = deviceSession.device_id;
    }

    // 5. Tráº£ vá» user object Ä‘Ã­nh kÃ¨m accessToken + deviceId
    return {
      ...appUser,
      roles,
      deviceId,
      accessToken: token,
    };
  }
}
