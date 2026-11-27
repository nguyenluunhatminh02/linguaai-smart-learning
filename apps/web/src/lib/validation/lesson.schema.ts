import { z } from "zod";

// Base lesson schema (common fields)
const baseLessonSchema = z.object({
  type: z.enum(
    ["vocabulary", "grammar", "translation", "reading", "listening"],
    {
      required_error: "Lesson type is required",
    },
  ),
  language: z.enum(["japanese", "chinese", "english"], {
    required_error: "Language is required",
  }),
  level: z.string().min(1, "Level is required"),
  title: z
    .string()
    .min(1, "Title is required")
    .min(3, "Title must be at least 3 characters")
    .max(200, "Title must not exceed 200 characters"),
  titleVi: z
    .string()
    .min(1, "Vietnamese title is required")
    .min(3, "Vietnamese title must be at least 3 characters")
    .max(200, "Vietnamese title must not exceed 200 characters"),
  slug: z
    .string()
    .min(1, "Slug is required")
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Slug must be lowercase with hyphens only",
    ),
  category: z
    .string()
    .min(1, "Category is required")
    .max(100, "Category must not exceed 100 characters"),
  categoryVi: z
    .string()
    .min(1, "Vietnamese category is required")
    .max(100, "Vietnamese category must not exceed 100 characters"),
  description: z
    .string()
    .max(1000, "Description must not exceed 1000 characters")
    .optional(),
  thumbnail: z
    .string()
    .url("Thumbnail must be a valid URL")
    .optional()
    .or(z.literal("")),
  images: z.array(z.string().url("Image must be a valid URL")).optional(),
  source: z
    .string()
    .max(200, "Source must not exceed 200 characters")
    .optional(),
  isPublished: z.boolean(),
  sortOrder: z
    .number()
    .int("Sort order must be an integer")
    .min(0, "Sort order must be non-negative")
    .optional(),
});

// Vocabulary word schema (matches CMS VocabularyContent.words[])
const vocabularyWordSchema = z.object({
  word: z.string().min(1, "Word is required"),
  reading: z.string().optional(),
  romaji: z.string().optional(),
  pinyin: z.string().optional(),
  ipa: z.string().optional(),
  pos: z.string().min(1, "Part of speech is required"),
  en: z.string().min(1, "English definition is required"),
  vi: z.string().min(1, "Vietnamese definition is required"),
  example: z.string().min(1, "Example is required"),
  topic: z.string().min(1, "Topic is required"),
});

// Grammar explanation schema
const grammarExplanationSchema = z.object({
  native: z.string().min(1, "Native explanation is required"),
  vi: z.string().min(1, "Vietnamese explanation is required"),
});

// Grammar example schema
const grammarExampleSchema = z.object({
  native: z.string().min(1, "Native example is required"),
  vi: z.string().min(1, "Vietnamese translation is required"),
});

// Grammar exercise schema (matches CMS GrammarContent.exercises[])
const grammarExerciseSchema = z.object({
  question: z.string().min(1, "Question is required"),
  options: z.array(z.string().min(1)).min(2, "At least 2 options required"),
  correct: z.number().int().min(0, "Correct answer index is required"),
  explanation: z.string().min(1, "Explanation is required"),
});

// Grammar common mistakes schema (matches CMS GrammarContent.commonMistakes[])
const grammarCommonMistakeSchema = z.object({
  wrong: z.string().min(1, "Wrong sentence is required"),
  right: z.string().min(1, "Correct sentence is required"),
  note: z.string().optional(),
});

// Translation sentence schema (matches CMS TranslationContent.sentences[])
const translationSentenceSchema = z.object({
  id: z.number(),
  vi: z.string().min(1, "Vietnamese text is required"),
  target: z.string().min(1, "Target language text is required"),
  alts: z.array(z.string()).optional(),
  hint: z.string().optional(),
});

// Reading vocabulary schema
const readingVocabularySchema = z.object({
  word: z.string().min(1, "Word is required"),
  reading: z.string().optional(),
  definition: z.string().min(1, "English definition is required"),
  definitionVi: z.string().min(1, "Vietnamese definition is required"),
  partOfSpeech: z.string().min(1, "Part of speech is required"),
  example: z.string().optional(),
});

