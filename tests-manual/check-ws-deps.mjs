import fs from 'node:fs';
import path from 'node:path';
const apiMods = path.resolve(import.meta.dirname, '..', 'apps', 'api', 'node_modules');
const pkgs = [
  'ws',
  '@nestjs/websockets',
  '@nestjs/platform-ws',
  '@nestjs/platform-socket.io',
  'groq-sdk',
];
for (const p of pkgs) {
  const exists = fs.existsSync(path.join(apiMods, ...p.split('/')));
  console.log(`${exists ? 'OK' : 'MISSING'}: ${p}`);
}

// Check api package.json for ws-related deps
const pkg = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '..', 'apps', 'api', 'package.json'), 'utf8'));
console.log('\npackage.json deps with ws:');
for (const [k, v] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
  if (k.includes('ws') || k.includes('websocket') || k.includes('socket') || k.includes('platform')) {
    console.log(`  ${k}: ${v}`);
  }
}
