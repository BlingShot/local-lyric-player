import type { LyricDocument } from './types.ts';

export interface LyricGap { start: number; end: number; kind: 'intro' | 'middle' | 'outro' }
// Union of all vocal intervals, including backing vocals which outlast the lead.
export function interludeBefore(document: LyricDocument, duration = 0): Map<string, LyricGap> {
  const markers = new Map<string, LyricGap>();
  const lines = [...document.lines].sort((a, b) => a.start - b.start);
  if (!lines.length) return markers;
  if (lines[0].start >= 5) markers.set(lines[0].id, { start: 0, end: lines[0].start, kind: 'intro' });
  let occupiedUntil = -Infinity;
  for (const line of lines) {
    if (Number.isFinite(occupiedUntil) && line.start - occupiedUntil > 10) markers.set(line.id, { start: occupiedUntil, end: line.start, kind: 'middle' });
    occupiedUntil = Math.max(occupiedUntil, line.end ?? Infinity);
  }
  if (Number.isFinite(duration) && Number.isFinite(occupiedUntil) && duration - occupiedUntil >= 5) markers.set('$outro', { start: occupiedUntil, end: duration, kind: 'outro' });
  return markers;
}
