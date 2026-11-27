import { create } from 'zustand';

export type LearningLanguage = 'english' | 'chinese' | 'japanese';

interface LearningLanguageState {
  language: LearningLanguage;
  setLanguage: (lang: LearningLanguage) => void;
  hydrate: () => void;
}

export const useLearningLanguageStore = create<LearningLanguageState>((set) => ({
  language: 'english',
  setLanguage: (language) => {
    try { localStorage.setItem('linguaai-learning-lang', language); } catch { /* ignore */ }
    set({ language });
  },
  hydrate: () => {
    try {
      const saved = localStorage.getItem('linguaai-learning-lang');
      if (saved === 'english' || saved === 'chinese' || saved === 'japanese') {
        set({ language: saved });
      }
    } catch { /* ignore */ }
  },
}));
