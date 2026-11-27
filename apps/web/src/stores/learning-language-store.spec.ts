import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('useLearningLanguageStore', () => {
  beforeEach(async () => {
    localStorage.clear();
    vi.clearAllMocks();
    
    const { useLearningLanguageStore } = await import('./learning-language-store');
    useLearningLanguageStore.setState({
      language: 'english',
    });
  });

  it('should initialize with language english', async () => {
    const { useLearningLanguageStore } = await import('./learning-language-store');
    const state = useLearningLanguageStore.getState();
    expect(state.language).toBe('english');
  });

  it('should change language and store in localStorage', async () => {
    const { useLearningLanguageStore } = await import('./learning-language-store');
    const store = useLearningLanguageStore.getState();
    
    store.setLanguage('chinese');
    
    expect(useLearningLanguageStore.getState().language).toBe('chinese');
    expect(localStorage.getItem('linguaai-learning-lang')).toBe('chinese');
  });

  it('should hydrate language from localStorage', async () => {
    localStorage.setItem('linguaai-learning-lang', 'japanese');
    
    const { useLearningLanguageStore } = await import('./learning-language-store');
    const store = useLearningLanguageStore.getState();
    
    store.hydrate();
    
    expect(useLearningLanguageStore.getState().language).toBe('japanese');
  });

  it('should not hydrate invalid language from localStorage', async () => {
    localStorage.setItem('linguaai-learning-lang', 'invalid-lang');
    
    const { useLearningLanguageStore } = await import('./learning-language-store');
    const store = useLearningLanguageStore.getState();
    
    store.hydrate();
    
    expect(useLearningLanguageStore.getState().language).toBe('english'); // Remains default
  });
});
