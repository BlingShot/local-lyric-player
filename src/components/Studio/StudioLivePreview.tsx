import { vocalLayout, activeVocalLayout } from '../../lyrics/vocalLayout';
import { wordVisualProgress, rapidWord } from '../../lyrics/wordVisual';
import { sustainedGlow } from '../../lyrics/sustained';
import type { SyncTarget } from '../../studio/useWordRecording';
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
import { LYRIC_END } from '../../studio/sync';
import { useAppSelector } from '../../store/store';

export function StudioLivePreview({ project, durationMs, enabled, recordingWordIds, syncTarget }: { project: StudioProject; durationMs: number; enabled: boolean; recordingWordIds?: readonly string[]; syncTarget?: SyncTarget }) {
  const fonts = useLocalFonts();
  const appearance = useAppSelector(state => state.ui.lyricsAppearance);
  const { showVocalLabels } = appearance;
  const timeline = useStudioTimeline(project, durationMs / 1000);
  const visualLines = useMemo(() => groupVocalLines(project.lines, line => line.parentId || line.id), [project.lines]);
  const layout = useMemo(() => vocalLayout(project.lines.map(line => {
    const bounds = lineBounds(project, line, durationMs);
    return { id: line.id, groupId: line.parentId || line.id, role: line.role, agent: line.performerId, start: (bounds.start ?? Infinity) / 1000, end: bounds.end === null ? undefined : bounds.end / 1000 };
  })), [project.lines, durationMs]);
  const [focusId, setFocusId] = useState<string>();
  const follow = useLyricFollow(focusId, `${fonts.lyrics.family}:${appearance.translationSize}:${appearance.performerAlignment}`, true, project.trackId);
  useEffect(() => {
    const root = follow.viewport.current; if (!root) return;
    const rows = project.lines.map(l => ({ line: l, phase: '', bounds: lineBounds(project, l, durationMs), node: root.querySelector<HTMLElement>(`[data-preview-line="${CSS.escape(l.id)}"]`), words: l.units.map(w => ({ w, node: root.querySelector<HTMLElement>(`[data-preview-word="${CSS.escape(w.id)}"]`) })) }));
    const gaps = [...root.querySelectorAll<HTMLElement>('[data-preview-gap]')];
    const recordingWords = new Set(recordingWordIds);
    const recordingLines = project.lines.filter(line => line.units.some(word => recordingWords.has(word.id)));
    const boundary = root.querySelector<HTMLElement>('[data-preview-boundary]');
    let previousFocus: string | undefined | null = null;
    return subscribeAudioClock(clock => {
      const time = enabled ? Math.round(clock.time * 1000) : -1;
      const activeIds = new Set(rows.filter(row => recordingLines.some(line => line.id === row.line.id) || row.bounds.start !== null && row.bounds.end !== null && time >= row.bounds.start && time < row.bounds.end).map(row => row.line.id));
      const lanes = activeVocalLayout(layout, activeIds, appearance.performerAlignment);
      for (const row of rows) {
        const { line, bounds, node, words } = row;
        if (!node) continue;
        const lane = lanes.get(line.id);
        node.dataset.vocalSide = lane?.side || 'left';
        node.style.textAlign = lane?.side === 'right' ? 'right' : 'left';
        const recording = recordingLines.some(recordingLine => recordingLine.id === line.id);
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
          const timed = appearance.wordByWord && w.startMs !== null && w.endMs !== null && w.endMs > w.startMs;
          node.toggleAttribute('data-timed', timed);
          node.toggleAttribute('data-active', timed && time >= w.startMs! && time < w.endMs!);
          node.toggleAttribute('data-past', timed && time >= w.endMs!);
          node.toggleAttribute('data-recording', recordingWords.has(w.id));
          // Fill only from recorded media times. Untimed words retain line highlighting.
          const part = { text: w.text, start: w.startMs === null ? undefined : w.startMs / 1000, end: w.endMs === null ? undefined : w.endMs / 1000 };
          const visual = timed ? wordVisualProgress(part, phase === 'past' ? Infinity : time / 1000) : undefined;
          node.toggleAttribute('data-rapid', timed && rapidWord(part));
          node.style.setProperty('--word-visual', String(visual ?? 0));
          node.style.setProperty('--sustain-glow', String(timed ? sustainedGlow(part, time / 1000) : 0));
          node.style.setProperty('--studio-word-progress', `${(visual ?? 0) * 100}%`);
          const progress = timed ? (100 * Math.max(0, Math.min(1, (time - w.startMs!) / (w.endMs! - w.startMs!)))).toFixed(2) : undefined;
          if (progress !== node.dataset.progress) {
            if (progress === undefined) { delete node.dataset.progress; node.style.removeProperty('--studio-word-progress'); }
            else { node.dataset.progress = progress;  }
          }
        }
      }
      const ended = enabled && project.boundaries?.endMs != null && time >= project.boundaries.endMs;
      boundary?.toggleAttribute('data-active', ended);
      const cue = recordingLines.find(line => line.id === project.selectedId)?.id || (enabled ? syncTarget?.lineId : undefined) || recordingLines[0]?.id || studioFollowTarget(timeline, enabled ? clock.time : -1);
      const target = project.lines.find(l => l.id === cue)?.parentId || cue;
      gaps.forEach(node => node.toggleAttribute('data-active', node.dataset.interludeId === target));
      if (target !== previousFocus) { previousFocus = target; setFocusId(target); }
    });
  }, [project.lines, project.boundaries, project.selectedId, durationMs, enabled, timeline, recordingWordIds, appearance.wordByWord, appearance.performerAlignment, layout, syncTarget]);
  return <div className='studio-preview-panel' data-word-by-word={appearance.wordByWord}><div className='studio-live-preview' ref={follow.viewport} aria-label={t("Live lyric preview")} role='region' tabIndex={0}
    onWheel={follow.browse} onTouchStart={follow.browse} onKeyDown={e => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(e.key)) { e.stopPropagation(); follow.browse(); } }}>
    <div className='studio-preview-lines'>
    {visualLines.map(line => { const performer = project.performers.find(p => p.id === line.performerId), bounds = lineBounds(project, line, durationMs); return <Fragment key={line.id}>
      {timeline.gaps.has(line.id) && <div className='studio-preview-interlude' data-preview-gap data-interlude-id={`gap:${line.id}`} aria-label={t("Preview instrumental break")}>♪</div>}
      <div className='studio-preview-line' data-preview-line={line.id} data-line-id={line.id} data-vocal-group={line.parentId || line.id} data-popout={line.role === 'background' || undefined} data-background={line.role === 'background' || undefined} data-vocal-side={appearance.performerAlignment ? layout.get(line.id)?.side || 'left' : 'left'} style={{ textAlign: appearance.performerAlignment && layout.get(line.id)?.side === 'right' ? 'right' : 'left' }}>
      <div className='studio-popout-content'>
      <button className='studio-preview-seek' disabled={!enabled || bounds.start === null} aria-label={t("Seek preview: {0}", line.text)} onClick={() => { if (bounds.start !== null) { getLocalPlayer().seek(bounds.start / 1000); follow.resume(); } }}>
      {showVocalLabels && <small>{line.role === 'background' ? t("Background · ") : ''}{performer?.name}</small>}<span className='studio-preview-text' dir='auto'>{line.units.map(w => { const p = project.performers.find(p => p.id === (w.performerId || line.performerId)); return <span key={w.id} data-preview-word={w.id} title={showVocalLabels ? p?.name : undefined} style={{ borderColor: project.settings.colors ? p?.color : undefined }}>{w.text}</span>; })}</span>
      </button>
      {line.annotations.map(a => <p key={a.id} className='studio-preview-annotation' data-kind={a.kind} lang={a.language}>{a.text}</p>)}
    </div></div></Fragment>; })}
    {project.boundaries?.endMs != null && <div className='studio-preview-line studio-preview-boundary' data-preview-boundary data-line-id={LYRIC_END}>{t('End of Lyric')}</div>}
    </div>
  </div>{!follow.following && <button className='studio-follow-button' onClick={follow.resume}>{t("Resume preview")}</button>}</div>;
}
