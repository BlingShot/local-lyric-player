import { useEffect, useMemo, useState, type RefObject } from 'react';
import { subscribeAudioClock } from '../lyrics/audioClock';
import { studioFollowTarget, studioTimeline, studioTimelineFrame } from './playbackFrame';
import { lineBounds } from './validation';
import { msText, type StudioProject } from './project';

export function useStudioTimeline(project: StudioProject, duration: number) {
  return useMemo(() => studioTimeline(project.lines.map(l => {
    const b = lineBounds(project, l, Math.round(duration * 1000)); return { id: l.id, text: l.text, start: msText(b.start), end: msText(b.end) };
  }), duration, project.boundaries?.endMs == null ? undefined : project.boundaries.endMs / 1000), [project.lines, project.boundaries, duration]);
}
export function useProjectPlayback(project: StudioProject, duration: number, enabled: boolean, region: RefObject<HTMLDivElement | null>) {
  const timeline = useStudioTimeline(project, duration);
  const [focusId, setFocusId] = useState<string>();
  useEffect(() => {
    const root = region.current; if (!root) return;
    const rows = [...root.querySelectorAll<HTMLElement>('[data-line-id]')], gaps = [...root.querySelectorAll<HTMLElement>('[data-gap-id]')];
    let previousFocus: string | undefined | null = null;
    return subscribeAudioClock(clock => {
      const frame = studioTimelineFrame(timeline, enabled ? clock.time : -1), active = new Set(frame.activeIds);
      rows.forEach(row => row.toggleAttribute('data-playing', active.has(row.dataset.lineId!)));
      gaps.forEach(gap => gap.toggleAttribute('data-playing', gap.dataset.gapId === frame.interlude));
      const target = studioFollowTarget(timeline, enabled ? clock.time : -1);
      // A background row may be collapsed; keep its lead row in view instead.
      const line = project.lines.find(l => l.id === target);
      const visibleTarget = line?.parentId || target;
      if (previousFocus !== visibleTarget) { previousFocus = visibleTarget; setFocusId(visibleTarget); }
    });
  }, [timeline, enabled, region, project.selectedId]);
  return { gaps: timeline.gaps, focusId };
}
