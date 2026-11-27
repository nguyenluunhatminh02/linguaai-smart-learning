'use client';

import { useLanguageHydration } from '@/stores/language-store';

export function LanguageHydration() {
  useLanguageHydration();
  return null;
}
