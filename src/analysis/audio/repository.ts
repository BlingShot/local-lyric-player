import { openLibraryDatabase } from '../../library/database';
import type { AnalysisCorrections, AnalysisInput, AnalysisRecord } from '../types';
import { audioVersion } from '../versions';
import { audioAlgorithm, audioSettings } from './config';
import type { AudioAnalysisKind, AudioTask } from './types';

export type AudioRecord = AnalysisRecord<'bpm'> | AnalysisRecord<'key'>;
export const audioCacheMatches = (record: AudioRecord | undefined, input: AnalysisInput, kind: AudioAnalysisKind) => !!record
  && !!input.versions.audio?.[input.track.id]
  && record.kind === kind && record.trackId === input.track.id && record.input.audio?.[input.track.id] === input.versions.audio?.[input.track.id]
  && record.algorithm.id === audioAlgorithm(kind).id && record.algorithm.version === audioAlgorithm(kind).version
  && JSON.stringify(record.settings) === JSON.stringify(audioSettings(kind)) && record.result?.range?.kind === 'full-track';

const updated = (trackId: string) => window.dispatchEvent(new CustomEvent('local-analysis-updated', { detail: trackId }));
export async function readAudioResult(trackId: string, kind: AudioAnalysisKind): Promise<AudioRecord | undefined> {
  const db = await openLibraryDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction('analysis').objectStore('analysis').get([trackId, kind]);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
export async function saveAudioTask(task: AudioTask, create = false) {
  const db = await openLibraryDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['tracks', 'analysis-tasks'], 'readwrite');
    let failure: unknown;
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(failure || tx.error || new Error('Task state could not be saved.'));
    const track = tx.objectStore('tracks').getKey(task.trackId), previous = tx.objectStore('analysis-tasks').get([task.trackId, task.kind]);
    previous.onsuccess = () => {
      try { if (track.result && (create || previous.result?.id === task.id)) tx.objectStore('analysis-tasks').put(task, [task.trackId, task.kind]); }
      catch (error) { failure = error; tx.abort(); }
    };
  });
}
export async function saveAudioResult(record: AudioRecord, taskId: string) {
  const db = await openLibraryDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['tracks', 'analysis', 'analysis-tasks'], 'readwrite');
    let failure: unknown;
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(failure || tx.error || new Error('Analysis result was not saved.'));
    const track = tx.objectStore('tracks').get(record.trackId), task = tx.objectStore('analysis-tasks').get([record.trackId, record.kind]);
    task.onsuccess = () => {
      if (!track.result || audioVersion(track.result) !== record.input.audio?.[record.trackId]) failure = new Error('The audio changed or the song was removed during analysis. Run again using the current file.');
      else if (task.result?.id !== taskId || task.result?.status !== 'saving') failure = new Error('This analysis task is no longer current. Its result was discarded.');
      if (failure) { tx.abort(); return; }
      try { tx.objectStore('analysis').put(record, [record.trackId, record.kind]); }
      catch (error) { failure = error; tx.abort(); }
    };
  });
  updated(record.trackId);
}
export async function saveAudioCorrection<K extends AudioAnalysisKind>(trackId: string, kind: K, value: AnalysisCorrections[K] | undefined) {
  const db = await openLibraryDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['tracks', 'analysis-edits'], 'readwrite');
    let failure: unknown;
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(failure || tx.error);
    const track = tx.objectStore('tracks').getKey(trackId), edits = tx.objectStore('analysis-edits').get(trackId);
    edits.onsuccess = () => {
      if (!track.result) { failure = new Error('This song was removed.'); tx.abort(); return; }
      try { tx.objectStore('analysis-edits').put({ ...edits.result, trackId, updatedAt: Date.now(), [kind]: value }, trackId); }
      catch (error) { failure = error; tx.abort(); }
    };
  });
  updated(trackId);
}
