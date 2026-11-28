/**
 * CMS transcript generation — thin admin-only proxy to the orchestrated backend
 * workflow (REL-02). The Next.js route deliberately holds no provider key and
 * performs no AI call: NestJS reserves an AI operation, runs the generation
 * through the AI service, persists an unpublished draft and exposes it for
 * review. The browser forwards its JWT so the backend can authorize and scope
 * the operation to the same admin.
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyAuthHeader, isAdmin, type VerifiedUser } from "@/lib/auth/jwt-verify";

const BACKEND =
  process.env.CMS_BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:3001/api/v1";

const GENERATE_PATH = "/content-workflow/generate-from-transcript";
const OPERATION_PATH = "/content-workflow/operations/";

const MAX_TRANSCRIPT_LENGTH = 20_000;
const MAX_CLIENT_OPERATION_ID_LENGTH = 128;
const MAX_STATUS_POLLS = 20;
const POLL_INTERVAL_MS = 1_000;
const UPSTREAM_TIMEOUT_MS = 120_000;

const ALLOWED_LANGUAGES = new Set([
  "english",
  "vietnamese",
  "japanese",
  "chinese",
  "korean",
  "spanish",
  "french",
  "german",
]);
const LEVEL_PATTERN = /^[A-C][1-2]$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface TranscriptPayload {
  transcript: string;
  language: string;
  level: string;
  clientOperationId: string;
}

interface ValidationResult {
  payload?: TranscriptPayload;
  error?: string;
}

interface GeneratedData {
  vocabulary?: unknown[];
  questions?: unknown[];
  [key: string]: unknown;
}

interface OperationResult {
  operationId: string;
  status: string;
  resultRef?: string | null;
  draft?: GeneratedData | null;
  errorCode?: string | null;
  [key: string]: unknown;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

/** Extract the backend payload from its standard { success, data } envelope. */
function unwrapEnvelope(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  if (
    "success" in record &&
    "data" in record &&
    record.data &&
    typeof record.data === "object" &&
    !Array.isArray(record.data)
  ) {
    return record.data as Record<string, unknown>;
  }
  return record;
}

function backendError(body: unknown, status: number): NextResponse {
  const envelope = unwrapEnvelope(body);
  const rawCode = envelope?.errorCode ?? envelope?.error;
  const code =
    typeof rawCode === "string" &&
    [
      "VALIDATION_ERROR",
      "INSUFFICIENT_CREDITS",
      "OPERATION_CONFLICT",
      "RATE_LIMITED",
      "PROVIDER_UNAVAILABLE",
      "PROVIDER_TIMEOUT",
      "INVALID_AI_OUTPUT",
      "OPERATION_UNKNOWN",
      "INTERNAL_ERROR",
    ].includes(rawCode)
      ? rawCode
      : undefined;

  const message =
    typeof envelope?.message === "string" &&
    envelope.message.length > 0 &&
    envelope.message.length <= 300
      ? envelope.message
      : status === 502 || status === 503 || status === 504
        ? "Generation service temporarily unavailable"
        : "Generation request failed";

  return NextResponse.json(
    { error: message, ...(code ? { code } : {}) },
    { status: status >= 400 && status <= 599 ? status : 502 },
  );
}

/** Body and header validation happens at the edge so the backend never sees junk. */
function validate(body: unknown, headerKey: string | null): ValidationResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Invalid request body" };
  }
  const input = body as Record<string, unknown>;
  const { transcript, language, level } = input;

  if (typeof transcript !== "string" || transcript.trim().length === 0) {
    return { error: "Transcript is required" };
  }
  if (transcript.length > MAX_TRANSCRIPT_LENGTH) {
    return { error: `Transcript must be at most ${MAX_TRANSCRIPT_LENGTH} characters` };
  }
  const normalizedLanguage =
    typeof language === "string" && language.trim()
      ? language.trim().toLowerCase()
      : "english";
  if (!ALLOWED_LANGUAGES.has(normalizedLanguage)) {
    return { error: "Unsupported transcript language" };
  }
  const normalizedLevel =
    typeof level === "string" && level.trim()
      ? level.trim().toUpperCase()
      : "B1";
  if (!LEVEL_PATTERN.test(normalizedLevel)) {
    return { error: "Unsupported level" };
  }

  // The idempotency key travels in a header instead of the JSON body so the
  // legacy UI payload stays unchanged. Fall back to a per-request key only
  // when the caller did not supply one.
  const key =
    typeof headerKey === "string" && headerKey.trim()
      ? headerKey.trim()
      : crypto.randomUUID();
  if (key.length > MAX_CLIENT_OPERATION_ID_LENGTH) {
    return { error: "Idempotency key is too long" };
  }

  return {
    payload: {
      transcript,
      language: normalizedLanguage,
      level: normalizedLevel,
      clientOperationId: key,
    },
  };
}

