import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectFiles, filterTracks, fileFingerprint, sameFileBytes } from '../src/library/importFiles.ts';
const audio = (size = 128, name = '测试音频.WAV', fill = 0) => new File([new Uint8Array(size).fill(fill)], name, { lastModified: 100 });
test('an empty library stays empty with no selected files', async () => {
  const result = await collectFiles([], []); assert.deepEqual(result.tracks, []); assert.equal(result.duplicates, 0); assert.equal(result.rejected, 0);
});
test('only nonempty supported files are accepted', async () => {
  const result = await collectFiles([audio(), audio(5,'notes.txt'), audio(0)], []);
  assert.equal(result.tracks.length, 1); assert.equal(result.rejected, 2);
  assert.equal(result.tracks[0].dedupeFingerprint, fileFingerprint(audio()));
  assert.notEqual(result.tracks[0].id, fileFingerprint(audio()));
});
test('duplicates are verified within a batch and against saved bytes', async () => {
  const first = await collectFiles([audio(), audio()], []);
  assert.equal(first.tracks.length, 1); assert.equal(first.duplicates, 1);
  assert.equal(first.resolvedIds[0], first.resolvedIds[1]);
  const second = await collectFiles([audio(), audio(256)], first.tracks, t => first.originals.get(t.id));
  assert.equal(second.tracks.length, 1); assert.equal(second.duplicates, 1);
  assert.equal(second.resolvedIds[0], first.tracks[0].id);
});
test('F06 equal name, size and mtime cannot hide different audio or mix up source bytes', async () => {
  const files = [audio(128, 'same.wav', 1), audio(128,'same.wav',2)];
  const result = await collectFiles(files, []);
  assert.equal(result.tracks.length, 2); assert.equal(result.duplicates, 0);
  assert.notEqual(result.tracks[0].id, result.tracks[1].id);
  for (const [index, track] of result.tracks.entries()) assert.equal(result.originals.get(track.id), files[index]);
});
test('F06 legacy keys and edited tags keep associations; unavailable bytes do not prove a duplicate', async () => {
  const file = audio(), id = fileFingerprint(file), track = { id, name: 'Edited title', size: file.size, lastModified: 100 };
  const result = await collectFiles([file], [track], () => file);
  assert.equal(result.duplicates, 1); assert.deepEqual(result.resolvedIds, [id]); assert.equal(track.id,id);
  const unknown = await collectFiles([file], [track]); assert.equal(unknown.tracks.length,1);
});
test('F06 collision comparison reads bounded chunks and checks differences beyond the first chunk', async () => {
  const bytes = new Uint8Array(3 * 1024 * 1024 + 1), other = bytes.slice(); other[other.length-1] = 1;
  class BoundedBlob extends Blob {
    override slice(start?: number, end?: number) { assert.ok((end || 0) - (start || 0) <= 1024*1024); return super.slice(start, end); }
    override arrayBuffer(): Promise<ArrayBuffer> { throw new Error('Whole-file read forbidden'); }
  }
  assert.equal(await sameFileBytes(new BoundedBlob([bytes]),new BoundedBlob([other])),false);
});
test('search is local, case insensitive and treats URL-looking names as text', async () => {
  const { tracks } = await collectFiles([audio(), audio(128,'https-example.MP3')], []);
  assert.equal(filterTracks(tracks, '  wav ').length, 1); assert.equal(filterTracks(tracks, 'missing').length, 0); assert.equal(filterTracks(tracks, '').length, 2);
});
