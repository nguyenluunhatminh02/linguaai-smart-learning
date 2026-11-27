// Quick debug: login + test speaking history + WS
const API = 'http://localhost:3001/api';

async function login() {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@example.com',
      password: 'Admin123!',
      deviceId: '9d506ab3-4f14-4b61-8db9-56b4521de287',
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Login ${res.status}: ${data?.message}`);
  return (data?.data ?? data)?.accessToken;
}

async function main() {
  const token = await login();
  console.log('Token OK');

  // Test speaking history — raw response
  console.log('\n=== GET /api/speaking/history ===');
  const res1 = await fetch(`${API}/speaking/history?page=1&limit=5`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  console.log('Status:', res1.status);
  // Do not dump response headers: authenticated responses can carry
  // Set-Cookie/session material. Log only a bounded body preview.
  const text1 = await res1.text();
  console.log('Body:', text1.slice(0, 500));

  // Test WS via fetch (just checking port is open)
  console.log('\n=== WS endpoint check (HTTP upgrade expected) ===');
  try {
    const res2 = await fetch('http://localhost:3001/speaking-ws', { method: 'GET' });
    console.log('Status:', res2.status);
    const text2 = await res2.text();
    console.log('Body:', text2.slice(0, 200));
  } catch (e) {
    console.log('Fetch error (expected for WS):', e.message);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
