import { t, useLanguage } from '../../i18n';
import { Fragment, memo, useCallback, useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react';
import { groupVocalLines } from '../../lyrics/visualOrder';
import { readAudioClock, subscribeAudioClock } from '../../lyrics/audioClock';
import { useLyricFrame } from '../../lyrics/useLyricFrame';
import { useLyricFollow } from '../../lyrics/useLyricFollow';
import { partProgress } from '../../lyrics/timeline';
import type { LyricDocument, LyricLine } from '../../lyrics/types';
import { getLocalPlayer } from '../../player/runtime';
import { useAppSelector } from '../../store/store';

const LyricRow = memo(function LyricRow({ line, past, active, offsetMs, secondary, performer, agents, onSeek, showVocalLabels }: {
  line: LyricLine; past: boolean; active: boolean; offsetMs: number; secondary: boolean; performer?: string; agents: Record<string, string>; onSeek: (time: number) => void; showVocalLabels: boolean;
}) {
  useLanguage();
  const text = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (!text.current) return;
    const words = [...text.current.querySelectorAll<HTMLElement>('[data-part-index]')];
    if (!words.length) return;
    const update = (clock: ReturnType<typeof readAudioClock>) => {
      for (const word of words) {
        const progress = partProgress(line.parts[Number(word.dataset.partIndex)], clock.time - offsetMs / 1000)!;
        const value = progress.toFixed(4);
        if (word.dataset.wordProgress === value) continue;
        word.dataset.wordProgress = value;
        word.style.setProperty('--word-progress', `${progress * 100}%`);
      }
    };
    update(readAudioClock());
    if (active) return subscribeAudioClock(update);
  }, [line, active, past, offsetMs]);
  return <li className={`lyric-row ${line.role === 'background' ? 'lyric-background' : ''} ${secondary ? 'lyric-secondary' : ''}`}
    data-line-id={line.id} data-vocal-group={line.groupId} data-popout={line.role === 'background' || undefined} data-start={line.start} data-active={active || undefined} data-past={past || undefined}>
    <div className='lyric-popout-content' inert={line.role === 'background' && !active && !past || undefined}>
    <button className='lyric-line-button' aria-current={active ? 'true' : undefined}
      aria-label={t("Seek to {0}", line.parts.map(part => part.text).join(''))} onClick={() => onSeek(line.start)}>
      {showVocalLabels && (performer || line.role === 'background') && <span className='lyric-performer'>{line.role === 'background' ? t("Background vocals") : performer}{line.role === 'background' && performer ? ` · ${performer}` : ''}</span>}
      <span ref={text} className='lyric-text' dir='auto'>
        {line.parts.map((part, index) => {
          const progress = partProgress(part, past ? Infinity : -Infinity);
          return <span key={index} className={progress === undefined ? 'lyric-untimed' : 'lyric-word'} title={showVocalLabels && part.agent ? agents[part.agent] || part.agent : undefined} data-performer={part.agent ? agents[part.agent] || part.agent : undefined}
            data-part-index={progress === undefined ? undefined : index}
            data-word-progress={progress === undefined ? undefined : progress.toFixed(3)}
            style={progress === undefined ? undefined : { '--word-progress': `${progress * 100}%` } as CSSProperties}>{part.text}</span>;
        })}
      </span>
      {line.annotations.map((annotation, index) => <span key={index} lang={annotation.language} dir='auto' className={`lyric-annotation lyric-${annotation.kind}`}>{annotation.text}</span>)}
    </button></div>
  </li>;
});

export function LyricsView({ document, trackId, offsetMs = 0, fontKey = '', visible = true, entranceKey = '' }: {
  document: LyricDocument; trackId: string; offsetMs?: number; fontKey?: string; visible?: boolean; entranceKey?: string;
}) {
  const showVocalLabels = useAppSelector(state => state.ui.lyricsAppearance.showVocalLabels);
  const { activeIds, pastIds, focusId, activeInterlude, interludes } = useLyricFrame(document, trackId, offsetMs);
  const focusLine = document.lines.find(l => l.id === focusId);
  const scrollTarget = activeInterlude ? `interlude:${activeInterlude}` : focusLine?.role === 'background' ? document.lines.find(l => l.groupId === focusLine.groupId && l.role === 'lead')?.id || focusId : focusId;
  const { viewport, following, resume, browse } = useLyricFollow(scrollTarget, fontKey, visible, entranceKey);
  const resumeRef = useRef(resume); resumeRef.current = resume;
  const seek = useCallback((position: number) => { resumeRef.current(); getLocalPlayer().seek(Math.max(0, position + offsetMs / 1000)); }, [offsetMs]);
  const leadAgent = document.lines.find(line => line.role === 'lead' && line.agent)?.agent;
  const visualLines = useMemo(() => groupVocalLines(document.lines, line => line.groupId || line.id), [document.lines]);
  return <div className='lyrics-reader'>
    <div ref={viewport} className='lyrics-scroll' data-follow-ready='false' role='region' aria-label={t("Synced lyrics")} tabIndex={0}
      onWheel={browse} onTouchStart={browse}
      onKeyDown={event => { if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'].includes(event.key)) browse(); }}>
      <ol className='lyrics-lines'>
        {visualLines.map(line => <Fragment key={line.id}>
          {interludes.has(line.id) && <li className='lyric-interlude' aria-label={t("Instrumental break")} data-interlude-id={`interlude:${line.id}`}
            data-active={activeInterlude === line.id || undefined} data-past={activeIds.has(line.id) || pastIds.has(line.id) || undefined}><span aria-hidden='true'>♪</span></li>}
          <LyricRow line={line} agents={document.agents} onSeek={seek} active={activeIds.has(line.id)} showVocalLabels={showVocalLabels}
          past={pastIds.has(line.id)} offsetMs={offsetMs}
          secondary={!!line.agent && line.agent !== leadAgent}
          performer={line.agent?.split(/\s+/).map(id => document.agents[id] || id).join(' + ')} /></Fragment>)}
      </ol>
    </div>
    {!following && <button className='lyrics-resume' onClick={resume}>{t("Resume following")}</button>}
  </div>;
}
