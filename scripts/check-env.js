#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

console.log('\n🔍 LinguaAI — Environment Check\n');

const checks = [
  { name: 'Node.js', cmd: 'node --version', required: true },
  { name: 'pnpm', cmd: 'pnpm --version', required: true },
  { name: 'Docker', cmd: 'docker --version', required: false },
  // pnpm dev starts the FastAPI service via `python -m uvicorn`; fall back to
  // python3 because many systems only expose the versioned binary.
  { name: 'Python', cmd: 'python --version', fallbackCmd: 'python3 --version', required: true },
  { name: 'PostgreSQL (pg_isready)', cmd: 'pg_isready', required: false },
];

let allPassed = true;

for (const check of checks) {
  try {
    const result = execSync(check.cmd, { encoding: 'utf-8', stdio: 'pipe' }).trim();
    console.log(`  ✅ ${check.name}: ${result}`);
  } catch {
    let fallbackOk = false;
    if (check.fallbackCmd) {
      try {
        const result = execSync(check.fallbackCmd, { encoding: 'utf-8', stdio: 'pipe' }).trim();
        console.log(`  ✅ ${check.name} (${check.fallbackCmd.split(' ')[0]}): ${result}`);
        fallbackOk = true;
      } catch { /* try no further alternatives */ }
    }
    if (!fallbackOk) {
      if (check.required) {
        console.log(`  ❌ ${check.name}: NOT FOUND (required)`);
        allPassed = false;
      } else {
        console.log(`  ⚠️  ${check.name}: NOT FOUND (optional)`);
      }
    }
  }
}

const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  console.log(`  ✅ .env file exists`);
} else {
  console.log(`  ⚠️  .env file missing — copy from .env.example`);
}

const envExample = path.join(ROOT, '.env.example');
if (fs.existsSync(envExample)) {
  const content = fs.readFileSync(envExample, 'utf-8');
  const keys = content.match(/^[A-Z_]+(?==)/gm) || [];
  console.log(`  ℹ️  .env.example has ${keys.length} config keys`);
}

console.log(allPassed ? '\n✅ All required checks passed\n' : '\n❌ Some required checks failed\n');
process.exit(allPassed ? 0 : 1);
