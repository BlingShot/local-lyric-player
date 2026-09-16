import type { AudioAnalysisMetadata } from './analysisMetadata';
// Serializable file descriptions. Audio and blob URLs are owned by the player runtime.
export interface LocalTrack {
  id: string;
  dedupeFingerprint?: string;
  name: string;
  size: number;
  originalSize?: number;
  lyricsWrittenAt?: string;
  lastModified: number;
  audioRevision?: string;
  metadataRevision?: string;
  analysisMetadata?: AudioAnalysisMetadata;
  duration?: number;
  durationChecked?: boolean;
  error?: string;
  fileName?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  trackNumber?: number;
  discNumber?: number;
  releaseDate?: string;
  compilation?: boolean;
  albumGroup?: string;
  tagWarning?: string;
  artworkSource?: 'embedded' | 'custom';
  artworkType?: 'front' | 'other';
  coverUrl?: string;
  unavailable?: boolean;
  addedAt?: number;
  lastPlayedAt?: number;
  embeddedLyricsChecked?: boolean;
  lyricsWarning?: string;
}

export const AUDIO_ACCEPT = '.mp3,.wav,.flac,.m4a,.aac,.ogg,.oga,.opus,.aiff,.aif,.webm';
const AUDIO_EXTENSION = /\.(mp3|wav|flac|m4a|aac|ogg|oga|opus|aiff|aif|webm)$/i;
export const isAudioFileName = (name: string) => AUDIO_EXTENSION.test(name);

/** A cheap candidate key, never a track ID or proof of byte equality. */
export const fileFingerprint = (file: Pick<File, 'name' | 'size' | 'lastModified'>) =>
  JSON.stringify([file.name, file.size, file.lastModified]);
// Retained only for legacy callers/import history; new records use UUIDs.
export const fileId = fileFingerprint;
export function trackFingerprint(track: LocalTrack): string {
  if (track.dedupeFingerprint) return track.dedupeFingerprint;
  try {
    const legacy = JSON.parse(track.id);
    if (Array.isArray(legacy) && legacy.length === 3 && typeof legacy[0] === 'string'
      && typeof legacy[1] === 'number' && typeof legacy[2] === 'number') return JSON.stringify(legacy);
  } catch { /* A UUID is not a legacy metadata key. */ }
  return fileFingerprint({ name: track.fileName || track.name, size: track.originalSize ?? track.size, lastModified: track.lastModified });
}
/** Compare only metadata-collision candidates; at most 2 MiB are read at once.
 * This avoids full-file copies/hashing for every ordinary import and yields to UI.
 */
export async function sameFileBytes(a: Blob, b: Blob): Promise<boolean> {
  if (a.size !== b.size) return false;
  const chunk = 1024 * 1024;
  for (let start = 0; start < a.size; start += chunk) {
    const [left, right] = await Promise.all([a.slice(start, start + chunk).arrayBuffer(), b.slice(start, start + chunk).arrayBuffer()]);
    const x = new Uint8Array(left), y = new Uint8Array(right);
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  return true;
}
export async function collectFiles(files: readonly File[], existing: readonly LocalTrack[],
  readAudio: (track: LocalTrack) => Blob | undefined | Promise<Blob | undefined> = () => undefined) {
  const candidates = new Map<string, LocalTrack[]>();
  for (const track of existing) {
    const key = trackFingerprint(track), list = candidates.get(key) || [];
    list.push(track); candidates.set(key, list);
  }
  const tracks: LocalTrack[] = [], originals = new Map<string, File>(), resolvedIds: (string | undefined)[] = [];
  let rejected = 0, duplicates = 0;
  for (const file of files) {
    if (!AUDIO_EXTENSION.test(file.name) || file.size === 0) { rejected++; resolvedIds.push(undefined); continue; }
    const fingerprint = fileFingerprint(file), possible = candidates.get(fingerprint) || [];
    let duplicate: LocalTrack | undefined;
    for (const candidate of possible) {
      const bytes = originals.get(candidate.id) || await readAudio(candidate);
      // Missing/rewritten audio cannot prove equivalence. Never silently skip it.
      if (bytes && await sameFileBytes(file, bytes)) { duplicate = candidate; break; }
    }
    if (duplicate) { duplicates++; resolvedIds.push(duplicate.id); continue; }
    const track = { id: crypto.randomUUID(), dedupeFingerprint: fingerprint, name: file.name,
      fileName: file.name, size: file.size, lastModified: file.lastModified };
    tracks.push(track); originals.set(track.id, file); resolvedIds.push(track.id);
    possible.push(track); candidates.set(fingerprint, possible);
  }
  return { tracks, originals, resolvedIds, rejected, duplicates };
}

export function filterTracks(tracks: readonly LocalTrack[], query: string) {
  const text = query.trim().toLocaleLowerCase();
  return tracks.filter(track => [track.name, track.fileName, track.artist, track.album, track.albumArtist]
    .some(value => value?.toLocaleLowerCase().includes(text)));
}

export const trackCover = (track?: LocalTrack) => track?.coverUrl || '/images/playlist.png';

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
