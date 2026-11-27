'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BookMarked, Languages, ArrowRightLeft, BookOpen, ChevronRight } from 'lucide-react';
import { FlagIcon } from '@/components/ui/flag-icon';

const sections = [
  {
    href: '/japanese/vocabulary',
    icon: BookMarked,
    color: 'text-rose-500',
    bg: 'bg-rose-500/10',
    title: 'Từ vựng JLPT',
    titleJa: 'JLPT語彙',
    desc: '180 từ vựng từ N5 đến N1, phân theo cấp độ JLPT.',
    badge: '6 gói',
    lessonType: 'vocabulary',
  },
  {
    href: '/japanese/grammar',
    icon: Languages,
    color: 'text-blue-500',
    bg: 'bg-blue-500/10',
    title: 'Ngữ pháp tiếng Nhật',
    titleJa: '日本語文法',
    desc: 'Trợ từ, thể động từ, mẫu câu, kính ngữ và ngữ pháp nâng cao.',
    badge: '8+ bài',
    lessonType: 'grammar',
  },
  {
    href: '/japanese/translation',
    icon: ArrowRightLeft,
    color: 'text-teal-500',
    bg: 'bg-teal-500/10',
    title: 'Dịch Việt → Nhật',
    titleJa: '越訳日',
    desc: 'Luyện dịch câu tiếng Việt sang tiếng Nhật theo chủ đề.',
    badge: '12 bài',
    lessonType: 'translation',
  },
  {
    href: '/japanese/reading',
    icon: BookOpen,
    color: 'text-violet-500',
    bg: 'bg-violet-500/10',
    title: 'Đọc hiểu tiếng Nhật',
    titleJa: '日本語読解',
    desc: 'Bài đọc từ N5–N1 với từ vựng và câu hỏi đọc hiểu.',
    badge: '5 bài',
    lessonType: 'reading',
  },
] as const;

export default function JapaneseHubPage() {
  const [totals, setTotals] = useState<Record<string, number>>({});

  useEffect(() => {
    let active = true;
    // The CMS route reports the filtered count in meta.total; limit=1 keeps
    // the payload small since only the count is used here.
    Promise.all(
      sections.map(async ({ lessonType }) => {
        try {
          const res = await fetch(`/api/cms/lessons?language=japanese&type=${lessonType}&limit=1`, { cache: 'no-store' });
          if (!res.ok) return null;
          const json = await res.json();
          return [lessonType, Number(json?.meta?.total)] as const;
        } catch {
          return null;
        }
      }),
    ).then((results) => {
      if (!active) return;
      const next: Record<string, number> = {};
      for (const result of results) {
        if (result && Number.isFinite(result[1]) && result[1] >= 0) {
          next[result[0]] = result[1];
        }
      }
      setTotals(next);
    });
    return () => { active = false; };
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-500/10 overflow-hidden p-1.5">
          <FlagIcon country="ja" className="h-full w-full object-cover rounded-xs" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Học tiếng Nhật</h1>
          <p className="text-sm text-muted-foreground">日本語学習 — Hệ thống học tiếng Nhật toàn diện N5–N1</p>
        </div>
      </div>

      {/* Section cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        {sections.map((s) => {
          const total = totals[s.lessonType];
          const badge = total === undefined ? s.badge : `${total} bài`;
          return (
            <Link key={s.href} href={s.href}>
              <Card className="h-full cursor-pointer transition-all hover:shadow-md hover:border-primary/30">
                <CardContent className="flex flex-col gap-3 p-5">
                  <div className="flex items-center justify-between">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${s.bg}`}>
                      <s.icon className={`h-5 w-5 ${s.color}`} />
                    </div>
                    <Badge variant="secondary" className="text-xs">{badge}</Badge>
                  </div>
                  <div>
                    <p className="font-semibold">{s.title}</p>
                    <p className="text-xs text-muted-foreground">{s.titleJa}</p>
                  </div>
                  <p className="text-sm text-muted-foreground">{s.desc}</p>
                  <div className="flex items-center gap-1 text-xs text-primary font-medium pt-1">
                    Bắt đầu học <ChevronRight className="h-3 w-3" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
