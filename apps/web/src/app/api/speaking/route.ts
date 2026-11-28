import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { z } from 'zod';
import { verifyAuthHeader } from '@/lib/auth/jwt-verify';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

// Keep input bounds at the edge: the backend owns provider calls, billing and
// operation durability, but oversized or control-character transcripts should
// never reach it. All Unicode scripts remain valid (Vietnamese, Chinese, ...).
const SAFE_TEXT = /^[^\p{Cc}\p{Cf}]*$/u;
const safeString = (max: number) =>
  z
    .string()
    .max(max)
    .regex(SAFE_TEXT, 'Text contains unsupported control characters');

const SpeakingRequestSchema = z.object({
  text: safeString(4000).refine((value) => value.trim().length > 0, {
    message: 'Text is required',
  }),
  topic: safeString(200).optional(),
  level: z
    .string()
    .max(20)
    .regex(/^[A-Za-z0-9_-]+$/, 'Invalid level')
    .optional(),
  language: z
    .string()
    .max(30)
    .regex(/^[a-z_-]+$/, 'Invalid language')
    .optional(),
}).strict();

/** Format accepted for Idempotency-Key by the backend operation layer. */
const VALID_IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{1,128}$/;

export async function POST(req: NextRequest) {
  // The backend authorizes the operation and enforces ownership from the
  // forwarded bearer token; this check avoids unauthenticated proxying.
  const authHeader = req.headers.get('authorization');
  const user = await verifyAuthHeader(authHeader);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const parsedRequest = SpeakingRequestSchema.safeParse(rawBody);
  if (!parsedRequest.success) {
    return NextResponse.json(
      { error: parsedRequest.error.issues[0]?.message || 'Invalid request body' },
      { status: 400 },
    );
  }

  // The backend creates the durable AI operation and returns its operationId.
  // Reuse a valid caller key; otherwise derive a stable key from the owner and
  // the exact payload so a retry cannot reserve or charge a second operation.
  const suppliedKey = req.headers.get('idempotency-key')?.trim();
  const idempotencyKey =
    suppliedKey && VALID_IDEMPOTENCY_KEY.test(suppliedKey)
      ? suppliedKey
      : createHash('sha256')
          .update(
            `${user.id}:speaking_feedback:${parsedRequest.data.text}:${parsedRequest.data.topic ?? ''}:${parsedRequest.data.level ?? ''}:${parsedRequest.data.language ?? ''}`,
          )
          .digest('hex');

  let upstream: Response;
  try {
    upstream = await fetch(`${API_URL}/speaking/feedback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader!,
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(parsedRequest.data),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    console.error(
      '[Speaking API] Backend request failed:',
      error instanceof Error ? error.message : 'unknown error',
    );
    return NextResponse.json({ error: 'Speaking feedback service unavailable' }, { status: 502 });
  }

  // The backend owns response validation and returns { operationId, data }.
  // Forward it unchanged so callers receive the durable operation identifier.
  try {
    const data: unknown = await upstream.json();
    return NextResponse.json(data, { status: upstream.status });
  } catch {
    return NextResponse.json(
      { error: 'Invalid response from speaking service' },
      { status: 502 },
    );
  }
}
