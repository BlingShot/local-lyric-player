import { useLocalFonts } from '../../theme/fonts';
import { t } from '../../i18n';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { groupVocalLines } from '../../lyrics/visualOrder';
import { subscribeAudioClock } from '../../lyrics/audioClock';
import { useLyricFollow } from '../../lyrics/useLyricFollow';
import { getLocalPlayer } from '../../player/runtime';
import type { StudioProject } from '../../studio/project';
import { lineBounds } from '../../studio/validation';
import { useStudioTimeline } from '../../studio/useProjectPlayback';
import { studioFollowTarget } from '../../studio/playbackFrame';
import { useAppSelector } from '../../store/store';

export function StudioLivePreview({ project, durationMs, enabled, recordingWordId }: { project: StudioProject; durationMs: number; enabled: boolean; recordingWordId?: string }) {
  const fonts = useLocalFonts();
  const showVocalLabels = useAppSelector(state => state.ui.lyricsAppearance.showVocalLabels);
  const timeline = useStudioTimeline(project, durationMs / 1000);
  const visualLines = useMemo(() => groupVocalLines(project.lines, line => line.parentId || line.id), [project.lines]);
  const [focusId, setFocusId] = useState<string>();
  const follow = useLyricFollow(focusId, fonts.lyrics.family, true, project.trackId);
  useEffect(() => {
    const root = follow.viewport.current; if (!root) return;
    const rows = project.lines.map(l => ({ line: l, phase: '', bounds: lineBounds(project, l, durationMs), node: root.querySelector<HTMLElement>(`[data-preview-line="${CSS.escape(l.id)}"]`), words: l.units.map(w => ({ w, node: root.querySelector<HTMLElement>(`[data-preview-word="${CSS.escape(w.id)}"]`) })) }));
    const gaps = [...root.querySelectorAll<HTMLElement>('[data-preview-gap]')];
    const recordingLineId = project.lines.find(l => l.units.some(w => w.id === recordingWordId))?.id;
    let previousFocus: string | undefined | null = null;
    return subscribeAudioClock(clock => {
      const time = enabled ? Math.round(clock.time * 1000) : -1;
      for (const row of rows) {
        const { line, bounds, node, words } = row;
        if (!node) continue;
        const recording = line.id === recordingLineId;
        const active = recording || bounds.start !== null && bounds.end !== null && time >= bounds.start && time < bounds.end;
        const phase = active ? 'active' : bounds.end !== null && time >= bounds.end ? 'past' : 'future';
        if (phase === row.phase && !active) continue;
        if (phase !== row.phase) {
          row.phase = phase; node.toggleAttribute('data-active', active);
          if (line.role === 'background') { const content = node.firstElementChild as HTMLElement; if (content) content.inert = phase === 'future'; }
          node.toggleAttribute('data-past', phase === 'past'); node.toggleAttribute('data-current', line.id === project.selectedId);
        }
        for (const { w, node } of words) {
          if (!node) continue;
          const timed = w.startMs !== null && w.endMs !== null && w.endMs > w.startMs;
          node.toggleAttribute('data-timed', timed);
          node.toggleAttribute('data-active', timed && time >= w.startMs! && time < w.endMs!);
          node.toggleAttribute('data-past', timed && time >= w.endMs!);
          node.toggleAttribute('data-recording', w.id === recordingWordId);
          // Fill only from recorded media times. Untimed words retain line highlighting.
          const progress = timed ? (100 * Math.max(0, Math.min(1, (time - w.startMs!) / (w.endMs! - w.startMs!)))).toFixed(2) : undefined;
          if (progress !== node.dataset.progress) {
            if (progress === undefined) { delete node.dataset.progress; node.style.removeProperty('--studio-word-progress'); }
            else { node.dataset.progress = progress; node.style.setProperty('--studio-word-progress', `${progress}%`); }
          }
        }
      }
      const cue = recordingLineId || studioFollowTarget(timeline, enabled ? clock.time : -1);
      const target = project.lines.find(l => l.id === cue)?.parentId || cue;
      gaps.forEach(node => node.toggleAttribute('data-active', node.dataset.interludeId === target));
      if (target !== previousFocus) { previousFocus = target; setFocusId(target); }
    });
  }, [project.lines, project.boundaries, project.selectedId, durationMs, enabled, timeline, recordingWordId]);
  return <div className='studio-preview-panel'><div className='studio-live-preview' ref={follow.viewport} aria-label={t("Live lyric preview")} role='region' tabIndex={0}
    onWheel={follow.browse} onTouchStart={follow.browse} onKeyDown={e => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(e.key)) { e.stopPropagation(); follow.browse(); } }}>
    <div className='studio-preview-lines'>
    {visualLines.map(line => { const performer = project.performers.find(p => p.id === line.performerId), bounds = lineBounds(project, line, durationMs); return <Fragment key={line.id}>
      {timeline.gaps.has(line.id) && <div className='studio-preview-interlude' data-preview-gap data-interlude-id={`gap:${line.id}`} aria-label={t("Preview instrumental break")}>♪</div>}
      <div className='studio-preview-line' data-preview-line={line.id} data-line-id={line.id} data-vocal-group={line.parentId || line.id} data-popout={line.role === 'background' || undefined} data-background={line.role === 'background' || undefined} style={{ textAlign: project.settings.alignment && performer?.align !== 'auto' ? performer?.align : undefined }}>
      <div className='studio-popout-content'>
      <button className='studio-preview-seek' disabled={!enabled || bounds.start === null} aria-label={t("Seek preview: {0}", line.text)} onClick={() => { if (bounds.start !== null) { getLocalPlayer().seek(bounds.start / 1000); follow.resume(); } }}>
      {showVocalLabels && <small>{line.role === 'background' ? t("Background · ") : ''}{performer?.name}</small>}<span className='studio-preview-text' dir='auto'>{line.units.map(w => { const p = project.performers.find(p => p.id === (w.performerId || line.performerId)); return <span key={w.id} data-preview-word={w.id} title={showVocalLabels ? p?.name : undefined} style={{ borderColor: project.settings.colors ? p?.color : undefined }}>{w.text}</span>; })}</span>
      </button>
      {line.annotations.map(a => <p key={a.id} className='studio-preview-annotation' lang={a.language}>{a.text}</p>)}
    </div></div></Fragment>; })}
    </div>
  </div>{!follow.following && <button className='studio-follow-button' onClick={follow.resume}>{t("Resume preview")}</button>}</div>;
}
