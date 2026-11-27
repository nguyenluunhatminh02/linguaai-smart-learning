'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { useLanguageStore } from '@/stores/language-store';
import {
  LayoutDashboard, BookOpen, Users, ArrowLeft, Shield,
} from 'lucide-react';

const adminNav = [
  { href: '/admin', labelKey: 'overview', icon: LayoutDashboard, exact: true },
  { href: '/admin/lessons', labelKey: 'manageLessons', icon: BookOpen, exact: false },
  { href: '/admin/users', labelKey: 'manageUsers', icon: Users, exact: false },
] as const;

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuthStore();
  const { t } = useLanguageStore();

  // Block non-admin (client-side guard; middleware also protects)
  useEffect(() => {
    if (user && user.role !== 'admin' && user.role !== 'ADMIN') {
      router.push('/');
    }
  }, [user, router]);

  if (user && user.role !== 'admin' && user.role !== 'ADMIN') {
    return null;
  }

  return (
    <div className="space-y-0">
      {/* Admin top bar */}
      <div className="mb-6 flex items-center gap-4 rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-500/10">
          <Shield className="h-5 w-5 text-red-500" />
        </div>
        <div className="flex-1">
          <h1 className="text-lg font-bold">{t.admin.adminSystem}</h1>
          <p className="text-xs text-muted-foreground">{t.admin.adminSystemDesc}</p>
        </div>
        <Link
          href="/dashboard"
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> {t.admin.backToMain}
        </Link>
      </div>

      {/* Sub-navigation tabs */}
      <div className="mb-6 flex gap-1 rounded-xl border border-border bg-muted/30 p-1">
        {adminNav.map(({ href, labelKey, icon: Icon, exact }) => {
          const isActive = exact ? pathname === href : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-all',
                isActive
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4" />
              {t.admin[labelKey]}
            </Link>
          );
        })}
      </div>

      {/* Page content */}
      {children}
    </div>
  );
}
