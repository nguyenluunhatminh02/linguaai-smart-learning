'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useAuthStore } from '@/stores/auth-store';
import { useLanguageStore } from '@/stores/language-store';
import { apiClient } from '@/lib/api-client';
import { useQuery } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import {
  Flame, Zap, BookOpen, Trophy, Brain, PenTool, MessageSquare, Gamepad2,
  ArrowRight, TrendingUp, Sparkles, Loader2, BarChart2,
} from 'lucide-react';
import { quotes } from '@/components/motivational-quote';
import { LearningTree } from '@/components/learning-tree';
import { DailyCheckIn } from '@/components/features/daily-checkin';
import { NextLearningActivity } from '@/components/features/next-learning-activity';

interface WeeklyActivity {
  date: string;
  xp: number;
  minutes: number;
}

interface DashboardStats {
  streak: number;
  totalXp: number;
  dueCards: number;
  masteredCards: number;
  totalDecks: number;
  totalReviews: number;
  weeklyActivity?: WeeklyActivity[];
}

const quickActionKeys = [
  { labelKey: 'reviewFlashcards' as const, descKey: 'reviewFlashcardsDesc' as const, href: '/flashcards', icon: Brain, bg: 'bg-blue-500/[0.06]', iconColor: 'text-blue-500' },
  { labelKey: 'writingPractice' as const, descKey: 'writingPracticeDesc' as const, href: '/writing', icon: PenTool, bg: 'bg-emerald-500/[0.06]', iconColor: 'text-emerald-500' },
  { labelKey: 'aiTutorChat' as const, descKey: 'aiTutorChatDesc' as const, href: '/chat', icon: MessageSquare, bg: 'bg-violet-500/[0.06]', iconColor: 'text-violet-500' },
  { labelKey: 'takeQuiz' as const, descKey: 'takeQuizDesc' as const, href: '/quiz', icon: Gamepad2, bg: 'bg-orange-500/[0.06]', iconColor: 'text-orange-500' },
];

const WeeklyActivityChart = dynamic(
  () => import('@/components/features/weekly-activity-chart'),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[120px] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/40" />
      </div>
    ),
  }
);

