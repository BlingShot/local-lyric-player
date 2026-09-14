import test from 'node:test';
import assert from 'node:assert/strict';
import { integratedLoudness, loudnessRange, measurePeaks, peakDb } from '../src/analysis/loudness/math.ts';
import { defaultNormalization, normalizationGain, validNormalization } from '../src/player/normalizationMath.ts';

test('true-peak interpolation detects inter-sample overs above the sample peak, with channel independence', () => {
  for (const rate of [44100, 48000, 96000]) {
    const pcm = Float32Array.from({ length: rate }, (_, i) => .9 * Math.sin(Math.PI * .5 * i + Math.PI / 4));
    const measured = measurePeaks([pcm, Float32Array.from(pcm, x => -x)]);
    assert.ok(Math.abs(measured.samplePeak - .9 / Math.sqrt(2)) < 1e-6);
    assert.ok(Math.abs(peakDb(measured.truePeak)! - peakDb(.9)!) < .3, JSON.stringify(measured));
    assert.ok(measured.truePeak > measured.samplePeak * 1.3);
  }
  assert.deepEqual(measurePeaks([new Float32Array(100)]), { samplePeak: 0, truePeak: 0 });
  assert.throws(() => measurePeaks([new Float32Array([NaN])]), /invalid samples/);
});
test('integrated loudness re-gates pooled energy and does not average dB or track gains', () => {
  assert.equal(integratedLoudness([]), null); assert.equal(integratedLoudness([-1000, -70, -Infinity]), null);
  assert.ok(Math.abs(integratedLoudness([-20, -40])! + 20) < 1e-10, 'Quiet blocks excluded by relative gate');
  const pooled = integratedLoudness([-20, -20, -25, -25])!;
  const expected = 10 * Math.log10((10 ** -2 + 10 ** -2.5) / 2);
  assert.ok(Math.abs(pooled - expected) < 1e-10);
  assert.ok(Math.abs(pooled - (-22.5)) > .6);
  assert.equal(loudnessRange([-20, -20, -40, -40]), 20);
  assert.equal(loudnessRange([]), null);
});
test('normalization defaults to unity, handles boost/cut and caps true peak independently of the volume slider', () => {
  assert.equal(normalizationGain(defaultNormalization, { gainDb: 5, truePeak: .9 }).linear, 1);
  const enabled = { ...defaultNormalization, enabled: true };
  assert.equal(normalizationGain(enabled).linear, 1);
  const limited = normalizationGain(enabled, { gainDb: 10, truePeak: .9 });
  assert.equal(limited.limited, true);
  assert.ok(Math.abs(20 * Math.log10(limited.linear * .9) + 1) < 1e-10);
  assert.equal(normalizationGain({ ...enabled, preventClipping: false, preampDb: 2 }, { gainDb: 5, truePeak: .9 }).db, 7);
  assert.equal(normalizationGain(enabled, { gainDb: -10, truePeak: .9 }).db, -10);
  assert.equal(normalizationGain(enabled, { gainDb: 5, truePeak: 0 }).linear, 1);
  assert.equal(validNormalization({ preampDb: Infinity, ceilingDbtp: 20 }).preampDb, 0);
  assert.equal(validNormalization({ ceilingDbtp: 20 }).ceilingDbtp, 0);
});

// Independent reference: FFmpeg ebur128 reports −23.0 LUFS mono / −20.0 stereo
// for this 997 Hz, −20 dBFS-peak tone at each rate (one decimal: ±0.05 LU).
// Anti-phase must not cancel.
test('double-precision K weighting stays stable from 44.1 to 192 kHz', async () => {
  const { r128Windows } = await import('../src/analysis/loudness/r128.ts');
  for (const rate of [44100, 48000, 96000, 192000]) {
    const mono = Float32Array.from({ length: rate * 4 }, (_, n) => .1 * Math.sin(2 * Math.PI * 997 * n / rate));
    const windows = r128Windows([mono], rate);
    assert.equal(windows.momentary.length, 37); assert.equal(windows.shortTerm.length, 11);
    assert.ok(Math.abs(integratedLoudness(windows.momentary)! + 23) < .05);
    const stereo = r128Windows([mono, mono.map(n => -n)], rate);
    assert.ok(Math.abs(integratedLoudness(stereo.momentary)! + 20) < .05);
  }
});
