import { PrismaClient } from '../src/generated/prisma';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';

const url =
  process.env.DATABASE_URL ||
  'postgresql://linguaai:linguaai_secret@localhost:5432/linguaai_test';
const pool = new Pool({ connectionString: url });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

export async function seedTestDB() {
  // Clear existing data
  await prisma.$executeRaw`TRUNCATE TABLE users CASCADE`;

  const passwordHash = await bcrypt.hash('password123', 10);

  // Create test user
  const user = await prisma.users.create({
    data: {
      id: 'd3b07384-d113-4ec5-a58e-0d1134ec5a58', // Fixed UUID for easier testing
      email: 'test@example.com',
      password: passwordHash,
      first_name: 'Test',
      last_name: 'User',
      email_verified: true,
    },
  });

  // Create token balance
  await prisma.user_token_balance.create({
    data: {
      user_id: user.id,
      balance: 100,
    },
  });

  // Create a deck for SRS review testing
  const deck = await prisma.decks.create({
    data: {
      id: 'd3b07384-d113-4ec5-a58e-0d1134ec5a59',
      title: 'Test Deck',
      creator_id: user.id,
      language: 'english',
      level: 'A1',
      is_public: false,
    },
  });

  // Create a card for SRS review testing
  const card = await prisma.cards.create({
    data: {
      id: 'd3b07384-d113-4ec5-a58e-0d1134ec5a60',
      deck_id: deck.id,
      front_text: 'Hello',
      back_text: 'Xin chào',
    },
  });

  return { user, deck, card };
}

export async function cleanupTestDB() {
  await prisma.$executeRaw`TRUNCATE TABLE users CASCADE`;
  await prisma.$disconnect();
  await pool.end();
}
