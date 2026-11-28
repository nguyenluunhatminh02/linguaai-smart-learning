/* CMS Lessons API — Proxy to backend, fallback to local JSON */
import { NextRequest, NextResponse } from "next/server";
import { getAllLessons, createLesson } from "@/lib/cms-storage";
import { verifyAuthHeader, isAdmin } from "@/lib/auth/jwt-verify";

const BACKEND = process.env.CMS_BACKEND_URL || "http://localhost:4000/api/v1";
const IS_PROD = process.env.NODE_ENV === "production";

interface DbLessonData {
  language?: string;
  slug?: string;
  categoryVi?: string;
  description?: string;
  thumbnail?: string;
  images?: string[];
  source?: string;
  isUserUploaded?: boolean;
  userId?: string | null;
  vocabulary?: unknown[];
  formula?: string;
  examples?: unknown[];
  tips?: unknown[];
  commonMistakes?: unknown[];
  color?: string;
  words?: unknown[];
  sentences?: unknown[];
}

interface DbLessonRow {
  id: string;
  type: string;
  level: string;
  title: string;
  title_vi?: string;
  titleVi?: string;
  slug?: string;
  category: string;
  content?: string;
  duration?: string;
  word_count?: number;
  wordCount?: number;
  audio_url?: string;
  audioUrl?: string;
  questions?: unknown[];
  published?: boolean;
  sort_order?: number;
  sortOrder?: number;
  created_at?: string;
  createdAt?: string;
  updated_at?: string;
  updatedAt?: string;
  data?: DbLessonData;
}

export interface CmsLessonView {
  id: string;
  type: string;
  language: string;
  level: string;
  title: string;
  titleVi: string;
  slug: string;
  category: string;
  categoryVi: string;
  description: string;
  thumbnail: string;
  images: string[];
  source: string;
  isPublished: boolean;
  sortOrder: number;
  content: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
  isUserUploaded: boolean;
  userId: string | null;
}

interface CmsLessonInput {
  type?: string;
  language?: string;
  level?: string;
  title?: string;
  titleVi?: string;
  slug?: string;
  category?: string;
  categoryVi?: string;
  description?: string;
  thumbnail?: string;
  images?: string[];
  source?: string;
  isPublished?: boolean;
  sortOrder?: number;
  isUserUploaded?: boolean;
  userId?: string | null;
  content?: {
    transcript?: string;
    audioUrl?: string;
    duration?: string;
    text?: string;
    wordCount?: number;
    explanation?: string;
    formula?: string;
    color?: string;
    questions?: unknown[];
    exercises?: unknown[];
    vocabulary?: unknown[];
    examples?: unknown[];
    tips?: unknown[];
    commonMistakes?: unknown[];
    words?: unknown[];
    sentences?: unknown[];
  };
}

interface DbLessonPayload {
  type?: string;
  title?: string;
  titleVi?: string;
  level?: string;
  category?: string;
  content: string;
  audioUrl: string;
  duration: string;
  wordCount: number;
  published: boolean;
  sortOrder: number;
  questions: unknown[];
  data: Record<string, unknown>;
}

function inferLanguageFromLevel(level: string): string {
  if (!level) return "english";
  const lvl = level.toUpperCase();
  if (lvl.startsWith("N") || lvl === "ADVANCED") return "japanese";
  if (lvl.startsWith("HSK")) return "chinese";
  if (lvl.startsWith("TOPIK")) return "korean";
  return "english";
}

