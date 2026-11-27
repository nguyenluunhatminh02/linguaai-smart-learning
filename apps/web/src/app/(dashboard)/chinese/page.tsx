'use client';

import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BookMarked, Languages, ArrowRightLeft, BookOpen, ChevronRight } from 'lucide-react';
import { FlagIcon } from '@/components/ui/flag-icon';

const sections = [
  {
    href: '/chinese/vocabulary',
    icon: BookMarked,
    color: 'text-rose-500',
    bg: 'bg-rose-500/10',
    title: 'Từ vựng HSK',
    titleZh: 'HSK词汇',
    desc: '180 từ vựng từ HSK1 đến HSK6, phân theo cấp độ.',
    badge: '6 gói',
  },
  {
    href: '/chinese/grammar',
    icon: Languages,
    color: 'text-blue-500',
    bg: 'bg-blue-500/10',
    title: 'Ngữ pháp tiếng Trung',
    titleZh: '中文语法',
    desc: 'Cấu trúc câu, trợ từ, bổ ngữ và mẫu câu đặc biệt.',
    badge: '8+ bài',
  },
  {
    href: '/chinese/translation',
    icon: ArrowRightLeft,
    color: 'text-teal-500',
    bg: 'bg-teal-500/10',
    title: 'Dịch Việt → Trung',
    titleZh: '越译中',
    desc: 'Luyện dịch câu tiếng Việt sang tiếng Trung theo chủ đề.',
    badge: '14 bài',
  },
  {
    href: '/chinese/reading',
    icon: BookOpen,
    color: 'text-violet-500',
    bg: 'bg-violet-500/10',
    title: 'Đọc hiểu tiếng Trung',
    titleZh: '中文阅读',
    desc: 'Bài đọc từ HSK1–HSK6 với từ vựng và câu hỏi.',
    badge: '7 bài',
  },
];

export default function ChineseHubPage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-500/10 overflow-hidden p-1.5">
          <FlagIcon country="zh" className="h-full w-full object-cover rounded-xs" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Học tiếng Trung</h1>
          <p className="text-sm text-muted-foreground">中文学习 — Hệ thống học tiếng Trung toàn diện HSK1–HSK6</p>
        </div>
      </div>

      {/* Section cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        {sections.map((s) => (
          <Link key={s.href} href={s.href}>
            <Card className="h-full cursor-pointer transition-all hover:shadow-md hover:border-primary/30">
              <CardContent className="flex flex-col gap-3 p-5">
                <div className="flex items-center justify-between">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${s.bg}`}>
                    <s.icon className={`h-5 w-5 ${s.color}`} />
                  </div>
                  <Badge variant="secondary" className="text-xs">{s.badge}</Badge>
                </div>
                <div>
                  <p className="font-semibold">{s.title}</p>
                  <p className="text-xs text-muted-foreground">{s.titleZh}</p>
                </div>
                <p className="text-sm text-muted-foreground">{s.desc}</p>
                <div className="flex items-center gap-1 text-xs text-primary font-medium pt-1">
                  Bắt đầu học <ChevronRight className="h-3 w-3" />
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
