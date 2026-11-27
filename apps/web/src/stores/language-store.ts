import { create } from 'zustand';
import { useEffect } from 'react';
import type { Locale, Translations } from '@/lib/i18n/types';
import { en } from '@/lib/i18n/en';
import { vi } from '@/lib/i18n/vi';
import { zh } from '@/lib/i18n/zh';
import { ja } from '@/lib/i18n/ja';
import { ko } from '@/lib/i18n/ko';

const translations: Record<Locale, Translations> = { en, vi, zh, ja, ko };

interface LanguageState {
  locale: Locale;
  t: Translations;
  setLocale: (locale: Locale) => void;
}

export const useLanguageStore = create<LanguageState>((set) => ({
  locale: 'en',
  t: translations['en'],
  setLocale: (locale: Locale) => {
    try { localStorage.setItem('linguaai-locale', locale); } catch { /* ignore */ }
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale === 'zh' ? 'zh-CN' : locale;
    }
    set({ locale, t: translations[locale] });
  },
}));

/** Call once in the root layout to sync locale from localStorage after hydration */
export function useLanguageHydration() {
  useEffect(() => {
    try {
      const saved = localStorage.getItem('linguaai-locale');
      if (saved && saved in translations) {
        useLanguageStore.getState().setLocale(saved as Locale);
      }
    } catch { /* private browsing / disabled localStorage */ }
  }, []);
}
