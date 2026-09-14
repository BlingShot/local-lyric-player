import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectFiles, filterTracks } from '../src/library/importFiles.ts';

const audio = { name: '测试音频.WAV', size: 128, lastModified: 100 };
test('an empty library stays empty with no selected files', () => {
  assert.deepEqual(collectFiles([], []), { tracks: [], rejected: 0, duplicates: 0 });
});
test('only nonempty supported file descriptions are accepted', () => {
  const result = collectFiles([audio, { ...audio, name: 'notes.txt' }, { ...audio, size: 0 }], []);
  assert.equal(result.tracks.length, 1);
  assert.equal(result.tracks[0].name, audio.name);
  assert.equal(result.rejected, 2);
  assert.deepEqual(Object.keys(result.tracks[0]).sort(), ['id', 'lastModified', 'name', 'size']);
});
test('duplicates are suppressed within a batch and against existing files', () => {
  const first = collectFiles([audio, audio], []);
  assert.equal(first.tracks.length, 1);
  assert.equal(first.duplicates, 1);
  const second = collectFiles([audio, { ...audio, size: 256 }], first.tracks);
  assert.equal(second.tracks.length, 1);
  assert.equal(second.duplicates, 1);
});
test('search is local, case insensitive and treats URL-looking names as text', () => {
  const { tracks } = collectFiles([audio, { ...audio, name: 'https-example.MP3' }], []);
  assert.equal(filterTracks(tracks, '  wav ').length, 1);
  assert.equal(filterTracks(tracks, 'missing').length, 0);
  assert.equal(filterTracks(tracks, '').length, 2);
});
