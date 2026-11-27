const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('./src/generated/prisma');

const host = process.env.DATABASE_HOST || 'localhost';
const port = process.env.DATABASE_PORT || 5432;
const username = process.env.DATABASE_USER || 'linguaai';
const password = process.env.DATABASE_PASSWORD || 'linguaai_secret';
const database = process.env.DATABASE_NAME || 'linguaai';
const ssl = process.env.DATABASE_SSL === 'true';

const url =
  process.env.DATABASE_URL ||
  `postgresql://${username}:${encodeURIComponent(password)}@${host}:${port}/${database}?schema=public${
    ssl ? '&sslmode=require' : ''
  }`;

const pool = new Pool({ connectionString: url });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const languages = await prisma.writing_submissions.findMany({
    select: {
      language: true
    }
  });
  
  const counts = {};
  for (const item of languages) {
    counts[item.language] = (counts[item.language] || 0) + 1;
  }
  
  console.log("Language counts in writing_submissions:");
  console.log(counts);
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
