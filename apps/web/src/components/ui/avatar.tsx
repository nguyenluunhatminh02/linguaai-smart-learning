import { cn } from '@/lib/utils';

interface AvatarProps {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const gradients = [
  'from-primary to-primary-light',
  'from-blue-500 to-cyan-500',
  'from-emerald-500 to-teal-500',
  'from-amber-500 to-orange-500',
  'from-gradient-start to-gradient-mid',
  'from-gradient-mid to-gradient-end',
];

export function Avatar({ name, size = 'md', className }: AvatarProps) {
  const initials = name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const colorIndex = name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % gradients.length;

  return (
    <div
      role="img"
      aria-label={name}
      className={cn(
        'inline-flex items-center justify-center rounded-full bg-linear-to-br font-semibold text-white select-none shadow-sm',
        gradients[colorIndex],
        {
          'h-8 w-8 text-[11px]': size === 'sm',
          'h-10 w-10 text-sm': size === 'md',
          'h-14 w-14 text-lg': size === 'lg',
        },
        className,
      )}
    >
      {initials}
    </div>
  );
}
