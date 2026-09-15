import type { LyricPart } from './types.ts';
import { partProgress } from './timeline.ts';
const smooth = (value: number) => { const x = Math.max(0, Math.min(1, value)); return x * x * (3 - 2 * x); };

/** Only presentation is eased. Original word timestamps and raw progress stay intact. */
export function wordVisualProgress(part: LyricPart, time: number): number | undefined {
  const raw = partProgress(part, time);
  if (raw === undefined || time <= part.start!) return raw;
  const duration = part.end! - part.start!;
  return duration < .18 ? smooth((time - part.start!) / .18) : raw;
}
export const rapidWord = (part: LyricPart) => part.start !== undefined && part.end !== undefined && part.end > part.start && part.end - part.start < .18;
