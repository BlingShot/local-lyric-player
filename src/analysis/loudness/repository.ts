import { openLibraryDatabase, type TrackRecord } from '../../library/database';
import type { AnalysisInput } from '../types';
import { audioVersion } from '../versions';
import { loudnessAlgorithm, loudnessSettings } from './config';
import type { LoudnessKind, LoudnessRecord } from './types';

export async function readLoudnessResult(trackId: string, kind: LoudnessKind = 'loudness'): Promise<LoudnessRecord | undefined> {
  const db = await openLibraryDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction('analysis').objectStore('analysis').get([trackId, kind]);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
export function loudnessCurrent(record: LoudnessRecord | undefined, tracks: readonly TrackRecord[]) {
  if (!record || record.algorithm?.id !== loudnessAlgorithm.id || record.algorithm.version !== loudnessAlgorithm.version
    || JSON.stringify(record.settings) !== JSON.stringify(loudnessSettings) || !record.result?.ranges?.length) return false;
  const scope = record.result.scope;
  if (!scope || !Array.isArray(scope.trackIds) || scope.trackIds.length !== 1 || scope.trackIds[0] !== record.trackId || scope.kind !== 'track') return false;
  if (![record.result.samplePeak, record.result.truePeak].every(value => Number.isFinite(value) && value >= 0)) return false;
  if (scope.trackIds.some(id => { const track = tracks.find(t => t.id === id); return !track || audioVersion(track) !== record.input.audio?.[id]; })) return false;
  return true;
}
export function loudnessCacheMatches(record: LoudnessRecord | undefined, input: AnalysisInput, kind: LoudnessKind) {
  const members = [input.track];
  return record?.kind === kind && record.trackId === input.track.id && loudnessCurrent(record, members)
    && JSON.stringify([...record.result.scope.trackIds].sort()) === JSON.stringify(members.map(t => t.id).sort());
}
// Validate the source and task ID in the same transaction as the saved result.
export async function saveLoudnessResults(records: LoudnessRecord[], anchorId: string, kind: LoudnessKind, taskId: string) {
  const db = await openLibraryDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['tracks', 'analysis', 'analysis-tasks'], 'readwrite');
    let failure: unknown;
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(failure || tx.error || new Error('Loudness results could not be saved.'));
    const tracks = tx.objectStore('tracks').getAll(), task = tx.objectStore('analysis-tasks').get([anchorId, kind]);
    task.onsuccess = () => {
      if (task.result?.id !== taskId || task.result?.status !== 'saving') failure = new Error('This task is no longer current. Results were discarded.');
      else if (records.some(record => !loudnessCurrent(record, tracks.result))) failure = new Error('Audio changed during analysis. Run again with the current file.');
      if (failure) { tx.abort(); return; }
      try { records.forEach(record => tx.objectStore('analysis').put(record, [record.trackId, record.kind])); }
      catch (error) { failure = error; tx.abort(); }
    };
  });
  new Set(records.map(r => r.trackId)).forEach(id => window.dispatchEvent(new CustomEvent('local-analysis-updated', { detail: id })));
}
