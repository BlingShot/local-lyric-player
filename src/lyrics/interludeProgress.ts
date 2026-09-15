/** Three discrete thresholds, with no per-frame fill or looping animation. */
export function completedInterludeDots(start: number, end: number, time: number): number {
  if (!(end > start) || time <= start) return 0;
  if (time >= end) return 3;
  return Math.max(0, Math.min(3, Math.floor((time - start) / (end - start) * 3 + 1e-9)));
}
