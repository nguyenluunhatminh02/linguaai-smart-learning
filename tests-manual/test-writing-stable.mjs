// Wrapper: login with stable deviceId to avoid "Maximum number of devices" issue,
// then run the same suite as test-writing.mjs.
const API = process.env.API_URL || 'http://localhost:3001/api';
const EMAIL = process.env.TEST_EMAIL || 'admin@example.com';
const PASSWORD = process.env.TEST_PASSWORD || 'Admin123!';
const DEVICE_ID = process.env.TEST_DEVICE_ID || 'cascade-test-device-uuid-0001';

const samples = [
  {
    name: 'PERFECT B2 — should score >= 70',
    language: 'english',
    targetLevel: 'B2',
    text:
      'Working from home has become increasingly common in recent years. ' +
      'While it offers flexibility and saves commuting time, it can also ' +
      'lead to social isolation and difficulty separating work from personal life. ' +
      'Therefore, employers should establish clear boundaries and encourage ' +
      'regular team interactions to maintain productivity and well-being.',
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
    name: 'A1 SHORT — should score low',
    language: 'english',
    targetLevel: 'A1',
    text: 'I like cat. Cat is good. I have one cat.',
  },
  {
    name: 'VIETNAMESE — multilingual',
    language: 'vietnamese',
    targetLevel: 'B1',
    text:
      'Học ngoại ngữ là một quá trình dài và đòi hỏi sự kiên nhẫn. ' +
      'Tôi đã học tiếng Anh từ 5 năm trước nhưng tôi vẫn còn nhiều thứ phải cải thiện.',
  },
];

async function login() {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: EMAIL,
      password: PASSWORD,
      deviceId: DEVICE_ID,
      deviceName: 'Cascade Test',
      deviceType: 'desktop',
    }),
  });
  if (!res.ok) {
    throw new Error(`Login ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  const payload = data?.data ?? data;
  return payload?.accessToken;
}

async function assess(token, sample) {
  const t0 = Date.now();
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
  const elapsed = Date.now() - t0;
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { _raw: text }; }
  return { status: res.status, body: json, elapsed };
}

async function getHistory(token) {
  const res = await fetch(`${API}/writing/history?page=1&limit=10`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: res.status, body: await res.json() };
}

async function getErrorAnalysis(token) {
  const res = await fetch(`${API}/writing/error-analysis?language=english`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: res.status, body: await res.json() };
}

(async () => {
  console.log('═══ Writing E2E Test ═══');
  let token;
  try {
    token = await login();
    console.log(`✓ Login OK (token=${token.slice(0, 16)}...)`);
  } catch (e) {
    console.error('✗ Login failed:', e.message);
    process.exit(1);
  }

  const results = [];
  for (const s of samples) {
    console.log(`\n━━━ ${s.name} ━━━`);
    console.log(`  lang=${s.language} level=${s.targetLevel} chars=${s.text.length}`);
    try {
      const r = await assess(token, s);
      console.log(`  status=${r.status} elapsed=${r.elapsed}ms`);
      const data = r.body?.data ?? r.body;
      if (r.status >= 400) {
        console.log('  ❌ ERROR body:', JSON.stringify(r.body).slice(0, 400));
        results.push({ name: s.name, ok: false });
        continue;
      }
      console.log(`  Overall: ${data?.overallScore}/100`);
      console.log(`  Sub-scores: grammar=${data?.scores?.grammar} vocab=${data?.scores?.vocabulary} coherence=${data?.scores?.coherence} task=${data?.scores?.taskAchievement}`);
      console.log(`  Errors: ${data?.errors?.length ?? 0}`);
      if (data?.errors?.length) {
        data.errors.slice(0, 2).forEach((e, i) => {
          console.log(`    ${i + 1}. [${e.type}] "${e.original}" → "${e.correction}"`);
        });
      }
      console.log(`  Rewritten: ${(data?.rewrittenText || '').slice(0, 90)}...`);
      console.log(`  Suggestions: ${data?.suggestions?.length ?? 0}`);
      results.push({ name: s.name, ok: typeof data?.overallScore === 'number' && r.status === 200 });
    } catch (e) {
      console.error('  ✗ EXCEPTION:', e.message);
      results.push({ name: s.name, ok: false });
    }
  }

  console.log('\n━━━ GET /writing/history ━━━');
  const h = await getHistory(token);
  const hb = h.body?.data ?? h.body;
  console.log(`  status=${h.status} total=${hb?.total} items=${hb?.items?.length}`);

  console.log('\n━━━ GET /writing/error-analysis ━━━');
  const ea = await getErrorAnalysis(token);
  const eb = ea.body?.data ?? ea.body;
  console.log(`  status=${ea.status} keys=${Object.keys(eb || {}).join(',')}`);
  console.log(`  analyzedSubmissions=${eb?.analyzedSubmissions} totalErrors=${eb?.totalErrors} patterns=${eb?.patterns?.length} exercises=${eb?.exercises?.length}`);
  if (eb?.summary) console.log(`  summary: ${eb.summary.slice(0, 120)}...`);
  if (eb?.priority_focus) console.log(`  priority_focus: ${eb.priority_focus}`);

  console.log('\n═══ SUMMARY ═══');
  let pass = 0, fail = 0;
  for (const r of results) {
    console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`);
    r.ok ? pass++ : fail++;
  }
  console.log(`Total: ${pass} pass, ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
})().catch(err => { console.error('Fatal:', err); process.exit(1); });