export function dbToCms(row: DbLessonRow | null): CmsLessonView | null {
  if (!row) return null;
  const data = row.data || {};
  const language = data.language || inferLanguageFromLevel(row.level) || "english";
  
  let content: Record<string, unknown> = {};
  if (row.type === "listening") {
    content = {
      duration: row.duration || "",
      transcript: row.content || "",
      vocabulary: data.vocabulary || [],
      questions: row.questions || [],
      audioUrl: row.audio_url || row.audioUrl || "",
    };
  } else if (row.type === "reading") {
    content = {
      wordCount: row.word_count || row.wordCount || 0,
      text: row.content || "",
      vocabulary: data.vocabulary || [],
      questions: row.questions || [],
    };
  } else if (row.type === "grammar") {
    content = {
      formula: data.formula || "",
      explanation: row.content || "",
      examples: data.examples || [],
      exercises: row.questions || [],
      tips: data.tips || [],
      commonMistakes: data.commonMistakes || [],
    };
  } else if (row.type === "vocabulary") {
    content = {
      color: data.color || "",
      words: data.words || [],
    };
  } else if (row.type === "translation") {
    content = {
      sentences: data.sentences || [],
    };
  }

  return {
    id: row.id,
    type: row.type,
    language,
    level: row.level,
    title: row.title,
    titleVi: row.title_vi || row.titleVi || "",
    slug: data.slug || row.slug || `${row.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    category: row.category,
    categoryVi: data.categoryVi || row.category,
    description: data.description || "",
    thumbnail: data.thumbnail || "",
    images: data.images || [],
    source: data.source || "",
    isPublished: row.published !== false,
    sortOrder: row.sort_order || row.sortOrder || 0,
    content,
    createdAt: row.created_at || row.createdAt,
    updatedAt: row.updated_at || row.updatedAt,
    isUserUploaded: data.isUserUploaded || false,
    userId: data.userId || null,
  };
}

export function cmsToDb(lesson: CmsLessonInput): DbLessonPayload {
  let dbContent = "";
  let dbAudioUrl = "";
  let dbDuration = "";
  let dbWordCount = 0;
  let dbQuestions: unknown[] = [];
  
  const extraData: Record<string, unknown> = {
    language: lesson.language,
    slug: lesson.slug,
    categoryVi: lesson.categoryVi,
    description: lesson.description || "",
    thumbnail: lesson.thumbnail || "",
    images: lesson.images || [],
    source: lesson.source || "",
    isUserUploaded: lesson.isUserUploaded || false,
    userId: lesson.userId || null,
  };

  if (lesson.type === "listening") {
    const c: NonNullable<CmsLessonInput["content"]> = lesson.content || {};
    dbContent = c.transcript || "";
    dbAudioUrl = c.audioUrl || "";
    dbDuration = c.duration || "";
    dbQuestions = c.questions || [];
    extraData.vocabulary = c.vocabulary || [];
  } else if (lesson.type === "reading") {
    const c: NonNullable<CmsLessonInput["content"]> = lesson.content || {};
    dbContent = c.text || "";
    dbWordCount = c.wordCount || 0;
    dbQuestions = c.questions || [];
    extraData.vocabulary = c.vocabulary || [];
  } else if (lesson.type === "grammar") {
    const c: NonNullable<CmsLessonInput["content"]> = lesson.content || {};
    dbContent = c.explanation || "";
    dbQuestions = c.exercises || [];
    extraData.formula = c.formula || "";
    extraData.examples = c.examples || [];
    extraData.tips = c.tips || [];
    extraData.commonMistakes = c.commonMistakes || [];
  } else if (lesson.type === "vocabulary") {
    const c: NonNullable<CmsLessonInput["content"]> = lesson.content || {};
    dbContent = "";
    extraData.color = c.color || "";
    extraData.words = c.words || [];
  } else if (lesson.type === "translation") {
    const c: NonNullable<CmsLessonInput["content"]> = lesson.content || {};
    dbContent = "";
    extraData.sentences = c.sentences || [];
  }

  return {
    type: lesson.type,
    title: lesson.title,
    titleVi: lesson.titleVi,
    level: lesson.level,
    category: lesson.category,
    content: dbContent,
    audioUrl: dbAudioUrl,
    duration: dbDuration,
    wordCount: dbWordCount,
    published: lesson.isPublished !== false,
    sortOrder: lesson.sortOrder || 0,
    questions: dbQuestions,
    data: extraData,
  };
}

async function proxyGet(url: string, authHeader: string | null) {
  try {
    const res = await fetch(url, {
      cache: "no-store",
      headers: authHeader ? { authorization: authHeader } : undefined,
    });
    if (res.ok) {
      const json = await res.json();
      let unwrapped = json.data ?? json;
      if (unwrapped && typeof unwrapped === "object" && "data" in unwrapped && Array.isArray(unwrapped.data)) {
        unwrapped = unwrapped.data;
      }
      return { data: unwrapped, ok: true };
    }
  } catch {
    /* backend unavailable */
  }
  return { data: null, ok: false };
}

export async function GET(req: NextRequest) {
  // CMS lesson listing is an admin-only surface. Verify the JWT and admin
  // role up front so an unauthenticated or non-admin caller cannot reach
  // either the backend proxy or the local-JSON fallback. The previous
  // implementation performed no auth check on GET, which meant anyone who
  // could hit this route could enumerate content — including drafts — and
  // on backend failure receive the unauthenticated local-JSON dataset.
  const authHeader = req.headers.get("authorization");
  const user = await verifyAuthHeader(authHeader);
  if (!user || !isAdmin(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const qs = req.nextUrl.searchParams.toString();
  // Fetch from the admin content endpoint so the backend applies the same
  // authorization checks as every other admin route. The student /lessons
  // endpoint is public by design and would serve draft/unpublished content
  // to the CMS listing.
  const backendUrl = `${BACKEND}/admin/content${qs ? `?${qs}` : ""}`;
  const { data, ok } = await proxyGet(
    backendUrl,
    authHeader,
  );

  if (ok) {
    const rows: DbLessonRow[] = Array.isArray(data) ? data : [];
    let lessons: CmsLessonView[] = rows
      .map(dbToCms)
      .filter((l): l is CmsLessonView => l !== null);

    // Apply query filters
    const { searchParams } = req.nextUrl;
    const userUploaded = searchParams.get("userUploaded") === "true";
    
    // Filter by isUserUploaded
    if (userUploaded) {
      lessons = lessons.filter((l) => l.isUserUploaded === true);
    } else {
      lessons = lessons.filter((l) => !l.isUserUploaded);
    }

    const type = searchParams.get("type");
    if (type) {
      lessons = lessons.filter((l) => l.type === type);
    }

    const language = searchParams.get("language");
    if (language) {
      lessons = lessons.filter((l) => l.language === language);
    }

    const level = searchParams.get("level");
    if (level) {
      lessons = lessons.filter((l) => l.level === level);
    }

    const published = searchParams.get("published");
    if (published !== null) {
      lessons = lessons.filter((l) => l.isPublished === (published === "true"));
    }

    const search = searchParams.get("search");
    if (search) {
      const q = search.toLowerCase();
      lessons = lessons.filter(
        (l) =>
          (l.title || "").toLowerCase().includes(q) ||
          (l.titleVi || "").toLowerCase().includes(q) ||
          (l.source || "").toLowerCase().includes(q),
      );
    }

    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "20", 10);
    const start = (page - 1) * limit;

    return NextResponse.json({
      data: lessons.slice(start, start + limit),
      meta: {
        page,
        limit,
        total: lessons.length,
        totalPages: Math.ceil(lessons.length / limit),
      },
    });
  }

  // Fallback: local JSON (no pagination for local fallback)
  const { searchParams } = req.nextUrl;
  const userUploaded = searchParams.get("userUploaded") === "true";
  
  let userId: string | undefined = undefined;
  if (userUploaded) {
    const authHeader = req.headers.get("authorization");
    const user = await verifyAuthHeader(authHeader);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    userId = user.id;
  }

  const filters = {
    type: searchParams.get("type") || undefined,
    language: searchParams.get("language") || undefined,
    level: searchParams.get("level") || undefined,
    isPublished: searchParams.has("published")
      ? searchParams.get("published") === "true"
      : undefined,
    search: searchParams.get("search") || undefined,
    isUserUploaded: userUploaded,
    userId,
  };
  const all = await getAllLessons(filters);
  const page = parseInt(searchParams.get("page") || "1", 10);
  const limit = parseInt(searchParams.get("limit") || "20", 10);
  const start = (page - 1) * limit;
  return NextResponse.json({
    data: all.slice(start, start + limit),
    meta: {
      page,
      limit,
      total: all.length,
      totalPages: Math.ceil(all.length / limit),
    },
  });
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  console.log("[CMS POST ROUTE] authHeader received:", authHeader);

  // Verify JWT signature and check admin role
  const user = await verifyAuthHeader(authHeader);
  if (!user || !isAdmin(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();

  if (!body.type || !body.language || !body.title || !body.slug) {
    return NextResponse.json(
      { error: "Missing required fields (type, language, title, slug)" },
      { status: 400 },
    );
  }

  const authHeaderValue = authHeader as string;
  const dbBody = cmsToDb(body);

  let backendReached = false;
  try {
    // Post to /admin/content endpoint on the backend
    const res = await fetch(`${BACKEND}/admin/content`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authorization: authHeaderValue,
      },
      body: JSON.stringify(dbBody),
    });
    if (res.ok) {
      backendReached = true;
      const json = await res.json();
      return NextResponse.json(dbToCms(json.data ?? json), { status: 201 });
    }
    if (res.status !== 404) {
      backendReached = true;
      if (res.status >= 400 && res.status < 500) {
        return NextResponse.json(await res.json(), { status: res.status });
      }
    }
  } catch {
    /* backend unavailable */
  }

  if (IS_PROD || backendReached) {
    return NextResponse.json(
      { error: "Content service unavailable" },
      { status: 502 },
    );
  }
  const lesson = await createLesson(body);
  return NextResponse.json(lesson, { status: 201 });
}
