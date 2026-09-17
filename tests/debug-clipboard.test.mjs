import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareClipboardReport } from '../electron/debug-clipboard.mjs';

test('native report copying validates type, size and schema and redacts again before writing', () => {
  for (const value of [null, 3, 'invalid JSON', 'null', '[]', '{}', 'x'.repeat(1024 * 1024 + 1)]) assert.throws(() => prepareClipboardReport(value));
  const result = prepareClipboardReport(JSON.stringify({ reportVersion: 1, environment: { apiKey: 'copy-secret' },
    audio: { path: '/home/PrivateName/Music/example.flac' }, lyrics: { current: 'Visible lyric' } }));
  assert.equal(JSON.parse(result).reportVersion, 1);
  assert.ok(result.includes('example.flac')); assert.ok(result.includes('Visible lyric'));
  assert.ok(!result.includes('copy-secret')); assert.ok(!result.includes('PrivateName'));
});
