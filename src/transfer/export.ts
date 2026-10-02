import { openLibraryDatabase, type TrackRecord, type LocalPlaylist } from '../library/database';
import type { SavedLyrics } from '../lyrics/types';
import { TransferSHA256 } from './sha256';
import { studioRecoveries } from '../studio/repository';

export interface TransferResource { path: string; byteLength: number; sha256: string }
export interface TransferTrack {
  id: string; title: string; artist: string; album: string; albumArtist: string;
  releaseDate?: string; compilation?: boolean; albumGroup?: string;
  disc: number; number: number; duration: number; fileExtension: string;
  audio: string; cover?: string; lyrics?: string;
}
export interface TransferManifest {
  schemaVersion: 1; appVersion: string; exportedAt: string;
  resources: TransferResource[]; tracks: TransferTrack[];
  playlists: { id: string; name: string; trackIDs: string[] }[];
  omitted: string[];
}
const read = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
});
/** A single IDB transaction snapshots immutable Blob references and related metadata. */
async function snapshot() {
  const db = await openLibraryDatabase();
  const tx = db.transaction(['tracks', 'audio', 'covers', 'lyrics', 'playlists'], 'readonly');
  const done = new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); tx.onerror = () => {}; });
  const tracks = read(tx.objectStore('tracks').getAll()) as Promise<TrackRecord[]>;
  const playlists = read(tx.objectStore('playlists').getAll()) as Promise<LocalPlaylist[]>;
  const map = async <T>(name: string) => {
    const [keys, values] = await Promise.all([read(tx.objectStore(name).getAllKeys()), read(tx.objectStore(name).getAll())]);
    return new Map(keys.map((key, index) => [String(key), values[index] as T]));
  };
  const [t, p, audio, covers, lyrics] = await Promise.all([tracks, playlists, map<Blob>('audio'), map<Blob>('covers'), map<SavedLyrics>('lyrics'), done]);
  return { tracks: t, playlists: p, audio, covers, lyrics };
}
export async function exportTransfer(destination: FileSystemDirectoryHandle, signal: AbortSignal, progress: (message: string) => void) {
  const state = await snapshot();
  if (state.tracks.length > 10000) throw new Error('Transfer supports at most 10,000 tracks.');
  const folderName = 'LyricPlayer-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomUUID().slice(0,8);
  const folder = await destination.getDirectoryHandle(folderName, { create: true });
  const manifest: TransferManifest = {
    schemaVersion: 1, appVersion: 'electron-transfer-1', exportedAt: new Date().toISOString(), resources: [], tracks: [], playlists: [],
    omitted: ['Studio projects, source backups and recovery drafts remain on the source device; iOS does not import them.',
      'Analysis results/edits, preferences and playback memory are not migrated by this exporter. Credentials are never exported.']
  };
  const pending = studioRecoveries().length;
  if (pending) manifest.omitted.push(pending + ' unsaved Studio recovery entries remain on the source device.');
  async function write(path: string, blob: Blob) {
    signal.throwIfAborted();
    const components = path.split('/'); let parent = folder;
    for (const component of components.slice(0, -1)) parent = await parent.getDirectoryHandle(component, { create: true });
    const handle = await parent.getFileHandle(components.at(-1)!, { create: true });
    const stream = await handle.createWritable();
    const hash = new TransferSHA256();
    try {
      for (let offset = 0; offset < blob.size; offset += 1024 * 1024) {
        signal.throwIfAborted();
        const bytes = new Uint8Array(await blob.slice(offset, offset + 1024 * 1024).arrayBuffer());
        hash.update(bytes); await stream.write(bytes);
      }
      await stream.close();
    } catch (error) { await stream.abort().catch(() => {}); throw error; }
    manifest.resources.push({ path, byteLength: blob.size, sha256: hash.hex() });
  }
  try {
    let total = 0;
    for (const [index, track] of state.tracks.entries()) {
      progress((index + 1) + '/' + state.tracks.length + ' · ' + track.name);
      const audio = state.audio.get(track.id);
      if (!audio?.size) throw new Error('Missing audio copy: ' + track.name + '. Restore it before export.');
      if (audio.size > 512 * 1024 * 1024 || (total += audio.size) > 20 * 1024 ** 3) throw new Error('Transfer exceeds 512 MiB/file or 20 GiB total.');
      const ext = track.fileName?.split('.').at(-1)?.toLowerCase() || '';
      if (!/^(mp3|wav|flac|m4a|aac|ogg|oga|opus|aiff|aif|webm|mp4|caf)$/.test(ext)) throw new Error('Unknown audio extension: ' + track.name);
      const key = crypto.randomUUID();
      const row: TransferTrack = {
        id: track.id, title: track.name, artist: track.artist || '', album: track.album || '', albumArtist: track.albumArtist || '',
        releaseDate: track.releaseDate, compilation: track.compilation, albumGroup: track.albumGroup,
        disc: track.discNumber || 0, number: track.trackNumber || 0, duration: track.duration || 0,
        fileExtension: ext, audio: 'media/' + key + '.' + ext
      };
      await write(row.audio, audio);
      const cover = state.covers.get(track.id);
      if (cover?.size && cover.size <= 10 * 1024 * 1024) { row.cover = 'covers/' + key; await write(row.cover, cover); }
      const lyric = state.lyrics.get(track.id);
      if (lyric) {
        row.lyrics = 'lyrics/' + key + '.json';
        const bytes = new Blob([JSON.stringify({ source: lyric.source, fileName: lyric.fileName, offsetMs: lyric.offsetMs || 0 })]);
        if (bytes.size > 8 * 1024 * 1024) throw new Error('Lyric resource exceeds budget.');
        await write(row.lyrics, bytes);
        if (lyric.alternates?.length) manifest.omitted.push('Alternate lyric sources remain on source: ' + track.name);
      }
      manifest.tracks.push(row);
    }
    const ids = new Set(manifest.tracks.map(track => track.id));
    manifest.playlists = state.playlists.map(list => ({ id: list.id, name: list.name, trackIDs: list.trackIds.filter(id => ids.has(id)) }));
    // Manifest last: incomplete folders can never be mistaken for complete packages.
    const file = await folder.getFileHandle('manifest.json', { create: true });
    const stream = await file.createWritable();
    await stream.write(JSON.stringify(manifest, null, 2)); await stream.close();
    progress('Exported ' + manifest.tracks.length + ' tracks to ' + folderName + '. Select this folder in iOS Settings → Import transfer folder. Studio and analysis data remain on this device.');
  } catch (error) {
    await destination.removeEntry(folderName, { recursive: true }).catch(() => {});
    throw error;
  }
}
