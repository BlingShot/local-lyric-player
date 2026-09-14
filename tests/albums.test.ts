import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildAlbums, albumKey } from '../src/library/albums.ts';
import { filterTracks, type LocalTrack } from '../src/library/importFiles.ts';

const track = (id: string, tags: Partial<LocalTrack> = {}): LocalTrack =>
  ({ id, name: id, size: 100, lastModified: 0, ...tags });

test('album artists distinguish same-named albums while compilations retain different performers', () => {
  const albums = buildAlbums([
    track('a', { album: 'Shared', albumArtist: 'A', artist: 'Singer 1' }),
    track('b', { album: 'shared', albumArtist: 'A', artist: 'Singer 2' }),
    track('c', { album: 'Shared', albumArtist: 'B' }),
    track('d', { album: 'Mix', artist: 'One', compilation: true }),
    track('e', { album: 'Mix', artist: 'Two', compilation: true }),
  ]);
  assert.deepEqual(albums.map(album => album.tracks.length), [2, 1, 2]);
  assert.equal(albums[2].artist, 'Various artists');
});
test('missing tags stay conservative; manual grouping joins or separates ambiguous albums', () => {
  const unknown = [track('a'), track('b'), track('c', { album: 'Named' }), track('d', { album: 'Named' })];
  assert.equal(buildAlbums(unknown).length, 4);
  assert.equal(buildAlbums(unknown.map(t => ({ ...t, albumGroup: 'My album' }))).length, 1);
  assert.notEqual(albumKey(track('a', { albumGroup: 'Edition one' })), albumKey(track('a', { albumGroup: 'Edition two' })));
  assert.equal(buildAlbums([track('missing')])[0].name, 'Unknown album');
});
test('album tracks sort by disc then track and only count actual imports; embedded art wins', () => {
  const tags = { album: 'Partial', albumArtist: 'A' };
  const [album] = buildAlbums([
    track('late', { ...tags, discNumber: 2, trackNumber: 1, coverUrl: 'custom', artworkSource: 'custom' }),
    track('first', { ...tags, discNumber: 1, trackNumber: 2, coverUrl: 'front', artworkSource: 'embedded' }),
    track('unknown', tags),
  ]);
  assert.deepEqual(album.tracks.map(t => t.id), ['first', 'unknown', 'late']);
  assert.equal(album.tracks.length, 3);
  assert.equal(album.coverUrl, 'front');
});
test('local search covers title, track artist, album artist, album and original filename', () => {
  const tracks = [track('x', { name: 'Title', fileName: 'original.flac', artist: 'Singer', albumArtist: 'Ensemble', album: 'Record' })];
  for (const query of ['title', 'SINGER', ' Ensemble ', 'record', 'original']) assert.equal(filterTracks(tracks, query).length, 1);
  assert.equal(filterTracks(tracks, 'remote song').length, 0);
});
