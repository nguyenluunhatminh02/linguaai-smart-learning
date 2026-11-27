'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Gift, Coins, CheckCircle2, Flame, Calendar, Sparkles } from 'lucide-react';
import { useTokenStore } from '@/stores/token-store';
import { useLanguageStore } from '@/stores/language-store';
import { cn } from '@/lib/utils';
import apiClient from '@/lib/api-client';

const CHECK_IN_KEY = 'daily_checkin';
const CHECK_IN_STREAK_KEY = 'daily_checkin_streak';
const CHECK_IN_HISTORY_KEY = 'daily_checkin_history';

// Bonus tokens for consecutive check-in days
const STREAK_BONUSES = [5, 5, 8, 8, 10, 10, 15]; // Day 1-7, then repeats

interface CheckInData {
  lastDate: string;
  streak: number;
  history: string[]; // ISO date strings of last 7 days
}

function getCheckInData(): CheckInData {
  if (typeof window === 'undefined') return { lastDate: '', streak: 0, history: [] };
  const lastDate = localStorage.getItem(CHECK_IN_KEY) || '';
  const streakRaw = parseInt(localStorage.getItem(CHECK_IN_STREAK_KEY) || '0', 10);
  const streak = Number.isFinite(streakRaw) && streakRaw > 0 ? streakRaw : 0;

  let history: string[] = [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(CHECK_IN_HISTORY_KEY) || '[]');
    if (Array.isArray(parsed)) {
      history = parsed.filter((d): d is string => typeof d === 'string');
    } else {
      localStorage.removeItem(CHECK_IN_HISTORY_KEY);
    }
  } catch {
    // Corrupt legacy data must never crash the render — discard it.
    try { localStorage.removeItem(CHECK_IN_HISTORY_KEY); } catch { /* storage blocked */ }
  }
  return { lastDate, streak, history };
}

