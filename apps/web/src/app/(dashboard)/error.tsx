'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useLanguageStore } from '@/stores/language-store';

const messages = {
  en: { title: 'Something went wrong', description: 'An unexpected error occurred. Please try again.', retry: 'Try Again' },
  vi: { title: 'Đã xảy ra lỗi', description: 'Đã xảy ra lỗi không mong muốn. Vui lòng thử lại.', retry: 'Thử lại' },
  zh: { title: '出现问题', description: '发生意外错误，请重试。', retry: '重试' },
  ja: { title: '問題が発生しました', description: '予期しないエラーが発生しました。もう一度お試しください。', retry: '再試行' },
  ko: { title: '문제가 발생했습니다', description: '예기치 않은 오류가 발생했습니다. 다시 시도해 주세요.', retry: '다시 시도' },
};

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { locale } = useLanguageStore();
  const copy = messages[locale];

  useEffect(() => {
    console.error('[Dashboard Error]', error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-5 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/[0.06]">
        <AlertTriangle className="h-7 w-7 text-destructive" />
      </div>
      <div>
        <h2 className="text-base font-bold">{copy.title}</h2>
        <p className="mt-1.5 text-xs text-muted-foreground/70">{copy.description}</p>
      </div>
      <Button onClick={reset} variant="outline" size="sm">
        <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> {copy.retry}
      </Button>
    </div>
  );
}
