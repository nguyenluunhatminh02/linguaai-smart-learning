'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth-store';

export default function CmsLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user } = useAuthStore();

  // Client-side admin guard. Real authorization is enforced by the backend
  // (JwtAuthGuard + RolesGuard); this only prevents non-admins from seeing the UI.
  useEffect(() => {
    if (user && user.role !== 'admin' && user.role !== 'ADMIN') {
      router.push('/');
    }
  }, [user, router]);

  if (user && user.role !== 'admin' && user.role !== 'ADMIN') {
    return null;
  }

  return <>{children}</>;
}
