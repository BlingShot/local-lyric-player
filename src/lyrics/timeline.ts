import type { LyricDocument, LyricLine, LyricPart } from './types.ts';

export function lineEnd(line: LyricLine, duration: number) {
  return line.end ?? (Number.isFinite(duration) && duration > 0 ? duration : Infinity);
}
export function partProgress(part: LyricPart, time: number): number | undefined {
  if (part.start === undefined || part.end === undefined || part.end <= part.start) return undefined;
  return Math.max(0, Math.min(1, (time - part.start) / (part.end - part.start)));
}
export function lyricFrame(document: LyricDocument, time: number, duration: number) {
  const active = document.lines.filter(line => time >= line.start && time < lineEnd(line, duration));
  // Keep simultaneous voices active. An overlapping background line never displaces the lead.
  const focus = active.find(line => line.role === 'lead') ?? active[0]
    ?? [...document.lines].reverse().find(line => line.start <= time) ?? document.lines[0];
  return { activeIds: new Set(active.map(line => line.id)), focusId: focus?.id };
}
