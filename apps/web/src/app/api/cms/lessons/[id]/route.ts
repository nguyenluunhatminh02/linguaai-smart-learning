/* CMS Lessons [id] API — Proxy to backend, fallback to local JSON */
import { NextRequest, NextResponse } from "next/server";
import { getLessonById, updateLesson, deleteLesson } from "@/lib/cms-storage";
import { verifyAuthHeader, isAdmin } from "@/lib/auth/jwt-verify";
import { dbToCms, cmsToDb } from "../route";

const BACKEND = process.env.CMS_BACKEND_URL || "http://localhost:4000/api/v1";
const IS_PROD = process.env.NODE_ENV === "production";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;

  try {
    // Fetch from /lessons/:id endpoint on the backend
    const res = await fetch(`${BACKEND}/lessons/${id}`, {
      cache: "no-store",
    });
    if (res.ok) {
      const json = await res.json();
      return NextResponse.json(dbToCms(json.data ?? json));
    }
    if (res.status === 404) {
      // Try local fallback
    } else {
      return NextResponse.json(await res.json(), { status: res.status });
    }
  } catch {
    /* backend unavailable */
  }

  // Fallback: local JSON
  const lesson = await getLessonById(id);
  if (!lesson)
    return NextResponse.json({ error: "Lesson not found" }, { status: 404 });
  return NextResponse.json(lesson);
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const authHeader = req.headers.get("authorization");

  // Verify JWT signature and check admin role
  const user = await verifyAuthHeader(authHeader);
  if (!user || !isAdmin(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const body = await req.json();

  const authHeaderValue = authHeader as string;
  const dbBody = cmsToDb(body);

  let backendReached = false;
  try {
    // Proxy PUT to PATCH /admin/content/:id
    const res = await fetch(`${BACKEND}/admin/content/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeaderValue,
      },
      body: JSON.stringify(dbBody),
    });
    backendReached = true;
    if (res.ok) {
      const json = await res.json();
      return NextResponse.json(dbToCms(json.data ?? json));
    }
    // Any backend error (including 404) is authoritative — surface it.
    let errorBody: any = { error: "Backend update failed" };
    try {
      errorBody = await res.json();
    } catch {
      /* non-JSON error body */
    }
    return NextResponse.json(errorBody, { status: res.status });
  } catch {
    /* backend unavailable — fall through only in non-prod */
  }

  if (IS_PROD || backendReached) {
    return NextResponse.json(
      { error: "Content service unavailable" },
      { status: 502 },
    );
  }

  // Dev-only fallback: local JSON (mirrors POST behaviour)
  console.warn(`[CMS PUT] backend unavailable; using local JSON fallback for lesson ${id}`);
  const updated = await updateLesson(id, body);
  if (!updated)
    return NextResponse.json({ error: "Lesson not found" }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const authHeader = req.headers.get("authorization");

  // Verify JWT signature and check admin role
  const user = await verifyAuthHeader(authHeader);
  if (!user || !isAdmin(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;

  const authHeaderValue = authHeader as string;

  let backendReached = false;
  try {
    // Proxy DELETE to DELETE /admin/content/:id
    const res = await fetch(`${BACKEND}/admin/content/${id}`, {
      method: "DELETE",
      headers: { Authorization: authHeaderValue },
    });
    backendReached = true;
    if (res.ok) {
      const json = await res.json();
      return NextResponse.json(json.data ?? json);
    }
    // Any backend error (including 404) is authoritative — surface it.
    let errorBody: any = { error: "Backend delete failed" };
    try {
      errorBody = await res.json();
    } catch {
      /* non-JSON error body */
    }
    return NextResponse.json(errorBody, { status: res.status });
  } catch {
    /* backend unavailable — fall through only in non-prod */
  }

  if (IS_PROD || backendReached) {
    return NextResponse.json(
      { error: "Content service unavailable" },
      { status: 502 },
    );
  }

  // Dev-only fallback: local JSON (mirrors POST behaviour)
  console.warn(`[CMS DELETE] backend unavailable; using local JSON fallback for lesson ${id}`);
  const ok = await deleteLesson(id);
  if (!ok)
    return NextResponse.json({ error: "Lesson not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}
