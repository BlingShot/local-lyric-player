import test from 'node:test';
import assert from 'node:assert/strict';
import { customIconPng } from '../electron/file-artwork.mjs';
import { png } from '../scripts/library-fixtures.mjs';

function resourceFork(image) {
  const chunk = Buffer.alloc(8); chunk.write('ic08'); chunk.writeUInt32BE(image.length + 8, 4);
  const icon = Buffer.concat([Buffer.from('icns'), Buffer.alloc(4), chunk, image]); icon.writeUInt32BE(icon.length, 4);
  const header = Buffer.alloc(256); header.writeUInt32BE(256); header.writeUInt32BE(icon.length + 4, 8);
  const size = Buffer.alloc(4); size.writeUInt32BE(icon.length);
  return Buffer.concat([header, size, icon]);
}
test('extracts PNG artwork from a macOS custom-icon resource fork', () => {
  const image = png(30, 70, 150);
  assert.deepEqual(customIconPng(resourceFork(image)), image);
});
test('rejects truncated, oversized and malformed custom icons', () => {
  const fork = resourceFork(png(30, 70, 150));
  assert.equal(customIconPng(fork.subarray(0, fork.length - 1)), undefined);
  fork.writeUInt32BE(0xffffffff, 272);
  assert.equal(customIconPng(fork), undefined);
  assert.equal(customIconPng(Buffer.alloc(21 * 1024 * 1024)), undefined);
});
