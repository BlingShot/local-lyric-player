import { openLibraryDatabase } from '../library/database';
import { analysisKinds } from './catalog';
import type { AnalysisCorrections, AnyAnalysisRecord } from './types';
import type { AudioTask } from './audio/types';

export async function readAnalysisResults(trackId: string) {
  const db = await openLibraryDatabase();
  return new Promise<{ records: AnyAnalysisRecord[]; corrections?: AnalysisCorrections; audioTasks: AudioTask[] }>((resolve, reject) => {
    const tx = db.transaction(['analysis', 'analysis-edits', 'analysis-tasks']);
    const requests = analysisKinds.map(kind => tx.objectStore('analysis').get([trackId, kind]));
    const edits = tx.objectStore('analysis-edits').get(trackId);
    const tasks = ['bpm', 'key', 'loudness'].map(kind => tx.objectStore('analysis-tasks').get([trackId, kind]));
    tx.oncomplete = () => {
      const records: AnyAnalysisRecord[] = requests.map(request => request.result).filter(Boolean);
      if (records.some(record => record.schemaVersion !== 1 || record.trackId !== trackId || !analysisKinds.includes(record.kind))) { reject(new Error('Saved analysis uses an unsupported format.')); return; }
      resolve({ records, corrections: edits.result, audioTasks: tasks.map(task => task.result).filter(Boolean) });
    };
    tx.onabort = () => reject(tx.error);
  });
}
async function saveForTrack(trackId: string, write: (tx: IDBTransaction) => void) {
  const db = await openLibraryDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['tracks', 'analysis', 'analysis-edits'], 'readwrite');
    let failure: unknown;
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(failure ?? tx.error ?? new Error('Analysis was not saved.'));
    const request = tx.objectStore('tracks').getKey(trackId);
    request.onsuccess = () => {
      if (!request.result) { failure = new Error('This song was removed. Analysis cannot be saved.'); tx.abort(); return; }
      try { write(tx); } catch (error) { failure = error; tx.abort(); }
    };
  });
  window.dispatchEvent(new CustomEvent('local-analysis-updated', { detail: trackId }));
}
export async function saveAnalysisResult(record: AnyAnalysisRecord) {
  if (record.schemaVersion !== 1 || !record.algorithm.id || !record.algorithm.version || !Number.isFinite(record.analyzedAt)) throw new Error('An analysis result must include its algorithm, version and timestamp.');
  // Algorithm output and user corrections have separate stores; reruns never overwrite corrections.
  await saveForTrack(record.trackId, tx => tx.objectStore('analysis').put(record, [record.trackId, record.kind]));
}
export async function saveAnalysisCorrections(edits: AnalysisCorrections) {
  await saveForTrack(edits.trackId, tx => tx.objectStore('analysis-edits').put(edits, edits.trackId));
}
