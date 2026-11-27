/* CMS Image Upload — Proxy to backend, fallback to local */
import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { verifyAuthHeader, isAdmin } from "@/lib/auth/jwt-verify";

const BACKEND = process.env.CMS_BACKEND_URL || "http://localhost:4000/api/v1";
const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "lessons");
const MAX_SIZE = 5 * 1024 * 1024;
const ALLOWED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp"];
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

const IMAGE_MAGIC_BYTES: Record<string, number[]> = {
  "image/jpeg": [0xff, 0xd8, 0xff],
  "image/png": [0x89, 0x50, 0x4e, 0x47],
  "image/gif": [0x47, 0x49, 0x46],
  "image/webp": [0x52, 0x49, 0x46, 0x46],
};

function matchesMagicBytes(buffer: Buffer, mimeType: string): boolean {
  const magic = IMAGE_MAGIC_BYTES[mimeType];
  if (!magic) return false;
  return magic.every((byte, i) => buffer[i] === byte);
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

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: "Unsupported format. Accepted: JPEG, PNG, GIF, WebP" },
      { status: 400 },
    );
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json(
      { error: "File too large. Maximum 5MB" },
      { status: 400 },
    );
  }

  const ext = path.extname(file.name).toLowerCase() || ".jpg";
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return NextResponse.json(
      { error: "Invalid file extension" },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  if (!matchesMagicBytes(buffer, file.type)) {
    return NextResponse.json(
      { error: "File content does not match declared format" },
      { status: 400 },
    );
  }

  // Try proxy to backend
  try {
    const backendFd = new FormData();
    backendFd.append("file", file);
    const res = await fetch(`${BACKEND}/files/upload`, {
      method: "POST",
      headers: authHeader ? {
        "Authorization": authHeader,
      } : {},
      body: backendFd,
    });
    if (res.ok) {
      const json = await res.json();
      return NextResponse.json(json.data ?? json);
    }
  } catch {
    /* backend unavailable */
  }

  // Fallback: local filesystem
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
  const safeName = `${crypto.randomUUID()}${ext}`;
  const filePath = path.join(UPLOAD_DIR, safeName);
  fs.writeFileSync(filePath, buffer);

  const url = `/uploads/lessons/${safeName}`;
  return NextResponse.json({
    url,
    name: safeName,
    size: file.size,
    type: file.type,
  });
}
