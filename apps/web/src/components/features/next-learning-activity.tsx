"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Clock, Map } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  studyMinuteOptions,
  useLearningPreferences,
  useSaveLearningPreferences,
  type DailyStudyMinutes,
  type LearningLevel,
} from "@/hooks/use-learning-preferences";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { useLanguageStore } from "@/stores/language-store";
import { useLearningLanguageStore } from "@/stores/learning-language-store";

type LearningActivityType =
  | "srs_review"
  | "reading"
  | "writing_practice"
  | "quiz"
  | "error_exercises"
  | "grammar";

interface LearningPathActivity {
  rank: number;
  type: LearningActivityType;
  title: string;
  description: string;
  urgency: "high" | "medium" | "low";
  estimatedMinutes: number;
  action: Record<string, unknown>;
}

interface LearningPath {
  userId: string;
  generatedAt: string;
  activities: LearningPathActivity[];
  summary: string;
}

const urgencyLabel = (urgency: LearningPathActivity["urgency"], vi: boolean) =>
  urgency === "high"
    ? vi
      ? "Ưu tiên cao"
      : "High priority"
    : urgency === "medium"
      ? vi
        ? "Ưu tiên trung bình"
        : "Medium priority"
      : vi
        ? "Ưu tiên thấp"
        : "Low priority";

const urgencyVariant = (urgency: LearningPathActivity["urgency"]): "destructive" | "warning" | "secondary" =>
  urgency === "high" ? "destructive" : urgency === "medium" ? "warning" : "secondary";

function activityHref(
  activity: LearningPathActivity,
  libraryHref: string,
  language: string,
): string {
  const action = activity.action ?? {};
  const deckId = typeof action.deckId === "string" ? action.deckId : null;
  const dueCount = typeof action.dueCount === "number" ? action.dueCount : 0;
  switch (activity.type) {
    case "srs_review":
      return deckId
        ? `/flashcards/${encodeURIComponent(deckId)}/study?limit=${Math.max(1, Math.min(20, Math.ceil(dueCount) || 10))}`
        : "/flashcards";
    case "error_exercises":
      return "/difficult-words";
    case "writing_practice":
      return "/writing";
    case "quiz": {
      const quizId = typeof action.quizId === "string" ? action.quizId : null;
      return quizId ? `/quiz/${encodeURIComponent(quizId)}` : "/quiz";
    }
    case "grammar":
      return language === "chinese"
        ? "/chinese/grammar"
        : language === "japanese"
          ? "/japanese/grammar"
          : "/grammar";
    case "reading":
      return language === "chinese"
        ? "/chinese/reading"
        : language === "japanese"
          ? "/japanese/reading"
          : "/reading";
    default:
      return libraryHref;
  }
}

