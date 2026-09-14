import { lineEnd, parseStudioTime, type StudioLine } from './model.ts';

export function studioTimeline(lines: readonly StudioLine[], duration: number) {
  const intervals = lines.map((line, index) => ({ id: line.id, start: parseStudioTime(line.start), end: lineEnd(lines, index, duration), text: line.text }));
  const gaps = new Map<string, { start: number; end: number }>();
  let end = -Infinity;
  for (const line of [...intervals].filter(line => line.text.trim() && line.start !== undefined && line.end !== undefined && line.end > line.start).sort((a, b) => a.start! - b.start!)) {
    if (Number.isFinite(end) && line.start! - end > 10) gaps.set(line.id, { start: end, end: line.start! });
    end = Math.max(end, line.end!);
  }
  return { intervals, gaps };
}
export function studioTimelineFrame({ intervals, gaps }: ReturnType<typeof studioTimeline>, time: number) {
  const activeIds = intervals.filter(line => line.text.trim() && line.start !== undefined && line.end !== undefined && line.end > line.start && time >= line.start && time < line.end).map(line => line.id);
  const interlude = !activeIds.length ? [...gaps].find(([, gap]) => time >= gap.start && time < gap.end)?.[0] : undefined;
  return { activeIds, gaps, interlude };
}
/** Keep context through pauses instead of jumping back to the editor selection. */
export function studioFollowTarget(timeline: ReturnType<typeof studioTimeline>, time: number) {
  if (time < 0) return undefined;
  const frame = studioTimelineFrame(timeline, time);
  if (frame.interlude) return `gap:${frame.interlude}`;
  if (frame.activeIds.length) return frame.activeIds[0];
  let before: (typeof timeline.intervals)[number] | undefined, first: typeof before;
  for (const line of timeline.intervals) {
    if (!line.text.trim() || line.start === undefined || line.end === undefined || line.end <= line.start) continue;
    if (!first || line.start < first.start!) first = line;
    if (line.start <= time && (!before || line.start > before.start!)) before = line;
  }
  return (before || first)?.id;
}
export const studioPlaybackFrame = (lines: readonly StudioLine[], time: number, duration: number) => studioTimelineFrame(studioTimeline(lines, duration), time);
