import { useSyncExternalStore } from 'react';
import { configPreference } from '../desktop/config';
import { zh } from './zh';
export type Language = 'en' | 'zh-CN';
const key = 'local-music-language';
const initial = (): Language => { try { const saved = localStorage.getItem(key); if (saved === 'en' || saved === 'zh-CN') return saved; } catch { /* Use system language. */ } return navigator.language.startsWith('zh') ? 'zh-CN' : 'en'; };
let language = initial(), error = '', revision = 0;
let snapshot = { language, error };
const listeners = new Set<() => void>();
function publish() { document.documentElement.lang = language; snapshot = { language, error }; listeners.forEach(fn => fn()); }
export function t(text: string, ...values: unknown[]): string {
  const translated = language === 'zh-CN' ? zh[text] ?? text : text;
  return values.length ? translated.replace(/\{(\d+)\}/g, (match, i) => Number(i) < values.length ? String(values[Number(i)] ?? '') : match) : translated;
}
export const useLanguage = () => useSyncExternalStore(fn => { listeners.add(fn); return () => { listeners.delete(fn); }; }, () => snapshot);
export async function setLanguage(next: Language) {
  const current = ++revision; language = next === 'zh-CN' ? 'zh-CN' : 'en'; error = ''; publish();
  try { if (window.localMusicDesktop) await window.localMusicDesktop.setConfig('language',language); else localStorage.setItem(key,language); }
  catch { if(current===revision) { error = 'Language changed for this session but could not be saved.'; publish(); } }
}
export async function initializeLanguage() {
  const current = revision, value = await configPreference('language',language);
  if(current===revision) { language=value==='zh-CN'?'zh-CN':'en';publish(); }
}
publish();
