/**
 * Manual test for Speaking WebSocket — gửi 1 audio file mẫu để verify pipeline.
 *
 * Yêu cầu chạy trước:
 *   1. API server: pnpm dev:api          (port 3001, GROQ_API_KEY phải set)
 *   2. Audio mẫu có sẵn trong repo: tests-manual/sample.wav (mặc định).
 *      Có thể dùng file khác qua đối số hoặc SAMPLE_PATH (.webm/.mp3/...).
 *
 * Cách chạy:
 *   node tests-manual/test-speaking-ws.mjs
 *   node tests-manual/test-speaking-ws.mjs ./path/to/audio.mp3
 *
 * Output: log từng phase WS (connected → session_ready → status → transcript → feedback_chunk → feedback_done)
 */

import fs from 'node:fs';
import path from 'node:path';
import { WebSocket } from 'ws';

const API_HTTP = process.env.API_URL || 'http://localhost:3001/api';
const WS_URL = (process.env.WS_URL || 'ws://localhost:3001/speaking-ws');
const EMAIL = process.env.TEST_EMAIL || 'admin@example.com';
const PASSWORD = process.env.TEST_PASSWORD || 'Admin123!';
const SAMPLE_PATH = process.argv[2] || process.env.SAMPLE_PATH || './tests-manual/sample.wav';

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', red: '\x1b[31m', green: '\x1b[32m',
  yellow: '\x1b[33m', cyan: '\x1b[36m', gray: '\x1b[90m',
};

function mimeFromPath(p) {
  const ext = path.extname(p).toLowerCase();
  const map = {
    '.webm': 'audio/webm',
    '.mp3': 'audio/mpeg',
    '.mp4': 'audio/mp4',
    '.m4a': 'audio/mp4',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
  };
  return map[ext] || 'audio/webm';
}

async function login() {
  const res = await fetch(`${API_HTTP}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`Login ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const payload = data?.data ?? data;
  return payload?.accessToken || payload?.access_token;
}

function loadAudio() {
  if (!fs.existsSync(SAMPLE_PATH)) {
    console.error(`${c.red}✗ Audio file not found: ${SAMPLE_PATH}${c.reset}`);
    console.error(`Tạo file mẫu trước:`);
    console.error(`  1. Mở https://online-voice-recorder.com/ ghi âm 10s tiếng Anh, download MP3.`);
    console.error(`  2. Đặt vào ${SAMPLE_PATH}`);
    process.exit(1);
  }
  const buf = fs.readFileSync(SAMPLE_PATH);
  const mimeType = mimeFromPath(SAMPLE_PATH);
  console.log(`${c.gray}Audio: ${SAMPLE_PATH} (${(buf.length / 1024).toFixed(1)} KB, ${mimeType})${c.reset}`);
  return { base64: buf.toString('base64'), mimeType };
}

async function runWsTest(token, audio) {
  const url = `${WS_URL}?token=${encodeURIComponent(token)}`;
  console.log(`${c.cyan}Connecting to ${url.replace(/token=[^&]+/, 'token=***')}${c.reset}`);

  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    const phaseTimes = {};
    const t0 = Date.now();
    let transcript = '';
    let feedback = '';
    let scores = null;
    let chunkCount = 0;

    const setPhase = (phase) => {
      phaseTimes[phase] = Date.now() - t0;
      console.log(`${c.gray}[${phaseTimes[phase]}ms]${c.reset} ${c.bold}→ ${phase}${c.reset}`);
    };

    ws.on('open', () => {
      setPhase('open');
    });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); }
      catch { console.log(`${c.red}✗ non-JSON message:${c.reset}`, raw.toString().slice(0, 200)); return; }
      const { event, data } = msg;

      switch (event) {
        case 'connected':
          setPhase('connected');
          console.log(`${c.gray}  sid=${data?.sid}${c.reset}`);
          // Start session
          ws.send(JSON.stringify({
            event: 'start_session',
            data: { topic: 'Talk about your favorite hobby', level: 'B1', language: 'english' },
          }));
          break;

        case 'session_ready':
          setPhase('session_ready');
          console.log(`${c.gray}  sending audio (${audio.mimeType}, ${(audio.base64.length / 1024).toFixed(1)} KB base64)${c.reset}`);
          ws.send(JSON.stringify({
            event: 'audio_data',
            data: { audio: audio.base64, mimeType: audio.mimeType },
          }));
          break;

        case 'status':
          console.log(`${c.gray}  status: ${data?.phase} - ${data?.message}${c.reset}`);
          break;

        case 'transcript':
          setPhase('transcript');
          transcript = data?.text || '';
          console.log(`${c.green}  📝 "${transcript}"${c.reset}`);
          break;

        case 'feedback_chunk':
          if (chunkCount === 0) setPhase('first_chunk');
          chunkCount++;
          feedback += data?.chunk || '';
          process.stdout.write(c.gray + (data?.chunk || '') + c.reset);
          break;

        case 'feedback_done':
          process.stdout.write('\n');
          setPhase('feedback_done');
          scores = data?.scores;
          console.log(`${c.gray}  chunks received: ${chunkCount}${c.reset}`);
          ws.close();
          resolve({ transcript, feedback, scores, phaseTimes, chunkCount });
          break;

        case 'error':
          console.log(`${c.red}✗ Server error: ${data?.message}${c.reset}`);
          ws.close();
          resolve({ error: data?.message, phaseTimes });
          break;

        default:
          console.log(`${c.yellow}? Unknown event: ${event}${c.reset}`, data);
      }
    });

    ws.on('error', (err) => {
      console.error(`${c.red}WS error:${c.reset}`, err.message);
      resolve({ error: err.message, phaseTimes });
    });

    ws.on('close', (code, reason) => {
      console.log(`${c.gray}WS closed: ${code} ${reason?.toString() || ''}${c.reset}`);
    });

    // Hard timeout
    setTimeout(() => {
      if (ws.readyState !== WebSocket.CLOSED) {
        console.error(`${c.red}✗ Timeout after 60s${c.reset}`);
        ws.close();
        resolve({ error: 'timeout', phaseTimes });
      }
    }, 60_000);
  });
}

