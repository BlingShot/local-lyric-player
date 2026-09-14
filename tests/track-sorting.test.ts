import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortTracks, groupTracksByAlbum } from '../src/library/sortTracks.ts';
import { technicalValue } from '../src/library/technicalInfo.ts';
const make = (id, bitrate, albumArtist = 'One', trackNumber = 1) => ({ id, name: id, size: 10, lastModified: 1, album: 'Shared name', albumArtist, trackNumber, analysisMetadata: { tags: {}, bitrate } });
test('numeric sorting keeps missing values last in both directions and equal values stable', () => {
  const tracks = [make('a', 320000), make('missing', undefined), make('b', 128000), make('c', 320000)];
  assert.deepEqual(sortTracks(tracks, 'bitrate').map(t => t.id), ['b', 'a', 'c', 'missing']);
  assert.deepEqual(sortTracks(tracks, 'bitrate', true).map(t => t.id), ['a', 'c', 'b', 'missing']);
  assert.equal(technicalValue(tracks[0], 'bitrate'), '320 kbps');
  assert.equal(technicalValue(tracks[0], 'bitsPerSample'), '—');
});
test('album grouping separates album artists, and uses disc/track order within the same album', () => {
  const tracks = [make('a2', 1, 'One', 2), make('b1', 1, 'Two'), make('a1', 1, 'One')];
  assert.deepEqual(groupTracksByAlbum(tracks).map(t => t.id), ['a1', 'a2', 'b1']);
  assert.deepEqual(tracks.map(t => t.id), ['a2', 'b1', 'a1']);
});
