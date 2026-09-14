import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { parseBuffer } from 'music-metadata';
import { taggedWav, png } from '../scripts/library-fixtures.mjs';
import { writeAudioLyrics } from '../src/library/writeAudioLyrics.ts';
import { extractEmbeddedLrc, extractEmbeddedTtml } from '../src/lyrics/embedded.ts';

const source = '[00:01.000]繁體 & <light> 🌓\n[00:03.000]\n[00:04.000]Next line\n[00:06.000]\n';
const original = taggedWav({ TIT2: 'Original title', TPE1: 'Original artist', TALB: 'Original album' }, [{ type: 3, data: png(80, 150, 200) }], '[00:01.000]Old line\n', 8);
function payload(buffer, type) {
  if (type === 'wav') { let at = 12; while (at < buffer.length) { const size = buffer.readUInt32LE(at + 4); if (buffer.toString('ascii', at, at + 4) === 'data') return buffer.subarray(at + 8, at + 8 + size); at += 8 + size + size % 2; } }
  if (type === 'flac') { let at = 4, last = false; while (!last) { last = !!(buffer[at] & 128); at += 4 + buffer.readUIntBE(at + 1, 3); } return buffer.subarray(at); }
  if (type === 'mp3') { const size = buffer.toString('ascii', 0, 3) === 'ID3' ? 10 + buffer[6] * 2097152 + buffer[7] * 16384 + buffer[8] * 128 + buffer[9] : 0; return buffer.subarray(size); }
  throw new Error('No payload');
}
async function roundTrip(before, name, type) {
  const input = await parseBuffer(before), output = await writeAudioLyrics(new Blob([before]), name, source);
  const buffer = Buffer.from(await output.arrayBuffer()), parsed = await parseBuffer(buffer);
  assert.equal(extractEmbeddedLrc(parsed).lyrics?.source.trim(), source.trim());
  assert.equal(parsed.common.title, input.common.title); assert.equal(parsed.common.artist, input.common.artist); assert.equal(parsed.common.album, input.common.album);
  assert.deepEqual(parsed.common.picture, input.common.picture);
  assert.equal(parsed.format.duration, input.format.duration);
  assert.deepEqual(payload(buffer, type), payload(before, type), 'audio bytes must be identical');
  const repeat = Buffer.from(await (await writeAudioLyrics(output, name, source.replace('Next line', 'Replacement'))).arrayBuffer());
  const again = await parseBuffer(repeat);
  assert.equal(extractEmbeddedLrc(again).lyrics?.source.trim(), source.replace('Next line', 'Replacement').trim());
  assert.equal(again.common.lyrics.length, 1, 'replace the existing lyric entry');
  assert.deepEqual(payload(repeat, type), payload(before, type));
  const ttml = '<?xml version="1.0" encoding="UTF-8"?><tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="1s" end="2s"><span begin="1s" end="2s">春天 &amp; 光</span></p></div></body></tt>';
  const writtenTtml = Buffer.from(await (await writeAudioLyrics(new Blob([repeat]), name, ttml)).arrayBuffer());
  const ttmlTags = await parseBuffer(writtenTtml);
  assert.equal(extractEmbeddedTtml(ttmlTags), ttml);
  assert.deepEqual(payload(writtenTtml,type),payload(before,type));
  assert.deepEqual(ttmlTags.common.picture,input.common.picture);
  assert.equal(ttmlTags.common.lyrics.length,1);

}
test('WAV writes Unicode LRC, preserves artwork, other tags and PCM, and replaces previous lyrics', async () => {
  await roundTrip(original, 'test.wav', 'wav');
});
test('real FLAC and ID3v2.3 / v2.4 MP3 retain their compressed audio and cover', async () => {
  const root = resolve('test-results/tag-writer'); await mkdir(root, { recursive: true });
  await writeFile(resolve(root, 'source.wav'), original); await writeFile(resolve(root, 'cover.png'), png(80, 150, 200));
  for (const [file, options] of [['source.flac', ['-c:a', 'flac']], ['v3.mp3', ['-c:a', 'libmp3lame', '-id3v2_version', '3']], ['v4.mp3', ['-c:a', 'libmp3lame', '-id3v2_version', '4']]]) {
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', resolve(root, 'source.wav'), '-i', resolve(root, 'cover.png'), '-map', '0:a', '-map', '1:v', ...options, '-c:v', 'copy', '-disposition:v', 'attached_pic', resolve(root, file)], { windowsHide: true });
    await roundTrip(await readFile(resolve(root, file)), file, file.endsWith('flac') ? 'flac' : 'mp3');
  }
});
test('unsupported, corrupt and unsafe structures fail before any write', async () => {
  await assert.rejects(writeAudioLyrics(new Blob(['OggSaaaa']), 'test.ogg', source), /supports native FLAC/);
  await assert.rejects(writeAudioLyrics(new Blob(['fLaC\x80\x00\x00\x20']), 'broken.flac', source), /Malformed/);
  const bad = Buffer.from(original); bad.writeUInt32LE(0xffffff00, 40);
  await assert.rejects(writeAudioLyrics(new Blob([bad]), 'bad.wav', source), /Malformed/);
  const root = resolve('test-results/tag-writer');
  // An extended-header flag is rejected rather than discarding unknown structure.
  const mp3 = await readFile(resolve(root, 'v4.mp3')); mp3[5] = 64;
  await assert.rejects(writeAudioLyrics(new Blob([mp3]), 'unsafe.mp3', source), /not supported for safe writing/);
});
