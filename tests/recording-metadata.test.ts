import test from 'node:test';
import assert from 'node:assert/strict';
import { recordingMetadata } from '../src/library/recordingMetadata.ts';
import type { IAudioMetadata } from 'music-metadata';
test('reads local recording identifiers without requiring Spotify login', () => {
  const result = recordingMetadata({ common: { isrc: ['HK-G73-25-41765'], comment: [{ text: 'ordinary comment' },
    { text: 'https://open.spotify.com/track/0iNf5PLeDpBIrr9yBCprCR' }] } } as IAudioMetadata);
  assert.equal(result.isrc, 'HKG732541765');
  assert.equal(result.spotifyId, '0iNf5PLeDpBIrr9yBCprCR');
});
test('does not treat arbitrary URLs or malformed ISRC tags as identifiers', () => {
  const result = recordingMetadata({ common: { isrc: ['invalid'], comment: [{ text: 'https://example.com/track/0iNf5PLeDpBIrr9yBCprCR' }] } } as IAudioMetadata);
  assert.equal(result.isrc, undefined); assert.equal(result.spotifyId, undefined);
});