async function backendFetch(
  path: string,
  init: RequestInit,
  token: string,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    return await fetch(`${BACKEND.replace(/\/$/, "")}${path}`, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseOperation(body: unknown): OperationResult | null {
  const data = unwrapEnvelope(body);
  if (!data || typeof data.operationId !== "string") return null;
  if (!UUID_PATTERN.test(data.operationId)) return null;
  if (typeof data.status !== "string") return null;
  return data as unknown as OperationResult;
}

function isTerminal(status: string): boolean {
  return ["SUCCEEDED", "FAILED", "CANCELLED", "UNKNOWN"].includes(status);
}

/**
 * Keep the historical synchronous `{ data: { vocabulary, questions } }` reply
 * expected by the existing CMS editor while the backend owns the durable
 * operation. Each poll is authenticated and read-only; no draft is published
 * implicitly — publication stays in the backend review workflow.
 */
function terminalData(op: OperationResult): GeneratedData | null {
  if (op.status !== "SUCCEEDED") return null;
  if (op.draft && typeof op.draft === "object") return op.draft;
  return null;
}

export async function POST(req: NextRequest) {
  let user: VerifiedUser | null = null;
  try {
    user = await verifyAuthHeader(req.headers.get("authorization"));
  } catch (error) {
    console.error("[Generate from Transcript] token verification failed:", errorMessage(error));
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Authorization was established by the JWT; the backend call uses the same
  // token so the durable operation is attributed to this admin.
  const token = req.headers.get("authorization")?.slice(7).trim();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { payload, error } = validate(
    body,
    req.headers.get("x-client-operation-id") ?? req.headers.get("idempotency-key"),
  );
  if (!payload) {
    return NextResponse.json({ error: error ?? "Invalid request" }, { status: 400 });
  }

  let initiation: Response;
  let initiatedBody: unknown;
  try {
    initiation = await backendFetch(
      GENERATE_PATH,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      token,
    );
    initiatedBody = await initiation.json().catch(() => null);
  } catch (error) {
    console.error("[Generate from Transcript] backend error:", errorMessage(error));
    return NextResponse.json(
      { error: "Generation service temporarily unavailable" },
      { status: 502 },
    );
  }

  if (!initiation.ok) {
    return backendError(initiatedBody, initiation.status);
  }

  const operation = parseOperation(initiatedBody);
  if (!operation) {
    return NextResponse.json(
      { error: "Invalid generation response" },
      { status: 502 },
    );
  }

  let current = operation;
  for (
    let attempt = 0;
    attempt < MAX_STATUS_POLLS && !isTerminal(current.status);
    attempt++
  ) {
    await sleep(POLL_INTERVAL_MS);

    let poll: Response;
    let pollBody: unknown;
    try {
      poll = await backendFetch(
        `${OPERATION_PATH}${encodeURIComponent(current.operationId)}`,
        { method: "GET" },
        token,
      );
      pollBody = await poll.json().catch(() => null);
    } catch (error) {
      console.error("[Generate from Transcript] status error:", errorMessage(error));
      return NextResponse.json(
        { error: "Generation service temporarily unavailable" },
        { status: 502 },
      );
    }

    if (!poll.ok) {
      return backendError(pollBody, poll.status);
    }
    const next = parseOperation(pollBody);
    if (!next) {
      return NextResponse.json(
        { error: "Invalid operation status response" },
        { status: 502 },
      );
    }
    current = next;
  }

  if (current.status === "SUCCEEDED") {
    const data = terminalData(current);
    if (!data) {
      return NextResponse.json(
        { error: "Generated draft is unavailable" },
        { status: 502 },
      );
    }
    return NextResponse.json({ data, operationId: current.operationId });
  }

  if (current.status === "FAILED" || current.status === "CANCELLED") {
    return NextResponse.json(
      {
        error: "Generation failed",
        ...(current.errorCode ? { code: current.errorCode } : {}),
        operationId: current.operationId,
      },
      { status: 502 },
    );
  }

  // Terminal UNKNOWN or a long-running job stays recoverable by operationId;
  // the UI can surface the reference without pretending the result succeeded.
  return NextResponse.json(
    {
      error: "Generation is still processing",
      code: "OPERATION_UNKNOWN",
      operationId: current.operationId,
      status: current.status,
    },
    { status: 202 },
  );
}
