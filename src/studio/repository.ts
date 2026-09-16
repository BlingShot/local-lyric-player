import { openLibraryDatabase } from '../library/database';
import { migrateDraft, parseProject, type StudioProject as StudioDraft } from './project';

const prefix = 'lyric-studio:';
import { RecoveryJournal, type RecoveryEntry } from './recoveryJournal';
const journal = () => new RecoveryJournal<StudioDraft>(localStorage);
function recovery(trackId: string): StudioDraft | undefined {
  try { return journal().forTrack(trackId).find(entry => isDraft(entry.draft))?.draft; } catch { return; }
}
export function studioRecoveries(): RecoveryEntry<StudioDraft>[] {
  try { return journal().entries().filter(entry => isDraft(entry.draft)); } catch { return []; }
}
export function discardStudioRecovery(entry: RecoveryEntry<StudioDraft>) {
  journal().clear(entry);
  window.dispatchEvent(new Event('local-studio-recovery-updated'));
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
  const pending = recovery(trackId);
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
  const pending = studioRecoveries()[0]?.draft;
  if (isDraft(pending)) return pending.trackId;
  const db = await openLibraryDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction('settings').objectStore('settings').get(prefix + 'last');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
export function saveStudioDraft(value: StudioDraft): Promise<void> {
  // Capture now; neither IDB nor the journal may observe later caller mutations.
  const draft: StudioDraft = structuredClone(value);
  let pending: RecoveryEntry<StudioDraft> | undefined, recoveryError: unknown;
  const legacy = (() => { try { return journal().forTrack(draft.trackId); } catch { return []; } })();
  try { pending = journal().stage(draft); } catch (error) { recoveryError = error; }
  return (async () => {
    try {
      const db = await openLibraryDatabase();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('settings', 'readwrite');
        let failure: unknown;
        tx.oncomplete = () => resolve(); tx.onabort = () => reject(failure ?? tx.error ?? new Error('Draft save was cancelled.'));
        tx.onerror = () => {};
        const abort = (error: unknown) => { failure = error; tx.abort(); };
        const request = tx.objectStore('settings').get(prefix + draft.trackId);
        request.onsuccess = () => {
          try {
            if (request.result?.updatedAt > draft.updatedAt) throw new Error('A newer version of this draft is already saved.');
            tx.objectStore('settings').put(draft, prefix + draft.trackId);
            tx.objectStore('settings').put(draft.trackId, prefix + 'last');
          } catch (error) { abort(error); }
        };
      });
    } catch (error) {
      window.dispatchEvent(new Event('local-studio-recovery-updated'));
      if (recoveryError) throw new Error(`Draft and recovery copy could not be saved. Export before leaving. ${String(recoveryError)}`, { cause: error });
      throw error;
    }
    try {
      if (pending) journal().clear(pending);
      for (const entry of legacy) if (entry.draft.updatedAt <= draft.updatedAt) journal().clear(entry);
    } catch { /* A redundant recovery copy is harmless; never erase an unrelated project. */ }
    window.dispatchEvent(new Event('local-studio-recovery-updated'));
    window.dispatchEvent(new CustomEvent('local-studio-draft-updated', { detail: draft.trackId }));
  })();
}

// Source switches retain an immutable draft outside the transient recovery journal.
// Ordinary autosaves must never clean these copies up.
export interface StudioSourceBackup { key: string; project: StudioDraft }
const backupPrefix = (trackId: string) => `lyric-studio-source-backup:${encodeURIComponent(trackId)}:`;
export async function backupStudioSource(project: StudioDraft): Promise<void> {
  const snapshot = structuredClone(project), db = await openLibraryDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('settings', 'readwrite'), store = tx.objectStore('settings');
    const key = backupPrefix(project.trackId) + project.updatedAt;
    const get = store.get(key);
    get.onsuccess = () => { if (get.result === undefined) store.add(snapshot, key); };
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error || new Error('The previous draft could not be backed up.')); tx.onerror = () => {};
  });
}
export async function studioSourceBackups(trackId: string): Promise<StudioSourceBackup[]> {
  const db = await openLibraryDatabase(), prefix = backupPrefix(trackId);
  return new Promise((resolve, reject) => {
    const result: StudioSourceBackup[] = [], request = db.transaction('settings').objectStore('settings').openCursor(IDBKeyRange.bound(prefix, prefix + '\uffff'));
    request.onsuccess = () => { const cursor = request.result; if (!cursor) { resolve(result.sort((a, b) => b.project.updatedAt - a.project.updatedAt)); return; }
      if (isDraft(cursor.value) && cursor.value.trackId === trackId) result.push({ key: String(cursor.key), project: migrateDraft(cursor.value) }); cursor.continue(); };
    request.onerror = () => reject(request.error);
  });
}
