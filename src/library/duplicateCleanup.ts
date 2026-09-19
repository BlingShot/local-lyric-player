import { openLibraryDatabase, type LocalPlaylist, type TrackRecord, type SavedTrack } from './database';
import { fileContentHash, sameFileBytes } from './importFiles';

export interface DuplicateGroup { tracks: TrackRecord[] }
interface MergeBackup {
  key: string; createdAt: number; keepId: string; removed: TrackRecord[];
  before: LocalPlaylist[]; after: LocalPlaylist[];
}
const backupPrefix = 'duplicate-merge:';
const request = <T>(value: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error);
});
const identity = (track: TrackRecord) => JSON.stringify([
  track.id, track.size, track.audioRevision, track.metadataRevision, track.lyricsWrittenAt, track.lastModified,
]);
async function audioCopy(id: string) {
  const db = await openLibraryDatabase();
  return request(db.transaction('audio').objectStore('audio').get(id)) as Promise<Blob | undefined>;
}

/** Equal names are never evidence of equal audio. Only identical bytes qualify. */
export async function findDuplicateTracks(signal: AbortSignal, progress: (done: number, total: number) => void): Promise<DuplicateGroup[]> {
  const db = await openLibraryDatabase();
  const tracks = await request(db.transaction('tracks').objectStore('tracks').getAll()) as TrackRecord[];
  const bySize = new Map<number, TrackRecord[]>();
  for (const track of tracks) { const list = bySize.get(track.size) ?? []; list.push(track); bySize.set(track.size, list); }
  const candidates = [...bySize.values()].filter(group => group.length > 1).flat();
  const hashes = new Map<string, TrackRecord[]>();
  progress(0, candidates.length);
  for (const [index, track] of candidates.entries()) {
    signal.throwIfAborted();
    const audio = await audioCopy(track.id);
    if (audio && audio.size === track.size) {
      const hash = await fileContentHash(audio, signal), group = hashes.get(hash) ?? [];
      group.push(track); hashes.set(hash, group);
    }
    progress(index + 1, candidates.length);
  }
  return [...hashes.values()].filter(group => group.length > 1)
    .map(group => ({ tracks: group.sort((a, b) => (a.addedAt ?? 0) - (b.addedAt ?? 0)) }));
}

/** Keep the original stored assets for undo; do not touch the user's source files. */
export async function mergeDuplicateRecords(preview: readonly TrackRecord[], keepId: string, canRemove: (id: string) => boolean) {
  if (preview.length < 2 || new Set(preview.map(track => track.id)).size !== preview.length || !preview.some(track => track.id === keepId))
    throw new Error('Choose one retained song from a valid duplicate group.');
  const removedIds = preview.filter(track => track.id !== keepId).map(track => track.id);
  const keeperAudio = await audioCopy(keepId);
  if (!keeperAudio) throw new Error('The retained audio copy is unavailable.');
  for (const id of removedIds) {
    const audio = await audioCopy(id);
    if (!audio || !await sameFileBytes(keeperAudio, audio)) throw new Error('Audio changed since the preview. Scan for duplicates again.');
  }
  const db = await openLibraryDatabase();
  return new Promise<{ kept: TrackRecord; removedIds: string[]; playlists: LocalPlaylist[] }>((resolve, reject) => {
    const tx = db.transaction(['tracks', 'settings', 'playlists'], 'readwrite');
    let failure: unknown, result: { kept: TrackRecord; removedIds: string[]; playlists: LocalPlaylist[] };
    const current = new Map<string, TrackRecord>();
    let playlists: LocalPlaylist[] = [], settingKeys: IDBValidKey[] = [], pending = preview.length + 2;
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(failure ?? tx.error ?? new Error('Duplicate merge was cancelled.'));
    tx.onerror = () => {};
    const ready = () => {
      if (--pending) return;
      try {
        for (const expected of preview) {
          const latest = current.get(expected.id);
          if (!latest || identity(latest) !== identity(expected)) throw new Error('A song changed since the preview. Scan for duplicates again.');
        }
        for (const id of removedIds) {
          if (!canRemove(id)) throw new Error('Keep the current song to merge this group without interrupting playback.');
          if (settingKeys.some(key => key === 'lyric-studio:' + id || String(key).startsWith('lyric-studio-source-backup:' + encodeURIComponent(id) + ':')))
            throw new Error('A duplicate has a Studio draft or source backup. Keep that song or resolve its Studio drafts before merging.');
        }
        const records = preview.map(track => current.get(track.id)!);
        const kept: TrackRecord = { ...current.get(keepId)!,
          lastPlayedAt: Math.max(...records.map(track => track.lastPlayedAt ?? 0)) || undefined,
          addedAt: Math.min(...records.map(track => track.addedAt ?? Date.now())) };
        const removed = new Set(removedIds);
        const updated = playlists.map(playlist => ({ ...playlist,
          trackIds: [...new Set(playlist.trackIds.map(id => removed.has(id) ? keepId : id))] }));
        const changed = playlists.filter((playlist, index) => JSON.stringify(playlist.trackIds) !== JSON.stringify(updated[index].trackIds));
        const backup: MergeBackup = { key: backupPrefix + Date.now() + ':' + crypto.randomUUID(), createdAt: Date.now(),
          keepId, removed: removedIds.map(id => current.get(id)!), before: changed,
          after: changed.map(playlist => updated.find(item => item.id === playlist.id)!) };
        tx.objectStore('settings').add(backup, backup.key);
        tx.objectStore('tracks').put(kept, keepId);
        for (const id of removedIds) tx.objectStore('tracks').delete(id);
        for (const playlist of backup.after) tx.objectStore('playlists').put(playlist, playlist.id);
        // Audio, lyrics, artwork, analyses and Studio data remain keyed by the
        // original IDs. Undo restores those entries without reconstructing files.
        result = { kept, removedIds, playlists: updated };
      } catch (error) { failure = error; tx.abort(); }
    };
    for (const track of preview) {
      const get = tx.objectStore('tracks').get(track.id);
      get.onsuccess = () => { if (get.result) current.set(track.id, get.result); ready(); };
    }
    const getPlaylists = tx.objectStore('playlists').getAll();
    getPlaylists.onsuccess = () => { playlists = getPlaylists.result; ready(); };
    const getKeys = tx.objectStore('settings').getAllKeys();
    getKeys.onsuccess = () => { settingKeys = getKeys.result; ready(); };
  });
}

