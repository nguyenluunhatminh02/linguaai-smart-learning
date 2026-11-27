'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { apiClient } from '@/lib/api-client';
import { useLanguageStore } from '@/stores/language-store';
import {
  Users, Layers, CreditCard, RefreshCw, FileText,
  BookOpen, Plus, ArrowRight, Headphones,
  Languages, BookText, MessageSquare,
} from 'lucide-react';

interface AdminOverview {
  totalUsers: number;
  totalDecks: number;
  totalCards: number;
  totalReviews: number;
  totalContent: number;
}

interface LessonStat {
  type: string;
  count: number;
}

export default function AdminOverviewPage() {
  const { t } = useLanguageStore();
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [lessonStats, setLessonStats] = useState<LessonStat[]>([]);
  const [totalLessons, setTotalLessons] = useState(0);

  useEffect(() => {
    apiClient.get('/admin/overview').then((r) => setOverview(r.data)).catch(() => {});

    fetch('/api/cms/lessons?limit=1')
      .then(r => r.json())
      .then(json => {
        const total = json.meta?.total ?? 0;
        setTotalLessons(total);
      })
      .catch(() => {});

    const types = ['grammar', 'translation', 'reading', 'vocabulary', 'listening'];
    Promise.all(
      types.map(t =>
        fetch(`/api/cms/lessons?type=${t}&limit=1`)
          .then(r => r.json())
          .then(json => ({ type: t, count: json.meta?.total ?? (json.data?.length ?? 0) }))
          .catch(() => ({ type: t, count: 0 }))
      )
    ).then(setLessonStats);
  }, []);

  const platformStats = overview
    ? [
        { label: t.admin.manageUsers, value: overview.totalUsers, icon: Users, color: 'bg-blue-500/10 text-blue-500' },
        { label: t.admin.totalDecks, value: overview.totalDecks, icon: Layers, color: 'bg-primary/10 text-primary-dark' },
        { label: t.admin.totalFlashcards, value: overview.totalCards, icon: CreditCard, color: 'bg-emerald-500/10 text-emerald-500' },
        { label: t.admin.totalReviews, value: overview.totalReviews, icon: RefreshCw, color: 'bg-orange-500/10 text-orange-500' },
        { label: t.admin.totalContent, value: overview.totalContent, icon: FileText, color: 'bg-pink-500/10 text-pink-500' },
      ]
    : [];

  const typeIcons: Record<string, typeof BookOpen> = {
    grammar: Languages,
    translation: MessageSquare,
    reading: BookText,
    vocabulary: BookOpen,
    listening: Headphones,
  };

  const typeLabels: Record<string, string> = {
    grammar: t.admin.typeGrammar,
    translation: t.admin.typeTranslation,
    reading: t.admin.typeReading,
    vocabulary: t.admin.typeVocabulary,
    listening: t.admin.typeListening,
  };

  return (
    <div className="space-y-6">
      {/* Platform stats */}
      {overview && (
        <div>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wider">{t.admin.platformStats}</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {platformStats.map((stat) => (
              <Card key={stat.label}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${stat.color}`}>
                      <stat.icon className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold tabular-nums">{stat.value?.toLocaleString?.() ?? 0}</p>
                      <p className="text-xs text-muted-foreground">{stat.label}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Lesson stats + quick actions */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">{t.admin.lessonsByType}</h2>
            <Badge variant="secondary">{totalLessons} {t.admin.totalLessonsSuffix}</Badge>
          </div>
          <Card>
            <CardContent className="divide-y p-0">
              {lessonStats.map(({ type, count }) => {
                const Icon = typeIcons[type] ?? BookOpen;
                return (
                  <Link
                    key={type}
                    href={`/admin/lessons?type=${type}`}
                    className="flex items-center gap-3 px-4 py-3.5 transition hover:bg-muted/40"
                  >
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/5">
                      <Icon className="h-4 w-4 text-primary" />
                    </div>
                    <span className="flex-1 text-sm font-medium">{typeLabels[type] ?? type}</span>
                    <span className="text-sm font-bold tabular-nums text-foreground">{count}</span>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </Link>
                );
              })}
            </CardContent>
          </Card>
        </div>

        <div>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wider">{t.admin.quickActions}</h2>
          <div className="grid gap-3">
            <Link href="/admin/lessons/new">
              <Card className="cursor-pointer transition hover:shadow-md hover:border-primary/30">
                <CardContent className="flex items-center gap-4 p-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
                    <Plus className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <p className="font-semibold">{t.admin.createLesson}</p>
                    <p className="text-xs text-muted-foreground">{t.admin.createNewLessonDesc}</p>
                  </div>
                </CardContent>
              </Card>
            </Link>

            <Link href="/admin/lessons">
              <Card className="cursor-pointer transition hover:shadow-md hover:border-primary/30">
                <CardContent className="flex items-center gap-4 p-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-mid/10">
                    <BookOpen className="h-6 w-6 text-gradient-end" />
                  </div>
                  <div>
                    <p className="font-semibold">{t.admin.manageLessons}</p>
                    <p className="text-xs text-muted-foreground">{t.admin.manageLessonsDesc}</p>
                  </div>
                </CardContent>
              </Card>
            </Link>

            <Link href="/admin/users">
              <Card className="cursor-pointer transition hover:shadow-md hover:border-primary/30">
                <CardContent className="flex items-center gap-4 p-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/10">
                    <Users className="h-6 w-6 text-blue-500" />
                  </div>
                  <div>
                    <p className="font-semibold">{t.admin.manageUsers}</p>
                    <p className="text-xs text-muted-foreground">{t.admin.manageUsersDesc}</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
