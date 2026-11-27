'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { LessonForm } from '@/components/cms/lesson-form';
import type { CmsLesson } from '@/lib/types/cms';
import { Loader2 } from 'lucide-react';
import { useAuthStore, getAccessToken } from '@/stores/auth-store';
import { useLanguageStore } from '@/stores/language-store';

const isAdminRole = (role: string | undefined) =>
  role === 'admin' || role === 'ADMIN' || role === 'ROLE_ADMIN';

export default function CmsEditPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuthStore();
  const { t } = useLanguageStore();
  const [lesson, setLesson] = useState<CmsLesson | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const notFound = t.admin.toastLessonNotFound || 'Không tìm thấy bài học';
  const forbidden = 'Bạn không có quyền truy cập trang này';

  useEffect(() => {
    // Do not issue the lesson request (or render the editor) unless the
    // current user is a verified admin. The backend remains the real authority.
    if (authLoading) return;
    if (!user || !isAdminRole(user.role)) {
      setError(forbidden);
      setLoading(false);
      router.replace('/');
      return;
    }

    let cancelled = false;
    const token = getAccessToken();
    fetch(`/api/cms/lessons/${params.id}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
      .then((r) => {
        if (!r.ok) throw new Error(notFound);
        return r.json();
      })
      .then((data) => { if (!cancelled) setLesson(data); })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [params.id, authLoading, user, router, notFound, forbidden]);

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
        <p className="text-lg font-medium text-red-500">{error || notFound}</p>
      </div>
    );
  }

  return <LessonForm initial={lesson} />;
}
