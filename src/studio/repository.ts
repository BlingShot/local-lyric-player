import { openLibraryDatabase } from '../library/database';
import { migrateDraft, parseProject, type StudioProject as StudioDraft } from './project';

const prefix = 'lyric-studio:';
const recoveryKey = 'lyric-studio-recovery';
function recovery(): StudioDraft | undefined {
  try { return JSON.parse(localStorage.getItem(recoveryKey) || 'null') || undefined; } catch { return; }
}
const isLegacy = (value: unknown): boolean => !!value && typeof value === 'object'
  && 'trackId' in value && typeof value.trackId === 'string' && 'audioName' in value && typeof value.audioName === 'string'
  && 'updatedAt' in value && typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt)
  && 'selectedId' in value && typeof value.selectedId === 'string' && 'lines' in value && Array.isArray(value.lines)
  && value.lines.length <= 5000 && value.lines.every(line => line && ['id', 'text', 'start', 'end'].every(key => typeof line[key] === 'string'));
const isDraft = (value: unknown): value is StudioDraft => {
  if (isLegacy(value)) return true;
  try { parseProject(JSON.stringify(value)); return true; } catch { return false; }
};
export async function readStudioDraft(trackId: string): Promise<StudioDraft | undefined> {
  const pending = recovery();
  try {
    const db = await openLibraryDatabase();
    const saved = await new Promise<StudioDraft | undefined>((resolve, reject) => {
      const request = db.transaction('settings').objectStore('settings').get(prefix + trackId);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    if (isDraft(pending) && pending.trackId === trackId && (!saved || pending.updatedAt >= saved.updatedAt)) return migrateDraft(pending);
    if (saved !== undefined && !isDraft(saved)) throw new Error('The saved studio draft is not readable.');
    return saved ? migrateDraft(saved) : undefined;
  } catch (error) { if (isDraft(pending) && pending.trackId === trackId) return migrateDraft(pending); throw error; }
}
export async function lastStudioTrack(): Promise<string | undefined> {
  const pending = recovery();
  if (isDraft(pending)) return pending.trackId;
  const db = await openLibraryDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction('settings').objectStore('settings').get(prefix + 'last');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
export function saveStudioDraft(draft: StudioDraft): Promise<void> {
  // Only small lyric text is journaled synchronously; audio is never put in localStorage.
  try { localStorage.setItem(recoveryKey, JSON.stringify(draft)); } catch { /* IndexedDB may still have space. Its committed result is authoritative. */ }
  return (async () => {
    const db = await openLibraryDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('settings', 'readwrite');
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error ?? new Error('Draft save was cancelled.'));
      try {
        tx.objectStore('settings').put(draft, prefix + draft.trackId);
        tx.objectStore('settings').put(draft.trackId, prefix + 'last');
      } catch (error) { tx.abort(); reject(error); }
    });
    try { const pending = recovery(); if (pending?.trackId === draft.trackId && pending.updatedAt === draft.updatedAt) localStorage.removeItem(recoveryKey); } catch { /* A redundant recovery copy is harmless. */ }
    window.dispatchEvent(new CustomEvent('local-studio-draft-updated', { detail: draft.trackId }));
  })();
}
