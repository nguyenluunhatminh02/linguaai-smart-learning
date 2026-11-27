const LOCALE_BY_LANG: Record<string, string> = {
  english: 'en-US',
  chinese: 'zh-CN',
  japanese: 'ja-JP',
  korean: 'ko-KR',
  vietnamese: 'vi-VN',
  french: 'fr-FR',
  spanish: 'es-ES',
};

/** Normalize a stored learning-language value into a BCP 47 TTS locale. */
function toSpeechLocale(lang: string): string {
  if (!lang) return '';
  return LOCALE_BY_LANG[lang.toLowerCase()] || lang;
}

export function detectLanguage(text: string, targetLanguage?: string): string {
  // The target language is the most reliable signal: the same Han characters
  // are valid in Japanese and Chinese, and TTS voices must match what the
  // learner is studying rather than the script alone.
  const preferred = toSpeechLocale(targetLanguage || '');
  if (preferred) {
    if (preferred.toLowerCase().startsWith('ja')) return 'ja-JP';
    if (preferred.toLowerCase().startsWith('zh')) return 'zh-CN';
    if (preferred.toLowerCase().startsWith('ko')) return 'ko-KR';
    if (preferred.toLowerCase().startsWith('vi')) return 'vi-VN';
  }

  // Japanese: Hiragana or Katakana — unambiguous Japanese-only scripts.
  if (/[぀-ゟ゠-ヿ]/.test(text)) {
    return 'ja-JP';
  }
  // Chinese: Han characters (including kanji-only Japanese when the target
  // locale is unset, which is the legacy auto-detection behaviour).
  if (/[一-鿿]/.test(text)) {
    return 'zh-CN';
  }
  // Vietnamese special characters
  if (/[àáảãạâầấẩẫậăằắẳẵặèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđĐ]/i.test(text)) {
    return 'vi-VN';
  }
  return preferred || 'en-US';
}

let activeUtterance: SpeechSynthesisUtterance | null = null;

/** Stop the current utterance, if it is still playing. */
export function stopSpeaking(): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  if (activeUtterance) {
    window.speechSynthesis.cancel();
    activeUtterance = null;
  }
}

/**
 * Speak a word or phrase. Utterances are queued by the browser so clicking a
 * second word does not cancel unrelated speech; call stopSpeaking() explicitly
 * when a replacement (rather than a second item) is intended.
 *
 * Pass `lang` (a locale or stored learning-language value) whenever the
 * caller knows the target language; auto-detection alone cannot distinguish
 * kanji-only Japanese from Chinese.
 */
export function speakWord(word: string, lang?: string, targetLanguage?: string) {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  const utter = new SpeechSynthesisUtterance(word);
  utter.lang = toSpeechLocale(lang || '') || detectLanguage(word, targetLanguage);
  utter.rate = 0.85;
  activeUtterance = utter;
  window.speechSynthesis.speak(utter);
}
