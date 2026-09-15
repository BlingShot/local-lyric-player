import type { LocalTrack } from './importFiles.ts';
import { buildAlbums } from './albums.ts';
import type { TechnicalField } from './technicalInfo.ts';
export type TrackSort = 'addedAt' | 'lastPlayedAt' | 'name' | 'artist' | 'album' | 'duration' | TechnicalField;
export const trackSortLabels: Record<TrackSort, string> = { lastPlayedAt: 'Last played', addedAt: 'Import order', name: 'Title', artist: 'Artist', album: 'Album', bitrate: 'Bitrate', sampleRate: 'Sample rate', bitsPerSample: 'Bit depth', duration: 'Duration' };
export function sortTracks(tracks: readonly LocalTrack[], field: TrackSort, descending = false) {
  const get = (track: LocalTrack) => ['bitrate', 'sampleRate', 'bitsPerSample'].includes(field) ? track.analysisMetadata?.[field as TechnicalField] : track[field as Exclude<TrackSort, TechnicalField>];
  return [...tracks].sort((a, b) => {
    const left = get(a), right = get(b);
    const missing = (value: unknown) => value === undefined || value === '' || typeof value === 'number' && !Number.isFinite(value);
    // Untagged values stay at the end in either direction.
    if (missing(left) || missing(right)) return Number(missing(left)) - Number(missing(right));
    const order = typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: 'base' });
    return descending ? -order : order;
  });
}
export function groupTracksByAlbum(tracks: readonly LocalTrack[]) {
  // Preserve the chosen album order, then use disc / track order within each album.
  return buildAlbums(tracks).flatMap(album => album.tracks);
}
