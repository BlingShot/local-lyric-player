import type { LyricDocument } from './types.ts';

// Presentation markers only: never insert inferred lyric/word timings into the document.
export function interludeBefore(document: LyricDocument): Map<string, { start: number; end: number }> {
  const markers = new Map<string, { start: number; end: number }>();
  let previousStart: number | undefined, occupiedUntil = -Infinity;
  for (const line of document.lines) {
    if (previousStart !== undefined && line.start > previousStart) {
      if (Number.isFinite(occupiedUntil) && line.start - occupiedUntil > 10) markers.set(line.id, { start: occupiedUntil, end: line.start });
    }
    previousStart = line.start;
    occupiedUntil = Math.max(occupiedUntil, line.end ?? Infinity);
  }
  return markers;
}
