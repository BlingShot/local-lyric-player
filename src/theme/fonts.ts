import { useSyncExternalStore } from 'react';
import { openLibraryDatabase } from '../library/database';

export type FontTarget = 'app' | 'app-cjk' | 'lyrics' | 'lyrics-cjk';
export type LocalFont = { kind: 'system' } | { kind: 'installed'; family: string } | { kind: 'file'; name: string; bytes: Uint8Array };
type FontState = { label: string; kind: LocalFont['kind']; family: string; name: string; error: string; busy: boolean };
const fallback = 'system-ui, "Microsoft YaHei", sans-serif';
const initial = (): FontState => ({ label: 'System default', kind: 'system', family: fallback, name: 'system-ui', error: '', busy: false });
let state: Record<FontTarget, FontState> = { app: initial(), 'app-cjk': initial(), lyrics: initial(), 'lyrics-cjk': initial() };
const listeners = new Set<() => void>(), faces: Partial<Record<FontTarget, FontFace>> = {};
const revisions: Record<FontTarget, number> = { app: 0, 'app-cjk': 0, lyrics: 0, 'lyrics-cjk': 0 };
let faceId = 0;

/** Latin and CJK fonts are selected separately so a Western font never
 *  forces its (often missing or ugly) CJK fallback, and vice versa. */
const fontStack = (latin: FontState, cjk: FontState) => {
  const parts = [latin.kind === 'system' ? 'system-ui' : latin.name];
  if (cjk.kind !== 'system') parts.push(cjk.name);
  parts.push('"Microsoft YaHei"', 'sans-serif');
  return parts.join(', ');
};
const publish = (slot: FontTarget, patch: Partial<FontState>) => {
  state = { ...state, [slot]: { ...state[slot], ...patch } };
  document.documentElement.style.setProperty('--app-font-family', fontStack(state.app, state['app-cjk']));
  document.documentElement.style.setProperty('--local-lyrics-font-family', fontStack(state.lyrics, state['lyrics-cjk']));
  listeners.forEach(listener => listener());
};
export const useLocalFonts = () => useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => state);
export const cssFontFamily = (family: string) => `${JSON.stringify(family)}, ${fallback}`;
async function read(slot: FontTarget): Promise<LocalFont> {
  if (window.localMusicDesktop) return window.localMusicDesktop.getFont(slot);
  const db = await openLibraryDatabase();
  return new Promise((resolve, reject) => { const request = db.transaction('settings').objectStore('settings').get(`local-font-${slot}`);
    request.onsuccess = () => resolve(request.result || { kind: 'system' }); request.onerror = () => reject(request.error); });
}
async function write(slot: FontTarget, font: LocalFont) {
  if (window.localMusicDesktop) return window.localMusicDesktop.setFont(slot, font);
  const db = await openLibraryDatabase();
  return new Promise<void>((resolve, reject) => { const tx = db.transaction('settings', 'readwrite');
    tx.objectStore('settings').put(font, `local-font-${slot}`); tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error); });
}
async function prepare(font: LocalFont) {
  if (font.kind === 'system') return { family: fallback, name: 'system-ui', label: 'System default' };
  if (font.kind === 'installed') {
    if (!font.family || font.family.length > 240) throw new Error('Invalid font selection.');
    // Probe availability without copying installed font data or prompting on startup.
    const probe = new FontFace(`LocalFontProbe${++faceId}`, `local(${JSON.stringify(font.family)})`);
    await probe.load();
    return { family: cssFontFamily(font.family), name: JSON.stringify(font.family), label: font.family };
  }
  if (!(font.bytes instanceof Uint8Array) || font.bytes.byteLength > 32 * 1024 * 1024) throw new Error('Choose a valid TTF, OTF, WOFF or WOFF2 font under 32 MB.');
  const family = `LocalMusicFont${++faceId}`;
  // Chromium validates the actual font before it replaces the saved selection.
  const face = new FontFace(family, new Uint8Array(font.bytes).buffer, { weight: '100 900', stretch: '50% 200%' });
  await face.load();
  return { face, family: cssFontFamily(family), name: JSON.stringify(family), label: font.name };
}
async function select(slot: FontTarget, font: LocalFont, persist: boolean, revision: number) {
  try {
    const loaded = await prepare(font);
    if (revision !== revisions[slot]) return;
    if (persist) await write(slot, font);
    if (revision !== revisions[slot]) return;
    if (loaded.face) document.fonts.add(loaded.face);
    if (faces[slot]) document.fonts.delete(faces[slot]!);
    faces[slot] = loaded.face;
    publish(slot, { kind: font.kind, label: loaded.label, family: loaded.family, name: loaded.name, error: '', busy: false });
  } catch {
    if (revision === revisions[slot]) publish(slot, { busy: false, error: persist ? 'Font could not be loaded or saved. Choose another local font.' : 'Saved font is unavailable. Choose it again or use the system default.' });
  }
}
export async function chooseLocalFont(slot: FontTarget, font: LocalFont) {
  if (state[slot].busy) return;
  const revision = ++revisions[slot]; publish(slot, { busy: true, error: '' });
  await select(slot, font, true, revision);
}
export async function initializeLocalFonts() {
  await Promise.all((['app', 'app-cjk', 'lyrics', 'lyrics-cjk'] as const).map(async slot => {
    const revision = revisions[slot];
    try { const font = await read(slot); if (revision === revisions[slot]) await select(slot, font, false, revision); }
    catch { if (revision === revisions[slot]) publish(slot, { error: 'Saved font is unavailable. Choose it again or use the system default.' }); }
  }));
}
export async function installedFontFamilies() {
  if (!window.queryLocalFonts) throw new Error('Installed font access is unavailable here. Choose a font file instead.');
  const fonts = await window.queryLocalFonts();
  return [...new Set(fonts.map(font => font.family))].sort((a, b) => a.localeCompare(b));
}
