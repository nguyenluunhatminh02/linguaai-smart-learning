'use client';

import { cn } from '@/lib/utils';

interface FlagIconProps {
  country: string; // 'en' | 'vi' | 'zh' | 'ja' | 'ko' | 'english' | 'chinese' | 'japanese' | 'korean'
  className?: string;
}

export function FlagIcon({ country, className }: FlagIconProps) {
  const code = country.toLowerCase();

  // Vietnam Flag
  if (code === 'vi' || code === 'vietnamese') {
    return (
      <svg
        viewBox="0 0 3 2"
        aria-hidden="true"
        focusable="false"
        className={cn('inline-block rounded-xs shadow-xs border border-border/10', className)}
      >
        <rect width="3" height="2" fill="#da251d" />
        <polygon
          points="1.5,0.4 1.63,0.85 2.1,0.85 1.72,1.13 1.87,1.57 1.5,1.3 1.13,1.57 1.28,1.13 0.9,0.85 1.37,0.85"
          fill="#ffff00"
        />
      </svg>
    );
  }

  // China Flag
  if (code === 'zh' || code === 'chinese') {
    return (
      <svg
        viewBox="0 0 30 20"
        aria-hidden="true"
        focusable="false"
        className={cn('inline-block rounded-xs shadow-xs border border-border/10', className)}
      >
        <rect width="30" height="20" fill="#de2910" />
        <polygon points="5,2 5.5,3.8 7.3,3.8 5.8,4.9 6.3,6.7 5,5.6 3.7,6.7 4.2,4.9 2.7,3.8 4.5,3.8" fill="#ffde00" />
        <polygon points="10,2 10.3,2.9 11.2,2.9 10.5,3.4 10.7,4.3 10,3.7 9.3,4.3 9.5,3.4 8.8,2.9 9.7,2.9" fill="#ffde00" />
        <polygon points="12,4 12.3,4.9 13.2,4.9 12.5,5.4 12.7,6.3 12,5.7 11.3,6.3 11.5,5.4 10.8,4.9 11.7,4.9" fill="#ffde00" />
        <polygon points="12,7 12.3,7.9 13.2,7.9 12.5,8.4 12.7,9.3 12,8.7 11.3,9.3 11.5,8.4 10.8,7.9 11.7,7.9" fill="#ffde00" />
        <polygon points="10,9 10.3,9.9 11.2,9.9 10.5,10.4 10.7,11.3 10,10.7 9.3,11.3 9.5,10.4 8.8,9.9 9.7,9.9" fill="#ffde00" />
      </svg>
    );
  }

  // Japan Flag
  if (code === 'ja' || code === 'japanese') {
    return (
      <svg
        viewBox="0 0 3 2"
        aria-hidden="true"
        focusable="false"
        className={cn('inline-block rounded-xs shadow-xs border border-border/10', className)}
      >
        <rect width="3" height="2" fill="#fff" />
        <circle cx="1.5" cy="1" r="0.6" fill="#bc002d" />
      </svg>
    );
  }

  // Korea Flag
  if (code === 'ko' || code === 'korean') {
    return (
      <svg
        viewBox="0 0 30 20"
        aria-hidden="true"
        focusable="false"
        className={cn('inline-block rounded-xs shadow-xs border border-border/10', className)}
      >
        <rect width="30" height="20" fill="#fff" />
        {/* Taegeuk */}
        <path d="M 15,10 A 4,4 0 0 0 15,6 A 2,2 0 0 0 15,8 A 2,2 0 0 1 15,12 A 4,4 0 0 0 15,10" fill="#cd2e3a" />
        <path d="M 15,10 A 4,4 0 0 1 15,14 A 2,2 0 0 1 15,12 A 2,2 0 0 0 15,8 A 4,4 0 0 1 15,10" fill="#0047a0" />
        {/* Simplified trigrams */}
        <g stroke="#000" strokeWidth="1.2" strokeLinecap="round">
          <line x1="6" y1="5" x2="10" y2="5" />
          <line x1="6" y1="7" x2="10" y2="7" />
          <line x1="6" y1="9" x2="10" y2="9" />
          
          <line x1="20" y1="5" x2="24" y2="5" />
          <line x1="20" y1="7" x2="21.5" y2="7" /><line x1="22.5" y1="7" x2="24" y2="7" />
          <line x1="20" y1="9" x2="24" y2="9" />
          
          <line x1="6" y1="11" x2="10" y2="11" />
          <line x1="6" y1="13" x2="7.5" y2="13" /><line x1="8.5" y1="13" x2="10" y2="13" />
          <line x1="6" y1="15" x2="10" y2="15" />
          
          <line x1="20" y1="11" x2="21.5" y2="11" /><line x1="22.5" y1="11" x2="24" y2="11" />
          <line x1="20" y1="13" x2="21.5" y2="13" /><line x1="22.5" y1="13" x2="24" y2="13" />
          <line x1="20" y1="15" x2="21.5" y2="15" /><line x1="22.5" y1="15" x2="24" y2="15" />
        </g>
      </svg>
    );
  }

  // Default: US Flag (en / english)
  return (
    <svg
      viewBox="0 0 26 14"
      aria-hidden="true"
      focusable="false"
      className={cn('inline-block rounded-xs shadow-xs border border-border/10', className)}
    >
      <rect width="26" height="14" fill="#B22234" />
      <path d="M0,1h26 M0,3h26 M0,5h26 M0,7h26 M0,9h26 M0,11h26 M0,13h26" stroke="#fff" strokeWidth="1" />
      <rect width="11" height="8" fill="#3C3B6E" />
      <g fill="#fff">
        <circle cx="2" cy="2" r="0.4" />
        <circle cx="4" cy="2" r="0.4" />
        <circle cx="6" cy="2" r="0.4" />
        <circle cx="8" cy="2" r="0.4" />
        <circle cx="3" cy="4" r="0.4" />
        <circle cx="5" cy="4" r="0.4" />
        <circle cx="7" cy="4" r="0.4" />
        <circle cx="2" cy="6" r="0.4" />
        <circle cx="4" cy="6" r="0.4" />
        <circle cx="6" cy="6" r="0.4" />
        <circle cx="8" cy="6" r="0.4" />
      </g>
    </svg>
  );
}
