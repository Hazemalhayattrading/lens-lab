/**
 * Minimal i18n: English is bundled, Arabic (strings + IBM Plex Sans Arabic) is lazy-loaded.
 * `t(key, params)` looks the key up in the active dictionary (falling back to English) and fills
 * `{name}` placeholders. Switching language sets <html lang/dir> (full RTL layout via CSS) and
 * notifies listeners so the UI can re-render.
 */
import { en, type Strings } from './en';

export type Lang = 'en' | 'ar';

let lang: Lang = 'en';
let dict: Partial<Strings> = en;
const listeners = new Set<(l: Lang) => void>();
const STORAGE_KEY = 'lens-lab.lang';

export type StringKey = keyof Strings;

export function t(key: StringKey, params?: Record<string, string | number>): string {
  let s: string = dict[key] ?? en[key] ?? key;
  if (params) s = s.replace(/\{(\w+)\}/g, (_, k: string) => (k in params ? String(params[k]) : `{${k}}`));
  return s;
}

/** True if the key exists (used for optional, data-driven keys). */
export function has(key: string): key is StringKey {
  return key in en;
}

export function getLang(): Lang {
  return lang;
}

export function isRTL(): boolean {
  return lang === 'ar';
}

export function onLangChange(cb: (l: Lang) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Language to start with: saved choice → ?lang= → browser language. */
export function initialLang(): Lang {
  const q = new URLSearchParams(location.search).get('lang');
  if (q === 'ar' || q === 'en') return q;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'ar' || saved === 'en') return saved;
  } catch {
    /* storage may be unavailable */
  }
  return (navigator.language || '').toLowerCase().startsWith('ar') ? 'ar' : 'en';
}

export async function setLang(next: Lang): Promise<void> {
  if (next === 'ar') {
    const [{ ar }] = await Promise.all([import('./ar'), import('./arabicFont')]);
    dict = ar;
    // make sure the glyphs are ready before canvas/HTML text is measured
    await Promise.race([document.fonts.load('500 16px "IBM Plex Sans Arabic"'), new Promise((r) => setTimeout(r, 1500))]);
  } else {
    dict = en;
  }
  lang = next;
  const html = document.documentElement;
  html.lang = next;
  html.dir = next === 'ar' ? 'rtl' : 'ltr';
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* ignore */
  }
  for (const cb of listeners) cb(next);
}
