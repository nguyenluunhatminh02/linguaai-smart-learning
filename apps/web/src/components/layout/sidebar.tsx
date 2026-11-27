"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import {
  LayoutDashboard,
  BookOpen,
  PenTool,
  BookText,
  Languages,
  MessageCircle,
  HelpCircle,
  UserCircle,
  Shield,
  Sparkles,
  BookMarked,
  Zap,
  Headphones,
  AlertTriangle,
  Trophy,
  Target,
  CreditCard,
  ArrowRightLeft,
  ChevronDown,
  Mic,
  Menu,
  X,
} from "lucide-react";
import { useAuthStore } from "@/stores/auth-store";
import { useLanguageStore } from "@/stores/language-store";
import {
  useLearningLanguageStore,
  type LearningLanguage,
} from "@/stores/learning-language-store";
import { useState, useCallback, useEffect, useRef } from "react";
import { useClickOutside } from "@/hooks/use-click-outside";
import { FlagIcon } from "@/components/ui/flag-icon";

// Target-language switcher (different from UI locale).
// Only languages with dedicated content routes are listed here. UI locale supports 5 (en/vi/zh/ja/ko).
const languageOptions: { id: LearningLanguage; flag: string; label: string }[] =
  [
    { id: "english", flag: "\u{1F1FA}\u{1F1F8}", label: "English" }, // 🇺🇸
    { id: "chinese", flag: "\u{1F1E8}\u{1F1F3}", label: "Chinese" }, // 🇨🇳
    { id: "japanese", flag: "\u{1F1EF}\u{1F1F5}", label: "Japanese" }, // 🇯🇵
  ];

const learningNavByLang: Record<
  LearningLanguage,
  { href: string; key: string; icon: typeof BookOpen }[]
> = {
  english: [
    { href: "/flashcards", key: "flashcards", icon: BookOpen },
    { href: "/vocabulary", key: "vocabulary", icon: BookMarked },
    { href: "/writing", key: "writing", icon: PenTool },
    { href: "/reading", key: "reading", icon: BookText },
    { href: "/grammar", key: "grammar", icon: Languages },
    { href: "/listening", key: "listening", icon: Headphones },
    { href: "/speaking", key: "speaking", icon: Mic },
    { href: "/translation", key: "translation", icon: ArrowRightLeft },
    { href: "/chat", key: "aiTutor", icon: MessageCircle },
  ],
  chinese: [
    { href: "/chinese", key: "zhHub", icon: BookOpen },
    { href: "/flashcards", key: "flashcards", icon: BookOpen },
    { href: "/chinese/vocabulary", key: "zhVocabulary", icon: BookMarked },
    { href: "/writing", key: "writing", icon: PenTool },
    { href: "/chinese/reading", key: "zhReading", icon: BookText },
    { href: "/chinese/grammar", key: "zhGrammar", icon: Languages },
    { href: "/listening", key: "listening", icon: Headphones },
    { href: "/speaking", key: "speaking", icon: Mic },
    {
      href: "/chinese/translation",
      key: "zhTranslation",
      icon: ArrowRightLeft,
    },
    { href: "/chat", key: "aiTutor", icon: MessageCircle },
  ],
  japanese: [
    { href: "/japanese", key: "jaHub", icon: BookOpen },
    { href: "/flashcards", key: "flashcards", icon: BookOpen },
    { href: "/japanese/vocabulary", key: "jaVocabulary", icon: BookMarked },
    { href: "/writing", key: "writing", icon: PenTool },
    { href: "/japanese/reading", key: "jaReading", icon: BookText },
    { href: "/japanese/grammar", key: "jaGrammar", icon: Languages },
    { href: "/listening", key: "listening", icon: Headphones },
    { href: "/speaking", key: "speaking", icon: Mic },
    {
      href: "/japanese/translation",
      key: "jaTranslation",
      icon: ArrowRightLeft,
    },
    { href: "/chat", key: "aiTutor", icon: MessageCircle },
  ],
};

