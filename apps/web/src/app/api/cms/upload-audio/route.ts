/* CMS Audio Upload — validate locally, then proxy to backend.
 *
 * Storage adapter and ownership live in the backend (apps/api/src/files/).
 * This route enforces a bounded byte cap that matches the backend's
 * MAX_UPLOAD_BYTES (10 MiB), rejects oversized or empty payloads before
 * buffering, derives the canonical extension from the validated MIME type
 * (never from the client filename), and rebuilds the outbound File with
 * only validated bytes and a server-generated name.
 */
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { verifyAuthHeader, isAdmin } from "@/lib/auth/jwt-verify";

const BACKEND = process.env.CMS_BACKEND_URL || "http://localhost:3001/api/v1";

/**
 * Shared decoded-byte budget. Must stay in lockstep with the backend's
 * MAX_UPLOAD_BYTES in apps/api/src/files/file-validation.ts so that valid
 * uploads cannot fail late with an opaque 502.
 */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MiB

type AudioFormat = "mp3" | "wav" | "ogg" | "m4a" | "aac" | "flac";

const ALLOWED_MIME_TYPES: readonly string[] = [
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/wave",
  "audio/ogg",
  "audio/mp4",
  "audio/m4a",
  "audio/aac",
  "audio/flac",
  "audio/x-flac",
];

/** Map a normalized MIME type to one canonical format/extension. */
const MIME_TO_FORMAT: Record<string, AudioFormat> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/wave": "wav",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/aac": "aac",
  "audio/flac": "flac",
  "audio/x-flac": "flac",
};

/** Strip MIME parameters and normalize to lowercase for safe comparison. */
function normalizeMimeType(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.split(";")[0].trim().toLowerCase();
}

function startsWith(buffer: Buffer, offset: number, ascii: string): boolean {
  const bytes = Buffer.from(ascii, "ascii");
  return buffer.length >= offset + bytes.length &&
    bytes.every((byte, i) => buffer[offset + i] === byte);
}

/**
 * Verify that the payload really is the format the client declared.
 * MIME headers are attacker-controlled; magic bytes are not.
 */
function matchesAudioFormat(buffer: Buffer, format: AudioFormat): boolean {
  switch (format) {
    case "mp3":
      // ID3 tag header, or an MPEG audio frame sync (11 set bits).
      return startsWith(buffer, 0, "ID3") ||
        (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0 &&
          (buffer[1] & 0x06) !== 0x00);
    case "wav":
      return startsWith(buffer, 0, "RIFF") && startsWith(buffer, 8, "WAVE");
    case "ogg":
      return startsWith(buffer, 0, "OggS");
    case "m4a":
      // ISO BMFF: size (4 bytes) followed by the "ftyp" box type.
      return startsWith(buffer, 4, "ftyp");
    case "aac":
      // ADTS sync, ID3-tagged AAC, or an MP4/M4A container.
      return (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xf0) === 0xf0) ||
        startsWith(buffer, 0, "ID3") || startsWith(buffer, 4, "ftyp");
    case "flac":
      return startsWith(buffer, 0, "fLaC");
    default:
      return false;
  }
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");

  // Verify JWT signature and check admin role
  const user = await verifyAuthHeader(authHeader);
  if (!user || !isAdmin(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Enforce the byte cap on Content-Length before parsing the multipart body.
  // This rejects oversized payloads at the parser level rather than after
  // buffering, matching the backend's parser-level limit.
  const contentLength = req.headers.get("content-length");
  if (contentLength) {
    const declared = Number.parseInt(contentLength, 10);
    if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: `File too large. Maximum ${MAX_UPLOAD_BYTES / 1024 / 1024}MB` },
        { status: 400 },
      );
    }
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Invalid multipart payload" },
      { status: 400 },
    );
  }

  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  // Reject empty files before buffering.
  if (file.size === 0) {
    return NextResponse.json({ error: "File is empty" }, { status: 400 });
  }

  // Reject oversized files before buffering.
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `File too large. Maximum ${MAX_UPLOAD_BYTES / 1024 / 1024}MB` },
      { status: 400 },
    );
  }

  // Normalize the declared MIME type and check it against the allowlist.
  const mimeType = normalizeMimeType(file.type);
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    return NextResponse.json(
      { error: "Unsupported format. Accepted: MP3, WAV, OGG, M4A, AAC, FLAC" },
      { status: 400 },
    );
  }

  // Derive the canonical extension from the validated MIME type, never from
  // the client filename. The backend generates the real object key from the
  // authenticated owner id; the filename we forward is irrelevant to storage.
  const format = MIME_TO_FORMAT[mimeType];
  if (!format) {
    return NextResponse.json(
      { error: "Unsupported format. Accepted: MP3, WAV, OGG, M4A, AAC, FLAC" },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (!matchesAudioFormat(buffer, format)) {
    return NextResponse.json(
      { error: "File content does not match declared format" },
      { status: 400 },
    );
  }

  // Uploads are persisted by the backend only. Writing to the public
  // directory after a 401/403/500 would bypass backend authorization and
  // validation; a local fallback is not safe for user-supplied files.
  try {
    const backendFd = new FormData();
    // Rebuild the File so the backend receives the exact validated bytes,
    // a server-generated name, and the normalized MIME type. The backend
    // ignores the client filename and generates an owner-scoped key.
    const serverName = `${crypto.randomUUID()}.${format}`;
    backendFd.append("file", new File([buffer], serverName, {
      type: mimeType,
    }));
    const res = await fetch(`${BACKEND}/files/upload`, {
      method: "POST",
      headers: authHeader ? {
        "Authorization": authHeader,
      } : {},
      body: backendFd,
    });
    if (!res.ok) {
      const status = res.status === 401 || res.status === 403 ? 401 : 502;
      return NextResponse.json(
        { error: status === 401 ? "Unauthorized" : "Upload service unavailable" },
        { status },
      );
    }
    const json = await res.json();
    return NextResponse.json(json.data ?? json);
  } catch {
    return NextResponse.json(
      { error: "Upload service unavailable" },
      { status: 502 },
    );
  }
}
