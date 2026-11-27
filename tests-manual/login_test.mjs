const API = process.env.API_URL || 'http://localhost:3001/api';
const EMAIL = process.env.TEST_EMAIL || 'admin@example.com';
const PASSWORD = process.env.TEST_PASSWORD || 'Admin123!';

async function login() {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error('Login failed:', data);
    process.exit(1);
  }
  // Never dump the full response — it contains accessToken/refreshToken.
  // Log only non-sensitive identifiers so terminal/CI scrollback stays safe.
  const safe = {
    user: data?.data?.user?.email ?? data?.user?.email ?? '(unknown)',
    hasAccessToken: Boolean(data?.data?.accessToken ?? data?.accessToken),
  };
  console.log('Login success:', JSON.stringify(safe));
}

login().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