export default function DashboardPage() {
  const { user } = useAuthStore();
  const { t, locale } = useLanguageStore();
  const [quoteIndex, setQuoteIndex] = useState(0);

  useEffect(() => {
    setQuoteIndex(Math.floor(Math.random() * quotes.length));
  }, []);

  const statsQuery = useQuery<DashboardStats>({
    queryKey: ['dashboard-stats', user?.id],
    enabled: Boolean(user?.id),
    queryFn: async () => (await apiClient.get<DashboardStats>('/analytics/dashboard')).data,
  });
  const stats = statsQuery.data;

  const statCards = [
    { label: locale === 'vi' ? 'Chuỗi ngày học' : 'Study day streak', value: stats?.streak ?? 0, icon: Flame, color: 'text-orange-500', bg: 'bg-orange-500/[0.06]' },
    { label: t.dashboard.totalXP, value: stats?.totalXp ?? 0, icon: Zap, color: 'text-primary', bg: 'bg-primary/[0.06]' },
    { label: t.dashboard.cardsDue, value: stats?.dueCards ?? 0, icon: BookOpen, color: 'text-blue-500', bg: 'bg-blue-500/[0.06]' },
    { label: t.dashboard.mastered, value: stats?.masteredCards ?? 0, icon: Trophy, color: 'text-emerald-500', bg: 'bg-emerald-500/[0.06]' },
  ];

  return (
    <div className="space-y-6">
      {/* 2-Column Desktop Grid / 1-Column Mobile Layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left Column: Main Content (2/3 width) */}
        <div className="space-y-6 lg:col-span-2">
          {/* Welcome Banner + Integrated Quote */}
          <div className="relative overflow-hidden rounded-2xl gradient-bg p-7 text-white shadow-lg shadow-primary/10">
            <div className="pointer-events-none absolute inset-0 bg-linear-to-r from-transparent via-white/[0.03] to-white/[0.06]" />
            <div className="absolute -right-6 -top-6 h-28 w-28 rounded-full bg-white/[0.07]" />
            <div className="absolute -bottom-3 -right-3 h-16 w-16 rounded-full bg-white/[0.04]" />
            <div className="relative">
              <div className="flex items-center gap-2 mb-1.5">
                <Sparkles className="h-4 w-4 text-white/70" />
                <span className="text-xs font-medium text-white/70 uppercase tracking-wider">{t.dashboard.welcomeBack}</span>
              </div>
              <h1 className="text-2xl font-bold">{user?.displayName || t.dashboard.learnerDefault}</h1>
              <p className="mt-1.5 text-sm text-white/60 max-w-md">
                {(stats?.dueCards ?? 0) > 0
                  ? t.dashboard.hasDueCards.replace('{count}', String(stats?.dueCards))
                  : t.dashboard.allCaughtUp}
              </p>
              
              {/* Integrated Quote */}
              <div className="mt-4 border-t border-white/10 pt-3 max-w-lg">
                <p className="text-[11px] italic text-white/85 leading-relaxed">
                  &ldquo;{quotes[quoteIndex]?.text || "Knowledge of languages is the doorway to wisdom."}&rdquo;
                </p>
                <p className="mt-1 text-[10px] text-white/60">— {quotes[quoteIndex]?.author || "Roger Bacon"}</p>
              </div>

            </div>
          </div>

          <NextLearningActivity />

          {/* Quick Actions Grid */}
          <div>
            <h2 className="mb-3 text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider">{t.dashboard.quickActions}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {quickActionKeys.map((action) => (
                <Link key={action.href} href={action.href}>
                  <Card className="group card-hover card-press h-full cursor-pointer glass-panel">
                    <CardContent className="flex items-center gap-3.5 p-4">
                      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${action.bg} transition-all duration-300 group-hover:scale-105 group-hover:shadow-sm`}>
                        <action.icon className={`h-5 w-5 ${action.iconColor}`} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">{t.dashboard[action.labelKey]}</p>
                        <p className="text-[11px] text-muted-foreground/60 truncate mt-0.5">{t.dashboard[action.descKey]}</p>
                      </div>
                      <ArrowRight className="ml-auto h-4 w-4 opacity-0 group-hover:opacity-100 transition-all duration-200 text-muted-foreground/50" />
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </div>

          {/* Weekly Activity (Chart) */}
          <Card className="glass-panel">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider">
                <BarChart2 className="h-4 w-4 text-primary" />
                {t.dashboard.weeklyActivity}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-1 pb-3">
              <WeeklyActivityChart
                weeklyActivity={stats?.weeklyActivity ?? []}
                noActivityText={t.dashboard.noActivityThisWeek}
              />
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Widgets / Stats (1/3 width) */}
        <div className="space-y-6">
          {/* Daily Check-in Widget */}
          <DailyCheckIn />

          {/* Stats Overview Widget */}
          <Card className="glass-panel">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" />
                {t.dashboard.studyProgress || "Thống kê học tập"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Compact Stats Grid */}
              <div className="grid grid-cols-2 gap-2">
                {statCards.map((stat) => (
                  <div key={stat.label} className="rounded-xl bg-muted/30 p-3 flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <stat.icon className={`h-4 w-4 ${stat.color}`} />
                      <span className="text-[10px] text-muted-foreground/75 font-medium truncate">{stat.label}</span>
                    </div>
                    <span className="text-lg font-bold tabular-nums mt-1">{stat.value}</span>
                  </div>
                ))}
              </div>

              {/* Progress bar */}
              <div className="border-t border-border/40 pt-3">
                <div className="mb-1.5 flex justify-between text-xs">
                  <span className="text-muted-foreground/70">{t.dashboard.cardsMastered}</span>
                  <span className="font-medium tabular-nums">{stats?.masteredCards ?? 0}</span>
                </div>
                <Progress
                  value={stats?.masteredCards ?? 0}
                  max={Math.max((stats?.masteredCards ?? 0) + (stats?.dueCards ?? 0), 1)}
                  variant="gradient"
                />
              </div>

              {/* Decks/Reviews quick indicators */}
              <div className="grid grid-cols-2 gap-2 text-center text-[10px] text-muted-foreground/60 border-t border-border/40 pt-3">
                <div>
                  <span className="font-semibold text-foreground/80 block text-xs">{stats?.totalDecks ?? 0}</span>
                  {t.dashboard.totalDecks}
                </div>
                <div>
                  <span className="font-semibold text-foreground/80 block text-xs">{stats?.totalReviews ?? 0}</span>
                  {t.dashboard.totalReviews}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Learning Tree Widget */}
          <Card className="glass-panel">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider">
                <span>🌱</span>
                {t.dashboard.learningTree}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-2 pb-4 pt-1">
              <LearningTree streak={stats?.streak ?? 0} />
              <p className="max-w-xs text-center text-[10px] text-muted-foreground/60 leading-normal mt-1">
                {locale === 'vi' 
                  ? 'Học tập hàng ngày để nuôi dưỡng cây phát triển. Cây sẽ bị héo nếu bạn bỏ học!' 
                  : t.dashboard.learningTreeDesc || 'Study daily to grow the tree. Miss a day and it wilts.'}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
