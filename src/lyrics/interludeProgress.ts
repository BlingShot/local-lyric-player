/** Three discrete thresholds, with no per-frame fill or looping animation. */
export function completedInterludeDots(start: number, end: number, time: number): number {
  if (!(end > start) || time <= start) return 0;
  if (time >= end) return 3;
  return Math.max(0, Math.min(3, Math.floor((time - start) / (end - start) * 3 + 1e-9)));
}

/** Handoff starts before the next vocal, and all space is reclaimed at its start. */
export const INTERLUDE_EXIT_SECONDS = .64;
const ease = (value: number) => { const x = Math.max(0, Math.min(1, value)); return x * x * (3 - 2 * x); };
export function interludePresentation(start: number, end: number, time: number, reduced = false) {
  if (!Number.isFinite(time) || !Number.isFinite(start) || !Number.isFinite(end) || end <= start || time < start || time >= end) {
    return { phase: 'hidden', space: 0, opacity: 0, y: 0, scale: 1 } as const;
  }
  if (reduced) return { phase: 'visible', space: 1, opacity: 1, y: 0, scale: 1 } as const;
  const enter = ease((time - start) / .48);
  const exit = ease((time - (end - INTERLUDE_EXIT_SECONDS)) / INTERLUDE_EXIT_SECONDS);
  return { phase: exit > 0 ? 'leaving' : enter < 1 ? 'entering' : 'visible',
    space: enter * (1 - exit), opacity: enter * (1 - exit), y: (1 - enter) * 8 - exit * 6,
    scale: 1 - .06 * (1 - enter) - .04 * exit };
}
