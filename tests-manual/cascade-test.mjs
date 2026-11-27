/**
 * Cascade auto-test for Writing + Speaking (HTTP only, no browser).
 * Uses existing deviceId to avoid "Maximum devices" error.
 */
const API = 'http://localhost:3001/api';
const EMAIL = 'admin@example.com';
const PASSWORD = 'Admin123!';
const DEVICE_ID = '9d506ab3-4f14-4b61-8db9-56b4521de287';

// ─── Login ───────────────────────────────────────────────
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
  const data = await res.json();
  if (!res.ok) throw new Error(`Login ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return (data?.data ?? data)?.accessToken;
}

// ─── Writing Tests ───────────────────────────────────────
const writingSamples = [
  {
    name: 'PERFECT B2',
    body: {
      userText:
        'Working from home has become increasingly common in recent years. ' +
        'While it offers flexibility and saves commuting time, it can also lead to social isolation. ' +
        'Therefore, employers should establish clear boundaries and encourage regular team interactions.',
      language: 'english',
      targetLevel: 'B2',
    },
    expect: { minScore: 60 },
  },
  {
    name: 'INTENTIONAL ERRORS',
    body: {
      userText:
        "I are go to school yesterday and meet my friend who is very nice person. " +
        "He don't like coffee but he like tea. We goes to library.",
      language: 'english',
      targetLevel: 'B1',
    },
    expect: { minErrors: 3, maxScore: 60 },
  },
  {
    name: 'VIETNAMESE',
    body: {
      userText:
        'Học ngoại ngữ là một quá trình dài và đòi hỏi sự kiên nhẫn. ' +
        'Tôi đã học tiếng Anh từ 5 năm trước nhưng tôi vẫn còn nhiều thứ phải cải thiện.',
      language: 'vietnamese',
      targetLevel: 'B1',
    },
    expect: {},
  },
];

async function testWritingAssess(token, sample) {
  const t0 = Date.now();
  const res = await fetch(`${API}/writing/assess`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(sample.body),
  });
  const elapsed = Date.now() - t0;
  const raw = await res.text();
  let json;
  try { json = JSON.parse(raw); } catch { json = { _raw: raw }; }
  const data = json?.data ?? json;
  return { status: res.status, data, elapsed };
}

async function testWritingHistory(token) {
  const res = await fetch(`${API}/writing/history?page=1&limit=5`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json();
  return { status: res.status, data: json?.data ?? json };
}

async function testWritingErrorAnalysis(token) {
  const res = await fetch(`${API}/writing/error-analysis?language=english`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json();
  return { status: res.status, data: json?.data ?? json };
}

// ─── Speaking Tests (HTTP topic generation + WS connectivity) ────
async function testSpeakingTopic(token) {
  // This goes to Next.js API route (/api/speaking/topic)
  const res = await fetch('http://localhost:3000/api/speaking/topic', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ level: 'B1', category: 'daily', language: 'english' }),
  });
  const raw = await res.text();
  let json;
  try { json = JSON.parse(raw); } catch { json = { _raw: raw }; }
  return { status: res.status, data: json?.data ?? json };
}

async function testSpeakingHistory(token) {
  const res = await fetch(`${API}/speaking/history?page=1&limit=5`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json();
  return { status: res.status, data: json?.data ?? json };
}

async function testSpeakingWsConnect(token) {
  // Test WebSocket connectivity (connect + start_session + disconnect)
  // Use dynamic import for ws
  const { WebSocket } = await import('ws');
  const url = `ws://localhost:3001/speaking-ws?token=${encodeURIComponent(token)}`;

  return new Promise((resolve) => {
    const events = [];
    const t0 = Date.now();
    const ws = new WebSocket(url);

    const timeout = setTimeout(() => {
      ws.close();
      resolve({ ok: false, events, error: 'Timeout 15s' });
    }, 15000);

    ws.on('open', () => {
      events.push({ event: 'ws_open', ms: Date.now() - t0 });
    });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        events.push({ event: msg.event, ms: Date.now() - t0, data: msg.data });

        if (msg.event === 'connected') {
          // Send start_session
          ws.send(JSON.stringify({
            event: 'start_session',
            data: { topic: 'Test topic', level: 'B1', language: 'english' },
          }));
        }
        if (msg.event === 'session_ready') {
          // WS is functional — don't send audio (no sample file), just close
          events.push({ event: 'test_complete', ms: Date.now() - t0 });
          clearTimeout(timeout);
          ws.close();
          resolve({ ok: true, events });
        }
        if (msg.event === 'error') {
          clearTimeout(timeout);
          ws.close();
          resolve({ ok: false, events, error: msg.data?.message });
        }
      } catch (e) {
        events.push({ event: 'parse_error', ms: Date.now() - t0 });
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      events.push({ event: 'ws_error', ms: Date.now() - t0, error: err.message });
      resolve({ ok: false, events, error: err.message });
    });

    ws.on('close', (code, reason) => {
      events.push({ event: 'ws_close', ms: Date.now() - t0, code, reason: reason?.toString() });
    });
  });
}