function summarize(result) {
  console.log(`\n${c.bold}${c.cyan}═════════════ RESULT ═════════════${c.reset}`);
  if (result.error) {
    console.log(`${c.red}✗ FAIL: ${result.error}${c.reset}`);
    return false;
  }

  const { phaseTimes, transcript, scores, chunkCount } = result;
  console.log(`${c.bold}Phase timings:${c.reset}`);
  Object.entries(phaseTimes).forEach(([p, t]) => {
    console.log(`  ${p.padEnd(20)} ${t}ms`);
  });

  console.log(`\n${c.bold}Transcript:${c.reset} "${transcript}"`);
  console.log(`${c.bold}Feedback chunks:${c.reset} ${chunkCount}`);

  if (scores) {
    console.log(`${c.bold}Scores:${c.reset}`);
    console.log(`  overall:       ${scores.overall}/100`);
    console.log(`  pronunciation: ${scores.pronunciation}/100`);
    console.log(`  fluency:       ${scores.fluency}/100`);
    console.log(`  grammar:       ${scores.grammar}/100`);
    console.log(`  vocabulary:    ${scores.vocabulary}/100`);
  } else {
    console.log(`${c.yellow}⚠ scores missing — possibly BUG S3 (parseScores fallback)${c.reset}`);
  }

  // ── Bug detection ──────────────────────────────────────
  const issues = [];
  if (scores && scores.overall === 70 && scores.pronunciation === 70 &&
      scores.fluency === 70 && scores.grammar === 70 && scores.vocabulary === 70) {
    issues.push(`${c.red}🚨 BUG S3 confirmed: all scores = 70 → parseScores hit fallback. LLM forgot [SCORES] block.${c.reset}`);
  }
  if (!transcript) {
    issues.push(`${c.yellow}⚠ Empty transcript — Whisper failed${c.reset}`);
  }
  if (chunkCount < 5) {
    issues.push(`${c.yellow}⚠ Only ${chunkCount} chunks streamed — LLM response too short${c.reset}`);
  }

  if (issues.length === 0) {
    console.log(`\n${c.green}✅ PASS — pipeline OK${c.reset}`);
    return true;
  }

  console.log(`\n${c.bold}Issues:${c.reset}`);
  issues.forEach(i => console.log(`  ${i}`));
  return false;
}

async function main() {
  console.log(`${c.bold}LinguaAI Speaking WS Manual Test${c.reset}`);

  let token;
  try {
    token = await login();
    console.log(`${c.green}✓ Login OK${c.reset}`);
  } catch (err) {
    console.error(`${c.red}✗ Login failed:${c.reset}`, err.message);
    process.exit(1);
  }

  const audio = loadAudio();
  const result = await runWsTest(token, audio);
  const ok = summarize(result);
  process.exit(ok ? 0 : 1);
}

main().catch(err => {
  console.error(`${c.red}Fatal:${c.reset}`, err);
  process.exit(1);
});
