import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

export async function POST(req: NextRequest) {
  // Forward only the refresh token — never the whole cookie jar (which may
  // contain auth_session, userRole, or other unrelated cookies) to the API.
  const refreshToken = req.cookies.get('refreshToken')?.value;
  try {
    const res = await fetch(`${API_URL}/auth/refresh-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(refreshToken ? { refreshToken } : {}),
    });

    // The rotated refresh token stays in the httpOnly Set-Cookie only. The
    // access token is returned in the body so the in-memory client can use it,
    // but no script can read the long-lived refresh credential from JSON.
    let data: Record<string, unknown>;
    try {
      data = await res.json();
    } catch {
      data = { message: 'Invalid refresh response from API' };
    }
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data ?? {})) {
      if (key !== 'refreshToken' && key !== 'refresh_token' && key !== 'refresh') {
        sanitized[key] = value;
      }
    }
    const response = NextResponse.json(sanitized, { status: res.status });
    const setCookie = res.headers.getSetCookie?.() ?? [];
    for (const cookie of setCookie) {
      response.headers.append('Set-Cookie', cookie);
    }
    return response;
  } catch {
    return NextResponse.json({ message: 'Refresh failed' }, { status: 401 });
  }
}
