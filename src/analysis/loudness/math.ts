// ITU-R BS.1770-5 Annex 2: the published 48-tap, 4-phase interpolation filter.
// Floating point needs no initial -12.04 dB attenuation or compensating gain.
const phases = [
  [.001708984375, .010986328125, -.0196533203125, .033203125, -.0594482421875, .1373291015625, .97216796875, -.102294921875, .047607421875, -.026611328125, .014892578125, -.00830078125],
  [-.0291748046875, .029296875, -.0517578125, .089111328125, -.16650390625, .465087890625, .77978515625, -.2003173828125, .1015625, -.0582275390625, .0330810546875, -.0189208984375],
  [-.0189208984375, .0330810546875, -.0582275390625, .1015625, -.2003173828125, .77978515625, .465087890625, -.16650390625, .089111328125, -.0517578125, .029296875, -.0291748046875],
  [-.00830078125, .014892578125, -.026611328125, .047607421875, -.102294921875, .97216796875, .1373291015625, -.0594482421875, .033203125, -.0196533203125, .010986328125, .001708984375],
];
export function measurePeaks(channels: readonly Float32Array[]) {
  let samplePeak = 0, truePeak = 0;
  for (const channel of channels) {
    const history = new Float64Array(24);
    for (let n = 0; n < channel.length + 11; n++) {
      const sample = n < channel.length ? channel[n] : 0;
      if (!Number.isFinite(sample)) throw new Error('The decoded PCM contains invalid samples.');
      samplePeak = Math.max(samplePeak, Math.abs(sample));
      const head = 11 - n % 12; history[head] = history[head + 12] = sample;
      for (const phase of phases) {
        let value = 0;
        for (let k = 0; k < 12; k++) value += phase[k] * history[head + k];
        truePeak = Math.max(truePeak, Math.abs(value));
      }
    }
  }
  return { samplePeak, truePeak: Math.max(samplePeak, truePeak) };
}
const energy = (lufs: number) => 10 ** (lufs / 10);
const meanLoudness = (levels: readonly number[]) => 10 * Math.log10(levels.reduce((sum, value) => sum + energy(value), 0) / levels.length);
export function integratedLoudness(levels: readonly number[]): number | null {
  const absolute = levels.filter(value => Number.isFinite(value) && value > -70);
  if (!absolute.length) return null;
  const threshold = meanLoudness(absolute) - 10;
  return meanLoudness(absolute.filter(value => value > threshold));
}
export function loudnessRange(levels: readonly number[]): number | null {
  const absolute = levels.filter(value => Number.isFinite(value) && value > -70);
  if (!absolute.length) return null;
  const threshold = meanLoudness(absolute) - 20;
  const gated = absolute.filter(value => value >= threshold).sort((a, b) => a - b);
  return gated[Math.round((gated.length - 1) * .95)] - gated[Math.round((gated.length - 1) * .1)];
}
export const peakDb = (peak: number) => peak > 0 ? 20 * Math.log10(peak) : null;
