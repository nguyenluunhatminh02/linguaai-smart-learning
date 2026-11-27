'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/lib/api-client';
import type { CommunicationScenarioSummary, LearningCompletion } from '@/lib/learning-types';

export default function LearnPage() {
  const scenarios = useQuery({
    queryKey: ['communication-scenarios'],
    queryFn: async () => (await apiClient.get<CommunicationScenarioSummary[]>('/learning/scenarios')).data,
  });
  const progress = useQuery({
    queryKey: ['learning-progress'],
    queryFn: async () => (await apiClient.get<LearningCompletion[]>('/learning/progress')).data,
  });
  const completed = new Set(progress.data?.filter((item) => item.activityType === 'scenario').map((item) => item.activityId));

  return (
    <main className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold">Tiếng Anh giao tiếp hằng ngày</h1>
      {scenarios.isPending && <p role="status">Đang tải bài học…</p>}
      {scenarios.isError && (
        <div className="space-y-2">
          <p role="alert">Chưa tải được danh sách bài học.</p>
          <Button onClick={() => void scenarios.refetch()}>Tải lại</Button>
        </div>
      )}
      {scenarios.data && (['A1', 'A2'] as const).map((level) => (
        <section key={level} className="space-y-3" aria-labelledby={`level-${level}`}>
          <h2 id={`level-${level}`} className="text-lg font-semibold">{level === 'A1' ? 'A1 · Mới bắt đầu' : 'A2 · Cơ bản'}</h2>
          <ul className="space-y-2">
            {scenarios.data.filter((scenario) => scenario.level === level).map((scenario) => (
              <li key={scenario.slug}>
                <Link
                  href={`/learn/${scenario.slug}`}
                  className="flex items-center gap-4 rounded-xl border border-border bg-card p-4 hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  <div className="flex-1 space-y-1">
                    <div className="font-semibold">{scenario.title}</div>
                    <p className="text-sm text-muted-foreground">{scenario.objective}</p>
                    <p className="text-sm text-muted-foreground">
                      {scenario.estimatedMinutes} phút
                      {completed.has(scenario.slug) && (
                        <span className="ml-3 inline-flex items-center gap-1">
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" /> Đã hoàn thành
                        </span>
                      )}
                    </p>
                  </div>
                  <ArrowRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
