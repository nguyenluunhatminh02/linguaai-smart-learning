/* ═══════════════════════════════════════════════════════════════
   CMS Types — Shared type definitions for the lesson CMS
   ═══════════════════════════════════════════════════════════════ */

// ── Enums ──────────────────────────────────────────────────────
export type LessonType = 'grammar' | 'translation' | 'reading' | 'vocabulary' | 'listening';
export type LessonLanguage = 'english' | 'chinese' | 'japanese';

// ── Content types per lesson kind ──────────────────────────────

export interface GrammarContent {
  formula: string;
  explanation: string;
  examples: { native: string; vi: string }[];
  exercises: { question: string; options: string[]; correct: number; explanation: string }[];
  tips: string[];
  commonMistakes: { wrong: string; right: string; note: string }[];
}

export interface TranslationContent {
  sentences: { id: number; vi: string; target: string; alts?: string[]; hint?: string }[];
}

export interface ReadingContent {
  wordCount: number;
  text: string;
  vocabulary: {
    word: string;
    reading?: string;
    pinyin?: string;
    definition: string;
    definitionVi: string;
    partOfSpeech: string;
    example: string;
  }[];
  questions: {
    question: string;
    questionVi?: string;
    options: string[];
    correctAnswer: number;
    explanation: string;
  }[];
}

export interface VocabularyContent {
  color?: string;
  words: {
    word: string;
    reading?: string;
    romaji?: string;
    pinyin?: string;
    ipa?: string;
    pos: string;
    en: string;
    vi: string;
    example: string;
    topic: string;
  }[];
}

export interface ListeningQuestion {
  question: string;
  options: string[];
  correctAnswer: number;
  /** Legacy field name used by older listening lessons in cms-data. */
  correct?: number;
  explanation: string;
}

export interface ListeningContent {
  duration: string;
  transcript: string;
  vocabulary: { word: string; definition: string; definitionVi: string }[];
  questions: ListeningQuestion[];
  audioUrl?: string;
}

/**
 * Normalize legacy listening answer keys (`correct`) to `correctAnswer` so
 * editors and the student page read the same field. Non-listening content and
 * questions with an explicit canonical answer are returned unchanged.
 */
export function normalizeListeningAnswers(lesson: CmsLesson): CmsLesson {
  if (lesson.type !== 'listening') return lesson;
  const content = lesson.content as ListeningContent;
  if (!content || !Array.isArray(content.questions)) return lesson;

  let changed = false;
  const questions = content.questions.map((q) => {
    if (typeof q?.correctAnswer !== 'number' && typeof q?.correct === 'number') {
      changed = true;
      const { correct, ...rest } = q;
      return { ...rest, correctAnswer: correct };
    }
    return q;
  });

  return changed ? { ...lesson, content: { ...content, questions } } : lesson;
}

export type LessonContent =
  | GrammarContent
  | TranslationContent
  | ReadingContent
  | VocabularyContent
  | ListeningContent;

// ── Main CMS Lesson ────────────────────────────────────────────

export interface CmsLesson {
  id: string;
  type: LessonType;
  language: LessonLanguage;
  level: string;
  title: string;
  titleVi: string;
  slug: string;
  category: string;
  categoryVi: string;
  description: string;
  thumbnail: string;
  images: string[];         // additional images embedded in the lesson
  content: LessonContent;
  source: string;           // e.g. "Minna no Nihongo Ch.1"
  isPublished: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  isUserUploaded?: boolean;
  userId?: string;
}

// ── API DTOs ───────────────────────────────────────────────────

export type CreateLessonDto = Omit<CmsLesson, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdateLessonDto = Partial<CreateLessonDto>;

// ── Level options per language ──────────────────────────────────

export const LEVEL_OPTIONS: Record<LessonLanguage, string[]> = {
  english:  ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'],
  chinese:  ['HSK1', 'HSK2', 'HSK3', 'HSK4', 'HSK5', 'HSK6'],
  japanese: ['N5', 'N4', 'N3', 'N2', 'N1', 'Advanced'],
};

export const CATEGORY_OPTIONS: Record<LessonType, { id: string; label: string; labelVi: string }[]> = {
  grammar: [
    { id: 'tenses', label: 'Tenses', labelVi: 'Thì' },
    { id: 'sentence-structure', label: 'Sentence Structure', labelVi: 'Cấu trúc câu' },
    { id: 'particles', label: 'Particles', labelVi: 'Trợ từ' },
    { id: 'verb-forms', label: 'Verb Forms', labelVi: 'Dạng động từ' },
    { id: 'honorifics', label: 'Honorifics', labelVi: 'Kính ngữ' },
    { id: 'other', label: 'Other', labelVi: 'Khác' },
  ],
  translation: [
    { id: 'daily', label: 'Daily Life', labelVi: 'Cuộc sống' },
    { id: 'travel', label: 'Travel', labelVi: 'Du lịch' },
    { id: 'work', label: 'Work & Study', labelVi: 'Công việc' },
    { id: 'social', label: 'Social', labelVi: 'Giao tiếp' },
    { id: 'academic', label: 'Academic', labelVi: 'Học thuật' },
  ],
  reading: [
    { id: 'daily-life', label: 'Daily Life', labelVi: 'Đời sống' },
    { id: 'culture', label: 'Culture', labelVi: 'Văn hóa' },
    { id: 'science', label: 'Science', labelVi: 'Khoa học' },
    { id: 'society', label: 'Society', labelVi: 'Xã hội' },
    { id: 'history', label: 'History', labelVi: 'Lịch sử' },
  ],
  vocabulary: [
    { id: 'basic', label: 'Basic', labelVi: 'Cơ bản' },
    { id: 'intermediate', label: 'Intermediate', labelVi: 'Trung cấp' },
    { id: 'advanced', label: 'Advanced', labelVi: 'Nâng cao' },
    { id: 'topic', label: 'Topic-based', labelVi: 'Theo chủ đề' },
  ],
  listening: [
    { id: 'conversation', label: 'Conversations', labelVi: 'Hội thoại' },
    { id: 'announcement', label: 'Announcements', labelVi: 'Thông báo' },
    { id: 'lecture', label: 'Lectures', labelVi: 'Bài giảng' },
    { id: 'interview', label: 'Interviews', labelVi: 'Phỏng vấn' },
    { id: 'news', label: 'News', labelVi: 'Tin tức' },
  ],
};

// ── Empty content factory ──────────────────────────────────────

export function createEmptyContent(type: LessonType): LessonContent {
  switch (type) {
    case 'grammar':
      return {
        formula: '',
        explanation: '',
        examples: [{ native: '', vi: '' }],
        exercises: [{ question: '', options: ['', '', '', ''], correct: 0, explanation: '' }],
        tips: [''],
        commonMistakes: [{ wrong: '', right: '', note: '' }],
      };
    case 'translation':
      return {
        sentences: [{ id: 1, vi: '', target: '' }],
      };
    case 'reading':
      return {
        wordCount: 0,
        text: '',
        vocabulary: [],
        questions: [{ question: '', questionVi: '', options: ['', '', '', ''], correctAnswer: 0, explanation: '' }],
      };
    case 'vocabulary':
      return {
        color: '#3b82f6',
        words: [{ word: '', pos: 'noun', en: '', vi: '', example: '', topic: '' }],
      };
    case 'listening':
      return {
        duration: '',
        transcript: '',
        vocabulary: [],
        questions: [{ question: '', options: ['', '', '', ''], correctAnswer: 0, explanation: '' }],
        audioUrl: '',
      };
  }
}