// ─── Main ────────────────────────────────────────────────
const report = { writing: [], speaking: [], bugs: [] };

(async () => {
  console.log('==================================================');
  console.log('  LinguaAI — Writing + Speaking E2E Test');
  console.log('==================================================\n');

  // 1. Login
  let token;
  try {
    token = await login();
    console.log(`[LOGIN] OK — token=${token.slice(0, 20)}...`);
  } catch (e) {
    console.error(`[LOGIN] FAIL: ${e.message}`);
    process.exit(1);
  }

  // ═══════════════════════════════════════════════════════════
  // 2. WRITING TESTS
  // ═══════════════════════════════════════════════════════════
  console.log('\n== WRITING: /writing/assess ==');
  for (const s of writingSamples) {
    console.log(`\n--- ${s.name} ---`);
    try {
      const r = await testWritingAssess(token, s);
      console.log(`  HTTP ${r.status} (${r.elapsed}ms)`);
      if (r.status >= 400) {
        console.log(`  ERROR: ${JSON.stringify(r.data).slice(0, 300)}`);
        report.writing.push({ name: s.name, pass: false, reason: `HTTP ${r.status}` });
        continue;
      }
      const d = r.data;
      console.log(`  overallScore: ${d?.overallScore}/100`);
      console.log(`  scores: grammar=${d?.scores?.grammar} vocab=${d?.scores?.vocabulary} coherence=${d?.scores?.coherence} task=${d?.scores?.taskAchievement}`);
      console.log(`  errors: ${d?.errors?.length ?? 0}`);
      (d?.errors || []).slice(0, 2).forEach((e, i) =>
        console.log(`    ${i+1}. [${e.type}] "${e.original}" -> "${e.correction}"`)
      );
      console.log(`  rewrittenText: ${(d?.rewrittenText || 'null').slice(0, 80)}...`);
      console.log(`  suggestions: ${d?.suggestions?.length ?? 0}`);

      const issues = [];
      if (typeof d?.overallScore !== 'number') { issues.push('overallScore not number'); }
      if (s.expect.minScore && d?.overallScore < s.expect.minScore) { issues.push(`score ${d?.overallScore} < ${s.expect.minScore}`); }
      if (s.expect.maxScore && d?.overallScore > s.expect.maxScore) { issues.push(`score ${d?.overallScore} > ${s.expect.maxScore}`); }
      if (s.expect.minErrors && (d?.errors?.length ?? 0) < s.expect.minErrors) { issues.push(`errors ${d?.errors?.length} < ${s.expect.minErrors}`); }
      // Any violated expectation is a failed test, not just a logged issue.
      const pass = issues.length === 0;
      if (issues.length) console.log(`  ISSUES: ${issues.join(', ')}`);
      report.writing.push({ name: s.name, pass, issues });
    } catch (e) {
      console.log(`  EXCEPTION: ${e.message}`);
      report.writing.push({ name: s.name, pass: false, reason: e.message });
    }
  }

  // 2b. Writing History
  console.log('\n--- Writing History ---');
  try {
    const h = await testWritingHistory(token);
    console.log(`  HTTP ${h.status} total=${h.data?.total} items=${h.data?.items?.length}`);
    report.writing.push({ name: 'History', pass: h.status === 200 });
  } catch (e) {
    console.log(`  EXCEPTION: ${e.message}`);
    report.writing.push({ name: 'History', pass: false });
  }

  // 2c. Error Analysis
  console.log('\n--- Error Analysis ---');
  try {
    const ea = await testWritingErrorAnalysis(token);
    console.log(`  HTTP ${ea.status}`);
    console.log(`  keys: ${Object.keys(ea.data || {}).join(', ')}`);
    console.log(`  analyzedSubmissions=${ea.data?.analyzedSubmissions} totalErrors=${ea.data?.totalErrors}`);
    if (ea.data?.summary) console.log(`  summary: ${ea.data.summary.slice(0, 100)}...`);
    if (ea.data?.patterns) console.log(`  patterns: ${ea.data.patterns.length}`);
    if (ea.data?.exercises) console.log(`  exercises: ${ea.data.exercises.length}`);
    // BUG W1 check
    if (ea.data?.message && !ea.data?.summary) {
      console.log(`  BUG W1: response has message but no summary — frontend will render undefined`);
      report.bugs.push('W1: error-analysis empty state missing summary field');
    }
    report.writing.push({ name: 'Error Analysis', pass: ea.status === 200 });
  } catch (e) {
    console.log(`  EXCEPTION: ${e.message}`);
    report.writing.push({ name: 'Error Analysis', pass: false });
  }

  // ═══════════════════════════════════════════════════════════
  // 3. SPEAKING TESTS
  // ═══════════════════════════════════════════════════════════
  console.log('\n\n== SPEAKING ==');

  // 3a. Topic Generation (Next.js API route)
  console.log('\n--- Speaking Topic Generation (/api/speaking/topic) ---');
  try {
    const t = await testSpeakingTopic(token);
    console.log(`  HTTP ${t.status}`);
    if (t.status === 200 && t.data) {
      console.log(`  topic: ${t.data.topic}`);
      console.log(`  prompt: ${(t.data.prompt || '').slice(0, 80)}...`);
      console.log(`  tips: ${t.data.tips?.length ?? 0}, phrases: ${t.data.samplePhrases?.length ?? 0}`);
      console.log(`  duration: ${t.data.duration}s, difficulty: ${t.data.difficulty}`);
      report.speaking.push({ name: 'Topic Gen', pass: true });
    } else {
      console.log(`  ERROR: ${JSON.stringify(t.data).slice(0, 200)}`);
      report.speaking.push({ name: 'Topic Gen', pass: false });
    }
  } catch (e) {
    console.log(`  EXCEPTION: ${e.message}`);
    report.speaking.push({ name: 'Topic Gen', pass: false });
  }

  // 3b. Speaking History (NestJS)
  console.log('\n--- Speaking History (/speaking/history) ---');
  try {
    const sh = await testSpeakingHistory(token);
    console.log(`  HTTP ${sh.status} total=${sh.data?.total} items=${sh.data?.items?.length}`);
    report.speaking.push({ name: 'History', pass: sh.status === 200 });
  } catch (e) {
    console.log(`  EXCEPTION: ${e.message}`);
    report.speaking.push({ name: 'History', pass: false });
  }

  // 3c. WebSocket connectivity test
  console.log('\n--- Speaking WS Connect + start_session ---');
  try {
    const ws = await testSpeakingWsConnect(token);
    console.log(`  Result: ${ws.ok ? 'OK' : 'FAIL'}`);
    ws.events.forEach(e => {
      console.log(`    [${e.ms}ms] ${e.event}${e.data?.sid ? ' sid=' + e.data.sid : ''}${e.error ? ' err=' + e.error : ''}${e.code ? ' code=' + e.code : ''}`);
    });
    if (!ws.ok) console.log(`  Error: ${ws.error}`);
    report.speaking.push({ name: 'WS Connect+Session', pass: ws.ok });
  } catch (e) {
    console.log(`  EXCEPTION: ${e.message}`);
    report.speaking.push({ name: 'WS Connect+Session', pass: false });
  }

  // Note: Full speaking audio pipeline NOT tested (no sample audio file available).
  // WS connect + start_session proves gateway is functional.
  console.log('\n  NOTE: Full audio pipeline (record→STT→feedback) not tested — no sample audio file.');
  console.log('        WS connect + session_ready proves gateway is functional.\n');

  // ═══════════════════════════════════════════════════════════
  // 4. KNOWN BUGS FROM CODE REVIEW
  // ═══════════════════════════════════════════════════════════
  report.bugs.push('FRONTEND BUG: writing/page.tsx uses submitError/setSubmitError without useState declaration');

  // ═══════════════════════════════════════════════════════════
  // 5. SUMMARY
  // ═══════════════════════════════════════════════════════════
  console.log('==================================================');
  console.log('  TEST REPORT');
  console.log('==================================================');
  console.log('\n--- Writing ---');
  report.writing.forEach(r => console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.issues?.length ? ' (' + r.issues.join(', ') + ')' : ''}${r.reason ? ' — ' + r.reason : ''}`));
  console.log('\n--- Speaking ---');
  report.speaking.forEach(r => console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.reason ? ' — ' + r.reason : ''}`));

  if (report.bugs.length) {
    console.log('\n--- Known Bugs ---');
    report.bugs.forEach(b => console.log(`  BUG: ${b}`));
  }

  const allTests = [...report.writing, ...report.speaking];
  const passed = allTests.filter(t => t.pass).length;
  const failed = allTests.filter(t => !t.pass).length;
  console.log(`\nTotal: ${passed} PASS, ${failed} FAIL, ${report.bugs.length} known bugs`);
  process.exit(failed > 0 ? 1 : 0);
})().catch(err => { console.error('Fatal:', err); process.exit(1); });
