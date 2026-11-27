import { useQuery, useMutation } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";

export interface GrammarExercise {
  question: string;
  options: string[];
  correct: number;
  explanation: string;
}

export interface GrammarLesson {
  id: string;
  title: string;
  titleVi: string;
  slug: string;
  level: string;
  category: string;
  description: string;
  formula: string;
  explanation: string;
  examples: { en: string; vi: string }[];
  exercises: GrammarExercise[];
  tips: string[];
  commonMistakes: { wrong: string; right: string; note: string }[];
}

export interface GrammarResult {
  topic: string;
  explanation: string;
  examples: { sentence: string; translation: string }[];
  exercises: { question: string; answer: string }[];
  tips: string[];
}

function cmsToGrammarLesson(lesson: Record<string, unknown>): GrammarLesson {
  const c = (lesson.content ?? {}) as Record<string, unknown>;
  const rawExamples = (c.examples as Array<Record<string, string>>) ?? [];
  return {
    id: (lesson.slug as string) || (lesson.id as string),
    title: lesson.title as string,
    titleVi: (lesson.titleVi ?? lesson.title_vi) as string,
    slug: lesson.slug as string,
    level: lesson.level as string,
    category: lesson.category as string,
    description: (lesson.description as string) ?? "",
    formula: (c.formula as string) ?? "",
    explanation: (c.explanation as string) ?? "",
    examples: rawExamples.map((ex) => ({
      en: ex.native || ex.en || "",
      vi: ex.vi || "",
    })),
    exercises: (c.exercises as GrammarExercise[]) ?? [],
    tips: (c.tips as string[]) ?? [],
    commonMistakes: (c.commonMistakes as GrammarLesson["commonMistakes"]) ?? [],
  };
}

export function useGrammarLessons() {
  return useQuery<GrammarLesson[]>({
    queryKey: ["grammar-lessons"],
    queryFn: async () => {
      const response = await fetch(
        "/api/cms/lessons?type=grammar&language=english&published=true&limit=200"
      );
      if (!response.ok) throw new Error("Failed to fetch grammar lessons");
      const json = await response.json();
      const items = json.data ?? json ?? [];
      return items.map(cmsToGrammarLesson);
    },
  });
}

export function useGrammarExplain() {
  return useMutation<GrammarResult, Error, { grammarPoint: string; language: string }>({
    mutationFn: async ({ grammarPoint, language }) => {
      const res = await apiClient.post("/grammar/explain", {
        grammarPoint,
        language,
      });
      const raw = res.data as Record<string, unknown>;
      const examples = Array.isArray(raw.examples)
        ? (raw.examples as (string | Record<string, string>)[]).map((ex) =>
            typeof ex === "string"
              ? { sentence: ex, translation: "" }
              : {
                  sentence: (ex as Record<string, string>).sentence || "",
                  translation: (ex as Record<string, string>).translation || "",
                }
          )
        : [];
      const exercises = Array.isArray(raw.practiceExercises)
        ? (raw.practiceExercises as Record<string, string>[]).map((ex) => ({
            question: ex.question || "",
            answer: ex.answer || "",
          }))
        : [];
      return {
        topic: (raw.point as string) || (raw.topic as string) || grammarPoint,
        explanation: (raw.explanation as string) || "",
        examples,
        exercises,
        tips: Array.isArray(raw.tips) ? (raw.tips as string[]) : [],
      };
    },
  });
}
