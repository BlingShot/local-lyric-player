import { useSyncExternalStore } from 'react';
import { openLibraryDatabase } from '../library/database';

export type FontTarget = 'app' | 'lyrics';
export type LocalFont = { kind: 'system' } | { kind: 'installed'; family: string } | { kind: 'file'; name: string; bytes: Uint8Array };
type FontState = { label: string; kind: LocalFont['kind']; family: string; error: string; busy: boolean };
const fallback = 'system-ui, "Microsoft YaHei", sans-serif';
const initial = (): FontState => ({ label: 'System default', kind: 'system', family: fallback, error: '', busy: false });
let state = { app: initial(), lyrics: initial() };
const listeners = new Set<() => void>(), faces: Partial<Record<FontTarget, FontFace>> = {};
const revisions = { app: 0, lyrics: 0 };
let faceId = 0;
const publish = (slot: FontTarget, patch: Partial<FontState>) => {
  state = { ...state, [slot]: { ...state[slot], ...patch } };
  document.documentElement.style.setProperty(`--${slot === 'app' ? 'app' : 'local-lyrics'}-font-family`, state[slot].family);
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
  if (font.kind === 'system') return { family: fallback, label: 'System default' };
  if (font.kind === 'installed') {
    if (!font.family || font.family.length > 240) throw new Error('Invalid font selection.');
    // Probe availability without copying installed font data or prompting on startup.
    const probe = new FontFace(`LocalFontProbe${++faceId}`, `local(${JSON.stringify(font.family)})`);
    await probe.load();
    return { family: cssFontFamily(font.family), label: font.family };
  }
  if (!(font.bytes instanceof Uint8Array) || font.bytes.byteLength > 32 * 1024 * 1024) throw new Error('Choose a valid TTF, OTF, WOFF or WOFF2 font under 32 MB.');
  const family = `LocalMusicFont${++faceId}`;
  // Chromium validates the actual font before it replaces the saved selection.
  const face = new FontFace(family, new Uint8Array(font.bytes).buffer, { weight: '100 900', stretch: '50% 200%' });
  await face.load();
  return { face, family: cssFontFamily(family), label: font.name };
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
    publish(slot, { kind: font.kind, label: loaded.label, family: loaded.family, error: '', busy: false });
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
  await Promise.all((['app', 'lyrics'] as const).map(async slot => {
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
