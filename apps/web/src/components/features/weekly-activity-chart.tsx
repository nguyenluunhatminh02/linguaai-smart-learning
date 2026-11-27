'use client';

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';

interface WeeklyActivity {
  date: string;
  xp: number;
  minutes: number;
}

interface WeeklyActivityChartProps {
  weeklyActivity: WeeklyActivity[];
  noActivityText: string;
}

export default function WeeklyActivityChart({ weeklyActivity, noActivityText }: WeeklyActivityChartProps) {
  if (!weeklyActivity || weeklyActivity.length === 0) {
    return (
      <div className="flex h-30 items-center justify-center">
        <p className="text-xs text-muted-foreground/50">{noActivityText}</p>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={120}>
      <BarChart data={weeklyActivity} barCategoryGap="30%">
        <XAxis
          dataKey="date"
          tickFormatter={(v: string) => {
            try {
              const [year, month, day] = v.split('-').map(Number);
              const d = new Date(year, month - 1, day);
              return d.toLocaleDateString(undefined, { weekday: 'short' });
            } catch {
              return v;
            }
          }}
          tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis hide />
        <Tooltip
          contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid hsl(var(--border))', backgroundColor: 'hsl(var(--background))' }}
          formatter={(value: number) => [`${value} XP`, 'XP']}
          labelFormatter={(label: string) => {
            try {
              const [year, month, day] = label.split('-').map(Number);
              const d = new Date(year, month - 1, day);
              return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
            } catch {
              return label;
            }
          }}
        />
        <Bar dataKey="xp" radius={[4, 4, 0, 0]}>
          {weeklyActivity.map((entry, i) => (
            <Cell
              key={`cell-${i}`}
              fill={entry.xp > 0 ? 'hsl(var(--primary))' : 'hsl(var(--muted))'}
              fillOpacity={entry.xp > 0 ? 0.85 : 0.3}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