// Reading question schema (matches CMS ReadingContent.questions[])
const readingQuestionSchema = z.object({
  question: z.string().min(1, "Question is required"),
  questionVi: z.string().optional(),
  options: z.array(z.string().min(1)).min(2, "At least 2 options required"),
  correctAnswer: z.number().int().min(0, "Correct answer index is required"),
  explanation: z.string().min(1, "Explanation is required"),
});

// Listening vocabulary schema
const listeningVocabularySchema = z.object({
  word: z.string().min(1, "Word is required"),
  definition: z.string().min(1, "English definition is required"),
  definitionVi: z.string().min(1, "Vietnamese definition is required"),
});

// Listening question schema (matches CMS ListeningContent.questions[])
const listeningQuestionSchema = z.object({
  question: z.string().min(1, "Question is required"),
  options: z.array(z.string().min(1)).min(2, "At least 2 options required"),
  correctAnswer: z.number().int().min(0, "Correct answer index is required"),
  explanation: z.string().min(1, "Explanation is required"),
});

// Content schemas for each lesson type (match CMS types)
const vocabularyContentSchema = z.object({
  color: z.string().optional(),
  words: z
    .array(vocabularyWordSchema)
    .min(1, "At least one vocabulary word is required"),
});

const grammarContentSchema = z.object({
  formula: z.string().min(1, "Formula is required"),
  explanation: z.string().min(1, "Explanation is required"),
  examples: z
    .array(grammarExampleSchema)
    .min(1, "At least one example is required"),
  exercises: z
    .array(grammarExerciseSchema)
    .min(1, "At least one exercise is required"),
  tips: z.array(z.string()).optional().default([]),
  commonMistakes: z.array(grammarCommonMistakeSchema).optional().default([]),
});

const translationContentSchema = z.object({
  sentences: z
    .array(translationSentenceSchema)
    .min(1, "At least one translation sentence is required"),
});

const readingContentSchema = z.object({
  wordCount: z.number().int().min(0, "Word count must be non-negative"),
  text: z.string().min(1, "Reading text is required"),
  vocabulary: z.array(readingVocabularySchema).optional().default([]),
  questions: z.array(readingQuestionSchema).optional().default([]),
});

const listeningContentSchema = z.object({
  duration: z.string().min(1, "Duration is required"),
  transcript: z.string().min(1, "Transcript is required"),
  vocabulary: z.array(listeningVocabularySchema).optional().default([]),
  questions: z.array(listeningQuestionSchema).optional().default([]),
  audioUrl: z
    .string()
    .url("Audio URL must be valid")
    .optional()
    .or(z.literal("")),
});

// Full lesson schema with discriminated union for content
export const lessonSchema = baseLessonSchema.and(
  z.discriminatedUnion("type", [
    z.object({
      type: z.literal("vocabulary"),
      content: vocabularyContentSchema,
    }),
    z.object({
      type: z.literal("grammar"),
      content: grammarContentSchema,
    }),
    z.object({
      type: z.literal("translation"),
      content: translationContentSchema,
    }),
    z.object({
      type: z.literal("reading"),
      content: readingContentSchema,
    }),
    z.object({
      type: z.literal("listening"),
      content: listeningContentSchema,
    }),
  ]),
);

export type LessonFormData = z.infer<typeof lessonSchema>;
export type VocabularyWord = z.infer<typeof vocabularyWordSchema>;
export type GrammarExplanation = z.infer<typeof grammarExplanationSchema>;
export type GrammarExample = z.infer<typeof grammarExampleSchema>;
export type GrammarExercise = z.infer<typeof grammarExerciseSchema>;
export type GrammarCommonMistake = z.infer<typeof grammarCommonMistakeSchema>;
export type TranslationSentence = z.infer<typeof translationSentenceSchema>;
export type ReadingVocabulary = z.infer<typeof readingVocabularySchema>;
export type ReadingQuestion = z.infer<typeof readingQuestionSchema>;
export type ListeningVocabulary = z.infer<typeof listeningVocabularySchema>;
export type ListeningQuestion = z.infer<typeof listeningQuestionSchema>;
