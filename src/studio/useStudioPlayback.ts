import { useEffect, useMemo, useState } from 'react';
import { getLocalAudioElement } from '../player/runtime';
import { studioTimeline, studioTimelineFrame } from './playbackFrame';
import type { StudioDraft } from './model';

export function useStudioPlayback(draft: StudioDraft, duration: number, enabled: boolean) {
  const [active, setActive] = useState<{ activeIds: string[]; interlude?: string }>({ activeIds: [] });
  const timeline = useMemo(() => studioTimeline(draft.lines, duration), [draft.lines, duration]);
  useEffect(() => {
    const audio = getLocalAudioElement(); let animation = 0;
    const sample = () => {
      const frame = enabled ? studioTimelineFrame(timeline, audio.currentTime) : { activeIds: [], interlude: undefined };
      setActive(previous => previous.interlude === frame.interlude && previous.activeIds.join('\0') === frame.activeIds.join('\0') ? previous : { activeIds: frame.activeIds, interlude: frame.interlude });
      animation = !audio.paused && !audio.ended ? requestAnimationFrame(sample) : 0;
    };
    const update = () => { cancelAnimationFrame(animation); sample(); };
    const events = ['timeupdate', 'seeking', 'seeked', 'playing', 'pause', 'ended', 'emptied', 'durationchange'];
    events.forEach(name => audio.addEventListener(name, update)); update();
    return () => { cancelAnimationFrame(animation); events.forEach(name => audio.removeEventListener(name, update)); };
  }, [timeline, draft.trackId, enabled]);
  return { ...active, gaps: timeline.gaps };
}
