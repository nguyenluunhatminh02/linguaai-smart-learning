import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '../generated/prisma';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

/** DI token for an optional metrics sink; consumers can bind it in PrismaModule. */
export const PRISMA_QUERY_METRICS = Symbol('PRISMA_QUERY_METRICS');

export type PrismaQueryOutcome = 'success' | 'error';

/** Only bounded, non-sensitive labels may cross this port. */
export interface PrismaQueryMetric {
  readonly operation: string;
  readonly outcome: PrismaQueryOutcome;
  readonly durationMs: number;
}

export interface PrismaQueryErrorMetric {
  readonly operation: 'unknown';
  readonly outcome: 'error';
}

export interface PrismaQueryMetricsPort {
  recordQuery(metric: PrismaQueryMetric): void;
  recordError(metric: PrismaQueryErrorMetric): void;
}

export const noopPrismaQueryMetrics: PrismaQueryMetricsPort = {
  recordQuery: () => undefined,
  recordError: () => undefined,
};

const PRISMA_QUERY_ACTIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
  'findRaw',
  'aggregateRaw',
  'queryRaw',
  'executeRaw',
]);

const SAFE_MODEL_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const DEFAULT_SLOW_QUERY_MS = 1000;

/**
 * Build a bounded label from Prisma's operation/target metadata only. Query
 * text and params are deliberately never accepted; anything outside the
 * allowlist becomes 'unknown' or 'raw'.
 */
export function classifyPrismaOperation(target: unknown): string {
  if (typeof target !== 'string') return 'unknown';

  const normalized = target.startsWith('$') ? target.slice(1) : target;
  if (!normalized || normalized.length > 160) return 'unknown';

  const parts = normalized.split('.');
  if (parts.length === 1) {
    const action = parts[0];
    return action === 'queryRaw' || action === 'executeRaw' ? 'raw' : 'unknown';
  }
  if (parts.length !== 2) return 'unknown';

  const [model, action] = parts;
  if (!PRISMA_QUERY_ACTIONS.has(action)) return 'unknown';
  if (action === 'queryRaw' || action === 'executeRaw') return 'raw';
  if (!SAFE_MODEL_NAME.test(model)) return 'unknown';
  return `${model}.${action}`;
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private readonly pool: Pool;
  private readonly metrics: PrismaQueryMetricsPort;

  constructor(
    configService: ConfigService,
    @Optional()
    @Inject(PRISMA_QUERY_METRICS)
    metrics?: PrismaQueryMetricsPort,
  ) {
    // DATABASE_URL is the single source of truth (PaaS providers inject it).
    // Construct one from the discrete variables only when it is absent; never
    // silently fall back to hard-coded dev credentials if those are missing.
    const url =
      process.env.DATABASE_URL || PrismaService.buildDatabaseUrl(configService);
    if (!url) {
      throw new Error(
        'DATABASE_URL (or DATABASE_HOST plus DATABASE_USER, DATABASE_PASSWORD and DATABASE_NAME) must be defined. Set it in the environment before starting the API.',
      );
    }
    process.env.DATABASE_URL = url;

    // Query events (which carry SQL text and params) are only requested when
    // instrumentation is explicitly enabled. Error events stay on by default.
    const metricsEnabled = PrismaService.isMetricsEnabled(configService);
    const log: Array<{ emit: 'event'; level: 'query' | 'error' }> = [
      { emit: 'event', level: 'error' },
    ];
    if (metricsEnabled) {
      log.push({ emit: 'event', level: 'query' });
    }

    const pool = new Pool({ connectionString: url });
    const adapter = new PrismaPg(pool);
    super({ adapter, log });
    this.pool = pool;
    this.metrics = metrics ?? noopPrismaQueryMetrics;

    const slowQueryMs = PrismaService.slowQueryThresholdMs(configService);

    // Surface database errors without echoing error messages or stacks, which
    // may contain connection strings, SQL, params or other sensitive data.
    const onEvent = this.$on as unknown as (
      event: string,
      listener: (payload: unknown) => void,
    ) => void;
    onEvent('error', () => {
      if (metricsEnabled) {
        this.recordMetricSafely(() =>
          this.metrics.recordError({ operation: 'unknown', outcome: 'error' }),
        );
      }
      this.logger.error('Prisma error event received; details suppressed');
    });

    if (!metricsEnabled) return;

    // Slow-query warnings report only a bounded operation label and duration.
    onEvent('query', (payload) => {
      const event = payload as {
        duration: number;
        target?: unknown;
        operation?: unknown;
      };
      const duration = Number(event.duration);
      if (!Number.isFinite(duration) || duration < 0) return;

      const operation = classifyPrismaOperation(
        event.target ?? event.operation,
      );
      this.recordMetricSafely(() =>
        this.metrics.recordQuery({
          operation,
          outcome: 'success',
          durationMs: duration,
        }),
      );

      if (duration > slowQueryMs) {
        this.logger.warn(
          `Slow Prisma query (operation=${operation}, durationMs=${Math.round(duration)})`,
        );
      }
    });
  }

  private static isMetricsEnabled(configService: ConfigService): boolean {
    const value = configService.get<string | boolean>(
      'PRISMA_QUERY_METRICS_ENABLED',
    );
    return value === true || String(value).trim().toLowerCase() === 'true';
  }

  private static slowQueryThresholdMs(configService: ConfigService): number {
    const value = configService.get<number | string>('PRISMA_SLOW_QUERY_MS');
    if (value === undefined || value === '') return DEFAULT_SLOW_QUERY_MS;
    const parsed =
      typeof value === 'number' ? value : Number(String(value).trim());
    return Number.isFinite(parsed) && parsed >= 0
      ? parsed
      : DEFAULT_SLOW_QUERY_MS;
  }

  private recordMetricSafely(record: () => void): void {
    try {
      record();
    } catch {
      this.logger.warn('Prisma metrics sink failed; metric dropped');
    }
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
      this.pool.end().catch(() => {
        this.logger.error('Failed to close database pool; details suppressed');
      }),
    ]);
  }
}
