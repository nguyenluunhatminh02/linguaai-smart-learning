'use client';

import { useState, useEffect, useRef } from 'react';
import { useTheme } from 'next-themes';
import { useAuthStore } from '@/stores/auth-store';
import { useLanguageStore } from '@/stores/language-store';
import { useTokenStore } from '@/stores/token-store';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Flame, Zap, LogOut, Moon, Sun, Coins, Bell, Check, CheckCheck, Info, AlertTriangle, Trophy, Loader2 } from 'lucide-react';
import { LanguageSwitcher } from './language-switcher';
import { apiClient } from '@/lib/api-client';
import { cn } from '@/lib/utils';

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="h-8 w-8" />;
  const isDark = theme === 'dark';
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className="h-8 w-8 rounded-xl text-muted-foreground/70 hover:text-foreground hover:bg-muted/40 transition-all"
      title={isDark ? 'Light mode' : 'Dark mode'}
    >
      {isDark ? (
        <Sun className="h-4 w-4 text-amber-400" />
      ) : (
        <Moon className="h-4 w-4" />
      )}
    </Button>
  );
}

interface Notification {
  id: string;
  title: string;
  body: string;
  type: string;
  isRead: boolean;
  createdAt: string;
}

function getNotifIcon(type: string) {
  if (type === 'ACHIEVEMENT' || type === 'STREAK') return <Trophy className="h-4 w-4 text-amber-500 shrink-0" />;
  if (type === 'WARNING' || type === 'REMINDER') return <AlertTriangle className="h-4 w-4 text-orange-500 shrink-0" />;
  return <Info className="h-4 w-4 text-primary shrink-0" />;
}

function NotificationBell() {
  const { t, locale } = useLanguageStore();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const fetchUnread = async () => {
    try {
      const res = await apiClient.get('/notifications/unread-count');
      setUnread(res.data?.count || 0);
    } catch { /* ignore */ }
  };

  const fetchNotifications = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/notifications?limit=10');
      const data = res.data?.data || res.data || [];
      setNotifications(Array.isArray(data) ? data : []);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUnread();
    const interval = setInterval(fetchUnread, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (open) fetchNotifications();
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const markRead = async (id: string) => {
    try {
      await apiClient.patch(`/notifications/${id}/read`);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
      setUnread(prev => Math.max(0, prev - 1));
    } catch { /* ignore */ }
  };

  const markAllRead = async () => {
    try {
      await apiClient.post('/notifications/read-all');
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
      setUnread(0);
    } catch { /* ignore */ }
  };

  return (
    <div className="relative" ref={panelRef}>
      <Button
        variant="ghost"
        size="icon"
        className="relative h-8 w-8 rounded-xl text-muted-foreground/70 hover:text-foreground hover:bg-muted/40 transition-all"
        onClick={() => setOpen(!open)}
        title={t.notifications.title}
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white leading-none">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </Button>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 w-80 rounded-2xl border border-border/60 bg-popover shadow-xl animate-scale-in overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-primary" />
              <span className="font-semibold text-sm">{t.notifications.title}</span>
              {unread > 0 && (
                <span className="flex h-5 items-center justify-center rounded-full bg-red-100 px-1.5 text-[10px] font-bold text-red-600 dark:bg-red-900/30 dark:text-red-400">
                  {unread} {t.notifications.newSuffix}
                </span>
              )}
            </div>
            {unread > 0 && (
              <button
                onClick={markAllRead}
                className="flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <CheckCheck className="h-3 w-3" /> {t.notifications.readAll}
              </button>
            )}
          </div>

          {/* Body */}
          <div className="max-h-72 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : notifications.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
                <Bell className="h-8 w-8 opacity-20" />
                <p className="text-sm">{t.notifications.noNotifications}</p>
              </div>
            ) : (
              notifications.map(n => (
                <div
                  key={n.id}
                  className={cn(
                    'flex items-start gap-3 px-4 py-3 border-b border-border/30 last:border-0 transition-colors',
                    n.isRead ? 'opacity-60 hover:opacity-80' : 'bg-primary/[0.02] hover:bg-primary/[0.04]',
                  )}
                >
                  <div className="mt-0.5">{getNotifIcon(n.type)}</div>
                  <div className="flex-1 min-w-0">
                    <p className={cn('text-sm font-medium truncate', !n.isRead && 'text-foreground')}>{n.title}</p>
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{n.body}</p>
                    <p className="text-[10px] text-muted-foreground/60 mt-1">
                      {new Date(n.createdAt).toLocaleDateString(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  {!n.isRead && (
                    <button
                      onClick={() => markRead(n.id)}
                      className="mt-0.5 shrink-0 text-primary/60 hover:text-primary transition-colors"
                      title={t.notifications.markAsRead}
                    >
                      <Check className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function Topbar() {
  const { user, logout } = useAuthStore();
  const { t } = useLanguageStore();
  const { balance, loadBalance } = useTokenStore();
  const router = useRouter();

  useEffect(() => {
    loadBalance();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLogout = async () => {
    await logout();
    router.push('/login');
  };

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border/40 bg-background/80 px-6 backdrop-blur-xl transition-colors duration-300">
      <div />

      <div className="flex items-center gap-2.5">
        <div className="flex items-center gap-1.5 rounded-lg bg-orange-500/[0.06] px-2.5 py-1 dark:bg-orange-500/[0.08]" role="img" aria-label={`Daily streak: ${user?.streakCount || 0}`}>
          <Flame className="h-3.5 w-3.5 text-orange-500" aria-hidden="true" />
          <span className="text-xs font-semibold text-orange-600 dark:text-orange-400 tabular-nums">{user?.streakCount || 0}</span>
        </div>

        <div className="flex items-center gap-1.5 rounded-lg bg-primary/[0.06] px-2.5 py-1 dark:bg-primary/[0.08]" role="img" aria-label={`Total XP: ${user?.totalXp || 0}`}>
          <Zap className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
          <span className="text-xs font-semibold text-primary dark:text-primary-light tabular-nums">{user?.totalXp || 0} XP</span>
        </div>

        <Link href="/pricing" className="flex items-center gap-1.5 rounded-lg bg-amber-500/6 px-2.5 py-1 dark:bg-amber-500/8 transition hover:bg-amber-500/12 cursor-pointer" title="AI Tokens" aria-label={`AI tokens: ${balance}`}>
          <Coins className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
          <span className="text-xs font-semibold text-amber-600 dark:text-amber-400 tabular-nums">{balance}</span>
        </Link>

        <div className="mx-0.5 h-5 w-px bg-border/60" />

        <NotificationBell />
        <LanguageSwitcher compact />
        <ThemeToggle />

        <div className="h-5 w-px bg-border/60" />

        <div className="flex items-center gap-2.5">
          <Avatar name={user?.displayName || 'User'} size="sm" />
          <div className="hidden sm:block">
            <p className="text-sm font-medium leading-none">{user?.displayName || 'Learner'}</p>
            <p className="text-[10px] leading-snug text-muted-foreground/70">{user?.email}</p>
          </div>
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={handleLogout}
          className="h-8 w-8 rounded-xl text-muted-foreground/60 hover:text-destructive hover:bg-destructive/[0.06] transition-all"
          title={t.auth.signOut}
        >
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}
