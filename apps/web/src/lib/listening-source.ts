import { z } from "zod";

export const youtubeListeningSource = z.object({
  youtubeUrl: z.string().url().refine((value) => {
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    return url.protocol === "https:" && (
      (["www.youtube.com", "youtube.com", "m.youtube.com"].includes(url.hostname) &&
        ((url.pathname === "/watch" && /^[\w-]{11}$/.test(url.searchParams.get("v") ?? "")) ||
          /^\/(shorts|embed)\/[\w-]{11}\/?$/.test(url.pathname))) ||
      (url.hostname === "youtu.be" && /^\/[\w-]{11}\/?$/.test(url.pathname))
    );
  }),
  transcript: z.string().trim().min(1).max(20_000),
  language: z.string().trim().min(1).max(50).default("english"),
  level: z.string().trim().min(1).max(10).default("B1"),
  category: z.string().trim().min(1).max(100).default("conversation"),
  title: z.string().trim().max(200).default(""),
});

const generatedLesson = z.object({
  titleVi: z.string().trim().min(1).max(200),
  vocabulary: z.array(z.object({
    word: z.string().min(1),
    definition: z.string(),
    definitionVi: z.string(),
  })).default([]),
  questions: z.array(z.object({
    question: z.string().trim().min(1),
    options: z.array(z.string().trim().min(1)).min(2).max(4),
    correctAnswer: z.number().int().min(0),
    explanation: z.string().trim().min(1),
    evidence: z.string().trim().min(1),
  })).min(1).max(5),
});

const normalize = (text: string) => text.normalize("NFKC").replace(/\s+/g, " ").trim();

export function verifyListeningQuestions(value: unknown, transcript: string) {
  const lesson = generatedLesson.parse(value);
  const source = normalize(transcript);
  const questions = lesson.questions.filter((item) =>
    item.correctAnswer < item.options.length &&
    new Set(item.options).size === item.options.length &&
    source.includes(normalize(item.evidence)),
  );
  if (questions.length === 0) throw new Error("No valid questions supported by the transcript");
  return { ...lesson, questions };
}
