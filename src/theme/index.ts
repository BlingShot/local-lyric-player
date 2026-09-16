import { useSyncExternalStore } from 'react';
import { configPreference } from '../desktop/config';

export type ThemeMode = 'dark' | 'light';
export const appLogoPaths: Record<ThemeMode, string> = { dark: '/images/app-logo.svg', light: '/images/app-logo-light.svg' };
const key = 'local-music-theme';
const read = (): ThemeMode => { try { return localStorage.getItem(key) === 'light' ? 'light' : 'dark'; } catch { return 'dark'; } };
let state = { mode: read(), error: '' };
const listeners = new Set<() => void>();
const apply = () => {
  document.documentElement.dataset.theme = state.mode;
  if (window.localMusicDesktop) {
    document.documentElement.dataset.desktop = 'true';
    void window.localMusicDesktop.setWindowTheme(state.mode).catch(error => console.error('Window theme could not be applied:', error));
  }
  document.querySelector('link[rel=icon]')?.setAttribute('href', appLogoPaths[state.mode]);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', state.mode === 'light' ? '#f0f2f4' : '#000000');
};
apply();
let revision = 0, writes = Promise.resolve();
export async function initializeThemeConfig() {
  const request = revision;
  try { const mode = await configPreference('theme', state.mode); if (request === revision && ['dark', 'light'].includes(mode)) { state = { mode, error: '' }; apply(); listeners.forEach(listener => listener()); } }
  catch (error) { state = { ...state, error: error instanceof Error ? error.message : 'Theme settings could not be restored.' }; listeners.forEach(listener => listener()); }
}
export async function setThemeMode(mode: ThemeMode) {
  if (mode !== 'light' && mode !== 'dark') return;
  const request = ++revision;
  state = { mode, error: '' }; apply(); listeners.forEach(listener => listener());
  writes = writes.catch(() => {}).then(async () => { if (window.localMusicDesktop) await window.localMusicDesktop.setConfig('theme', mode); else localStorage.setItem(key, mode); });
  try { await writes; } catch {
    if (request === revision) { state = { ...state, error: 'Theme changed for this session, but could not be saved. Check config.json and folder access.' }; listeners.forEach(listener => listener()); }
  }
}
window.addEventListener('storage', event => {
  if (event.key !== key) return;
  state = { mode: read(), error: '' }; apply(); listeners.forEach(listener => listener());
});
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const useAppTheme = () => useSyncExternalStore(subscribe, () => state);
