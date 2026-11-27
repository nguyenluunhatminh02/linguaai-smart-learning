"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { apiClient } from "@/lib/api-client";
import {
  Gamepad2,
  Plus,
  Trophy,
  ArrowRight,
  Sparkles,
  Loader2,
} from "lucide-react";
import { useLanguageStore } from "@/stores/language-store";
import { useLearningLanguageStore } from "@/stores/learning-language-store";
import { toast } from "sonner";

interface Quiz {
  id: string;
  title: string;
  description: string;
  questionCount: number;
  createdAt: string;
}

export default function QuizListPage() {
  const { t } = useLanguageStore();
  const { language } = useLearningLanguageStore();
  const router = useRouter();
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [showGenerate, setShowGenerate] = useState(false);
  // AI generate state
  const [genTopic, setGenTopic] = useState("");
  const [genLanguage, setGenLanguage] = useState<string>(language);
  const [genLevel, setGenLevel] = useState("B1");
  const [genCount, setGenCount] = useState(5);
  const [genTitle, setGenTitle] = useState("");
  const [generating, setGenerating] = useState(false);
  // Stable key per form so retries cannot double-charge tokens or create duplicate quizzes
  const [genIdempotencyKey, setGenIdempotencyKey] = useState(() => crypto.randomUUID());

  // Sync genLanguage with store language when it changes or panel opens
  useEffect(() => {
    setGenLanguage(language);
  }, [language]);

  useEffect(() => {
    apiClient
      .get(`/quiz?language=${language}`)
      .then((r) => setQuizzes(r.data.items || []))
      .catch(() => {});
  }, [language]);

  const handleAiGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!genTopic.trim()) return;
    setGenerating(true);
    try {
      const res = await apiClient.post(
        "/quiz/generate-from-topic",
        {
          topic: genTopic,
          language: genLanguage,
          level: genLevel,
          count: genCount,
          title: genTitle || `${genTopic} Quiz`,
        },
        { headers: { "idempotency-key": genIdempotencyKey } },
      );
      toast.success(
        `Quiz "${res.data.title}" generated with ${res.data.questions?.length ?? res.data.questionCount ?? "?"} questions!`,
      );
      router.push(`/quiz/${res.data.id}`);
      // A successful request is complete; the next form submission is a new operation.
      setGenIdempotencyKey(crypto.randomUUID());
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message || "Failed to generate quiz. Please try again.";
      toast.error(msg);
      // Keep the key on failure so an ambiguous timeout / network retry cannot
      // consume tokens twice or produce a second quiz.
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-pink-500/10">
            <Gamepad2 className="h-5 w-5 text-pink-500" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{t.quiz.title}</h1>
            <p className="text-sm text-muted-foreground">{t.quiz.desc}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setShowGenerate(!showGenerate)}
          >
            <Sparkles className="mr-2 h-4 w-4" /> AI Generate
          </Button>
          <Link href="/quiz/create">
            <Button variant="gradient">
              <Plus className="mr-2 h-4 w-4" /> {t.quiz.createQuiz}
            </Button>
          </Link>
        </div>
      </div>

      {/* AI Generate Panel */}
      {showGenerate && (
        <Card className="animate-scale-in border-pink-200 dark:border-pink-900/40">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-5 w-5 text-pink-500" />
              Generate Quiz with AI
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Enter a topic and AI will create a complete quiz with questions,
              answers, and explanations.
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleAiGenerate} className="space-y-4">
              <Input
                label="Topic"
                placeholder="e.g. climate change, World War II, photosynthesis..."
                value={genTopic}
                onChange={(e) => setGenTopic(e.target.value)}
                required
              />
              <Input
                label="Quiz Title (optional)"
                placeholder="Leave blank to auto-generate"
                value={genTitle}
                onChange={(e) => setGenTitle(e.target.value)}
              />
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label
                    htmlFor="gen-language"
                    className="mb-1.5 block text-sm font-medium"
                  >
                    Language
                  </label>
                  <select
                    id="gen-language"
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={genLanguage}
                    onChange={(e) => setGenLanguage(e.target.value)}
                  >
                    <option value="english">English</option>
                    <option value="chinese">Chinese</option>
                    <option value="japanese">Japanese</option>
                    <option value="vietnamese">Vietnamese</option>
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="gen-level"
                    className="mb-1.5 block text-sm font-medium"
                  >
                    Level
                  </label>
                  <select
                    id="gen-level"
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={genLevel}
                    onChange={(e) => setGenLevel(e.target.value)}
                  >
                    <option value="A1">A1</option>
                    <option value="A2">A2</option>
                    <option value="B1">B1</option>
                    <option value="B2">B2</option>
                    <option value="C1">C1</option>
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="gen-count"
                    className="mb-1.5 block text-sm font-medium"
                  >
                    Questions
                  </label>
                  <select
                    id="gen-count"
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={genCount}
                    onChange={(e) => setGenCount(Number(e.target.value))}
                  >
                    {[3, 5, 8, 10, 15, 20].map((n) => (
                      <option key={n} value={n}>
                        {n} questions
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={generating || !genTopic.trim()}>
                  {generating ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />{" "}
                      Generating Quiz...
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-4 w-4" /> Generate Quiz
                    </>
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowGenerate(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {quizzes.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-4 py-16 px-6">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-pink-500/10">
              <Gamepad2 className="h-8 w-8 text-pink-400" />
            </div>
            <div className="text-center">
              <p className="font-medium">{t.quiz.noQuizzes}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {t.quiz.noQuizzesDesc}
              </p>
            </div>
            <Link href="/quiz/create">
              <Button variant="outline">{t.quiz.createFirst}</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {quizzes.map((quiz, i) => (
            <Link key={quiz.id} href={`/quiz/${quiz.id}`}>
              <Card
                className="group h-full cursor-pointer card-hover animate-fade-in-up"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <CardHeader className="px-6 pt-6 pb-3">
                  <CardTitle className="flex items-center justify-between text-lg">
                    <span className="line-clamp-1">{quiz.title}</span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-all group-hover:opacity-100 group-hover:translate-x-0.5" />
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-6 pb-6">
                  {quiz.description && (
                    <p className="mb-3 text-sm text-muted-foreground line-clamp-2">
                      {quiz.description}
                    </p>
                  )}
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">
                      <Trophy className="mr-1 h-3 w-3" /> {quiz.questionCount}{" "}
                      {t.quiz.questions}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
