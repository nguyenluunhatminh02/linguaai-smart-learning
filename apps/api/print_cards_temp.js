const { PrismaClient } = require('./src/generated/prisma');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

const url = 'postgresql://linguaai:linguaai_secret@localhost:5432/linguaai';
const pool = new Pool({ connectionString: url });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const cards = await prisma.cards.findMany({
    orderBy: { created_at: 'desc' },
    take: 5
  });
  console.log(JSON.stringify(cards, null, 2));
}

main().finally(() => {
  prisma.$disconnect();
  pool.end();
});
