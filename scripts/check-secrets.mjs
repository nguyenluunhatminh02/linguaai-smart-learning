#!/usr/bin/env node
/**
 * CI-friendly key-pattern scan (roadmap SEC-10 / CI test policy).
 *
 * Contract:
 *   - No third-party dependencies; plain `node scripts/check-secrets.mjs`.
 *   - Never opens a real `.env` file (only `.env.example` is scanned).
 *   - Never prints a matched value or source line: output is path, line,
 *     rule id, severity and a static label only.
 *   - Exit 1 for errors (provider-shaped keys), 0 for warnings, 2 for usage.
 *
 * Known limitations (v1): no git-history scanning, no binary/archive
 * inspection, no entropy-only detection. Placeholder-looking values are
 * ignored to keep pull-request CI deterministic.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');

const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** Directories that are generated, vendored or otherwise not source. */
const SKIP_DIRS = new Set([
  '.git', '.github-cache', '.next', '.nuxt', '.svelte-kit', '.turbo',
  '.venv', 'venv', '__pycache__', '.pytest_cache', '.mypy_cache',
  '.cache', '.idea', '.vscode', 'node_modules', 'bower_components',
  'vendor', 'dist', 'build', 'out', 'target', 'coverage', 'tmp', 'temp',
  'test-screenshots', '.claude', 'baocao',
]);

/** Text formats where a credential assignment is meaningful. */
const TEXT_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.json', '.jsonc',
  '.yml', '.yaml', '.toml', '.ini', '.cfg', '.conf', '.env',
  '.py', '.sh', '.bash', '.zsh', '.ps1', '.md', '.sql', '.prisma',
]);

/** Extensionless files that are configuration and worth scanning. */
const EXTRA_FILES = new Set(['.env.example', '.npmrc', 'Dockerfile', 'Makefile']);

/** Lockfiles and generated fixtures produce high-entropy noise. */
const SKIP_FILES = new Set([
  'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lockb',
  'poetry.lock', 'Pipfile.lock', 'nul',
]);

/**
 * Values that are documentation/placeholders rather than live credentials.
 * Only used to suppress findings; never included in output.
 */
const PLACEHOLDER_TOKENS = [
  'example', 'placeholder', 'sample', 'fake', 'dummy', 'mock', 'changeme',
  'change_me', 'your_', 'your-', 'yourkey', 'test', 'testing', 'ci-only',
  'not-a-real', 'notareal', 'replace', 'insert', 'todo', 'xxx', 'localhost',
  'process.env', 'os.environ', 'import.meta.env', 'secrets.', 'env.',
  'undefined', 'null', 'none', 'string', 'password', 'secretvalue',
  // Descriptive fixture tokens like "sk-live-provider-secret" are test data,
  // not live keys: they follow no real provider key format.
  'provider-secret',
];

/**
 * Rules are ordered most-specific first; overlapping matches on a line are
 * claimed once so one token produces one finding.
 */
