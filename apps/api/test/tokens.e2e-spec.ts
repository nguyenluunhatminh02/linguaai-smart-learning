jest.mock('otplib', () => ({
  generateSecret: jest.fn(),
  verify: jest.fn(),
  generateURI: jest.fn(),
}));

import { Test } from '@nestjs/testing';
import { INestApplication, VersioningType } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '@/app.module';
import { seedTestDB, cleanupTestDB } from './setup';
import { WsAdapter } from '@nestjs/platform-ws';

describe('Tokens E2E', () => {
  let app: INestApplication;
  let accessToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();

    await seedTestDB();

    // Login to get token
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'test@example.com', password: 'password123' })
      .expect(200);

    accessToken = loginRes.body.data.accessToken;
  });

  afterAll(async () => {
    await cleanupTestDB();
    await app.close();
  });

  it('GET /api/v1/tokens/balance - should return current token balance', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/tokens/balance')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.data).toHaveProperty('balance');
    expect(res.body.data.balance).toBe(100);
  });

  it('POST /api/v1/tokens/consume - should decrement balance', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/tokens/consume')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ cost: 10, feature: 'ai_chat' })
      .expect(201);

    expect(res.body.data.balance).toBe(90); // 100 - 10
  });

  it('POST /api/v1/tokens/consume - idempotency key prevents double charge', async () => {
    const idempotencyKey = 'test-key-123';

    const res1 = await request(app.getHttpServer())
      .post('/api/v1/tokens/consume')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('idempotency-key', idempotencyKey)
      .send({ cost: 5, feature: 'ai_chat' })
      .expect(201);

    expect(res1.body.data.balance).toBe(85);

    // Retry with same key
    const res2 = await request(app.getHttpServer())
      .post('/api/v1/tokens/consume')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('idempotency-key', idempotencyKey)
      .send({ cost: 5, feature: 'ai_chat' })
      .expect(201);

    // Balance should only decrease once (still 85)
    expect(res2.body.data.balance).toBe(85);
  });
});
