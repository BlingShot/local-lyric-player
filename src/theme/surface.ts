import { useSyncExternalStore } from 'react';
import { configPreference } from '../desktop/config';
const key = 'local-music-glass';
const read = () => { try { return localStorage.getItem(key) === 'true'; } catch { return false; } };
let state = { glass: read(), error: '' }, revision = 0;
const listeners = new Set<() => void>();
const apply = () => { document.documentElement.dataset.glass = String(state.glass); listeners.forEach(listener => listener()); };
apply();
export async function initializeSurfaceConfig() {
  const current = revision, saved = await configPreference('surface', { glass: state.glass });
  if (current === revision) { state = { glass: saved?.glass === true, error: '' }; apply(); }
}
export async function setGlassSurface(glass: boolean) {
  const current = ++revision; state = { glass, error: '' }; apply();
  try { if (window.localMusicDesktop) await window.localMusicDesktop.setConfig('surface', { glass }); else localStorage.setItem(key, String(glass)); }
  catch { if (current === revision) { state = { glass, error: 'Glass appearance changed for this session but could not be saved.' }; apply(); } }
}
export const useSurface = () => useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => state);
window.addEventListener('storage', event => { if (event.key === key && !window.localMusicDesktop) { state = { glass: read(), error: '' }; apply(); } });
