import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '../generated/prisma';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly pool: Pool;

  constructor(private readonly configService: ConfigService) {
    // DATABASE_URL is the single source of truth (PaaS providers inject it).
    // Construct one from the discrete variables only when it is absent; never
    // silently fall back to hard-coded dev credentials if those are missing.
    const url = process.env.DATABASE_URL || PrismaService.buildDatabaseUrl(configService);
    if (!url) {
      throw new Error(
        'DATABASE_URL (or DATABASE_HOST plus DATABASE_USER, DATABASE_PASSWORD and DATABASE_NAME) must be defined. Set it in the environment before starting the API.',
      );
    }
    process.env.DATABASE_URL = url;

    const pool = new Pool({ connectionString: url });
    const adapter = new PrismaPg(pool);
    super({ adapter, log: [{ emit: 'event', level: 'query' }, { emit: 'event', level: 'error' }] });
    this.pool = pool;

    // Surface database errors (constraint violations, deadlocks, dropped
    // connections) that would otherwise be invisible at the Prisma layer.
    const onEvent = this.$on as unknown as (
      event: string,
      listener: (payload: unknown) => void,
    ) => void;
    onEvent('error', (payload) => {
      const error = payload as Error;
      this.logger.error(`Prisma error: ${error.message}`, error.stack);
    });

    // Log slow queries so pathological pagination/prompt work is observable.
    onEvent('query', (payload) => {
      const event = payload as { duration: number; query: string };
      if (event.duration > 1000) {
        this.logger.warn(
          `Slow Prisma query (${event.duration}ms): ${event.query.slice(0, 500)}`,
        );
      }
    });
  }

  private static buildDatabaseUrl(configService: ConfigService): string | null {
    const host = configService.get<string>('DATABASE_HOST');
    const port = configService.get<number>('DATABASE_PORT') || 5432;
    const username = configService.get<string>('DATABASE_USER');
    const password = configService.get<string>('DATABASE_PASSWORD');
    const database = configService.get<string>('DATABASE_NAME');
    if (!host || !username || password === undefined || !database) {
      return null;
    }
    const ssl = configService.get<string>('DATABASE_SSL') === 'true';
    return `postgresql://${username}:${encodeURIComponent(password)}@${host}:${port}/${database}?schema=public${
      ssl ? '&sslmode=require' : ''
    }`;
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    // One cleanup failure must not prevent the other, and a rejected
    // $disconnect/pool.end() must not derail NestJS graceful shutdown.
    await Promise.allSettled([
      this.$disconnect(),
      this.pool.end().catch((error: Error) => {
        this.logger.error(`Failed to close database pool: ${error.message}`, error.stack);
      }),
    ]);
  }
}
