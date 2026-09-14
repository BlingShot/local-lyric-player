import type { LocalTrack } from './importFiles.ts';

export interface LocalAlbum {
  id: string; name: string; artist: string; tracks: LocalTrack[]; coverUrl?: string;
  releaseDate?: string; uncertain: boolean;
}

const normalized = (value?: string) => value?.normalize('NFKC').trim().toLocaleLowerCase() || '';

export function albumKey(track: LocalTrack) {
  const album = normalized(track.album);
  if (track.albumGroup?.trim()) return JSON.stringify(['manual', normalized(track.albumGroup)]);
  // An untagged file is not evidence that it belongs to every other unknown album.
  if (!album) return JSON.stringify(['unknown', track.id]);
  const artist = normalized(track.albumArtist) || (track.compilation ? 'various artists' : normalized(track.artist));
  if (!artist) return JSON.stringify(['ambiguous', album, track.id]);
  return JSON.stringify(['album', album, artist, normalized(track.releaseDate)?.slice(0, 4)]);
}

export function sortAlbumTracks(tracks: readonly LocalTrack[]) {
  return [...tracks].sort((a, b) => (a.discNumber ?? 1) - (b.discNumber ?? 1)
    || (a.trackNumber ?? Infinity) - (b.trackNumber ?? Infinity));
}

export function buildAlbums(tracks: readonly LocalTrack[]): LocalAlbum[] {
  const albums = new Map<string, LocalAlbum>();
  for (const track of tracks) {
    const id = albumKey(track);
    let album = albums.get(id);
    if (!album) {
      album = { id, name: track.album || 'Unknown album',
        artist: track.albumArtist || (track.compilation ? 'Various artists' : track.artist) || 'Unknown artist',
        releaseDate: track.releaseDate, tracks: [], uncertain: !track.albumGroup && (!track.album || (!track.albumArtist && !track.compilation)) };
      albums.set(id, album);
    }
    album.tracks.push(track);
  }
  return [...albums.values()].map(album => {
    const sorted = sortAlbumTracks(album.tracks);
    return { ...album, tracks: sorted,
      coverUrl: sorted.find(t => t.artworkSource === 'embedded' && t.artworkType === 'front' && t.coverUrl)?.coverUrl
        || sorted.find(t => t.artworkSource === 'embedded' && t.coverUrl)?.coverUrl
        || sorted.find(t => t.coverUrl)?.coverUrl };
  });
}