export async function latestDuplicateMerge(): Promise<MergeBackup | undefined> {
  const db = await openLibraryDatabase();
  const cursor = await request(db.transaction('settings').objectStore('settings')
    .openCursor(IDBKeyRange.bound(backupPrefix, backupPrefix + '\uffff'), 'prev'));
  return cursor?.value as MergeBackup | undefined;
}

/** Do not overwrite playlists edited after the merge. Audio and lyric records
 * were never removed, so reverting the visible library is lossless. */
export async function undoDuplicateMerge() {
  const backup = await latestDuplicateMerge();
  if (!backup) throw new Error('There is no duplicate merge to undo.');
  const db = await openLibraryDatabase();
  return new Promise<{ items: SavedTrack[]; playlists: LocalPlaylist[] }>((resolve, reject) => {
    const tx = db.transaction(['tracks', 'settings', 'playlists', 'audio', 'covers'], 'readwrite');
    let failure: unknown, pending = backup.removed.length * 3 + 2;
    const audio = new Map<string, Blob>(), covers = new Map<string, Blob>(), existing = new Set<string>();
    let playlists: LocalPlaylist[] = [], backupExists = false, result: { items: SavedTrack[]; playlists: LocalPlaylist[] };
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(failure ?? tx.error ?? new Error('The merge could not be undone.'));
    tx.onerror = () => {};
    const ready = () => {
      if (--pending) return;
      try {
        if (!backupExists || existing.size || backup.removed.some(track => !audio.has(track.id)))
          throw new Error('Library contents changed. The merge backup was kept.');
        const items = backup.removed.map(track => ({ track, audio: audio.get(track.id)!, cover: covers.get(track.id) }));
        for (const item of items) tx.objectStore('tracks').add(item.track, item.track.id);
        playlists = playlists.map(playlist => {
          const after = backup.after.find(item => item.id === playlist.id), before = backup.before.find(item => item.id === playlist.id);
          if (before && after && JSON.stringify(playlist.trackIds) === JSON.stringify(after.trackIds)) {
            const restored = { ...playlist, trackIds: before.trackIds };
            tx.objectStore('playlists').put(restored, restored.id); return restored;
          }
          return playlist;
        });
        tx.objectStore('settings').delete(backup.key);
        result = { items, playlists };
      } catch (error) { failure = error; tx.abort(); }
    };
    const getBackup = tx.objectStore('settings').getKey(backup.key);
    getBackup.onsuccess = () => { backupExists = getBackup.result !== undefined; ready(); };
    const getPlaylists = tx.objectStore('playlists').getAll();
    getPlaylists.onsuccess = () => { playlists = getPlaylists.result; ready(); };
    for (const track of backup.removed) {
      const getTrack = tx.objectStore('tracks').getKey(track.id);
      getTrack.onsuccess = () => { if (getTrack.result !== undefined) existing.add(track.id); ready(); };
      const getAudio = tx.objectStore('audio').get(track.id);
      getAudio.onsuccess = () => { if (getAudio.result instanceof Blob) audio.set(track.id, getAudio.result); ready(); };
      const getCover = tx.objectStore('covers').get(track.id);
      getCover.onsuccess = () => { if (getCover.result instanceof Blob) covers.set(track.id, getCover.result); ready(); };
    }
  });
}
