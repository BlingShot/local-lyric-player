import { useLayoutEffect, useMemo, useState } from 'react';
import { readAudioClock, subscribeAudioClock, type AudioClock } from './audioClock';
import { interludeBefore } from './interludes';
import { lineEnd, lyricFrame } from './timeline';
import type { LyricDocument } from './types';

export function useLyricFrame(document: LyricDocument, trackId: string, offsetMs: number) {
  const interludes = useMemo(() => interludeBefore(document), [document]);
  const boundaries = useMemo(() => [...new Set([
    ...document.lines.flatMap(line => [line.start, line.end ?? Infinity]),
    ...[...interludes.values()].flatMap(gap => [gap.start, gap.end]),
  ])].sort((a, b) => a - b), [document, interludes]);
  const frameAt = ({ time: actualTime, duration: actualDuration }: AudioClock) => {
    const time = actualTime - offsetMs / 1000, duration = actualDuration - offsetMs / 1000;
    const frame = lyricFrame(document, time, duration);
    const activeInterlude = !frame.activeIds.size ? [...interludes].find(([, gap]) => time >= gap.start && time < gap.end)?.[0] : undefined;
    return { ...frame, activeInterlude, pastIds: new Set(document.lines.filter(line => time >= lineEnd(line, duration)).map(line => line.id)) };
  };
  const [frame, setFrame] = useState(() => frameAt(readAudioClock()));
  useLayoutEffect(() => {
    let interval = -1, ended = false, duration = -1;
    return subscribeAudioClock(clock => {
      const time = clock.time - offsetMs / 1000;
      let low = 0, high = boundaries.length;
      while (low < high) { const middle = (low + high) >>> 1; if (boundaries[middle] <= time) low = middle + 1; else high = middle; }
      const atEnd = clock.duration > 0 && clock.time >= clock.duration;
      if (low === interval && ended === atEnd && duration === clock.duration) return;
      interval = low; ended = atEnd; duration = clock.duration;
      // React updates at line/voice/gap boundaries, never once per word frame.
      setFrame(frameAt(clock));
    });
  }, [document, trackId, offsetMs, boundaries]);
  return { ...frame, interludes };
}
