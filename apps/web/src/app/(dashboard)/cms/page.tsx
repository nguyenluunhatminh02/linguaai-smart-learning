'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function CmsPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/admin/lessons');
  }, [router]);

  return (
    <div className="py-20 text-center text-muted-foreground">Đang chuyển hướng...</div>
  );
}
