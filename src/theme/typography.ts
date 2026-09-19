import { useSyncExternalStore } from 'react';
import type { FontTarget } from './fonts';
export interface FontAxes { weight: number; stretch: number; spacing: number; italic: boolean }
type Typography = Record<FontTarget, FontAxes>;
const defaults: Typography = { app: { weight: 400, stretch: 100, spacing: 0, italic: false }, 'app-cjk': { weight: 400, stretch: 100, spacing: 0, italic: false }, lyrics: { weight: 800, stretch: 100, spacing: 0, italic: false }, 'lyrics-cjk': { weight: 800, stretch: 100, spacing: 0, italic: false } };
let state = { values: defaults, error: '' }; const listeners = new Set<() => void>(); let queue: Promise<unknown> = Promise.resolve(), revision = 0;
export const useTypography = () => useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => state);
export function validAxes(value: Partial<FontAxes> | undefined, fallback: FontAxes): FontAxes {
  const clamp = (v: number | undefined, min: number, max: number, initial: number) => Number.isFinite(v) ? Math.max(min, Math.min(max, v!)) : initial;
  return { weight: clamp(value?.weight, 100, 900, fallback.weight), stretch: clamp(value?.stretch, 75, 125, 100), spacing: clamp(value?.spacing, -.04, .15, 0), italic: value?.italic === true };
}
function publish() {
  for (const target of ['app', 'app-cjk', 'lyrics', 'lyrics-cjk'] as const) { const axes = state.values[target], style = document.documentElement.style; style.setProperty(`--${target}-weight`, String(axes.weight)); style.setProperty(`--${target}-stretch`, `${axes.stretch}%`); style.setProperty(`--${target}-spacing`, `${axes.spacing}em`); style.setProperty(`--${target}-style`, axes.italic ? 'italic' : 'normal'); }
  listeners.forEach(listener => listener()); window.dispatchEvent(new Event('lyric-typography-updated'));
}
export async function initializeTypography() {
  const initial = revision;
  try { const saved = window.localMusicDesktop ? await window.localMusicDesktop.getConfig<Typography>('typography') : JSON.parse(localStorage.getItem('typography') || 'null'); if (initial !== revision) return; state = { values: { app: validAxes(saved?.app, defaults.app), 'app-cjk': validAxes(saved?.['app-cjk'], defaults['app-cjk']), lyrics: validAxes(saved?.lyrics, defaults.lyrics), 'lyrics-cjk': validAxes(saved?.['lyrics-cjk'], defaults['lyrics-cjk']) }, error: '' }; publish(); }
  catch { state = { ...state, error: 'Typography could not be restored. Defaults are in use.' }; publish(); }
}
export function updateTypography(target: FontTarget, patch: Partial<FontAxes>) {
  revision++; const values = { ...state.values, [target]: validAxes({ ...state.values[target], ...patch }, defaults[target]) }; state = { values, error: '' }; publish();
  queue = queue.catch(() => {}).then(async () => { if (window.localMusicDesktop) await window.localMusicDesktop.setConfig('typography', values); else localStorage.setItem('typography', JSON.stringify(values)); });
  void queue.catch(() => { state = { ...state, error: 'Typography changed but could not be saved.' }; publish(); });
}
