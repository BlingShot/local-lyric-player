import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { TransferSHA256 } from '../src/transfer/sha256.ts';
test('transfer whole-file SHA-256 agrees with Node across block and chunk boundaries', () => {
  for (const length of [0,1,55,56,63,64,65,127,128,1024,1048579]) {
    const bytes = randomBytes(length), digest = new TransferSHA256();
    for (let offset = 0; offset < length; offset += 37) digest.update(bytes.subarray(offset, offset + 37));
    assert.equal(digest.hex(), createHash('sha256').update(bytes).digest('hex'), String(length));
    assert.throws(() => digest.update(bytes));
  }
});
