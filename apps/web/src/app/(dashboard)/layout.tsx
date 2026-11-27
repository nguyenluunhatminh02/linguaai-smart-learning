"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth-store";
import { useLanguageStore } from "@/stores/language-store";
import { useLearningLanguageStore } from "@/stores/learning-language-store";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { PageTransition } from "@/components/layout/page-transition";
import { Sparkles } from "lucide-react";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, isLoading, loadUser } = useAuthStore();
  const { t } = useLanguageStore();
  const router = useRouter();
  const hydrateLang = useLearningLanguageStore((s) => s.hydrate);

  useEffect(() => {
    loadUser();
    hydrateLang();
  }, [loadUser, hydrateLang]);

  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/login");
    }
  }, [isLoading, user, router]);

  if (isLoading) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex h-screen flex-col items-center justify-center gap-3 bg-background"
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl gradient-bg shadow-sm shadow-primary/15 animate-pulse-ring">
          <Sparkles className="h-6 w-6 text-white" />
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <p
            className="text-sm font-medium text-foreground/60"
            suppressHydrationWarning
          >
            {t.common.loading}
          </p>
          <p
            className="text-[11px] text-muted-foreground/50"
            suppressHydrationWarning
          >
            {t.common.loadingDesc}
          </p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex h-screen bg-background">
      {/* Skip-link for keyboard users: must be first focusable element */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:text-primary-foreground focus:shadow-lg"
      >
        {t.common.skipToContent || "Skip to main content"}
      </a>
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden md:pl-65">
        <Topbar />
        <main id="main-content" className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-6xl p-5 lg:p-6">
            <PageTransition>
              {children}
            </PageTransition>
          </div>
        </main>
      </div>
    </div>
  );
}