const RULES = [
  {
    id: 'PRIVATE_KEY_BLOCK',
    label: 'private key block',
    severity: 'error',
    regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g,
  },
  {
    id: 'ANTHROPIC_TOKEN',
    label: 'Anthropic-shaped API key',
    severity: 'error',
    regex: /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g,
  },
  {
    id: 'OPENAI_TOKEN',
    label: 'OpenAI-shaped API key',
    severity: 'error',
    regex: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    id: 'GITHUB_TOKEN',
    label: 'GitHub-shaped access token',
    severity: 'error',
    regex: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
  },
  {
    id: 'AWS_ACCESS_KEY',
    label: 'AWS-shaped access key id',
    severity: 'error',
    regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  },
  {
    id: 'SLACK_TOKEN',
    label: 'Slack-shaped token',
    severity: 'error',
    regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  },
  {
    id: 'GOOGLE_API_KEY',
    label: 'Google-shaped API key',
    severity: 'error',
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/g,
  },
  {
    id: 'STRIPE_TOKEN',
    label: 'Stripe-shaped key',
    severity: 'error',
    regex: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g,
  },
  {
    id: 'SENDGRID_TOKEN',
    label: 'SendGrid-shaped key',
    severity: 'error',
    regex: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g,
  },
  {
    id: 'JWT_TOKEN',
    label: 'JSON web token literal',
    severity: 'warning',
    regex: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  },
  {
    id: 'GENERIC_ASSIGNMENT',
    label: 'credential-shaped assignment',
    severity: 'warning',
    regex: /\b[A-Z0-9_]*(?:API[_-]?KEY|SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE[_-]?KEY|ACCESS[_-]?KEY|CLIENT[_-]?SECRET|CREDENTIALS?)\b\s*[:=]\s*["'`]?([^\s"'`;,}]{6,})/gi,
  },
  {
    id: 'BEARER_LITERAL',
    label: 'bearer token literal',
    severity: 'warning',
    regex: /\bBearer\s+([A-Za-z0-9._~+/=-]{16,})/g,
  },
];

const USAGE = [
  'Usage: node scripts/check-secrets.mjs [options]',
  '',
  '  --root <dir>   Repository to scan (default: this repository)',
  '  --json         Emit a machine-readable report',
  '  --strict       Also fail on warnings',
  '  --self-test    Run the built-in tests (synthetic values only)',
  '  --help         Show this help',
].join('\n');

/**
 * True when a captured value is documentation, an environment reference,
 * or a repeated-character stub. The value itself is never returned.
 */
export function isPlaceholder(value) {
  if (typeof value !== 'string' || value.length === 0) return true;
  const lower = value.toLowerCase();
  if (PLACEHOLDER_TOKENS.some((token) => lower.includes(token))) return true;
  if (/[${\[<>]/.test(value)) return true;
  if (/^(?:[.\-_*x0]+)$/i.test(value)) return true;
  if (/(.)\1{5,}/.test(value)) return true;
  return false;
}

/** Decide whether a relative path is a text file that may be scanned. */
export function isScannableFile(relativePath) {
  const rel = relativePath.split(path.sep).join('/');
  const base = path.basename(rel);
  if (SKIP_FILES.has(base)) return false;
  if (rel.split('/').some((part) => SKIP_DIRS.has(part))) return false;
  // The scanner itself contains rule definitions and synthetic test values.
  if (base === 'check-secrets.mjs' || base === 'check-secrets.test.mjs') return false;
  // Real .env files are never opened. .env.example is deliberately included.
  if (base === '.env' || /^\.env\./.test(base)) return base === '.env.example';
  if (EXTRA_FILES.has(base)) return true;
  return TEXT_EXTENSIONS.has(path.extname(base).toLowerCase());
}

/** Recursively collect scannable files, in a stable order. */
export function listFiles(root) {
  const found = [];
  const visit = (dir, relDir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      // isFile()/isDirectory() are false for symlinks: they are skipped.
      if (entry.isDirectory()) {
        visit(path.join(dir, entry.name), path.join(relDir, entry.name));
      } else if (entry.isFile()) {
        const rel = path.join(relDir, entry.name);
        if (isScannableFile(rel)) found.push(rel.split(path.sep).join('/'));
      }
    }
  };
  visit(root, '');
  return found.sort();
}

function overlaps(ranges, start, end) {
  return ranges.some(([from, to]) => start < to && end > from);
}

/**
 * Scan one source snippet. Returns findings without any matched value.
 * A warning on a line is dropped when an error already covers that line.
 */
export function scanText(text, relativePath, rules = RULES) {
  const findings = [];
  const lines = text.split(/\r?\n/);

  lines.forEach((line, index) => {
    const ranges = [];
    const onLine = [];
    for (const rule of rules) {
      rule.regex.lastIndex = 0;
      let match;
      while ((match = rule.regex.exec(line)) !== null) {
        const start = match.index;
        const end = start + match[0].length;
        if (!overlaps(ranges, start, end)) {
          ranges.push([start, end]);
          // Placeholder detection applies uniformly to every rule: provider
          // tokens use the whole match, assignments use the captured value.
          const value = match[0];
          const subject = rule.id === 'GENERIC_ASSIGNMENT' ? match[1] : value;
          if (!isPlaceholder(subject)) {
            onLine.push({
              path: relativePath.split(path.sep).join('/'),
              line: index + 1,
              rule: rule.id,
              severity: rule.severity,
              label: rule.label,
            });
          }
        }
        if (match[0].length === 0) rule.regex.lastIndex += 1;
      }
    }
    const hasError = onLine.some((item) => item.severity === 'error');
    onLine.forEach((item) => {
      if (!hasError || item.severity === 'error') findings.push(item);
    });
  });
  return findings;
}

/** Scan a repository without reading `.env` or any binary/generated file. */
export function scanRepository(root = DEFAULT_ROOT) {
  const absoluteRoot = path.resolve(root);
  const findings = [];
  const readErrors = [];
  let scannedFiles = 0;

  for (const rel of listFiles(absoluteRoot)) {
    const absoluteFile = path.join(absoluteRoot, rel);
    let stat;
    try {
      stat = fs.statSync(absoluteFile);
    } catch (error) {
      readErrors.push({ path: rel, code: error?.code ?? 'STAT_FAILED' });
      continue;
    }
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) continue;
    let text;
    try {
      text = fs.readFileSync(absoluteFile, 'utf8');
    } catch (error) {
      readErrors.push({ path: rel, code: error?.code ?? 'READ_FAILED' });
      continue;
    }
    scannedFiles += 1;
    findings.push(...scanText(text, rel));
  }

  findings.sort((a, b) =>
    a.path.localeCompare(b.path) || a.line - b.line || a.rule.localeCompare(b.rule),
  );
  return { scannedFiles, findings, readErrors };
}

export function summarize(result) {
  const errorCount = result.findings.filter((f) => f.severity === 'error').length;
  const warningCount = result.findings.filter((f) => f.severity === 'warning').length;
  return { errorCount, warningCount };
}

/** Render a report that contains no matched value and no source excerpt. */
export function formatReport(result, format = 'text') {
  const { errorCount, warningCount } = summarize(result);
  if (format === 'json') {
    return JSON.stringify({
      ok: errorCount === 0 && result.readErrors.length === 0,
      scannedFiles: result.scannedFiles,
      errorCount,
      warningCount,
      readErrors: result.readErrors,
      findings: result.findings,
    }, null, 2);
  }
  const lines = [
    `Secret pattern scan: ${result.scannedFiles} text file(s) scanned, ` +
      `${errorCount} error(s), ${warningCount} warning(s), ` +
      `${result.readErrors.length} read error(s)`,
  ];
  for (const error of result.readErrors) {
    lines.push(`  error ${error.path}:0 READ_FAILED ${error.code}`);
  }
  for (const finding of result.findings) {
    lines.push(
      `  ${finding.severity} ${finding.path}:${finding.line} ` +
        `${finding.rule} ${finding.label}`,
    );
  }
  return lines.join('\n');
}

export function parseArgs(argv) {
  const options = {
    root: DEFAULT_ROOT,
    format: 'text',
    strict: false,
    help: false,
    selfTest: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') {
      options.format = 'json';
    } else if (arg === '--strict') {
      options.strict = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--self-test') {
      options.selfTest = true;
    } else if (arg === '--root') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error('--root requires a directory');
      options.root = value;
      i += 1;
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }
  return options;
}

