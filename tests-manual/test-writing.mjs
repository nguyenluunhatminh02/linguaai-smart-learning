/**
 * Manual test for Writing module — gọi 5 sample text qua /writing/assess.
 *
 * Yêu cầu chạy trước:
 *   1. API server: pnpm dev:api          (port 3001)
 *   2. AI service: pnpm dev:ai           (port 8000)
 *   3. Có sẵn 1 user trong DB. Sửa EMAIL/PASSWORD ở dưới hoặc set env:
 *        set TEST_EMAIL=admin@example.com
 *        set TEST_PASSWORD=Admin123!
 *
 * Cách chạy:
 *   node tests-manual/test-writing.mjs
 *
 * Output: log tất cả response + tổng kết bug nếu detect được.
 */

const API = process.env.API_URL || 'http://localhost:3001/api';
const EMAIL = process.env.TEST_EMAIL || 'admin@example.com';
const PASSWORD = process.env.TEST_PASSWORD || 'Admin123!';

const samples = [
  {
    name: 'PERFECT B2 — should score >= 80',
    language: 'english',
    targetLevel: 'B2',
    text:
      "Working from home has become increasingly common in recent years. " +
      "While it offers flexibility and saves commuting time, it can also " +
      "lead to social isolation and difficulty separating work from personal life. " +
      "Therefore, employers should establish clear boundaries and encourage " +
      "regular team interactions to maintain productivity and well-being.",
  },
  {
    name: 'INTENTIONAL ERRORS — should detect grammar/tense/article',
    language: 'english',
    targetLevel: 'B1',
    text:
      "I are go to school yesterday and meet my friend who is very nice person. " +
      "He don't like coffee but he like tea. We goes to library and study together " +
      "for the english exam.",
  },
  {
    name: 'A1 SHORT — should score low or warn too short',
    language: 'english',
    targetLevel: 'A1',
    text: "I like cat. Cat is good. I have one cat.",
  },
  {
    name: 'VIETNAMESE — multilingual support test',
    language: 'vietnamese',
    targetLevel: 'B1',
    text:
      "Học ngoại ngữ là một quá trình dài và đòi hỏi sự kiên nhẫn. " +
      "Tôi đã học tiếng Anh từ 5 năm trước nhưng tôi vẫn còn nhiều thứ phải cải thiện.",
  },
  {
    name: 'EDGE — empty-ish (1 char)',
    language: 'english',
    targetLevel: 'B1',
    text: "a",
  },
];

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', red: '\x1b[31m', green: '\x1b[32m',
  yellow: '\x1b[33m', cyan: '\x1b[36m', gray: '\x1b[90m',
};

async function login() {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Login failed (${res.status}): ${txt}`);
  }
  const data = await res.json();
  const payload = data?.data ?? data;
  const token = payload?.accessToken || payload?.access_token;
  if (!token) throw new Error('No accessToken in login response: ' + JSON.stringify(payload).slice(0, 200));
  return token;
}

async function assessWriting(token, sample) {
  const res = await fetch(`${API}/writing/assess`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      userText: sample.text,
      language: sample.language,
      targetLevel: sample.targetLevel,
    }),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { _raw: text }; }
  return { status: res.status, body: json };
}

function summarize(sample, result) {
  const { status, body } = result;
  const data = body?.data ?? body;

  console.log(`\n${c.bold}${c.cyan}━━━ ${sample.name} ━━━${c.reset}`);
  console.log(`${c.gray}lang=${sample.language} level=${sample.targetLevel} chars=${sample.text.length}${c.reset}`);
  console.log(`${c.gray}status: ${status}${c.reset}`);

  if (status >= 400) {
    console.log(`${c.red}❌ ERROR:${c.reset}`, JSON.stringify(body).slice(0, 500));
    return { ok: false, issues: ['HTTP error'] };
  }

  const issues = [];
  const overallScore = data?.overallScore;
  const errors = data?.errors ?? [];
  const scores = data?.scores ?? {};
  const rewritten = data?.rewrittenText;
  const suggestions = data?.suggestions ?? [];

  console.log(`${c.bold}Overall:${c.reset} ${overallScore}/100`);
  console.log(`${c.bold}Sub-scores:${c.reset} grammar=${scores.grammar} vocab=${scores.vocabulary} coherence=${scores.coherence} task=${scores.taskAchievement}`);
  console.log(`${c.bold}Errors found:${c.reset} ${errors.length}`);
  errors.slice(0, 3).forEach((e, i) => {
    console.log(`  ${i + 1}. [${e.type}] "${e.original}" → "${e.correction}"`);
    console.log(`     ${c.gray}${e.explanation}${c.reset}`);
  });
  console.log(`${c.bold}Rewritten:${c.reset} ${(rewritten || '(none)').slice(0, 120)}...`);
  console.log(`${c.bold}Suggestions:${c.reset} ${suggestions.length} items`);

  // ── Validation rules ─────────────────────────────────────
  if (typeof overallScore !== 'number') issues.push('overallScore not a number');
  if (overallScore < 0 || overallScore > 100) issues.push(`overallScore out of [0,100]: ${overallScore}`);
  if (!Array.isArray(errors)) issues.push('errors not an array');
  if (!rewritten) issues.push('rewrittenText missing');

  // Sample-specific expectations
  if (sample.name.startsWith('PERFECT') && overallScore < 70) {
    issues.push(`Expected score >= 70 for clean B2 text, got ${overallScore}`);
  }
  if (sample.name.startsWith('INTENTIONAL') && errors.length < 3) {
    issues.push(`Expected >= 3 errors for buggy text, got ${errors.length}`);
  }
  if (sample.name.startsWith('INTENTIONAL') && overallScore > 60) {
    issues.push(`Buggy text should score < 60, got ${overallScore}`);
  }
  if (sample.name.startsWith('VIETNAMESE') && errors.length === 0 && overallScore < 1) {
    issues.push('Vietnamese assessment seems broken');
  }

  if (issues.length === 0) {
    console.log(`${c.green}✅ PASS${c.reset}`);
    return { ok: true, issues: [] };
  }
  console.log(`${c.yellow}⚠ ISSUES:${c.reset}`);
  issues.forEach(i => console.log(`   - ${i}`));
  return { ok: false, issues };
}

async function testHistory(token) {
  console.log(`\n${c.bold}${c.cyan}━━━ GET /writing/history ━━━${c.reset}`);
  const issues = [];
  try {
    const res = await fetch(`${API}/writing/history?page=1&limit=10`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    const body = data?.data ?? data;
    console.log(`${c.gray}status: ${res.status}, total=${body?.total}, items=${body?.items?.length}${c.reset}`);

    if (res.status !== 200) {
      issues.push(`HTTP ${res.status}${body?.message ? `: ${body.message}` : ''}`);
      return { ok: false, issues };
    }
    // Contract: numeric total and an items array (even when empty).
    if (typeof body?.total !== 'number') issues.push('history.total is not a number');
    if (!Array.isArray(body?.items)) issues.push('history.items is not an array');
    return { ok: issues.length === 0, issues };
  } catch (err) {
    issues.push(`exception: ${err.message}`);
    return { ok: false, issues };
  }
}

async function testErrorAnalysis(token) {
  console.log(`\n${c.bold}${c.cyan}━━━ GET /writing/error-analysis ━━━${c.reset}`);
  const issues = [];
  try {
    const res = await fetch(`${API}/writing/error-analysis?language=english`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    const body = data?.data ?? data;
    console.log(`${c.gray}status: ${res.status}${c.reset}`);
    console.log(`fields: ${Object.keys(body || {}).join(', ')}`);

    if (res.status !== 200) {
      issues.push(`HTTP ${res.status}${body?.message ? `: ${body.message}` : ''}`);
      return { ok: false, issues };
    }
    // Contract: summary/patterns/exercises must be present even in the empty state.
    // A bare message without summary is the W1 regression this script claims to detect.
    if (body?.message && !body?.summary) {
      issues.push("BUG W1: empty-state response missing 'summary' field");
    }
    for (const field of ['summary', 'patterns', 'exercises']) {
      if (!(field in (body ?? {}))) issues.push(`error-analysis.${field} missing`);
    }
    return { ok: issues.length === 0, issues };
  } catch (err) {
    issues.push(`exception: ${err.message}`);
    return { ok: false, issues };
  }
}

async function main() {
  console.log(`${c.bold}LinguaAI Writing Manual Test${c.reset}`);
  console.log(`API: ${API}`);
  console.log(`User: ${EMAIL}`);

  let token;
  try {
    token = await login();
    console.log(`${c.green}✓ Login OK, token=${token.slice(0, 20)}...${c.reset}`);
  } catch (err) {
    console.error(`${c.red}✗ Login failed:${c.reset}`, err.message);
    console.error(`Hint: tạo user trước qua /auth/register hoặc set TEST_EMAIL/TEST_PASSWORD env vars.`);
    process.exit(1);
  }

  const results = [];
  for (const sample of samples) {
    try {
      const t0 = Date.now();
      const r = await assessWriting(token, sample);
      const elapsed = Date.now() - t0;
      console.log(`${c.gray}elapsed: ${elapsed}ms${c.reset}`);
      const summary = summarize(sample, r);
      results.push({ name: sample.name, ...summary, elapsed });
    } catch (err) {
      console.error(`${c.red}✗ ${sample.name} threw:${c.reset}`, err.message);
      results.push({ name: sample.name, ok: false, issues: ['exception'], elapsed: 0 });
    }
  }

  const historyResult = await testHistory(token);
  results.push({ name: 'GET /writing/history', ok: historyResult.ok, issues: historyResult.issues, elapsed: 0 });

  const errorAnalysisResult = await testErrorAnalysis(token);
  results.push({ name: 'GET /writing/error-analysis', ok: errorAnalysisResult.ok, issues: errorAnalysisResult.issues, elapsed: 0 });

  // ── Final summary ─────────────────────────────────────────
  console.log(`\n${c.bold}${c.cyan}═════════════ SUMMARY ═════════════${c.reset}`);
  let pass = 0, fail = 0;
  for (const r of results) {
    const tag = r.ok ? `${c.green}PASS${c.reset}` : `${c.red}FAIL${c.reset}`;
    console.log(`  ${tag} (${r.elapsed}ms) ${r.name}`);
    if (r.issues.length) r.issues.forEach(i => console.log(`     - ${i}`));
    r.ok ? pass++ : fail++;
  }
  console.log(`\n${c.bold}Total:${c.reset} ${c.green}${pass} pass${c.reset}, ${c.red}${fail} fail${c.reset}`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(`${c.red}Fatal:${c.reset}`, err);
  process.exit(1);
});
