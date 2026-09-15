import type { LyricPart } from './types';
const smooth = (value: number) => { const x = Math.max(0, Math.min(1, value)); return x * x * (3 - 2 * x); };
export function sustainedGlow(part: LyricPart, time: number): number {
  if (part.start === undefined || part.end === undefined || part.end - part.start < 1.2 || time <= part.start || time >= part.end) return 0;
  const elapsed = time - part.start, duration = part.end - part.start, progress = elapsed / duration;
  const envelope = smooth(elapsed / Math.min(.8, duration * .4)) * smooth((part.end - time) / Math.min(.65, duration * .3));
  return Math.max(0, Math.min(1, envelope * (.8 + .2 * Math.sin(Math.PI * progress))));
}
