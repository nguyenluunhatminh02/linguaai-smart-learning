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
import { PrismaClient } from '../src/generated/prisma';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { WsAdapter } from '@nestjs/platform-ws';

describe('SRS Review E2E', () => {
  let app: INestApplication;
  let accessToken: string;
  let prisma: PrismaClient;
  let pool: Pool;
  let testCardId: string;
  let testUserId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();

    const dbUrl = process.env.DATABASE_URL || 'postgresql://linguaai:linguaai_secret@localhost:5432/linguaai_test';
    pool = new Pool({ connectionString: dbUrl });
    const adapter = new PrismaPg(pool);
    prisma = new PrismaClient({ adapter });

    const seedResult = await seedTestDB();
    testCardId = seedResult.card.id;
    testUserId = seedResult.user.id;

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
    await prisma.$disconnect();
    await pool.end();
  });

  it('POST /api/v1/srs/review - should update card review state and progress', async () => {
    // Submit a review for the test card
    const res = await request(app.getHttpServer())
      .post('/api/v1/srs/review')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ cardId: testCardId, grade: 3 }) // Good rating
      .expect(201);

    expect(res.body.data).toHaveProperty('stability');
    expect(res.body.data).toHaveProperty('difficulty');
    expect(res.body.data).toHaveProperty('newInterval');

    // Retrieve progress from database to check next_review_date
    const progress = await prisma.user_card_progress.findUnique({
      where: {
        user_id_card_id: {
          user_id: testUserId,
          card_id: testCardId,
        },
      },
    });

    expect(progress).not.toBeNull();
    expect(progress!.repetition_count).toBe(1);
    expect(progress!.next_review_date.getTime()).toBeGreaterThan(Date.now());
  });
});
