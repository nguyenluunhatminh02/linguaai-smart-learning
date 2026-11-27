/* CMS Audio Upload — validate locally, then proxy to backend */
import { NextRequest, NextResponse } from "next/server";
import path from "path";
import crypto from "crypto";
import { verifyAuthHeader, isAdmin } from "@/lib/auth/jwt-verify";

const BACKEND = process.env.CMS_BACKEND_URL || "http://localhost:3001/api/v1";
const MAX_SIZE = 50 * 1024 * 1024; // 50 MB for audio

type AudioFormat = "mp3" | "wav" | "ogg" | "m4a" | "aac" | "flac";

const ALLOWED_TYPES = [
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
] as const;

/** Map both the declared MIME type and the file extension to one canonical format. */
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

const EXT_TO_FORMAT: Record<string, AudioFormat> = {
  ".mp3": "mp3",
  ".wav": "wav",
  ".ogg": "ogg",
  ".m4a": "m4a",
  ".aac": "aac",
  ".flac": "flac",
};

function startsWith(buffer: Buffer, offset: number, ascii: string): boolean {
  const bytes = Buffer.from(ascii, "ascii");
  return buffer.length >= offset + bytes.length &&
    bytes.every((byte, i) => buffer[offset + i] === byte);
}

/**
 * Verify that the payload really is the format the client declared.
 * Filename/TYPE headers are attacker-controlled; magic bytes are not.
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

  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (!ALLOWED_TYPES.includes(file.type as (typeof ALLOWED_TYPES)[number])) {
    return NextResponse.json(
      { error: "Unsupported format. Accepted: MP3, WAV, OGG, M4A, AAC, FLAC" },
      { status: 400 },
    );
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json(
      { error: "File too large. Maximum 50MB" },
      { status: 400 },
    );
  }

  const ext = path.extname(file.name).toLowerCase();
  const formatByMime = MIME_TO_FORMAT[file.type];
  const formatByExt = EXT_TO_FORMAT[ext];
  if (!formatByExt || formatByExt !== formatByMime) {
    return NextResponse.json(
      { error: "File extension does not match its MIME type" },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (!matchesAudioFormat(buffer, formatByMime)) {
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
    // Rebuild the File so the backend receives the exact validated bytes and
    // not an attacker-controlled filename or MIME type.
    backendFd.append("file", new File([buffer], `${crypto.randomUUID()}${ext}`, {
      type: file.type,
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
