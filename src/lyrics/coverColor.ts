export const DEFAULT_LYRICS_COLOR = 'hsl(215 10% 19%)';

export function accentFromPixels(pixels: ArrayLike<number>): string {
  const bins = new Map<string, { weight: number; red: number; green: number; blue: number }>();
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    const red = pixels[i] / 255, green = pixels[i + 1] / 255, blue = pixels[i + 2] / 255;
    const max = Math.max(red, green, blue), min = Math.min(red, green, blue), light = (max + min) / 2;
    const saturation = max === min ? 0 : (max - min) / (1 - Math.abs(2 * light - 1));
    if (light < .08 || light > .92 || saturation < .12) continue;
    const weight = (.2 + saturation) * (1 - Math.abs(light - .5));
    const key = `${Math.floor(red * 10)}:${Math.floor(green * 10)}:${Math.floor(blue * 10)}`;
    const bin = bins.get(key) ?? { weight: 0, red: 0, green: 0, blue: 0 };
    bin.weight += weight; bin.red += red * weight; bin.green += green * weight; bin.blue += blue * weight;
    bins.set(key, bin);
  }
  const dominant = [...bins.values()].sort((a, b) => b.weight - a.weight)[0];
  if (!dominant) return DEFAULT_LYRICS_COLOR;
  const r = dominant.red / dominant.weight, g = dominant.green / dominant.weight, b = dominant.blue / dominant.weight;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  const hue = ((max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4) * 60 + 360) % 360;
  const saturation = delta / (1 - Math.abs(max + min - 1));
  // Keep the cover's hue while constraining brightness for white lyric contrast.
  return `hsl(${Math.round(hue)} ${Math.round(Math.min(48, Math.max(20, saturation * 55)))}% 22%)`;
}
