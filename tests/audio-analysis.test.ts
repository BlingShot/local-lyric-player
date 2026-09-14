import test from 'node:test';
import assert from 'node:assert/strict';
import { checkAnalysisBudget } from '../src/analysis/audio/limits.ts';
import { MAX_AUDIO_FILE_BYTES } from '../src/analysis/audio/config.ts';
import { analysisMetadata } from '../src/library/analysisMetadata.ts';
import type { IAudioMetadata } from 'music-metadata';

test('full-track memory preflight accepts ordinary 44.1/48 kHz mono/stereo and rejects oversized or unsafe decodes', () => {
  for (const sampleRate of [44100, 48000]) for (const channels of [1, 2])
    assert.doesNotThrow(() => checkAnalysisBudget(10e6, { duration: 240, sampleRate, channels, tags: {} }));
  assert.throws(() => checkAnalysisBudget(MAX_AUDIO_FILE_BYTES + 1), /160 MiB/);
  assert.throws(() => checkAnalysisBudget(100, { duration: 901, sampleRate: 44100, channels: 1, tags: {} }), /No partial scan/);
  assert.throws(() => checkAnalysisBudget(100, { duration: 600, sampleRate: 96000, channels: 2, tags: {} }), /192 MiB/);
  for (const channels of [0, 1.5, 6, NaN]) assert.throws(() => checkAnalysisBudget(100, { duration: 60, sampleRate: 48000, channels, tags: {} }), /mono or stereo/);
  for (const duration of [undefined, 0, -1, Infinity]) assert.throws(() => checkAnalysisBudget(100, { duration, sampleRate: 48000, channels: 2, tags: {} }), /could not be read safely/);
});

test('embedded BPM, Key and ReplayGain retain their actual units and absent values remain absent', () => {
  const metadata = { common: { bpm: 123, key: 'F#m', replaygain_track_gain: { dB: -4.2, ratio: .38 }, replaygain_album_gain: { dB: 0, ratio: 1 }, replaygain_track_peak: { ratio: .82 } },
    format: { sampleRate: 48000, numberOfChannels: 2, duration: 32 } } as IAudioMetadata;
  const tags = analysisMetadata(metadata).tags;
  assert.equal(tags.bpm, 123); assert.equal(tags.key, 'F#m'); assert.equal(tags.trackGainDb, -4.2); assert.equal(tags.albumGainDb, 0); assert.equal(tags.trackPeak, .82);
  const missing = analysisMetadata({ common: {}, format: {} } as IAudioMetadata).tags;
  assert.ok(Object.values(missing).every(value => value === undefined));
});
