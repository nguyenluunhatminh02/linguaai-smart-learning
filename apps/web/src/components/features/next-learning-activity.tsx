"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Clock, Map } from "lucide-react";
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

type NextActivity =
  | { type: "srs_review"; href: string; title: string; estimatedMinutes: number; dueCount: number }
  | { type: "scenario"; href: string; title: string; estimatedMinutes: number; objective: string }
  | { type: "quiz"; href: string; title: string; estimatedMinutes: number }
  | { type: "library"; href: string };

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
  const next = useQuery({
    queryKey: ["next-learning-activity", userId, language],
    enabled: Boolean(userId),
    queryFn: async () => (await apiClient.get<NextActivity>("/recommendations/next-activity", { params: { language } })).data,
    staleTime: 0,
  });

  const onboarding = language === "english" && preferences.data?.configured === false;
  const showPreferences = editing || onboarding;
  const activity = next.data;
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
      const result = await next.refetch();
      router.push(result.data?.href ?? "/learn/greetings");
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
        ) : preferences.isLoading || next.isLoading ? (
          <p role="status" className="text-sm text-muted-foreground">{t.common.loading}</p>
        ) : (
          <div className="space-y-3">
            {activity && activity.type !== "library" && (
              <>
                <h3 className="font-semibold">{activity.title}</h3>
                {activity.type === "scenario" && <p className="text-sm text-muted-foreground">{activity.objective}</p>}
                {activity.type === "srs_review" && <p className="text-sm text-muted-foreground">{vi ? `${activity.dueCount} thẻ đến hạn` : `${activity.dueCount} cards due`}</p>}
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Clock className="h-4 w-4" aria-hidden="true" /> {activity.estimatedMinutes} {vi ? "phút" : "min"}
                </p>
              </>
            )}
            {next.isError && <p role="status" className="text-sm text-muted-foreground">{vi ? "Có thể chọn bài trong thư viện khi đề xuất chưa tải được." : "Choose a lesson from the library while recommendations are unavailable."}</p>}
            <Link className="gradient-bg inline-flex min-h-11 items-center gap-2 rounded-lg px-4 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-4" href={activity?.href ?? libraryHref}>
              {activity && activity.type !== "library"
                ? vi ? "Học tiếp" : "Continue learning"
                : vi ? "Chọn bài học" : "Choose a lesson"}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
