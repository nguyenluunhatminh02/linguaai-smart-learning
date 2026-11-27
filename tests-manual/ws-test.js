// Speaking WebSocket test with real audio file
const WebSocket = require('../apps/api/node_modules/ws');
const fs = require('fs');
const http = require('http');
const path = require('path');

const API_BASE = 'http://localhost:3001/api';
const WS_URL = 'ws://localhost:3001/speaking-ws';
const EMAIL = 'speaker@test.com';
const PASS = 'Test1234!';
const SAMPLE = path.join(__dirname, 'sample.wav');

function doPost(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname, port: +u.port || 80,
      path: u.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };
    const req = http.request(opts, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(d) }));
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

function doGet(url, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname, port: +u.port || 80,
      path: u.pathname + u.search,
      headers: { Authorization: 'Bearer ' + token }
    };
    http.get(opts, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(d) }));
    }).on('error', reject);
  });
}

async function main() {
  console.log('=== Speaking WS Test ===');
  
  // 1. Login
  const loginRes = await doPost(API_BASE + '/auth/login', JSON.stringify({ email: EMAIL, password: PASS }));
  if (loginRes.status !== 200) { console.error('Login FAILED:', loginRes.body.message); process.exit(1); }
  const token = loginRes.body.data.accessToken;
  console.log('✅ Login OK');

  // 2. Load audio
  if (!fs.existsSync(SAMPLE)) { console.error('Sample file not found:', SAMPLE); process.exit(1); }
  const buf = fs.readFileSync(SAMPLE);
  const base64 = buf.toString('base64');
  console.log(`✅ Audio loaded: ${(buf.length/1024).toFixed(1)} KB`);

  // 3. WebSocket test
  console.log('Connecting WS...');
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL + '?token=' + encodeURIComponent(token));
    ws.on('open', () => {
      console.log('✅ WS connected');
      ws.send(JSON.stringify({ event: 'start_session', data: { topic: 'Describe your dream vacation', level: 'B2', language: 'english' } }));
    });
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      const summary = JSON.stringify(msg.data || {}).slice(0, 120);
      console.log(`  [${msg.event}]`, summary);
      if (msg.event === 'session_ready') {
        console.log('→ Sending audio_data...');
        ws.send(JSON.stringify({ event: 'audio_data', data: { audio: base64, mimeType: 'audio/wav' } }));
      }
      if (msg.event === 'feedback_done') {
        const d = msg.data;
        console.log('\n=== FEEDBACK DONE ===');
        console.log('Transcript:', d.transcript ? d.transcript.slice(0, 100) : '(none)');
        console.log('Scores:', JSON.stringify(d.scores));
        ws.close(); resolve();
      }
      if (msg.event === 'error') {
        console.error('WS error event:', msg.data?.message);
        ws.close(); reject(new Error(msg.data?.message));
      }
    });
    ws.on('error', (e) => { console.error('WS error:', e.message); reject(e); });
    setTimeout(() => { ws.close(); reject(new Error('Timeout 90s')); }, 90000);
  });

  // 4. Verify history persisted
  const histRes = await doGet(API_BASE + '/speaking/history?page=1&limit=10', token);
  console.log('\n=== HISTORY ===');
  console.log('Status:', histRes.status);
  console.log('Total:', histRes.body?.data?.total);
  if (histRes.body?.data?.items?.length > 0) {
    const item = histRes.body.data.items[0];
    console.log('First item:', item.id, '|', item.topic, '|', item.created_at);
    console.log('✅ PERSISTENCE VERIFIED');
  } else {
    console.log('⚠️ No items in history (may have been saved but pagination off, or save failed)');
  }
}

main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
