import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomUUID } from 'crypto';
import { verifyAuthHeader } from '@/lib/auth/jwt-verify';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

/**
 * Speaking topic generation is owned by the NestJS API: it validates the
 * request, reserves credits against an AI operation, calls the AI service and
 * returns a durable operationId. This route is only a BFF proxy so the browser
 * never sees a provider key and never charges through the legacy
 * `/tokens/consume` path.
 */

const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]+$/;
const MAX_LANGUAGE_LENGTH = 30;
const MAX_LEVEL_LENGTH = 20;
const MAX_CATEGORY_LENGTH = 50;

interface TopicRequest {
  language: string;
  level: string;
  category: string;
}

interface TopicResponse {
  data: unknown;
  operationId: string;
  balance?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function boundedString(
  value: unknown,
  fallback: string,
  maxLength: number,
): string | null {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}

function parseTopicRequest(body: unknown): TopicRequest | null {
  const record = asRecord(body);
  if (!record) return null;

  const language = boundedString(record.language, 'english', MAX_LANGUAGE_LENGTH);
  const level = boundedString(record.level, 'B1', MAX_LEVEL_LENGTH);
  const category = boundedString(record.category, 'general', MAX_CATEGORY_LENGTH);

  if (!language || !level || !category) return null;
  return { language: language.toLowerCase(), level, category };
}

/**
 * Accept a caller-supplied key (header preferred) so retries replay the same
 * operation. If the client has no key yet, mint one; the backend still owns the
 * operation ledger and the actual reservation.
 */
function resolveIdempotencyKey(
  req: NextRequest,
  body: Record<string, unknown>,
  user: { id: string },
  topicRequest: TopicRequest,
): string | null {
  const fromHeader = req.headers.get('idempotency-key');
  const candidate =
    fromHeader !== null
      ? fromHeader.trim()
      : typeof body.idempotencyKey === 'string'
        ? body.idempotencyKey.trim()
        : '';

  if (candidate) {
    if (
      candidate.length > MAX_IDEMPOTENCY_KEY_LENGTH ||
      !IDEMPOTENCY_KEY_PATTERN.test(candidate)
    ) {
      return null;
    }
    return candidate;
  }

  // Legacy callers do not send a key. Derive a stable key from the verified
  // user and validated topic inputs so retries do not create duplicate paid
  // operations. Hashed inputs are bounded and contain no timestamp.
  return createHash('sha256')
    .update(`${user.id}:speaking_topic:${topicRequest.language}:${topicRequest.level}:${topicRequest.category}`)
    .digest('hex');
}

function responseMessage(payload: Record<string, unknown> | null): string | undefined {
  for (const key of ['error', 'message', 'detail']) {
    const value = payload?.[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim().slice(0, 300);
    }
  }
  return undefined;
}

function isInsufficientCredits(
  payload: Record<string, unknown> | null,
  message: string | undefined,
): boolean {
  return (
    payload?.code === 'INSUFFICIENT_CREDITS' ||
    /insufficient (tokens|credits)/i.test(message ?? '')
  );
}

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(req: NextRequest) {
  // The BFF still authenticates so anonymous callers cannot consume backend
  // quota; full authorization and billing stay in the NestJS API.
  const authHeader = req.headers.get('authorization');
  const user = await verifyAuthHeader(authHeader);
  if (!user) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: NO_STORE },
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400, headers: NO_STORE },
    );
  }

  const body = asRecord(rawBody);
  const topicRequest = parseTopicRequest(rawBody);
  const idempotencyKey = body
    ? resolveIdempotencyKey(req, body, user, topicRequest ?? {
        language: 'english',
        level: 'B1',
        category: 'general',
      })
    : null;

  if (!topicRequest || !idempotencyKey) {
    return NextResponse.json(
      { error: 'Invalid speaking topic request' },
      { status: 400, headers: NO_STORE },
    );
  }

  let backendRes: Response;
  try {
    backendRes = await fetch(`${API_URL}/speaking/topic/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: authHeader!,
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(topicRequest),
      cache: 'no-store',
    });
  } catch (error) {
    console.error('[Speaking Topic API] Backend connection error:', error);
    return NextResponse.json(
      { error: 'Failed to connect to speaking service' },
      { status: 502, headers: NO_STORE },
    );
  }

  const payload = asRecord(await backendRes.json().catch(() => null));
  const message = responseMessage(payload);
  const operationId =
    typeof payload?.operationId === 'string' && payload.operationId.trim()
      ? payload.operationId
      : undefined;

  if (backendRes.status === 200) {
    // A paid generation without a durable operationId cannot be replayed or
    // reconciled, so treat it as a broken backend contract.
    if (!payload?.data || !operationId) {
      console.error('[Speaking Topic API] Backend response missing data or operationId');
      return NextResponse.json(
        { error: 'Invalid AI response' },
        { status: 502, headers: NO_STORE },
      );
    }
    const response: TopicResponse = { data: payload.data, operationId };
    if (payload.balance !== undefined) response.balance = payload.balance;
    return NextResponse.json(response, { headers: NO_STORE });
  }

  if (backendRes.status === 202) {
    return NextResponse.json(
      {
        error: message || 'Topic generation in progress; retry with the same Idempotency-Key',
        ...(operationId ? { operationId } : {}),
      },
      { status: 202, headers: NO_STORE },
    );
  }

  switch (backendRes.status) {
    case 400:
    case 402:
      return NextResponse.json(
        {
          error: isInsufficientCredits(payload, message)
            ? 'Insufficient tokens'
            : message || 'Invalid request',
          ...(operationId ? { operationId } : {}),
        },
        { status: 400, headers: NO_STORE },
      );
    case 401:
    case 403:
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: NO_STORE },
      );
    case 409:
      return NextResponse.json(
        { error: message || 'Duplicate request', ...(operationId ? { operationId } : {}) },
        { status: 409, headers: NO_STORE },
      );
    case 422:
      return NextResponse.json(
        { error: message || 'Invalid AI output', ...(operationId ? { operationId } : {}) },
        { status: 422, headers: NO_STORE },
      );
    case 429:
      return NextResponse.json(
        { error: message || 'Too many requests', ...(operationId ? { operationId } : {}) },
        { status: 429, headers: NO_STORE },
      );
    default:
      if (backendRes.status >= 500) {
        console.error('[Speaking Topic API] Backend error:', backendRes.status);
        return NextResponse.json(
          { error: 'AI service temporarily unavailable' },
          { status: 502, headers: NO_STORE },
        );
      }
      return NextResponse.json(
        { error: message || 'Failed to generate speaking topic' },
        { status: 502, headers: NO_STORE },
      );
  }
}
