import type { AudioAnalysisMetadata } from './analysisMetadata';
// Serializable file descriptions. Audio and blob URLs are owned by the player runtime.
export interface LocalTrack {
  id: string;
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

export const fileId = (file: Pick<File, 'name' | 'size' | 'lastModified'>) =>
  JSON.stringify([file.name, file.size, file.lastModified]);

export function collectFiles(
  files: readonly Pick<File, 'name' | 'size' | 'lastModified'>[],
  existing: readonly LocalTrack[],
) {
  const known = new Set(existing.map(file => file.id));
  const tracks: LocalTrack[] = [];
  let rejected = 0;
  let duplicates = 0;
  for (const file of files) {
    if (!AUDIO_EXTENSION.test(file.name) || file.size === 0) {
      rejected++;
      continue;
    }
    // Preserve this identity across refreshes; edited display tags never change it.
    const id = fileId(file);
    if (known.has(id)) {
      duplicates++;
      continue;
    }
    known.add(id);
    tracks.push({ id, name: file.name, size: file.size, lastModified: file.lastModified });
  }
  return { tracks, rejected, duplicates };
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
