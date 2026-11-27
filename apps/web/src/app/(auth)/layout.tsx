'use client';

import { LanguageSwitcher } from '@/components/layout/language-switcher';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-40 -top-40 h-[550px] w-[550px] rounded-full bg-gradient-to-br from-primary/[0.12] via-gradient-mid/[0.08] to-transparent blur-[120px] animate-float" />
        <div className="absolute -bottom-32 -right-32 h-[500px] w-[500px] rounded-full bg-gradient-to-tl from-gradient-end/[0.12] via-primary/[0.06] to-transparent blur-[120px] animate-float delay-500" />
        <div className="absolute left-1/2 top-1/4 h-[350px] w-[350px] -translate-x-1/2 rounded-full bg-gradient-to-br from-gradient-mid/[0.06] to-transparent blur-[100px] animate-float delay-300" />
      </div>

      <div
        className="pointer-events-none absolute inset-0 opacity-[0.015]"
        style={{
          backgroundImage:
            'radial-gradient(circle, rgba(88,204,2,0.5) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }}
      />

      <div className="absolute top-5 right-5 z-20">
        <LanguageSwitcher />
      </div>

      <div className="relative z-10 w-full max-w-[420px] px-5 animate-fade-in-up">
        {children}
      </div>
    </div>
  );
}
