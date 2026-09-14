import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLrc } from '../src/lyrics/parseLrc.ts';
import { lyricFrame, partProgress } from '../src/lyrics/timeline.ts';
import { accentFromPixels, DEFAULT_LYRICS_COLOR } from '../src/lyrics/coverColor.ts';
import { extractEmbeddedLrc } from '../src/lyrics/embedded.ts';
import { parseBuffer } from 'music-metadata';

test('LRC repeated timestamps, positive offset and blank instrumental lines', () => {
  const doc = parseLrc('[ti:Test]\n[offset:500]\n[00:01.00][00:04.00]Again\n[00:03.00]\n[00:06.00]Last');
  assert.deepEqual(doc.lines.map(line => [line.start, line.end]), [[.5, 2.5], [3.5, 5.5], [5.5, undefined]]);
  assert.equal(doc.timing, 'line');
  assert.equal(lyricFrame(doc, 3, 8).activeIds.size, 0);
  assert.equal(lyricFrame(doc, 8, 8).activeIds.size, 0);
  assert.equal(partProgress(doc.lines[0].parts[0], 1), undefined);
});
test('enhanced LRC uses given word boundaries and never divides an untimed last word', () => {
  const doc = parseLrc('[00:01.00]<00:01.00>One <00:02.00>two<00:03.00> three\n[00:05.00]Next');
  assert.equal(partProgress(doc.lines[0].parts[0], 1.5), .5);
  assert.equal(partProgress(doc.lines[0].parts[1], 2.75), .75);
  assert.equal(partProgress(doc.lines[0].parts[2], 3.5), undefined);
  assert.equal(doc.timing, 'mixed');
  assert.ok(doc.notices.some(note => note.includes('no usable end')));
});
test('multiple simultaneous LRC lines are active together; backwards seeks reset progress', () => {
  const doc = parseLrc('[00:01.000]Voice A\n[00:01.000]Voice B\n[00:03.000]Next');
  assert.equal(lyricFrame(doc, 2, 8).activeIds.size, 2);
  assert.equal(lyricFrame(doc, .1, 8).activeIds.size, 0);
  assert.equal(partProgress({ text: 'word', start: 1, end: 2 }, .5), 0);
  assert.equal(partProgress({ text: 'word', start: 1, end: 2 }, 3), 1);
});
test('unsupported LRC content and impossible word timing fail explicitly', () => {
  for (const source of ['Plain text', '[00:90.00]Bad', '[00:00.00]<00:02.00>A<00:01.00>B', '[00:00.00]<00:00.00>A<00:04.00>\n[00:03.00]Next', '[00:00]A\n[unknown:x]']) {
    assert.throws(() => parseLrc(source));
  }
});

test('cover accent preserves hue and uses a neutral fallback for grayscale', () => {
  assert.match(accentFromPixels([255, 0, 0, 255]), /^hsl\(0 /);
  assert.match(accentFromPixels([0, 0, 255, 255]), /^hsl\(240 /);
  assert.equal(accentFromPixels([128, 128, 128, 255]), DEFAULT_LYRICS_COLOR);
  assert.equal(accentFromPixels([255, 0, 0, 0]), DEFAULT_LYRICS_COLOR);
});
test('native FLAC LYRICS retains offset and word timestamps before generic normalization', async () => {
  const source = '[offset:500]\n[00:01.00]<00:01.00>Blue <00:02.00>sky<00:03.00>\n[00:05.00]Next';
  const streamInfo = Buffer.alloc(34);
  streamInfo.writeBigUInt64BE((8000n << 44n) | (15n << 36n) | 64000n, 10);
  const text = Buffer.from(`LYRICS=${source}`), vendorLength = Buffer.alloc(4), count = Buffer.alloc(4), textLength = Buffer.alloc(4);
  count.writeUInt32LE(1); textLength.writeUInt32LE(text.length);
  const comments = Buffer.concat([vendorLength, count, textLength, text]);
  const header = Buffer.alloc(4); header[0] = 0x84; header.writeUIntBE(comments.length, 1, 3);
  const flac = Buffer.concat([Buffer.from('fLaC'), Buffer.from([0, 0, 0, 34]), streamInfo, header, comments]);
  const metadata = await parseBuffer(flac, { mimeType: 'audio/flac' });
  const result = extractEmbeddedLrc(metadata);
  assert.equal(result.lyrics?.source, source);
  assert.equal(result.lyrics?.document.lines[0].start, .5);
  assert.equal(result.lyrics?.document.lines[0].parts[0].end, 1.5);
});
