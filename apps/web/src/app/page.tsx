'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { BookOpen, PenTool, MessageCircle, Brain, Globe, Sparkles, ArrowRight, Zap, Shield } from 'lucide-react';
import { useLanguageStore } from '@/stores/language-store';
import { useAuthStore } from '@/stores/auth-store';
import { LanguageSwitcher } from '@/components/layout/language-switcher';

export default function LandingPage() {
  const { t } = useLanguageStore();
  const { user } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    if (user) {
      router.replace('/dashboard');
    }
  }, [user, router]);

  const features = [
    {
      icon: Brain,
      title: t.landing.featureFlashcards,
      desc: t.landing.featureFlashcardsDesc,
      bgColor: 'bg-blue-500/[0.07]',
      iconColor: 'text-blue-500',
    },
    {
      icon: PenTool,
      title: t.landing.featureWriting,
      desc: t.landing.featureWritingDesc,
      bgColor: 'bg-emerald-500/[0.07]',
      iconColor: 'text-emerald-500',
    },
    {
      icon: MessageCircle,
      title: t.landing.featureAITutor,
      desc: t.landing.featureAITutorDesc,
      bgColor: 'bg-violet-500/[0.07]',
      iconColor: 'text-violet-500',
    },
    {
      icon: BookOpen,
      title: t.landing.featureReading,
      desc: t.landing.featureReadingDesc,
      bgColor: 'bg-orange-500/[0.07]',
      iconColor: 'text-orange-500',
    },
    {
      icon: Globe,
      title: t.landing.featureGrammar,
      desc: t.landing.featureGrammarDesc,
      bgColor: 'bg-pink-500/[0.07]',
      iconColor: 'text-pink-500',
    },
    {
      icon: Zap,
      title: t.landing.featureQuiz,
      desc: t.landing.featureQuizDesc,
      bgColor: 'bg-indigo-500/[0.07]',
      iconColor: 'text-indigo-500',
    },
  ];

  const stats = [
    { label: t.landing.statModules, value: '12+' },
    { label: t.landing.statLanguages, value: '7' },
    { label: t.landing.statAI, value: 'Local' },
    { label: t.landing.statPrivacy, value: '100%' },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-50 border-b border-border/30 bg-background/70 backdrop-blur-2xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl gradient-bg shadow-sm shadow-primary/15 transition-transform duration-200 group-hover:scale-105">
              <Sparkles className="h-4.5 w-4.5 text-white" />
            </div>
            <span className="text-lg font-bold gradient-text">LinguaAI</span>
          </Link>
          <div className="flex items-center gap-2">
            <LanguageSwitcher compact />
            <Link
              href="/pricing"
              className="hidden rounded-lg px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground hover:bg-muted/50 sm:block"
            >
              {t.nav.pricing}
            </Link>
            <Link
              href="/login"
              className="rounded-lg px-4 py-2 text-sm font-medium text-foreground/80 transition-colors hover:text-foreground hover:bg-muted/50"
            >
              {t.auth.signIn}
            </Link>
            <Link
              href="/register"
              className="inline-flex items-center gap-2 rounded-xl gradient-bg px-5 py-2 text-sm font-medium text-white shadow-sm shadow-primary/15 transition-all hover:shadow-md hover:shadow-primary/20 hover:brightness-105"
            >
              {t.landing.startFree} <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -top-40 right-0 h-[500px] w-[500px] rounded-full bg-primary/[0.04] blur-[100px]" />
          <div className="absolute -bottom-40 left-0 h-[400px] w-[400px] rounded-full bg-violet-500/[0.04] blur-[100px]" />
          <div className="absolute left-1/2 top-1/3 h-[300px] w-[300px] -translate-x-1/2 rounded-full bg-fuchsia-500/[0.03] blur-[80px]" />
        </div>

        <div className="relative mx-auto max-w-7xl px-6 py-20 lg:py-28">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/[0.04] px-4 py-1.5 text-sm animate-fade-in">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span className="font-medium text-primary/80">{t.landing.badge}</span>
            </div>

            <h1 className="text-4xl font-extrabold tracking-tight text-foreground sm:text-5xl lg:text-6xl animate-fade-in-up leading-[1.1]">
              {t.landing.heroTitle1}{' '}
              <span className="gradient-text">{t.landing.heroTitle2}</span>
              <br />
              <span className="text-foreground/90">{t.landing.heroTitle3}</span>
            </h1>

            <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg animate-fade-in-up delay-150">
              {t.landing.heroDesc}
            </p>

            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center animate-fade-in-up delay-300">
              <Link
                href="/register"
                className="inline-flex items-center gap-2 rounded-2xl gradient-bg px-7 py-3.5 text-base font-semibold text-white shadow-md shadow-primary/15 transition-all hover:shadow-lg hover:shadow-primary/20 hover:brightness-105 active:scale-[0.98]"
              >
                {t.landing.startFree} <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-2xl border border-border/60 bg-background px-7 py-3.5 text-base font-medium text-foreground/80 transition-all hover:bg-muted/40 hover:border-border active:scale-[0.98]"
              >
                {t.landing.haveAccount}
              </Link>
            </div>
          </div>

          <div className="mx-auto mt-16 grid max-w-xl grid-cols-2 gap-3 sm:grid-cols-4 animate-fade-in-up delay-500">
            {stats.map((stat) => (
              <div key={stat.label} className="rounded-2xl border border-border/40 bg-card/60 backdrop-blur-sm p-4 text-center">
                <p className="text-xl font-bold gradient-text">{stat.value}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground/70">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-border/30 py-20">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              {t.landing.featuresTitle}
            </h2>
            <p className="mt-3 text-muted-foreground/80">
              {t.landing.featuresDesc}
            </p>
          </div>

          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature, i) => (
              <div
                key={feature.title}
                className="group rounded-2xl border border-border/40 bg-card p-6 transition-all duration-300 hover:shadow-md hover:-translate-y-0.5 hover:border-border/80 animate-fade-in-up"
                style={{ animationDelay: `${i * 75}ms` }}
              >
                <div className={`mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl ${feature.bgColor}`}>
                  <feature.icon className={`h-5 w-5 ${feature.iconColor}`} />
                </div>
                <h3 className="text-base font-semibold">{feature.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground/80">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20">
        <div className="mx-auto max-w-7xl px-6">
          <div className="relative overflow-hidden rounded-3xl gradient-bg p-10 text-center shadow-xl shadow-primary/10 sm:p-14">
            <div className="pointer-events-none absolute inset-0 bg-linear-to-t from-black/[0.06] to-transparent" />
            <div className="pointer-events-none absolute -right-20 -top-20 h-60 w-60 rounded-full bg-white/[0.06]" />
            <div className="pointer-events-none absolute -bottom-12 -left-12 h-40 w-40 rounded-full bg-white/[0.04]" />
            <div className="relative">
              <h2 className="text-2xl font-bold text-white sm:text-3xl">
                {t.landing.ctaTitle}
              </h2>
              <p className="mx-auto mt-3 max-w-md text-base text-white/75">
                {t.landing.ctaDesc}
              </p>
              <Link
                href="/register"
                className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-white px-7 py-3.5 text-base font-semibold text-primary shadow-lg transition-all hover:bg-white/90 active:scale-[0.98]"
              >
                {t.landing.ctaButton} <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-border/30 py-6">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-6 sm:flex-row">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-lg gradient-bg">
              <Sparkles className="h-3.5 w-3.5 text-white" />
            </div>
            <span className="text-sm font-semibold gradient-text">LinguaAI</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
            <Shield className="h-3.5 w-3.5" />
            <span>{t.landing.footerLocal}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