/** Parse, scan and render without writing to stdout (testable entry point). */
export function runCli(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    return {
      exitCode: 2,
      stdout: '',
      stderr: `Usage error: ${error.message}\n${USAGE}\n`,
    };
  }
  if (options.help) return { exitCode: 0, stdout: `${USAGE}\n`, stderr: '' };
  let result;
  try {
    result = scanRepository(options.root);
  } catch (error) {
    return {
      exitCode: 2,
      stdout: '',
      stderr: `Scan failed: ${error?.code ?? 'SCAN_FAILED'}\n`,
    };
  }
  const { errorCount, warningCount } = summarize(result);
  const exitCode =
    errorCount > 0 || result.readErrors.length > 0 || (options.strict && warningCount > 0)
      ? 1
      : 0;
  return {
    exitCode,
    stdout: `${formatReport(result, options.format)}\n`,
    stderr: '',
  };
}

async function runSelfTests() {
  const { test } = await import('node:test');
  const assert = (await import('node:assert/strict')).default;

  const fakeKey = `sk-${'A7b3Kp9Qz2Vm5Nx8Wt4Yc6Rs1'.repeat(2)}`;

  test('provider-shaped key is reported as an error without its value', () => {
    const findings = scanText(`KEY=${fakeKey}\n`, 'src/fake.ts');
    assert.equal(findings.length, 1);
    assert.equal(findings[0].rule, 'OPENAI_TOKEN');
    assert.equal(findings[0].severity, 'error');
    assert.ok(!JSON.stringify(findings).includes(fakeKey));
  });

  test('placeholder and environment-reference values are ignored', () => {
    const text = [
      'API_KEY=your_key_here',
      'TOKEN=process.env.TOKEN',
      'SECRET=${SECRET}',
    ].join('\n');
    assert.deepEqual(scanText(text, '.env.example'), []);
  });

  test('credential assignment is a warning', () => {
    const findings = scanText('const databasePassword = "hunter2xyz";\n', 'src/db.ts');
    assert.equal(findings.length, 1);
    assert.equal(findings[0].rule, 'GENERIC_ASSIGNMENT');
    assert.equal(findings[0].severity, 'warning');
  });

  test('private key block is an error', () => {
    const findings = scanText('-----BEGIN RSA PRIVATE KEY-----\n', 'cert.txt');
    assert.equal(findings.length, 1);
    assert.equal(findings[0].rule, 'PRIVATE_KEY_BLOCK');
    assert.equal(findings[0].severity, 'error');
  });

  test('an error suppresses warnings on the same line', () => {
    const findings = scanText(`GROQ_API_KEY=${fakeKey}\n`, 'src/config.ts');
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, 'error');
  });

  test('report contains paths and line numbers but never values', () => {
    const report = formatReport(
      { scannedFiles: 1, findings: scanText(`KEY=${fakeKey}\n`, 'src/fake.ts'), readErrors: [] },
      'json',
    );
    assert.ok(report.includes('src/fake.ts'));
    assert.ok(!report.includes(fakeKey));
  });

  test('real .env is never scanned while .env.example is', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linguaai-secret-test-'));
    try {
      fs.writeFileSync(path.join(root, '.env'), `API_KEY=${fakeKey}\n`);
      fs.writeFileSync(path.join(root, '.env.example'), 'API_KEY=your_key_here\n');
      const result = scanRepository(root);
      assert.equal(result.scannedFiles, 1);
      assert.deepEqual(result.findings, []);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('generated directories are skipped', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linguaai-secret-test-'));
    try {
      fs.mkdirSync(path.join(root, 'dist'));
      fs.mkdirSync(path.join(root, 'src'));
      fs.writeFileSync(path.join(root, 'dist', 'app.js'), `KEY=${fakeKey}\n`);
      fs.writeFileSync(path.join(root, 'src', 'app.js'), `KEY=${fakeKey}\n`);
      const result = scanRepository(root);
      assert.equal(result.findings.length, 1);
      assert.equal(result.findings[0].path, 'src/app.js');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('CLI exit code reflects errors and --strict warnings', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linguaai-secret-test-'));
    try {
      fs.writeFileSync(path.join(root, 'app.ts'), 'const databasePassword = "hunter2xyz";\n');
      assert.equal(runCli(['--root', root]).exitCode, 0);
      assert.equal(runCli(['--root', root, '--strict']).exitCode, 1);
      fs.writeFileSync(path.join(root, 'app.ts'), `KEY=${fakeKey}\n`);
      const run = runCli(['--root', root, '--json']);
      assert.equal(run.exitCode, 1);
      assert.ok(!run.stdout.includes(fakeKey));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}

const isTestContext =
  process.argv.includes('--self-test') ||
  process.argv.includes('--test') ||
  Object.prototype.hasOwnProperty.call(process.env, 'NODE_TEST_CONTEXT');

if (isTestContext) {
  await runSelfTests();
} else {
  const { exitCode, stdout, stderr } = runCli(process.argv.slice(2));
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  process.exitCode = exitCode;
}
