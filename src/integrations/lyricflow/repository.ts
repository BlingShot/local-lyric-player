import { openLibraryDatabase } from '../../library/database';
import type { LocalTrack } from '../../library/importFiles';
import type { SavedLyrics } from '../../lyrics/types';
import { lyricRevision, revisedLyrics } from '../../lyrics/revision';
import { normalizeApiOrigin } from './client';
import type { LyricFlowLink, LyricFlowPreferences } from './types';
import type { StudioProject } from '../../studio/project';

const read = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
const done = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error ?? new Error('Local LyricFlow data could not be saved.')); tx.onerror = () => {}; });
export const metadataFingerprint = (track: LocalTrack) => JSON.stringify([track.name, track.artist, track.album, track.duration, track.isrc, track.spotifyId, track.size, track.lastModified]);
export async function readPreferences(): Promise<LyricFlowPreferences> {
  const db = await openLibraryDatabase(), value = await read(db.transaction('settings').objectStore('settings').get('lyricflow'));
  return { enabled: value?.enabled === true, apiOrigin: typeof value?.apiOrigin === 'string' ? value.apiOrigin : '', siteOrigin: typeof value?.siteOrigin === 'string' ? value.siteOrigin : '' };
}
export async function savePreferences(value: LyricFlowPreferences) {
  const preferences = { ...value, apiOrigin: value.apiOrigin ? normalizeApiOrigin(value.apiOrigin) : '', siteOrigin: value.siteOrigin ? normalizeApiOrigin(value.siteOrigin) : '' };
  if (preferences.enabled && !preferences.apiOrigin) throw new Error('Set the LyricFlow API origin before enabling automatic lyrics.');
  const db = await openLibraryDatabase(), tx = db.transaction('settings', 'readwrite'), finished = done(tx); tx.objectStore('settings').put(preferences, 'lyricflow'); await finished;
  window.dispatchEvent(new Event('lyricflow-preferences-updated')); return preferences;
}
export async function readLink(apiOrigin: string, localTrackId: string): Promise<LyricFlowLink | undefined> { const db = await openLibraryDatabase(); return read(db.transaction('lyricflow-links').objectStore('lyricflow-links').get([apiOrigin, localTrackId])); }
export async function removeLink(apiOrigin: string, localTrackId: string) { const db = await openLibraryDatabase(), tx = db.transaction('lyricflow-links', 'readwrite'), finished = done(tx); tx.objectStore('lyricflow-links').delete([apiOrigin, localTrackId]); await finished; }

/** Track identity, lyrics and link are compared/written atomically across tabs. */
export async function saveImportedLyrics(record: SavedLyrics, link: LyricFlowLink, expectedTrack: LocalTrack, expectedLyrics: string | null, expectedLink: LyricFlowLink | undefined, signal: AbortSignal) {
  signal.throwIfAborted(); const db = await openLibraryDatabase(); signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['tracks', 'lyrics', 'lyricflow-links'], 'readwrite'); let failure: unknown;
    const abort = () => { failure = signal.reason; tx.abort(); }; signal.addEventListener('abort', abort, { once: true });
    tx.oncomplete = () => { signal.removeEventListener('abort', abort); resolve(); };
    tx.onabort = () => { signal.removeEventListener('abort', abort); reject(failure ?? tx.error ?? new Error('LyricFlow import was cancelled.')); }; tx.onerror = () => {};
    const trackRequest = tx.objectStore('tracks').get(expectedTrack.id), lyricRequest = tx.objectStore('lyrics').get(expectedTrack.id), linkRequest = tx.objectStore('lyricflow-links').get([link.apiOrigin, expectedTrack.id]); let remaining = 3;
    const ready = () => { if (--remaining) return; try {
      const track = trackRequest.result as LocalTrack | undefined;
      if (!track || record.trackId !== track.id || link.localTrackId !== track.id || track.audioRevision !== expectedTrack.audioRevision || track.metadataRevision !== expectedTrack.metadataRevision || metadataFingerprint(track) !== metadataFingerprint(expectedTrack)) throw new Error('This song changed while LyricFlow was loading. Local lyrics are unchanged.');
      if (lyricRevision(lyricRequest.result) !== expectedLyrics || JSON.stringify(linkRequest.result) !== JSON.stringify(expectedLink)) throw new Error('Lyrics or the LyricFlow link changed while downloading. The newer data was kept.');
      signal.throwIfAborted(); tx.objectStore('lyrics').put(revisedLyrics(record), track.id); tx.objectStore('lyricflow-links').put(link, [link.apiOrigin, track.id]);
    } catch (error) { failure = error; tx.abort(); } };
    trackRequest.onsuccess = ready; lyricRequest.onsuccess = ready; linkRequest.onsuccess = ready;
  });
  window.dispatchEvent(new CustomEvent('local-lyrics-updated', { detail: record.trackId }));
}

/** Keep the previous editable project and validate the recording in the same commit. */
export async function saveImportedStudioProject(project: StudioProject, expectedTrack: LocalTrack, previous: StudioProject | undefined, signal: AbortSignal) {
  signal.throwIfAborted(); const db = await openLibraryDatabase(); signal.throwIfAborted();
  const snapshot = structuredClone(project); snapshot.updatedAt = Math.max(Date.now(), (previous?.updatedAt ?? 0) + 1);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['tracks', 'settings'], 'readwrite'); let failure: unknown, remaining = 2;
    const abort = () => { failure = signal.reason; tx.abort(); }; signal.addEventListener('abort', abort, { once: true });
    tx.oncomplete = () => { signal.removeEventListener('abort', abort); resolve(); };
    tx.onabort = () => { signal.removeEventListener('abort', abort); reject(failure ?? tx.error ?? new Error('LyricFlow import was cancelled.')); }; tx.onerror = () => {};
    const trackRequest = tx.objectStore('tracks').get(expectedTrack.id), draftRequest = tx.objectStore('settings').get('lyric-studio:' + expectedTrack.id);
    const ready = () => { if (--remaining) return; try {
      const latest = trackRequest.result as LocalTrack | undefined, current = draftRequest.result as StudioProject | undefined;
      if (!latest || snapshot.trackId !== latest.id || latest.audioRevision !== expectedTrack.audioRevision || latest.metadataRevision !== expectedTrack.metadataRevision || metadataFingerprint(latest) !== metadataFingerprint(expectedTrack)) throw new Error('This song changed while LyricFlow was loading. Local lyrics are unchanged.');
      if (current && (!previous || current.updatedAt > previous.updatedAt || current.updatedAt === previous.updatedAt && JSON.stringify(current) !== JSON.stringify(previous))) throw new Error('A newer version of this draft is already saved.');
      signal.throwIfAborted();
      if (previous) tx.objectStore('settings').add(previous, `lyric-studio-source-backup:${encodeURIComponent(latest.id)}:${previous.updatedAt}:${crypto.randomUUID()}`);
      tx.objectStore('settings').put(snapshot, 'lyric-studio:' + latest.id); tx.objectStore('settings').put(latest.id, 'lyric-studio:last');
    } catch (error) { failure = error; tx.abort(); } };
    trackRequest.onsuccess = ready; draftRequest.onsuccess = ready;
  });
  window.dispatchEvent(new CustomEvent('local-studio-draft-updated', { detail: snapshot.trackId }));
}
