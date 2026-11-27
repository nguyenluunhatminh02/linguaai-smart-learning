import { createRequire } from 'module';
import path from 'node:path';

const require = createRequire(path.resolve(import.meta.dirname, '..', 'apps', 'api', 'package.json'));
const { PrismaClient } = require('./src/generated/prisma');
const prisma = new PrismaClient();

try {
  // Check if speaking_submissions model exists in Prisma client
  console.log('PrismaClient models:', Object.keys(prisma).filter(k => !k.startsWith('_') && !k.startsWith('$')));

  // Check if table exists in DB
  const tables = await prisma.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'speaking%'`;
  console.log('Speaking tables in DB:', tables);

  // Try count
  try {
    const count = await prisma.speaking_submissions.count();
    console.log('speaking_submissions count:', count);
  } catch (e) {
    console.log('speaking_submissions query error:', e.message.slice(0, 200));
  }
} catch (e) {
  console.error('Error:', e.message.slice(0, 300));
} finally {
  await prisma.$disconnect();
}
