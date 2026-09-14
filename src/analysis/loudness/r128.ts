// ITU-R BS.1770 K weighting. Rate-dependent coefficients follow the equations
// documented in libebur128 (ebur128_init_filter). Independent double-precision
// biquads avoid the high-rate instability of a combined single-precision filter.
type Coefficients = [number, number, number, number, number];
function coefficients(rate: number): [Coefficients, Coefficients] {
  const k = Math.tan(Math.PI * 1681.974450955533 / rate), q = .7071752369554196;
  const vh = 10 ** (3.999843853973347 / 20), vb = vh ** .4996667741545416;
  const a = 1 + k / q + k * k;
  const h = Math.tan(Math.PI * 38.13547087602444 / rate), d = 1 + h / .5003270373238773 + h * h;
  return [[(vh + vb * k / q + k * k) / a, 2 * (k * k - vh) / a,
    (vh - vb * k / q + k * k) / a, 2 * (k * k - 1) / a, (1 - k / q + k * k) / a],
  [1, -2, 1, 2 * (h * h - 1) / d, (1 - h / .5003270373238773 + h * h) / d]];
}

export function r128Windows(channels: Float32Array[], rate: number) {
  const hop = Math.round(rate / 10), frames = channels[0].length;
  const energy = new Float64Array(Math.floor(frames / hop));
  const [shelf, highpass] = coefficients(rate);
  for (const channel of channels) {
    let s1 = 0, s2 = 0, h1 = 0, h2 = 0;
    for (let bucket = 0; bucket < energy.length; bucket++) {
      let sum = 0;
      for (let i = bucket * hop; i < (bucket + 1) * hop; i++) {
        const x = channel[i], y = shelf[0] * x + s1;
        s1 = shelf[1] * x - shelf[3] * y + s2; s2 = shelf[2] * x - shelf[4] * y;
        const z = highpass[0] * y + h1;
        h1 = highpass[1] * y - highpass[3] * z + h2; h2 = highpass[2] * y - highpass[4] * z;
        sum += z * z;
      }
      // Mono contributes once. Stereo channels contribute independently, even
      // when anti-phase; no downmix, normalization or rate conversion occurs.
      energy[bucket] += sum / hop;
    }
  }
  const windows = (size: number) => {
    const values: number[] = []; let sum = 0;
    for (let i = 0; i < energy.length; i++) {
      sum += energy[i]; if (i >= size) sum -= energy[i - size];
      if (i >= size - 1) values.push(sum > 0 ? -.691 + 10 * Math.log10(sum / size) : -Infinity);
    }
    return values;
  };
  return { momentary: windows(4), shortTerm: windows(30) };
}
