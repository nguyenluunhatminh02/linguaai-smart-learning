import { ExecutionContext, Injectable, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import { APP_GUARD } from "@nestjs/core";
import { CacheModule } from "@nestjs/cache-manager";
import { ScheduleModule } from "@nestjs/schedule";

// ── Core Infrastructure ──────────────────────────────
import { PrismaModule } from "./prisma/prisma.module";

// ── Domain: Auth & Users ─────────────────────────────
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";

// ── Domain: Learning (Flashcards + SRS) ──────────────
import { DecksModule } from "./decks/decks.module";
import { CardsModule } from "./cards/cards.module";
import { SrsModule } from "./srs/srs.module";
import { LearningModule } from "./learning/learning.module";

// ── Domain: Assessment (Quiz) ────────────────────────
import { QuizModule } from "./quiz/quiz.module";

// ── Domain: AI-Powered Features ──────────────────────
import { WritingModule } from "./writing/writing.module";
import { ReadingModule } from "./reading/reading.module";
import { GrammarModule } from "./grammar/grammar.module";
import { ChatModule } from "./chat/chat.module";
import { RecommendationsModule } from "./recommendations/recommendations.module";

// ── Domain: Admin & Analytics ────────────────────────
import { AdminModule } from "./admin/admin.module";
import { AnalyticsModule } from "./analytics/analytics.module";
import { SpeakingModule } from "./speaking/speaking.module";

// ── System Modules ───────────────────────────────────
import { EmailModule } from "./email/email.module";
import { HealthModule } from "./health/health.module";
import { TokensModule } from "./tokens/tokens.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { FilesModule } from "./files/files.module";

import { envValidationSchema } from "./config/env.validation";

// @nestjs/throttler's handleRequest() assumes an HTTP response (it calls
// switchToHttp().getResponse().header()). APP_GUARD applies to every transport
// context, including WebSocket message handlers, so skip those contexts here.
@Injectable()
class HttpOnlyThrottlerGuard extends ThrottlerGuard {
  protected override async shouldSkip(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== "http") return true;
    return super.shouldSkip(context);
  }
}

@Module({
  imports: [
    // ── Core Infrastructure ──────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      // Resolve relative to CWD so the same path works for `nest start` (CWD=apps/api)
      // and `node dist/main` (CWD=apps/api). Avoids breakage when __dirname depth
      // changes between dev/build outputs.
      envFilePath: [".env", "../../.env"],
      validationSchema: envValidationSchema,
      validationOptions: {
        allowUnknown: true,
        abortEarly: true,
      },
    }),
    PrismaModule,
    CacheModule.registerAsync({
      isGlobal: true,
      useFactory: () => {
        const redisUrl =
          process.env.REDIS_URL ||
          `redis://:${process.env.REDIS_PASSWORD || ""}@${process.env.REDIS_HOST || "localhost"}:${process.env.REDIS_PORT || 6379}`;
        return {
          store: require("cache-manager-redis-yet"),
          url: redisUrl,
          ttl: 600000,
        };
      },
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      {
        ttl: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000", 10),
        limit: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || "100", 10),
      },
    ]),

    // ── Domain: Auth & Users ─────────────────────────────
    AuthModule,
    UsersModule,

    // ── Domain: Learning (Flashcards + SRS) ──────────────
    DecksModule,
    CardsModule,
    SrsModule,
    LearningModule,

    // ── Domain: Assessment (Quiz) ────────────────────────
    QuizModule,

    // ── Domain: AI-Powered Features ──────────────────────
    WritingModule,
    ReadingModule,
    GrammarModule,
    ChatModule,
    RecommendationsModule,

    // ── Domain: Admin & Analytics ────────────────────────
    AdminModule,
    AnalyticsModule,

    // ── Domain: Speaking (WebSocket) ─────────────────────
    SpeakingModule,

    // ── System Modules ───────────────────────────────────
    EmailModule,
    HealthModule,
    TokensModule,
    NotificationsModule,
    FilesModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: HttpOnlyThrottlerGuard,
    },
  ],
})
export class AppModule {}
