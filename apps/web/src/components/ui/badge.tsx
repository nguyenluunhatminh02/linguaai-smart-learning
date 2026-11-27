import React from 'react';
import { cn } from '@/lib/utils';

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline';
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium tracking-wide transition-colors',
        {
          'bg-primary/8 text-primary-dark dark:text-primary-light': variant === 'default',
          'bg-secondary text-secondary-foreground': variant === 'secondary',
          'bg-success/8 text-success': variant === 'success',
          'bg-warning/8 text-warning': variant === 'warning',
          'bg-destructive/8 text-destructive': variant === 'destructive',
          'border border-border/50 text-muted-foreground': variant === 'outline',
        },
        className,
      )}
      {...props}
    />
  );
}
