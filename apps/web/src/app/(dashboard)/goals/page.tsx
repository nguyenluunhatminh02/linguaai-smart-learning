'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Target, Clock, BookOpen, RotateCcw, CheckCircle2, TrendingUp, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguageStore } from '@/stores/language-store';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import { studyMinuteOptions, useLearningPreferences, useSaveLearningPreferences, type DailyStudyMinutes } from '@/hooks/use-learning-preferences';

interface Goal {
  id: string;
  type: 'minutes' | 'words' | 'reviews';
  target: number;
  current: number;
  icon: typeof Clock;
  color: string;
  bg: string;
}

const goalMeta: Record<Goal['type'], Pick<Goal, 'icon' | 'color' | 'bg'>> = {
  minutes: { icon: Clock, color: 'text-blue-500', bg: 'bg-blue-500/10' },
  words: { icon: BookOpen, color: 'text-green-500', bg: 'bg-green-500/10' },
  reviews: { icon: RotateCcw, color: 'text-purple-500', bg: 'bg-purple-500/10' },
};

interface WeeklyDay {
  date: string;
  xp: number;
  minutes: number;
}

export default function GoalsPage() {
  const { t, locale } = useLanguageStore();
  const vi = locale === 'vi';
  const userId = useAuthStore((state) => state.user?.id);
  const preferences = useLearningPreferences();
  const savePreferences = useSaveLearningPreferences();
  const stats = useQuery({
    queryKey: ['dashboard-stats', userId],
    enabled: Boolean(userId),
    queryFn: async () => (await apiClient.get<{
      weeklyActivity: WeeklyDay[];
      todayReviews: number;
      todayWords: number;
    }>('/analytics/dashboard')).data,
  });
  const weeklyData = stats.data?.weeklyActivity ?? [];
  const [editingGoal, setEditingGoal] = useState<string | null>(null);
  const [editValue, setEditValue] = useState(0);

  if (preferences.isLoading || stats.isLoading) {
    return (
      <div role="status" aria-label={t.common.loading} className="flex h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!preferences.data || !stats.data) {
    return (
      <div className="space-y-3">
        <p role="alert">{vi ? 'Chưa tải được mục tiêu hoặc tiến độ.' : 'Goals or progress could not be loaded.'}</p>
        <Button onClick={() => { void preferences.refetch(); void stats.refetch(); }}>
          {vi ? 'Thử lại' : 'Try again'}
        </Button>
      </div>
    );
  }

  const goals: Goal[] = [
    { id: 'minutes', type: 'minutes', current: weeklyData.at(-1)?.minutes ?? 0, target: preferences.data.dailyStudyMinutes, ...goalMeta.minutes },
    { id: 'words', type: 'words', current: stats.data.todayWords, target: preferences.data.dailyWordGoal, ...goalMeta.words },
    { id: 'reviews', type: 'reviews', current: stats.data.todayReviews, target: preferences.data.dailyReviewGoal, ...goalMeta.reviews },
  ];

  const getLabel = (type: string) => {
    switch (type) {
      case 'minutes': return t.goals.minutesPerDay;
      case 'words': return t.goals.wordsPerDay;
      case 'reviews': return t.goals.reviewsPerDay;
      default: return '';
    }
  };

  async function updateGoalTarget(goal: Goal) {
    if (editValue < 1 || editValue > 500) return;
    if (goal.type === 'minutes' && !studyMinuteOptions.includes(editValue as DailyStudyMinutes)) return;

    const change = goal.type === 'minutes'
      ? { dailyStudyMinutes: editValue as DailyStudyMinutes }
      : goal.type === 'reviews' ? { dailyReviewGoal: editValue } : { dailyWordGoal: editValue };
    try {
      await savePreferences.mutateAsync(change);
      setEditingGoal(null);
    } catch {
      // Keep the input and render the save error.
    }
  }

  const allGoalsComplete = goals.length > 0 && goals.every(g => g.current >= g.target);
  const completedCount = goals.filter(g => g.current >= g.target).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 animate-fade-in">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10">
          <Target className="h-5 w-5 text-emerald-500" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">{t.goals.title}</h1>
          <p className="text-sm text-muted-foreground">{t.goals.desc}</p>
        </div>
      </div>

      {/* Overall progress */}
      <Card className={cn('animate-fade-in', allGoalsComplete && 'border-green-500/50 bg-green-500/5')} style={{ animationDelay: '100ms' }}>
        <CardContent className="flex items-center gap-6 p-6">
          <div className={cn(
            'flex h-16 w-16 items-center justify-center rounded-2xl',
            allGoalsComplete ? 'bg-green-500/20' : 'bg-emerald-500/10',
          )}>
            {allGoalsComplete ? (
              <CheckCircle2 className="h-8 w-8 text-green-500" />
            ) : (
              <Target className="h-8 w-8 text-emerald-500" />
            )}
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-bold">
                {allGoalsComplete ? t.goals.goalReached : t.goals.keepGoing}
              </h2>
              <span className="text-sm text-muted-foreground">{completedCount}/{goals.length} {t.goals.completed}</span>
            </div>
            <Progress value={completedCount} max={goals.length} variant={allGoalsComplete ? 'success' : 'gradient'} />
          </div>
        </CardContent>
      </Card>

      {/* Individual goals */}
      <div className="grid gap-4 md:grid-cols-3">
        {goals.map((goal, i) => {
          const isComplete = goal.current >= goal.target;
          const Icon = goal.icon;

          return (
            <Card
              key={goal.id}
              className={cn('card-hover animate-fade-in-up', isComplete && 'border-green-500/30')}
              style={{ animationDelay: `${(i + 2) * 100}ms` }}
            >
              <CardContent className="p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div className={cn('flex h-10 w-10 items-center justify-center rounded-xl', goal.bg)}>
                    <Icon className={cn('h-5 w-5', goal.color)} />
                  </div>
                  {isComplete && <CheckCircle2 className="h-5 w-5 text-green-500" />}
                </div>

                <div>
                  <p className="font-semibold">{getLabel(goal.type)}</p>
                  <div className="flex items-baseline gap-1 mt-1">
                    <span className="text-3xl font-bold">{goal.current}</span>
                    <span className="text-muted-foreground">/ {goal.target}</span>
                  </div>
                </div>

                <Progress
                  value={goal.current}
                  max={goal.target}
                  variant={isComplete ? 'success' : 'default'}
                  showLabel
                />

                {editingGoal === goal.id ? (
                  <form className="space-y-2" onSubmit={(event) => {
                    event.preventDefault();
                    void updateGoalTarget(goal);
                  }}>
                    <div className="flex flex-wrap gap-2">
                      {goal.type === 'minutes' ? (
                        <select
                          aria-label={getLabel(goal.type)}
                          className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
                          value={editValue}
                          onChange={(event) => setEditValue(Number(event.target.value))}
                        >
                          {studyMinuteOptions.map((value) => <option key={value} value={value}>{value}</option>)}
                        </select>
                      ) : (
                        <input
                          type="number"
                          min="1"
                          max="500"
                          required
                          aria-label={getLabel(goal.type)}
                          className="w-20 rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
                          value={editValue || ''}
                          onChange={(event) => setEditValue(Number(event.target.value))}
                        />
                      )}
                      <Button type="submit" size="sm" disabled={savePreferences.isPending}>{t.common.save}</Button>
                      <Button type="button" variant="ghost" size="sm" disabled={savePreferences.isPending} onClick={() => setEditingGoal(null)}>{t.common.cancel}</Button>
                    </div>
                    {savePreferences.isError && <p role="alert" className="text-sm text-destructive">{vi ? 'Chưa lưu được mục tiêu. Hãy thử lại.' : 'Your goal could not be saved. Please try again.'}</p>}
                  </form>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => {
                      savePreferences.reset();
                      setEditingGoal(goal.id);
                      setEditValue(goal.target);
                    }}
                  >
                    {t.goals.setGoal}
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Weekly overview */}
      <Card className="animate-fade-in" style={{ animationDelay: '500ms' }}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            {t.goals.weeklyGoal}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end justify-between gap-2 h-32">
            {(() => {
              const dayLabels = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
              // Build 7-day chart from weeklyData (or zeros)
              const days = Array.from({ length: 7 }, (_, i) => {
                const d = new Date();
                d.setDate(d.getDate() - (6 - i));
                const year = d.getFullYear();
                const month = String(d.getMonth() + 1).padStart(2, '0');
                const dayStr = String(d.getDate()).padStart(2, '0');
                const dateStr = `${year}-${month}-${dayStr}`;
                const entry = weeklyData.find(w => w.date === dateStr);
                return {
                  label: dayLabels[d.getDay()],
                  xp: entry?.xp || 0,
                  minutes: entry?.minutes || 0,
                  isToday: i === 6,
                };
              });
              const maxMinutes = Math.max(...days.map(d => d.minutes), 1);
              return days.map((day, i) => {
                const heightPct = Math.round((day.minutes / maxMinutes) * 100);
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1" title={`${day.xp} XP · ${day.minutes} phút`}>
                    <div
                      className={cn(
                        'w-full rounded-lg transition-all duration-500',
                        heightPct >= 95 ? 'bg-green-500' : heightPct > 0 ? 'gradient-bg' : 'bg-muted',
                        day.isToday && 'ring-2 ring-primary ring-offset-2',
                      )}
                      style={{ height: `${Math.max(heightPct, 4)}%` }}
                    />
                    <span className={cn('text-xs', day.isToday ? 'font-bold text-primary' : 'text-muted-foreground')}>{day.label}</span>
                  </div>
                );
              });
            })()}
          </div>
          {weeklyData.length === 0 && (
            <p className="text-center text-xs text-muted-foreground mt-2">Chưa có dữ liệu hoạt động tuần này</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
