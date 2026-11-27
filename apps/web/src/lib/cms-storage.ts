/* ═══════════════════════════════════════════════════════════════
   CMS Storage — File-based storage for CMS lessons
   Reads / writes a single JSON file: <project>/cms-data/lessons.json
   ═══════════════════════════════════════════════════════════════ */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { CmsLesson, CreateLessonDto, UpdateLessonDto } from '@/lib/types/cms';

const DATA_DIR = path.join(process.cwd(), 'cms-data');
const DATA_FILE = path.join(DATA_DIR, 'lessons.json');

// ── Helpers ────────────────────────────────────────────────────

async function ensureDataFile(): Promise<void> {
  try {
    await fs.promises.access(DATA_DIR);
  } catch {
    await fs.promises.mkdir(DATA_DIR, { recursive: true });
  }
  try {
    await fs.promises.access(DATA_FILE);
  } catch {
    await fs.promises.writeFile(DATA_FILE, '[]', 'utf-8');
  }
}

async function readAll(): Promise<CmsLesson[]> {
  await ensureDataFile();
  const raw = await fs.promises.readFile(DATA_FILE, 'utf-8');
  return JSON.parse(raw) as CmsLesson[];
}

async function writeAll(lessons: CmsLesson[]): Promise<void> {
  await ensureDataFile();
  await fs.promises.writeFile(DATA_FILE, JSON.stringify(lessons, null, 2), 'utf-8');
}

function generateId(): string {
  return crypto.randomUUID();
}

// ── CRUD ───────────────────────────────────────────────────────

export async function getAllLessons(filters?: {
  type?: string;
  language?: string;
  level?: string;
  isPublished?: boolean;
  search?: string;
  isUserUploaded?: boolean;
  userId?: string;
}): Promise<CmsLesson[]> {
  let lessons = await readAll();

  // Filter by isUserUploaded (default to false / system content if not specified)
  if (filters?.isUserUploaded) {
    lessons = lessons.filter((l) => l.isUserUploaded === true);
  } else {
    lessons = lessons.filter((l) => !l.isUserUploaded);
  }

  if (filters?.userId) {
    lessons = lessons.filter((l) => l.userId === filters.userId);
  }

  if (filters?.type) {
    lessons = lessons.filter((l) => l.type === filters.type);
  }
  if (filters?.language) {
    lessons = lessons.filter((l) => l.language === filters.language);
  }
  if (filters?.level) {
    lessons = lessons.filter((l) => l.level === filters.level);
  }
  if (filters?.isPublished !== undefined) {
    lessons = lessons.filter((l) => {
      const isPub = l.isPublished !== false;
      return isPub === filters.isPublished;
    });
  }
  if (filters?.search) {
    const q = filters.search.toLowerCase();
    lessons = lessons.filter(
      (l) =>
        (l.title || '').toLowerCase().includes(q) ||
        (l.titleVi || '').toLowerCase().includes(q) ||
        (l.source || '').toLowerCase().includes(q),
    );
  }

  // Legacy records (e.g. older listening lessons) may not have sortOrder;
  // subtracting undefined produces NaN and leaves the order unspecified.
  return lessons.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

export async function getLessonById(id: string): Promise<CmsLesson | undefined> {
  const lessons = await readAll();
  return lessons.find((l) => l.id === id);
}

export async function getLessonBySlug(slug: string): Promise<CmsLesson | undefined> {
  const lessons = await readAll();
  return lessons.find((l) => l.slug === slug);
}

export async function createLesson(dto: CreateLessonDto): Promise<CmsLesson> {
  const lessons = await readAll();
  const now = new Date().toISOString();

  // Ensure slug uniqueness. A timestamp can collide for two writes in the
  // same millisecond; retry with a random suffix until the candidate is free.
  let slug = dto.slug;
  const existingSlugs = new Set(lessons.map((l) => l.slug));
  if (existingSlugs.has(slug)) {
    do {
      slug = `${dto.slug}-${crypto.randomUUID().slice(0, 8)}`;
    } while (existingSlugs.has(slug));
  }

  const lesson: CmsLesson = {
    id: generateId(),
    ...dto,
    slug,
    createdAt: now,
    updatedAt: now,
  };

  lessons.push(lesson);
  await writeAll(lessons);
  return lesson;
}

export async function updateLesson(id: string, dto: UpdateLessonDto): Promise<CmsLesson | null> {
  const lessons = await readAll();
  const idx = lessons.findIndex((l) => l.id === id);
  if (idx === -1) return null;

  const updated: CmsLesson = {
    ...lessons[idx],
    ...dto,
    id,
    createdAt: lessons[idx].createdAt,
    updatedAt: new Date().toISOString(),
  };

  lessons[idx] = updated;
  await writeAll(lessons);
  return updated;
}

export async function deleteLesson(id: string): Promise<boolean> {
  const lessons = await readAll();
  const idx = lessons.findIndex((l) => l.id === id);
  if (idx === -1) return false;

  lessons.splice(idx, 1);
  await writeAll(lessons);
  return true;
}

export async function getPublishedLessons(type: string, language: string): Promise<CmsLesson[]> {
  return getAllLessons({ type, language, isPublished: true });
}