export function NextLearningActivity() {
  const userId = useAuthStore((state) => state.user?.id);
  const { locale, t } = useLanguageStore();
  const vi = locale === "vi";
  const language = useLearningLanguageStore((state) => state.language);
  const router = useRouter();
  const preferences = useLearningPreferences();
  const savePreferences = useSaveLearningPreferences();
  const [editing, setEditing] = useState(false);
  const [level, setLevel] = useState<LearningLevel>("A1");
  const [minutes, setMinutes] = useState<DailyStudyMinutes>(10);
  const queryClient = useQueryClient();
  const path = useQuery({
    queryKey: ["next-learning-activity", userId],
    enabled: Boolean(userId),
    staleTime: 0,
    refetchOnWindowFocus: true,
    queryFn: async () =>
      (await apiClient.get<LearningPath>("/recommendations/learning-path")).data,
  });

  async function refreshPath() {
    try {
      await apiClient.post("/recommendations/invalidate-cache");
      await queryClient.invalidateQueries({ queryKey: ["next-learning-activity", userId] });
    } catch {
      // Server cache may be unavailable; still attempt a client refetch below.
    }
    await path.refetch();
  }

  const onboarding = language === "english" && preferences.data?.configured === false;
  const showPreferences = editing || onboarding;
  const libraryHref = language === "english" ? "/learn" : language === "chinese" ? "/chinese" : "/japanese";

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await savePreferences.mutateAsync({ level, dailyStudyMinutes: minutes });
      setEditing(false);
    } catch {
      // The mutation renders its error and preserves the selected values.
    }
  }

  async function skip() {
    try {
      await savePreferences.mutateAsync({ level: "A1", dailyStudyMinutes: 10 });
      const result = await path.refetch();
      const first = result.data?.activities?.[0];
      router.push(first ? activityHref(first, libraryHref, language) : "/learn/greetings");
    } catch {
      // The learner can retry the same request.
    }
  }

  return (
    <Card className="glass-panel">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Map className="h-5 w-5 text-primary" aria-hidden="true" />
          {vi ? "Lộ trình của bạn" : "Your learning path"}
        </CardTitle>
        {language === "english" && preferences.data?.configured && !editing && (
          <Button variant="ghost" size="sm" onClick={() => {
            setLevel(preferences.data.level);
            setMinutes(preferences.data.dailyStudyMinutes);
            savePreferences.reset();
            setEditing(true);
          }}>
            {vi ? "Điều chỉnh lộ trình" : "Edit study preferences"}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {showPreferences ? (
          <form className="space-y-4" onSubmit={save}>
            <p className="text-sm text-muted-foreground">
              {vi ? "Chọn bài giao tiếp phù hợp với trình độ và thời gian của bạn." : "Find speaking practice that fits your level and schedule."}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5 text-sm font-medium">
                {vi ? "Trình độ tự đánh giá" : "Your current level"}
                <select className="rounded-lg border bg-background px-3 py-2" value={level} onChange={(event) => setLevel(event.target.value as LearningLevel)}>
                  <option value="A1">{vi ? "A1 · Mới bắt đầu" : "A1 · Beginner"}</option>
                  <option value="A2">{vi ? "A2 · Đã giao tiếp cơ bản" : "A2 · Basic conversation"}</option>
                </select>
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                {vi ? "Thời gian mỗi ngày" : "Time per day"}
                <select className="rounded-lg border bg-background px-3 py-2" value={minutes} onChange={(event) => setMinutes(Number(event.target.value) as DailyStudyMinutes)}>
                  {studyMinuteOptions.map((value) => <option key={value} value={value}>{value} {vi ? "phút" : "min"}</option>)}
                </select>
              </label>
            </div>
            {savePreferences.isError && <p role="alert" className="text-sm text-destructive">{vi ? "Chưa lưu được. Hãy thử lại." : "Your preferences weren't saved. Please try again."}</p>}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={savePreferences.isPending}>{t.common.save}</Button>
              {editing ? (
                <Button type="button" variant="ghost" disabled={savePreferences.isPending} onClick={() => setEditing(false)}>{t.common.cancel}</Button>
              ) : (
                <Button type="button" variant="ghost" disabled={savePreferences.isPending} onClick={skip}>{vi ? "Bỏ qua và bắt đầu" : "Skip and start"}</Button>
              )}
            </div>
          </form>
        ) : preferences.isLoading || path.isLoading ? (
          <p role="status" className="text-sm text-muted-foreground">{t.common.loading}</p>
        ) : (
          <div className="space-y-3">
            {path.isError && (
              <p role="status" className="text-sm text-muted-foreground">
                {vi ? "Có thể chọn bài trong thư viện khi đề xuất chưa tải được." : "Choose a lesson from the library while recommendations are unavailable."}
              </p>
            )}

            {!path.data || path.data.activities.length === 0 ? (
              <p role="status" className="text-sm text-muted-foreground">
                {vi ? "Tiếp tục học để nhận đề xuất cá nhân hóa." : "Keep learning to get personalized recommendations."}
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold">{path.data.activities[0].title}</h3>
                  <Badge variant={urgencyVariant(path.data.activities[0].urgency)}>
                    {urgencyLabel(path.data.activities[0].urgency, vi)}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {path.data.activities[0].description}
                </p>
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Clock className="h-4 w-4" aria-hidden="true" />
                  {path.data.activities[0].estimatedMinutes} {vi ? "phút" : "min"}
                </p>

                {path.data.activities.length > 1 && (
                  <ol className="space-y-2 border-t pt-3">
                    {path.data.activities.slice(1).map((item) => (
                      <li key={`${item.rank}-${item.type}`}>
                        <Link
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-2"
                          href={activityHref(item, libraryHref, language)}
                        >
                          <span className="flex items-center gap-2">
                            <span className="tabular-nums text-muted-foreground">{item.rank}</span>
                            <span className="font-medium">{item.title}</span>
                          </span>
                          <span className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Badge variant={urgencyVariant(item.urgency)}>{urgencyLabel(item.urgency, vi)}</Badge>
                            <span>{item.estimatedMinutes} {vi ? "phút" : "min"}</span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ol>
                )}

                {path.data.summary && (
                  <p className="text-xs text-muted-foreground">{path.data.summary}</p>
                )}
              </>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Link
                className="gradient-bg inline-flex min-h-11 items-center gap-2 rounded-lg px-4 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-4"
                href={
                  path.data?.activities?.[0]
                    ? activityHref(path.data.activities[0], libraryHref, language)
                    : libraryHref
                }
              >
                {path.data?.activities?.length
                  ? vi ? "Học tiếp" : "Continue learning"
                  : vi ? "Chọn bài học" : "Choose a lesson"}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={refreshPath}
                disabled={path.isFetching}
              >
                {vi ? "Làm mới lộ trình" : "Refresh path"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
