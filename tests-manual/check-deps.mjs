import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const check = (name) => {
  try { require(name); console.log(`OK: ${name}`); } catch { console.log(`MISSING: ${name}`); }
};
check('ws');
check('groq-sdk');
check('@nestjs/websockets');
check('@prisma/client');
