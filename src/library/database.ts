import type { LocalTrack } from './importFiles.ts';
import type { RepeatMode } from '../player/queue.ts';
import type { SavedLyrics } from '../lyrics/types.ts';
import { validLyricsAppearance, type LyricsAppearance } from '../lyrics/appearance.ts';
import { configPreference } from '../desktop/config.ts';

export type TrackRecord = Omit<LocalTrack, 'coverUrl' | 'unavailable' | 'error'>;
export interface LocalPlaylist { id: string; name: string; trackIds: string[] }
export interface PlaybackSettings { volume: number; shuffle: boolean; repeat: RepeatMode }
export interface TrackColumns { title?: number; album: number; duration: number; bitrate: number; sampleRate: number; bitsPerSample: number; viewport?: number }
export const defaultTrackColumns: TrackColumns = { album: 240, duration: 64, bitrate: 100, sampleRate: 112, bitsPerSample: 96 };
export function validTrackColumns(value?: Partial<TrackColumns>): TrackColumns {
  const width = (n: number | undefined, min: number, max: number, fallback: number) =>
    n !== undefined && Number.isFinite(n) ? Math.round(Math.max(min, Math.min(max, n))) : fallback;
  return { title: value?.title === undefined ? undefined : width(value.title, 120, 4096, 300),
    album: width(value?.album, 80, 4096, 240), duration: width(value?.duration, 56, 240, 64),
    bitrate: width(value?.bitrate, 80, 400, 100), sampleRate: width(value?.sampleRate, 96, 400, 112), bitsPerSample: width(value?.bitsPerSample, 80, 400, 96),
    viewport: value?.viewport === undefined ? undefined : width(value.viewport, 1, 16384, 1000) };
}
export interface SavedTrack { track: TrackRecord; audio?: Blob; cover?: Blob; lyrics?: SavedLyrics }

export const DATABASE_NAME = 'local-music-library';
const stores = ['tracks', 'audio', 'covers', 'settings', 'playlists', 'lyrics', 'analysis', 'analysis-edits', 'analysis-tasks'] as const;
let connection: Promise<IDBDatabase> | undefined;

export function openLibraryDatabase(): Promise<IDBDatabase> {
  if (connection) return connection;
  connection = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 4);
    let blocked = false;
    request.onupgradeneeded = () => {
      for (const name of stores) {
        if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
      }
    };
    request.onblocked = () => { blocked = true; reject(new Error('Close other tabs of this player, then reload to open local storage.')); };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return; }
      request.result.onversionchange = () => { request.result.close(); connection = undefined; };
      resolve(request.result);
    };
  }).catch(error => { connection = undefined; throw error; });
  return connection;
}

const read = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
const completed = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onabort = () => reject(tx.error ?? new Error('The local save was cancelled.'));
  tx.onerror = () => { /* onabort is authoritative: no success before commit. */ };
});

export async function readLibrary() {
  const db = await openLibraryDatabase();
  const tx = db.transaction([...stores], 'readonly');
  const done = completed(tx);
  const [tracks, audioKeys, audio, coverKeys, covers, settings, playlists, columns, appearance] = await Promise.all([
    read(tx.objectStore('tracks').getAll()) as Promise<TrackRecord[]>,
    read(tx.objectStore('audio').getAllKeys()), read(tx.objectStore('audio').getAll()) as Promise<Blob[]>,
    read(tx.objectStore('covers').getAllKeys()), read(tx.objectStore('covers').getAll()) as Promise<Blob[]>,
    read(tx.objectStore('settings').get('playback')) as Promise<PlaybackSettings | undefined>,
    read(tx.objectStore('playlists').getAll()) as Promise<LocalPlaylist[]>,
    read(tx.objectStore('settings').get('track-columns')) as Promise<TrackColumns | undefined>,
    read(tx.objectStore('settings').get('lyrics-appearance')) as Promise<LyricsAppearance | undefined>, done,
  ]);
  const [preferences, savedColumns, savedAppearance] = await Promise.all([
    configPreference('playback', settings), configPreference('track-columns', columns), configPreference('lyrics-appearance', appearance),
  ]);
  return { tracks, audio: new Map(audioKeys.map((id, i) => [String(id), audio[i]])),
    covers: new Map(coverKeys.map((id, i) => [String(id), covers[i]])), settings: preferences, playlists, columns: validTrackColumns(savedColumns), appearance: validLyricsAppearance(savedAppearance) };
}

export function recordFor(track: LocalTrack): TrackRecord {
  const { coverUrl: _url, unavailable: _unavailable, error: _error, ...record } = track;
  return record;
}

