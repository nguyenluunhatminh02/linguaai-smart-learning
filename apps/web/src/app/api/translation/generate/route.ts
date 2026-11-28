import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { verifyAuthHeader } from "@/lib/auth/jwt-verify";

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

/**
 * Translation generation is intentionally a thin BFF proxy: the provider key,
 * token reservation, durable idempotency and operation ledger all live behind
 * the NestJS API. This route only authenticates the caller and relays the
 * legacy { data } / { error } contract used by the translation page.
 */
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const user = await verifyAuthHeader(authHeader);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  try {
    const backendRes = await fetch(`${API_URL}/translation/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader!,
        'Idempotency-Key': randomUUID(),
      },
      body: JSON.stringify(body),
    });

    if (backendRes.status === 200) {
      const json = await backendRes.json();
      // Preserve the legacy UI contract: the page reads json.data.sentences.
      if (json?.data) {
        return NextResponse.json({ data: json.data });
      }
      console.error('[Translation Generate API] Backend returned no data');
      return NextResponse.json({ error: 'Invalid AI response' }, { status: 502 });
    }

    let json: { error?: unknown; message?: unknown; detail?: unknown } = {};
    try {
      json = await backendRes.json();
    } catch {
      // Non-JSON gateway errors still need a stable UI error shape.
    }

    const message =
      (typeof json.error === 'string' && json.error) ||
      (typeof json.message === 'string' && json.message) ||
      (typeof json.detail === 'string' && json.detail);

    switch (backendRes.status) {
      case 400:
        return NextResponse.json(
          { error: message || 'Invalid request' },
          { status: 400 },
        );
      case 401:
      case 403:
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      case 402:
        return NextResponse.json(
          { error: message || 'Insufficient tokens' },
          { status: 402 },
        );
      case 409:
        return NextResponse.json(
          { error: message || 'Duplicate request' },
          { status: 409 },
        );
      case 429:
        return NextResponse.json(
          { error: message || 'Too many requests' },
          { status: 429 },
        );
      case 502:
        return NextResponse.json(
          { error: message || 'AI service temporarily unavailable' },
          { status: 502 },
        );
      default:
        if (backendRes.status >= 500) {
          console.error(
            '[Translation Generate API] Backend error:',
            backendRes.status,
          );
          return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 },
          );
        }
        return NextResponse.json(
          { error: message || 'Failed to generate translation lesson' },
          { status: 502 },
        );
    }
  } catch (error) {
    console.error('[Translation Generate API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to connect to translation service' },
      { status: 502 },
    );
  }
}
