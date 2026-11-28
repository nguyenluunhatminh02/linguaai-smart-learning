import { HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { HealthController } from './health.controller';

/**
 * OPS-01 / BUG-07 regression: readiness must use 503 when a required
 * dependency is down, liveness must stay 200, and public probe bodies must
 * never carry raw dependency errors (connection strings, stack traces, ...).
 */
describe('HealthController readiness (OPS-01)', () => {
  let prisma: { $queryRaw: jest.Mock };
  let redis: { healthCheck: jest.Mock };
  let controller: HealthController;
  let res: { status: jest.Mock };

  const makeResponse = (): { status: jest.Mock } => ({
    status: jest.fn().mockReturnThis(),
  });

  beforeEach(() => {
    prisma = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
    redis = { healthCheck: jest.fn().mockResolvedValue(true) };
    controller = new HealthController(
      prisma as never,
      redis as never,
    );
    res = makeResponse();
  });

  it('returns 200 and ready when all dependencies are up', async () => {
    const body = await controller.readiness(res as never as Response);

    expect(res.status).not.toHaveBeenCalled();
    expect(body.status).toBe('ready');
    expect(body.checks).toEqual({
      database: expect.objectContaining({ status: 'up' }),
      redis: expect.objectContaining({ status: 'up' }),
    });
  });

  it('returns 503 when the database is down', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('connection refused at postgres://db.internal'));

    const body = await controller.readiness(res as never as Response);

    expect(res.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(body.status).toBe('degraded');
    expect(body.checks.database.status).toBe('down');
    expect(JSON.stringify(body)).not.toContain('postgres://db.internal');
    expect(JSON.stringify(body)).not.toContain('connection refused');
  });

  it('returns 503 when Redis reports unhealthy (false)', async () => {
    redis.healthCheck.mockResolvedValue(false);

    const body = await controller.readiness(res as never as Response);

    expect(res.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(body.status).toBe('degraded');
    expect(body.checks.redis.status).toBe('down');
    expect(JSON.stringify(body)).not.toContain('unhealthy');
  });

  it('returns 503 when the Redis check rejects', async () => {
    redis.healthCheck.mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:6379'));

    const body = await controller.readiness(res as never as Response);

    expect(res.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(body.checks.redis.status).toBe('down');
    expect(JSON.stringify(body)).not.toContain('ECONNREFUSED');
  });

  it('omits raw error fields from every public check', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('secret connection string'));

    const body = await controller.readiness(res as never as Response);

    for (const check of Object.values(body.checks)) {
      expect(check).not.toHaveProperty('error');
      expect(Object.keys(check).sort()).toEqual(['latencyMs', 'status']);
    }
  });

  it('keeps liveness 200 while dependencies are down', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('db down'));
    redis.healthCheck.mockResolvedValue(false);

    const body = controller.liveness();

    expect(body.status).toBe('ok');
    expect(res.status).not.toHaveBeenCalled();
  });
});
