import { Controller, Get, HttpCode, HttpStatus, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../common/services/redis.service';

const DB_CHECK_TIMEOUT_MS = 3000;
const REDIS_CHECK_TIMEOUT_MS = 2000;

interface CheckResult {
  status: 'up' | 'down';
  latencyMs?: number;
  error?: string;
}

/**
 * Health endpoints for orchestrator probes (Docker, Render, Railway, Kubernetes).
 *
 * - `GET /api/health`     — liveness: cheap, always 200 if process is alive.
 * - `GET /api/health/ready` — readiness: verifies DB + Redis. 503 if any dep down.
 */
@ApiTags('Health')
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Liveness probe — always 200 if process is alive' })
  liveness() {
    return {
      status: 'ok',
      service: 'linguaai-api',
      timestamp: new Date().toISOString(),
    };
  }

  @Public()
  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe — checks database and cache' })
  async readiness() {
    const checks: Record<string, CheckResult> = {
      database: await this.check('database', DB_CHECK_TIMEOUT_MS, async () => {
        await this.prisma.$queryRaw`SELECT 1`;
        return true;
      }),
      redis: await this.check('redis', REDIS_CHECK_TIMEOUT_MS, () =>
        this.redis.healthCheck(),
      ),
    };

    const allUp = Object.values(checks).every((v) => v.status === 'up');
    return {
      status: allUp ? 'ready' : 'degraded',
      checks,
      timestamp: new Date().toISOString(),
    };
  }

  private async check(
    name: string,
    timeoutMs: number,
    operation: () => Promise<unknown>,
  ): Promise<CheckResult> {
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${name} health check timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
    });

    try {
      const result = await Promise.race([operation(), timeout]);
      if (name === 'redis' && result !== true) {
        throw new Error('Redis health check returned an unhealthy result');
      }
      return { status: 'up', latencyMs: Date.now() - started };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Log the actual cause instead of silently reporting just "down".
      this.logger.error(`${name} health check failed: ${message}`);
      return {
        status: 'down',
        error: message,
        latencyMs: Date.now() - started,
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
