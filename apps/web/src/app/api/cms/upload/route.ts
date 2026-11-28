/* CMS Image Upload — validate once, then proxy to the backend storage service.
 * Object naming and ownership remain server-side in NestJS. This route must
 * never write to the local filesystem or call a provider SDK directly.
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyAuthHeader, isAdmin } from "@/lib/auth/jwt-verify";

function resolveBackend(): string {
  const configured =
    process.env.CMS_BACKEND_URL ||
    process.env.INTERNAL_API_URL ||
    "http://localhost:4000/api/v1";
  const trimmed = configured.replace(/\/+$/, "");
  return trimmed.endsWith("/api/v1") || trimmed.endsWith("/files")
    ? trimmed
    : `${trimmed}/api/v1`;
}
const UPLOAD_TIMEOUT_MS = 30_000;
const MAX_SIZE = 5 * 1024 * 1024;

const MIME_TO_EXTENSION: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

function matchesMagicBytes(bytes: Uint8Array, mimeType: string): boolean {
  const startsWith = (offset: number, ascii: string) => {
    if (bytes.length < offset + ascii.length) return false;
    for (let i = 0; i < ascii.length; i += 1) {
      if (bytes[offset + i] !== ascii.charCodeAt(i)) return false;
    }
    return true;
  };

  switch (mimeType) {
    case "image/jpeg":
      return (
        bytes.length >= 3 &&
        bytes[0] === 0xff &&
        bytes[1] === 0xd8 &&
        bytes[2] === 0xff
      );
    case "image/png":
      return (
        bytes.length >= 8 &&
        [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
          (byte, i) => bytes[i] === byte,
        )
      );
    case "image/gif":
      return startsWith(0, "GIF87a") || startsWith(0, "GIF89a");
    case "image/webp":
      return startsWith(0, "RIFF") && startsWith(8, "WEBP");
    default:
      return false;
  }
}

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");

  // The BFF gate is defence in depth; the backend re-verifies the token and
  // derives the owner from the verified identity, never from this request body.
  const user = await verifyAuthHeader(authHeader);
  if (!user || !isAdmin(user)) {
    return errorResponse("Unauthorized", 401);
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return errorResponse("Invalid multipart payload", 400);
  }

  const file = formData.get("file");
  if (
    !file ||
    typeof file === "string" ||
    typeof file.arrayBuffer !== "function" ||
    file.size === 0
  ) {
    return errorResponse("No file provided", 400);
  }

  const mimeType = file.type.toLowerCase().split(";")[0].trim();
  const extension = MIME_TO_EXTENSION[mimeType];
  if (!extension) {
    return errorResponse(
      "Unsupported format. Accepted: JPEG, PNG, GIF, WebP",
      400,
    );
  }

  if (file.size > MAX_SIZE) {
    return errorResponse("File too large. Maximum 5MB", 400);
  }

  // The client-supplied name is deliberately not used for extension selection
  // or key generation. Check it only to reject confusing MIME/filename pairs.
  const clientExtension = file.name.includes(".")
    ? `.${file.name.split(".").pop()!.toLowerCase()}`
    : "";
  if (clientExtension && clientExtension !== extension) {
    return errorResponse("File extension does not match its MIME type", 400);
  }

  let bytes: Uint8Array<ArrayBuffer>;
  try {
    const arrayBuffer = await file.arrayBuffer();
    bytes = new Uint8Array(arrayBuffer);
  } catch {
    return errorResponse("Could not read uploaded file", 400);
  }

  if (!matchesMagicBytes(bytes, mimeType)) {
    return errorResponse("File content does not match declared format", 400);
  }

  // Rebuild the multipart part with a neutral transport name. The backend is
  // the only component that generates the owner-scoped object key.
  const transportFile = new File([bytes], `upload${extension}`, {
    type: mimeType,
  });
  const transport = new FormData();
  transport.append("file", transportFile, `upload${extension}`);

  const timeout = new AbortController();
  const timeoutId = setTimeout(() => timeout.abort(), UPLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(`${resolveBackend()}/files/upload`, {
      method: "POST",
      headers: authHeader ? { Authorization: authHeader } : {},
      body: transport,
      signal: timeout.signal,
    });

    if (response.status === 401 || response.status === 403) {
      return errorResponse("Unauthorized", 401);
    }
    if (!response.ok) {
      return errorResponse("Upload service unavailable", 502);
    }

    const json = await response.json();
    const payload = (json?.data ?? json) as Record<string, unknown> | null;
    const url = payload?.url;
    if (typeof url !== "string" || url.length === 0) {
      return errorResponse("Upload service returned an invalid response", 502);
    }
    return NextResponse.json({ ...payload, url });
  } catch {
    // No local fallback: a failed backend upload must never persist the file.
    return errorResponse("Upload service unavailable", 502);
  } finally {
    clearTimeout(timeoutId);
  }
}
