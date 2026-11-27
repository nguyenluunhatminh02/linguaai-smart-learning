import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const apiNodeMods = path.join(root, 'apps', 'api', 'node_modules');
const rootNodeMods = path.join(root, 'node_modules');

console.log('Root node_modules exists:', fs.existsSync(rootNodeMods));
console.log('API node_modules exists:', fs.existsSync(apiNodeMods));

for (const pkg of ['ws', 'groq-sdk', '@nestjs/websockets', '@prisma/client']) {
  const inRoot = fs.existsSync(path.join(rootNodeMods, ...pkg.split('/')));
  const inApi = fs.existsSync(path.join(apiNodeMods, ...pkg.split('/')));
  console.log(`  ${pkg}: root=${inRoot} api=${inApi}`);
}

// Also check if speaking_submissions table exists by querying via prisma