function getLocalDayStr(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const dayStr = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${dayStr}`;
}

function getToday(): string {
  return getLocalDayStr(new Date());
}

function getWeekDays(locale: string): { date: string; label: string; isToday: boolean }[] {
  const days: { date: string; label: string; isToday: boolean }[] = [];
  const today = new Date();
  // Use Intl API to localize short weekday names based on the active UI locale.
  const formatter = new Intl.DateTimeFormat(locale, { weekday: 'short' });

  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push({
      date: getLocalDayStr(d),
      label: formatter.format(d),
      isToday: i === 0,
    });
  }
  return days;
}

export function DailyCheckIn({ onCheckIn }: { onCheckIn?: (newStreak: number, tokensEarned: number) => void } = {}) {
  const { t, locale } = useLanguageStore();
  const [checkedIn, setCheckedIn] = useState(false);
  const [streak, setStreak] = useState(0);
  const [history, setHistory] = useState<string[]>([]);
  const [showReward, setShowReward] = useState(false);
  const [bonusAmount, setBonusAmount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    const data = getCheckInData();
    const today = getToday();
    setStreak(data.streak);
    setHistory(data.history);
    setCheckedIn(data.lastDate === today);
  }, []);

  const handleCheckIn = async () => {
    const today = getToday();
    if (getCheckInData().lastDate === today || saving) return;

    setSaving(true);
    setSaveError(false);
    try {
      const res = await apiClient.post<{
        balance?: number;
        tokensEarned?: number;
        streak?: number;
        alreadyCheckedIn?: boolean;
      }>('/users/me/tokens/daily-checkin');
      const earned = res.data.tokensEarned ?? 0;
      const newStreak = res.data.streak ?? getCheckInData().streak + 1;
      const newHistory = [...new Set([...getCheckInData().history, today])].slice(-7);

      localStorage.setItem(CHECK_IN_KEY, today);
      localStorage.setItem(CHECK_IN_STREAK_KEY, String(newStreak));
      localStorage.setItem(CHECK_IN_HISTORY_KEY, JSON.stringify(newHistory));
      setCheckedIn(true);
      setStreak(newStreak);
      setHistory(newHistory);

      if (typeof res.data.balance === 'number') useTokenStore.setState({ balance: res.data.balance });
      void useTokenStore.getState().loadHistory();

      if (earned > 0) {
        setBonusAmount(earned);
        setShowReward(true);
        setTimeout(() => setShowReward(false), 3000);
      }
      onCheckIn?.(newStreak, earned);
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  };

  const intlLocale = locale === 'zh' ? 'zh-CN' : locale;
  const weekDays = getWeekDays(intlLocale);
  const todayBonus = STREAK_BONUSES[Math.min(streak, STREAK_BONUSES.length - 1)];

  // Calculate connected step timeline indices
  let activeIdx = 0;

  if (checkedIn) {
    activeIdx = (streak - 1) % 7;
  } else {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = getLocalDayStr(yesterday);
    const data = getCheckInData();

    if (data.lastDate === yesterdayStr) {
      activeIdx = streak % 7;
    } else {
      activeIdx = 0;
    }
  }

  // Width of progress line in percentage (6 intervals between 7 steps)
  const progressPercent = checkedIn 
    ? (activeIdx / 6) * 100 
    : activeIdx === 0 
      ? 0 
      : ((activeIdx - 1) / 6) * 100;

  return (
    <Card className="relative overflow-hidden border border-amber-500/20 bg-linear-to-br from-amber-500/[0.03] via-background to-orange-500/[0.03] shadow-md shadow-amber-500/[0.01] rounded-2xl">
      {/* Reward animation overlay */}
      {showReward && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/85 backdrop-blur-md animate-fade-in">
          <div className="flex flex-col items-center gap-2.5 animate-bounce">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/20 shadow-lg shadow-amber-500/10">
              <Coins className="h-8 w-8 text-amber-500 animate-spin" />
            </div>
            <p className="text-xl font-bold text-amber-600 dark:text-amber-400">+{bonusAmount} {t.dashboardCheckin.tokensReward}!</p>
            <p className="text-xs text-muted-foreground font-semibold">{t.dashboardCheckin.checkin} ✓</p>
          </div>
        </div>
      )}

      <CardContent className="p-5">
        {/* Top Header section */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-500/10 shadow-sm">
              <Calendar className="h-5.5 w-5.5 text-amber-500" />
            </div>
            <div>
              <p className="text-sm font-bold tracking-tight text-foreground">{t.dashboardCheckin.title}</p>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="secondary" className="text-[10px] py-0 px-2 bg-orange-500/10 text-orange-600 font-semibold border-none">
                  <Flame className="mr-0.5 h-3 w-3" /> {streak} {t.dashboardCheckin.streakDays}
                </Badge>
                {!checkedIn && (
                  <Badge variant="secondary" className="text-[10px] py-0 px-2 bg-amber-500/10 text-amber-600 font-semibold border-none">
                    <Coins className="mr-0.5 h-3 w-3" /> +{todayBonus} {t.dashboardCheckin.tokensReward}
                  </Badge>
                )}
              </div>
            </div>
          </div>

          <Button
            variant={checkedIn ? 'outline' : 'gradient'}
            size="sm"
            onClick={handleCheckIn}
            disabled={checkedIn || saving}
            className={cn(
              'h-9 shrink-0 font-bold transition-all duration-300 shadow-sm', 
              checkedIn 
                ? 'border-green-500/20 text-green-600 hover:bg-green-500/[0.02]' 
                : 'hover:scale-[1.03] active:scale-[0.97] hover:shadow-md hover:shadow-orange-500/15'
            )}
          >
            {checkedIn ? (
              <><CheckCircle2 className="mr-1.5 h-4 w-4 text-green-500" /> {t.dashboardCheckin.checkin} ✓</>
            ) : (
              <><Gift className="mr-1.5 h-4 w-4 text-white" /> {t.dashboardCheckin.checkin}</>
            )}
          </Button>
        </div>

        {saveError && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <p role="alert" className="text-xs text-destructive">Chưa điểm danh được. Hãy thử lại.</p>
            <Button variant="outline" size="sm" disabled={saving} onClick={() => void handleCheckIn()}>Thử lại</Button>
          </div>
        )}

        {/* 7-day calendar strip (Glassmorphic cards) */}
        <div className="grid grid-cols-7 gap-1.5 mt-5">
          {weekDays.map((day) => {
            const isChecked = history.includes(day.date);
            return (
              <div 
                key={day.date} 
                className={cn(
                  "flex flex-col items-center justify-center py-2.5 rounded-xl border transition-all duration-300",
                  isChecked 
                    ? "bg-gradient-to-br from-amber-400 to-orange-500 text-white border-orange-500/20 shadow-xs shadow-amber-500/10"
                    : day.isToday 
                      ? "bg-amber-500/[0.06] border-dashed border-amber-500/50 text-amber-600 dark:text-amber-400 shadow-inner ring-2 ring-amber-500/5"
                      : "bg-muted/30 border-border/10 text-muted-foreground/60"
                )}
              >
                <span className={cn(
                  "text-[9px] uppercase tracking-wider font-semibold opacity-75 mb-1",
                  isChecked && "text-white opacity-90",
                  day.isToday && !isChecked && "text-amber-600 dark:text-amber-400 font-bold"
                )}>
                  {day.label}
                </span>
                <div
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold transition-all",
                    isChecked && "bg-white/20 text-white",
                    day.isToday && !isChecked && "bg-amber-500/20 text-amber-600 dark:text-amber-400 animate-pulse",
                    !day.isToday && !isChecked && "bg-muted/40 text-muted-foreground/60"
                  )}
                >
                  {isChecked ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <span>{parseInt(day.date.slice(8))}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Gamified Connected Step Timeline for streak rewards */}
        <div className="mt-6 pt-3 border-t border-border/40">
          <p className="text-[10px] text-muted-foreground/60 font-semibold uppercase tracking-wider mb-3.5">
            {locale === 'vi' ? 'Lộ trình nhận thưởng' : 'Streak Reward Pipeline'}
          </p>
          <div className="relative flex items-center justify-between w-full px-2 mt-4 mb-2">
            {/* Background connecting track line */}
            <div className="absolute left-4 right-4 top-1/2 -translate-y-1/2 h-1 bg-muted rounded-full z-0" />
            
            {/* Active completed progress line */}
            <div 
              className="absolute left-4 top-1/2 -translate-y-1/2 h-1 bg-gradient-to-r from-amber-500 to-orange-500 rounded-full z-0 transition-all duration-500" 
              style={{ width: `calc(${progressPercent}% - ${progressPercent > 0 ? '16px' : '0px'})` }}
            />

            {STREAK_BONUSES.map((bonus, i) => {
              const isCompleted = i < activeIdx || (i === activeIdx && checkedIn);
              const isActive = i === activeIdx && !checkedIn;
              const isLast = i === 6;

              return (
                <div key={i} className="relative z-10 flex flex-col items-center">
                  {/* Step Node Circle */}
                  <div
                    className={cn(
                      "w-8.5 h-8.5 rounded-full flex items-center justify-center text-[10px] font-extrabold transition-all duration-300 border-2",
                      isCompleted 
                        ? "bg-gradient-to-br from-amber-400 to-orange-500 text-white border-orange-500 shadow-md shadow-amber-500/25"
                        : isActive 
                          ? "bg-background text-amber-500 border-amber-500 shadow-sm animate-pulse ring-4 ring-amber-500/10"
                          : "bg-muted text-muted-foreground/50 border-muted-foreground/20"
                    )}
                  >
                    {isCompleted ? (
                      <CheckCircle2 className="h-4.5 w-4.5 text-white" />
                    ) : isLast ? (
                      <Sparkles className="h-4 w-4 text-amber-500 animate-pulse" />
                    ) : (
                      <span>+{bonus}</span>
                    )}
                  </div>
                  
                  {/* Label Day */}
                  <span className={cn(
                    "text-[9px] mt-1.5 font-medium whitespace-nowrap",
                    isCompleted && "text-amber-600 dark:text-amber-400 font-bold",
                    isActive && "text-amber-500 animate-pulse font-bold",
                    !isCompleted && !isActive && "text-muted-foreground/50"
                  )}>
                    {locale === 'vi' ? `N. ${i + 1}` : `Day ${i + 1}`}
                  </span>
                  
                  {/* Jackpot indicator above Day 7 */}
                  {isLast && !isCompleted && (
                    <span className="absolute -top-4.5 text-[8px] text-amber-500 font-extrabold bg-amber-500/10 px-1 py-0.5 rounded-sm animate-bounce tracking-wider">
                      BONUS
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