export async function saveTracks(items: readonly SavedTrack[]) {
  const db = await openLibraryDatabase();
  const tx = db.transaction(['tracks', 'audio', 'covers', 'lyrics'], 'readwrite');
  const done = completed(tx);
  let writeFailure: unknown;
  try {
    for (const item of items) {
      tx.objectStore('tracks').put(recordFor(item.track), item.track.id);
      if (item.audio) tx.objectStore('audio').put(item.audio, item.track.id);
      if (item.cover) tx.objectStore('covers').put(item.cover, item.track.id);
      if (item.lyrics) {
        const request = tx.objectStore('lyrics').getKey(item.track.id);
        request.onsuccess = () => {
          // Embedded discovery must never overwrite a manually imported lyric file.
          try { if (request.result === undefined) tx.objectStore('lyrics').put(item.lyrics, item.track.id); }
          catch (error) { writeFailure = error; tx.abort(); }
        };
      }
    }
  } catch (error) { tx.abort(); await done.catch(() => {}); throw error; }
  await done.catch(error => { throw writeFailure ?? error; });
}

export async function deleteTrack(id: string) {
  const db = await openLibraryDatabase();
  const tx = db.transaction(['tracks', 'audio', 'covers', 'playlists', 'lyrics', 'analysis', 'analysis-edits', 'analysis-tasks'], 'readwrite');
  const done = completed(tx);
  for (const name of ['tracks', 'audio', 'covers', 'lyrics']) tx.objectStore(name).delete(id);
  tx.objectStore('analysis').delete(IDBKeyRange.bound([id], [id, []]));
  tx.objectStore('analysis-edits').delete(id);
  tx.objectStore('analysis-tasks').delete(IDBKeyRange.bound([id], [id, []]));
  const request = tx.objectStore('playlists').openCursor();
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    const playlist = cursor.value as LocalPlaylist;
    cursor.update({ ...playlist, trackIds: playlist.trackIds.filter(trackId => trackId !== id) });
    cursor.continue();
  };
  await done;
}

export async function saveAudioLyricsCopy(expected: LocalTrack, audio: Blob, lyrics: SavedLyrics): Promise<TrackRecord> {
  const db = await openLibraryDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['tracks', 'audio', 'lyrics'], 'readwrite');
    let updated: TrackRecord, failure: unknown;
    tx.oncomplete = () => resolve(updated);
    tx.onabort = () => reject(failure ?? tx.error ?? new Error('Audio copy save was cancelled.'));
    tx.onerror = () => {};
    const request = tx.objectStore('tracks').get(expected.id);
    request.onsuccess = () => {
      try {
        const latest = request.result as TrackRecord | undefined;
        if (!latest || latest.audioRevision !== expected.audioRevision || latest.lyricsWrittenAt !== expected.lyricsWrittenAt)
          throw new Error('This audio changed or was removed in another window. Reopen the song before writing lyrics.');
        updated = { ...latest, size: audio.size, originalSize: latest.originalSize ?? latest.size,
          audioRevision: latest.audioRevision ?? JSON.stringify([latest.id, latest.size, latest.lastModified, latest.addedAt]),
          lyricsWrittenAt: crypto.randomUUID(), embeddedLyricsChecked: true, lyricsWarning: undefined };
        tx.objectStore('audio').put(audio, latest.id);
        tx.objectStore('tracks').put(updated, latest.id);
        tx.objectStore('lyrics').put(lyrics, latest.id);
      } catch (error) { failure = error; tx.abort(); }
    };
  });
}

export async function saveSettings(settings: PlaybackSettings) {
  if (window.localMusicDesktop) return window.localMusicDesktop.setConfig('playback', settings);
  const db = await openLibraryDatabase();
  const tx = db.transaction('settings', 'readwrite');
  const done = completed(tx);
  tx.objectStore('settings').put(settings, 'playback');
  await done;
}

export async function saveLyricsAppearance(appearance: LyricsAppearance) {
  if (window.localMusicDesktop) return window.localMusicDesktop.setConfig('lyrics-appearance', validLyricsAppearance(appearance));
  const db = await openLibraryDatabase();
  const tx = db.transaction('settings', 'readwrite');
  const done = completed(tx);
  tx.objectStore('settings').put(validLyricsAppearance(appearance), 'lyrics-appearance');
  await done;
}

export async function saveTrackColumns(columns: TrackColumns) {
  if (window.localMusicDesktop) return window.localMusicDesktop.setConfig('track-columns', validTrackColumns(columns));
  const db = await openLibraryDatabase();
  const tx = db.transaction('settings', 'readwrite');
  const done = completed(tx);
  tx.objectStore('settings').put(validTrackColumns(columns), 'track-columns');
  await done;
}

export function storageError(error: unknown) {
  if (error instanceof DOMException && ['NotReadableError', 'NotFoundError'].includes(error.name)) {
    return 'The file cannot be accessed. Nothing was saved. Choose the original file again and check its access permissions.';
  }
  if (error instanceof DOMException && error.name === 'QuotaExceededError') {
    return 'Not enough browser storage. Nothing from this operation was saved. Free disk space or remove copies from this library, then try again.';
  }
  return `Local storage failed. This operation was not saved. ${error instanceof Error ? error.message : 'Check browser storage permissions and available disk space.'}`;
}
