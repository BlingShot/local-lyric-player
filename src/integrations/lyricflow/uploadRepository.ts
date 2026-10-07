import { openLibraryDatabase } from '../../library/database';
import { metadataFingerprint } from './repository';
import type { LyricFlowUpload } from './contributionTypes';

export async function saveUpload(task: LyricFlowUpload, expectedUpdatedAt?: number) {
  const copy = structuredClone(task), db = await openLibraryDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['tracks', 'lyricflow-uploads'], 'readwrite'); let error: unknown;
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(error || tx.error || new Error('The upload could not be saved.')); tx.onerror = () => {};
    const track = tx.objectStore('tracks').get(copy.localTrackId), previous = tx.objectStore('lyricflow-uploads').get(copy.taskId); let remaining = 2;
    const ready = () => { if (--remaining) return;
      if (!track.result || track.result.audioRevision !== copy.audioRevision || track.result.metadataRevision !== copy.metadataRevision || metadataFingerprint(track.result) !== copy.metadataFingerprint) { error = new Error('This song changed. Prepare a new frozen upload snapshot.'); tx.abort(); return; }
      if (!previous.result && copy.step !== 'prepared') { error = new Error('This upload was removed. Prepare a new frozen upload snapshot.'); tx.abort(); return; }
      if (previous.result && expectedUpdatedAt !== undefined && previous.result.updatedAt !== expectedUpdatedAt) { error = new Error('This upload changed in another window. Reopen the saved task.'); tx.abort(); return; }
      tx.objectStore('lyricflow-uploads').put(copy, copy.taskId);
    };
    track.onsuccess = ready; previous.onsuccess = ready;
  });
}
export async function readUploads(localTrackId: string): Promise<LyricFlowUpload[]> {
  const db = await openLibraryDatabase();
  return new Promise((resolve, reject) => { const request = db.transaction('lyricflow-uploads').objectStore('lyricflow-uploads').getAll();
    request.onsuccess = () => resolve((request.result as LyricFlowUpload[]).filter(task => task.localTrackId === localTrackId).sort((a, b) => b.updatedAt - a.updatedAt)); request.onerror = () => reject(request.error); });
}
