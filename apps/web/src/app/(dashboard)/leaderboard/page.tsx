'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Trophy, Medal, Crown, Flame, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguageStore } from '@/stores/language-store';
import { useAuthStore } from '@/stores/auth-store';
import { apiClient } from '@/lib/api-client';

type TimeFilter = 'thisWeek' | 'thisMonth' | 'allTime';

interface LeaderboardEntry {
  rank: number;
  displayName: string;
  xp: number;
  wordsLearned: number;
  streak: number;
  isCurrentUser?: boolean;
}

export default function LeaderboardPage() {
  const { t } = useLanguageStore();
  const { user } = useAuthStore();
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('thisWeek');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchLeaderboard = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiClient.get(`/analytics/leaderboard?limit=20&period=${timeFilter}`);
        const data: Array<{ id: string; displayName: string; totalXp: number; streakCount: number }> = res.data;

        const mapped = data.map((u, i) => ({
          rank: i + 1,
          displayName: u.displayName || `User ${i + 1}`,
          xp: u.totalXp || 0,
          wordsLearned: 0,
          streak: u.streakCount || 0,
          isCurrentUser: u.id === user?.id,
        }));
        setEntries(mapped);
      } catch {
        setError('Unable to load leaderboard. Please try again later.');
        setEntries([]);
      } finally {
        setLoading(false);
      }
    };

    fetchLeaderboard();
  }, [timeFilter, user?.id]);

  const getRankIcon = (rank: number) => {
    if (rank === 1) return <Crown className="h-5 w-5 text-amber-500" />;
    if (rank === 2) return <Medal className="h-5 w-5 text-gray-400" />;
    if (rank === 3) return <Medal className="h-5 w-5 text-amber-700" />;
    return null;
  };

  const getRankBg = (rank: number) => {
    if (rank === 1) return 'bg-amber-500/5 border-amber-500/20';
    if (rank === 2) return 'bg-gray-500/5 border-gray-500/20';
    if (rank === 3) return 'bg-amber-700/5 border-amber-700/20';
    return '';
  };

  const leaderboard = entries;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between animate-fade-in">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10">
            <Trophy className="h-5 w-5 text-amber-500" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{t.leaderboard.title}</h1>
            <p className="text-sm text-muted-foreground">{t.leaderboard.desc}</p>
          </div>
        </div>
      </div>

      {/* Time filter */}
      <div className="flex gap-2 animate-fade-in" style={{ animationDelay: '100ms' }}>
        {(['thisWeek', 'thisMonth', 'allTime'] as const).map((f) => (
          <Button
            key={f}
            variant={timeFilter === f ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTimeFilter(f)}
          >
            {t.leaderboard[f]}
          </Button>
        ))}
      </div>

      {/* Error state */}
      {error && !loading && (
        <Card className="animate-fade-in border-destructive/30 bg-destructive/5">
          <CardContent className="flex items-center gap-3 py-6">
            <AlertCircle className="h-5 w-5 text-destructive shrink-0" />
            <p className="text-sm text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {!loading && !error && leaderboard.length === 0 && (
        <Card className="animate-fade-in">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Trophy className="h-10 w-10 text-muted-foreground/40 mb-3" />
            <p className="text-sm font-medium">No learners yet</p>
            <p className="text-xs text-muted-foreground mt-1">Be the first to earn XP {t.leaderboard[timeFilter]}!</p>
          </CardContent>
        </Card>
      )}

      {/* Top 3 podium */}
      {leaderboard.length > 0 && (
        <div className="grid grid-cols-3 gap-4 animate-fade-in" style={{ animationDelay: '200ms' }}>
          {[1, 0, 2].map((idx) => {
            const entry = leaderboard[idx];
            if (!entry) return null;
            const isFirst = entry.rank === 1;
            return (
              <Card key={entry.rank} className={cn('text-center', isFirst && 'md:-mt-4', getRankBg(entry.rank))}>
                <CardContent className={cn('py-6 px-4', isFirst && 'py-8')}>
                  <div className="mx-auto mb-2">
                    {getRankIcon(entry.rank)}
                  </div>
                  <div className={cn(
                    'mx-auto flex items-center justify-center rounded-full bg-linear-to-br font-bold text-white mb-3',
                    isFirst ? 'h-16 w-16 text-xl from-amber-400 to-amber-600' : 'h-12 w-12 text-base from-gray-400 to-gray-600',
                  )}>
                    {entry.rank}
                  </div>
                  <p className={cn('font-semibold truncate', isFirst && 'text-lg')}>{entry.displayName}</p>
                  <p className="text-sm text-primary font-bold mt-1">{entry.xp.toLocaleString()} XP</p>
                  <div className="flex items-center justify-center gap-1 mt-1 text-xs text-muted-foreground">
                    <Flame className="h-3 w-3 text-orange-500" /> {entry.streak}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Rest of leaderboard */}
      {leaderboard.length > 0 && (
        <Card className="animate-fade-in" style={{ animationDelay: '300ms' }}>
          <CardContent className="p-0">
            <div className="grid grid-cols-[60px_1fr_100px_100px_80px] gap-2 px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider border-b border-border">
              <span>{t.leaderboard.rank}</span>
              <span>{t.leaderboard.user}</span>
              <span className="text-right">{t.leaderboard.xp}</span>
              <span className="text-right">{t.leaderboard.wordsLearned}</span>
              <span className="text-right">{t.leaderboard.streak}</span>
            </div>
            {leaderboard.slice(3).map((entry) => (
              <div
                key={entry.rank}
                className={cn(
                  'grid grid-cols-[60px_1fr_100px_100px_80px] gap-2 items-center px-4 py-3 border-b border-border/50 last:border-0 transition-colors hover:bg-accent/50',
                  entry.isCurrentUser && 'bg-primary/5 border-primary/20',
                )}
              >
                <span className="font-medium text-muted-foreground">#{entry.rank}</span>
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-bold">
                    {entry.displayName.charAt(0)}
                  </div>
                  <span className={cn('font-medium truncate', entry.isCurrentUser && 'text-primary')}>
                    {entry.displayName}
                    {entry.isCurrentUser && (
                      <Badge className="ml-2 bg-primary/10 text-primary text-[10px]">{t.leaderboard.you}</Badge>
                    )}
                  </span>
                </div>
                <span className="text-right font-semibold">{entry.xp.toLocaleString()}</span>
                <span className="text-right text-muted-foreground">{entry.wordsLearned}</span>
                <div className="flex items-center justify-end gap-1">
                  <Flame className="h-3 w-3 text-orange-500" />
                  <span className="text-sm">{entry.streak}</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