const toolsNav = [
  { href: "/speed-review", key: "speedReview" as const, icon: Zap },
  {
    href: "/difficult-words",
    key: "difficultWords" as const,
    icon: AlertTriangle,
  },
  { href: "/quiz", key: "quiz" as const, icon: HelpCircle },
];

const generalNav = [
  { href: '/goals', key: 'goals' as const, icon: Target },
  { href: '/leaderboard', key: 'leaderboard' as const, icon: Trophy },
  { href: '/pricing', key: 'pricing' as const, icon: CreditCard },
  { href: '/profile', key: 'profile' as const, icon: UserCircle },
];

interface SidebarSectionProps {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

function SidebarSection({ title, isOpen, onToggle, children }: SidebarSectionProps) {
  // Stable id from the visible, localised title so aria-controls stays valid
  // across renders and locale changes.
  const panelId = `sidebar-section-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
  return (
    <div className="mt-3.5 first:mt-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={panelId}
        className="flex w-full items-center justify-between px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50 hover:text-foreground transition-colors duration-200 cursor-pointer"
      >
        <span>{title}</span>
        <ChevronDown
          className={cn(
            "h-3 w-3 text-muted-foreground/45 transition-transform duration-200",
            isOpen && "rotate-180"
          )}
        />
      </button>
      {isOpen && (
        <div id={panelId} className="mt-1 space-y-0.5 animate-scale-in">
          {children}
        </div>
      )}
    </div>
  );
}

function SidebarContent({ onCloseMobile }: { onCloseMobile?: () => void }) {
  const pathname = usePathname();
  const { user } = useAuthStore();
  const { t, locale } = useLanguageStore();
  const { language, setLanguage } = useLearningLanguageStore();
  const [langOpen, setLangOpen] = useState(false);
  const langTriggerRef = useRef<HTMLButtonElement>(null);
  const langPanelRef = useRef<HTMLDivElement>(null);

  const [coreOpen, setCoreOpen] = useState(true);
  const [skillsOpen, setSkillsOpen] = useState(true);
  const [toolsOpen, setToolsOpen] = useState(true);

  const closeDropdown = useCallback(() => {
    setLangOpen(false);
    langTriggerRef.current?.focus();
  }, []);
  const dropdownRef = useClickOutside(() => setLangOpen(false));

  // Escape closes the language popover and returns focus to its trigger.
  useEffect(() => {
    if (!langOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setLangOpen(false);
        langTriggerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [langOpen]);

  // Move focus into the popover when it opens so keyboard users can act.
  useEffect(() => {
    if (langOpen) {
      langPanelRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    }
  }, [langOpen]);

  const currentLang =
    languageOptions.find((l) => l.id === language) ?? languageOptions[0];
  const learningItems = learningNavByLang[language];

  const navLabel = (key: string): string => {
    if (key in t.nav) return t.nav[key as keyof typeof t.nav];
    return key;
  };

  const coreKeys = ["flashcards", "vocabulary", "aiTutor", "zhHub", "jaHub", "zhVocabulary", "jaVocabulary"];
  const skillsKeys = ["writing", "reading", "speaking", "listening", "zhReading", "jaReading"];
  const referenceKeys = ["grammar", "translation", "zhGrammar", "jaGrammar", "zhTranslation", "jaTranslation", "speedReview", "difficultWords", "quiz"];

  const coreItems = learningItems.filter((item) => coreKeys.includes(item.key));
  const skillsItems = learningItems.filter((item) => skillsKeys.includes(item.key));
  const toolsItems = [
    ...learningItems.filter((item) => referenceKeys.includes(item.key)),
    ...toolsNav.map((item) => ({
      href: item.href,
      key: item.key,
      icon: item.icon,
    }))
  ];

  return (
    <>
      <div className="flex h-16 items-center justify-between gap-3 px-5">
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl gradient-bg shadow-sm shadow-primary/15 transition-transform duration-200 group-hover:scale-105">
            <Sparkles className="h-4.5 w-4.5 text-white" />
          </div>
          <span className="text-lg font-bold gradient-text">LinguaAI</span>
        </Link>
        {onCloseMobile && (
          <button
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted/60 md:hidden transition-colors"
            onClick={onCloseMobile}
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-3">
        <div className="space-y-0.5">
          <NavLink
            href="/dashboard"
            icon={LayoutDashboard}
            label={t.nav.dashboard}
            pathname={pathname}
          />
        </div>

        <div className="mt-2 pt-2">
          <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
            {t.nav.language || "Language"}
          </p>
          <div ref={dropdownRef} className="relative mb-1">
            <button
              ref={langTriggerRef}
              type="button"
              onClick={() => setLangOpen(!langOpen)}
              aria-haspopup="listbox"
              aria-expanded={langOpen}
              aria-controls="sidebar-language-options"
              aria-label={t.nav.language || "Language"}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-all duration-200 hover:bg-muted/50"
            >
              <FlagIcon country={currentLang.id} className="h-3.5 w-5 shrink-0" />
              <span className="flex-1 text-left text-sidebar-foreground">
                {t.languages[language]}
              </span>
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 text-muted-foreground/60 transition-transform duration-200",
                  langOpen && "rotate-180",
                )}
              />
            </button>

            {langOpen && (
              <div
                id="sidebar-language-options"
                ref={langPanelRef}
                role="listbox"
                aria-label={t.nav.language || "Language"}
                className="absolute left-0 right-0 top-full z-50 mt-1 rounded-xl border border-border/50 bg-popover p-1 shadow-lg animate-scale-in"
              >
                {languageOptions.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    role="option"
                    aria-selected={language === opt.id}
                    onClick={() => {
                      setLanguage(opt.id);
                      setLangOpen(false);
                      langTriggerRef.current?.focus();
                    }}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                      language === opt.id
                        ? "bg-primary/6 text-primary-dark font-medium"
                        : "hover:bg-muted/50 text-foreground",
                    )}
                  >
                    <FlagIcon country={opt.id} className="h-3.5 w-5 shrink-0" />
                    <span>{t.languages[opt.id]}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Collapsible Study Sections */}
        <div className="mt-3.5 space-y-3.5">
          {coreItems.length > 0 && (
            <SidebarSection
              title={t.nav.coreStudy}
              isOpen={coreOpen}
              onToggle={() => setCoreOpen(!coreOpen)}
            >
              {coreItems.map(({ href, key, icon: Icon }) => (
                <NavLink
                  key={href}
                  href={href}
                  icon={Icon}
                  label={navLabel(key)}
                  pathname={pathname}
                />
              ))}
            </SidebarSection>
          )}

          {skillsItems.length > 0 && (
            <SidebarSection
              title={t.nav.skillsPractice}
              isOpen={skillsOpen}
              onToggle={() => setSkillsOpen(!skillsOpen)}
            >
              {skillsItems.map(({ href, key, icon: Icon }) => (
                <NavLink
                  key={href}
                  href={href}
                  icon={Icon}
                  label={navLabel(key)}
                  pathname={pathname}
                />
              ))}
            </SidebarSection>
          )}

          {toolsItems.length > 0 && (
            <SidebarSection
              title={t.nav.toolsReference}
              isOpen={toolsOpen}
              onToggle={() => setToolsOpen(!toolsOpen)}
            >
              {toolsItems.map(({ href, key, icon: Icon }) => (
                <NavLink
                  key={href}
                  href={href}
                  icon={Icon}
                  label={key in t.nav ? t.nav[key as keyof typeof t.nav] : navLabel(key)}
                  pathname={pathname}
                />
              ))}
            </SidebarSection>
          )}
        </div>

        {/* Account / General (Goals, Leaderboard, Profile) */}
        <div className="mt-4 pt-3 border-t border-border/20 space-y-0.5">
          <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
            {t.nav.account}
          </p>
          {generalNav.map(({ href, key, icon: Icon }) => (
            <NavLink
              key={href}
              href={href}
              icon={Icon}
              label={t.nav[key]}
              pathname={pathname}
            />
          ))}
        </div>

        {/* Admin section */}
        {user?.role?.toLowerCase() === "admin" && (
          <div className="mt-4 pt-3 border-t border-border/20">
            <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
              {t.common.admin}
            </p>
            <NavLink
              href="/admin"
              icon={Shield}
              label={t.common.adminPanel || "Quản trị"}
              pathname={pathname}
            />
          </div>
        )}
      </nav>

      <div className="px-5 py-4 text-center border-t border-border/10">
        <p className="text-[10px] text-muted-foreground/50 font-medium">
          {t.common.poweredBy} <span className="font-semibold text-foreground/60">{t.common.poweredByDesc || "Groq + FSRS"}</span>
        </p>
      </div>
    </>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const mobileDrawerRef = useRef<HTMLElement>(null);

  const closeMobile = useCallback(() => {
    setMobileOpen(false);
    // Return focus to the trigger after the drawer closes.
    menuButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
      // Move focus into the drawer (Close button) when it opens.
      mobileDrawerRef.current?.querySelector<HTMLButtonElement>('[aria-label="Close menu"]')?.focus();
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  // Escape closes the drawer and restores focus to the Menu button.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeMobile();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen, closeMobile]);

  return (
    <>
      <button
        ref={menuButtonRef}
        type="button"
        className="fixed left-4 top-4 z-50 rounded-xl border border-border/50 bg-background/90 p-2 shadow-sm backdrop-blur-sm md:hidden transition-all hover:shadow-md"
        onClick={() => setMobileOpen(true)}
        aria-label="Open menu"
        aria-haspopup="dialog"
        aria-expanded={mobileOpen}
        aria-controls="mobile-sidebar-drawer"
      >
        <Menu className="h-5 w-5" />
      </button>

      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm md:hidden animate-fade-in"
          onClick={closeMobile}
          aria-hidden="true"
        />
      )}

      <aside className="fixed left-0 top-0 z-40 hidden h-screen w-65 flex-col bg-sidebar md:flex">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-primary/[0.03] to-transparent" />
        <div className="relative flex h-full flex-col">
          <SidebarContent />
        </div>
      </aside>

      <aside
        id="mobile-sidebar-drawer"
        ref={mobileDrawerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
        aria-hidden={!mobileOpen}
        inert={!mobileOpen ? true : undefined}
        className={cn(
          "fixed left-0 top-0 z-50 h-screen w-65 flex-col bg-sidebar transition-transform duration-300 ease-out md:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-primary/[0.03] to-transparent" />
        <div className="relative flex h-full flex-col">
          <SidebarContent onCloseMobile={closeMobile} />
        </div>
      </aside>
    </>
  );
}

function NavLink({
  href,
  icon: Icon,
  label,
  pathname,
}: {
  href: string;
  icon: typeof LayoutDashboard;
  label: string;
  pathname: string;
}) {
  const hubRoutes = ["/dashboard", "/", "/chinese", "/japanese"];
  const isActive =
    pathname === href ||
    (!hubRoutes.includes(href) && pathname.startsWith(href + "/"));
  const isExact = pathname === href;
  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "group relative flex items-center gap-3 rounded-xl px-3 py-[7px] text-[13px] font-medium transition-all duration-200",
        isActive || isExact
          ? "text-primary-dark"
          : "text-sidebar-foreground/80 hover:text-foreground",
      )}
    >
      {(isActive || isExact) && (
        <motion.div
          layoutId="sidebar-active-pill"
          className="absolute inset-0 rounded-xl bg-primary/[0.07]"
          initial={false}
          transition={{ type: "spring", stiffness: 350, damping: 30 }}
        />
      )}
      <Icon
        className={cn(
          "relative z-10 h-[18px] w-[18px] transition-all duration-200",
          isActive || isExact
            ? "text-primary-dark"
            : "text-muted-foreground group-hover:text-foreground/70",
        )}
      />
      <span className="relative z-10 truncate">{label}</span>
      {(isActive || isExact) && (
        <div className="relative z-10 ml-auto h-1.5 w-1.5 rounded-full bg-primary/50" />
      )}
    </Link>
  );
}
