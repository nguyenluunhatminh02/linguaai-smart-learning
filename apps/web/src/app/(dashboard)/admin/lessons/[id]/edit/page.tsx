'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { LessonForm } from '@/components/cms/lesson-form';
import type { CmsLesson } from '@/lib/types/cms';
import { Loader2 } from 'lucide-react';
import { useLanguageStore } from '@/stores/language-store';

export default function AdminEditLessonPage() {
  const { t } = useLanguageStore();
  const params = useParams<{ id: string }>();
  const [lesson, setLesson] = useState<CmsLesson | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/cms/lessons/${params.id}`)
      .then((r) => {
        if (!r.ok) throw new Error(t.admin.toastLessonNotFound);
        return r.json();
      })
      .then(setLesson)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [params.id, t.admin.toastLessonNotFound]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !lesson) {
    return (
      <div className="py-20 text-center">
        <p className="text-lg font-medium text-red-500">{error || t.admin.toastLessonNotFound}</p>
      </div>
    );
  }

  return <LessonForm initial={lesson} backUrl="/admin/lessons" />;
}
