import { vocalLayout, activeVocalLayout, vocalScenes } from '../../lyrics/vocalLayout';
import { wordVisualProgress, rapidWord } from '../../lyrics/wordVisual';
import { sustainedGlow } from '../../lyrics/sustained';
import { Interlude } from './Interlude';
import './lyric-tools.css';
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

const LyricRow = memo(function LyricRow({ line, past, active, offsetMs, secondary, split, performer, agents, onSeek, showVocalLabels, wordByWord }: {
  line: LyricLine; past: boolean; active: boolean; offsetMs: number; secondary: boolean; split: boolean; performer?: string; agents: Record<string, string>; onSeek: (time: number) => void; showVocalLabels: boolean; wordByWord: boolean;
}) {
  useLanguage();
  const text = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (!text.current) return;
    const words = [...text.current.querySelectorAll<HTMLElement>('[data-part-index]')];
    if (!words.length) return;
    const update = (clock: ReturnType<typeof readAudioClock>) => {
      for (const word of words) {
        const part = line.parts[Number(word.dataset.partIndex)], time = clock.time - offsetMs / 1000;
        const progress = partProgress(part, time)!;
        const visual = wordVisualProgress(part, past ? Infinity : time)!;
        word.style.setProperty('--word-visual', String(visual));
        word.style.setProperty('--word-progress', `${visual * 100}%`);
        const glow = sustainedGlow(line.parts[Number(word.dataset.partIndex)], clock.time - offsetMs / 1000);
        word.style.setProperty('--sustain-glow', String(glow));
        word.dataset.sustained = glow > 0 ? 'true' : 'false';
        const value = progress.toFixed(4);
        if (word.dataset.wordProgress === value) continue;
        word.dataset.wordProgress = value;
      }
    };
    update(readAudioClock());
    if (active) return subscribeAudioClock(update);
  }, [line, active, past, offsetMs, wordByWord]);
  return <li className={`lyric-row ${line.role === 'background' ? 'lyric-background' : ''} ${secondary ? 'lyric-secondary' : ''}`}
    data-vocal-side={secondary ? 'right' : 'left'} data-duet={split || undefined} data-line-id={line.id} data-vocal-group={line.groupId} data-popout={line.role === 'background' || undefined} data-start={line.start} data-active={active || undefined} data-past={past || undefined}>
    <div className='lyric-popout-content' inert={line.role === 'background' && !active && !past || undefined}>
    <button className='lyric-line-button' aria-current={active ? 'true' : undefined}
      aria-label={t("Seek to {0}", line.parts.map(part => part.text).join(''))} onClick={() => onSeek(line.start)}>
      {showVocalLabels && (performer || line.role === 'background') && <span className='lyric-performer'>{line.role === 'background' ? t("Background vocals") : performer}{line.role === 'background' && performer ? ` · ${performer}` : ''}</span>}
      <span ref={text} className='lyric-text' dir='auto'>
        {line.parts.map((part, index) => {
          const progress = wordByWord ? partProgress(part, past ? Infinity : -Infinity) : undefined;
          return <span key={index} className={progress === undefined ? 'lyric-untimed' : 'lyric-word'} title={showVocalLabels && part.agent ? agents[part.agent] || part.agent : undefined} data-performer={part.agent ? agents[part.agent] || part.agent : undefined}
            data-rapid={progress !== undefined && rapidWord(part) || undefined} data-part-index={progress === undefined ? undefined : index}
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
  const appearance = useAppSelector(state => state.ui.lyricsAppearance);
  const { showVocalLabels } = appearance;
  const { activeIds, pastIds, focusId, activeInterlude, interludes } = useLyricFrame(document, trackId, offsetMs);
  const focusLine = document.lines.find(l => l.id === focusId);
  const scrollTarget = activeInterlude ? `interlude:${activeInterlude}` : focusLine?.role === 'background' ? document.lines.find(l => l.groupId === focusLine.groupId && l.role === 'lead')?.id || focusId : focusId;
  const { viewport, following, resume, browse } = useLyricFollow(scrollTarget, `${fontKey}:${appearance.translationSize}:${appearance.wordByWord}:${appearance.performerAlignment}`, visible, entranceKey);
  const resumeRef = useRef(resume); resumeRef.current = resume;
  const seek = useCallback((position: number) => { resumeRef.current(); getLocalPlayer().seek(Math.max(0, position + offsetMs / 1000)); }, [offsetMs]);
  const layout = useMemo(() => vocalLayout(document.lines), [document.lines]);
  const lanes = useMemo(() => activeVocalLayout(layout, activeIds, appearance.performerAlignment), [layout, activeIds, appearance.performerAlignment]);
  const visualLines = useMemo(() => groupVocalLines(document.lines, line => line.groupId || line.id), [document.lines]);
  const scenes = useMemo(() => vocalScenes(visualLines), [visualLines]);
  return <div className='lyrics-reader' data-has-duet={appearance.performerAlignment && [...layout.values()].some(lane => lane.split) || undefined} data-performer-alignment={appearance.performerAlignment} data-word-by-word={appearance.wordByWord}>
    <div ref={viewport} className='lyrics-scroll' data-follow-ready='false' role='region' aria-label={t("Synced lyrics")} tabIndex={0}
      onWheel={browse} onTouchStart={browse}
      onKeyDown={event => { if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'].includes(event.key)) browse(); }}>
      <ol className='lyrics-lines'>
        {scenes.map(scene => {
          const activeGroups = scene.groups.filter(group => group.some(line => activeIds.has(line.id)));
          const duet = appearance.performerAlignment && scene.groups.length > 1 && activeGroups.length !== 1;
          const rows = { left: 0, right: 0 };
          return <Fragment key={scene.id}>
            {scene.groups.flatMap(group => group.filter(line => interludes.has(line.id)).map(line => <Interlude key={line.id} id={line.id} gap={interludes.get(line.id)!} active={activeInterlude === line.id} offsetMs={offsetMs} onSeek={seek} />))}
            <li className='lyric-scene' data-duet={duet || undefined}><div className='lyric-scene-columns'>
              {scene.groups.map(group => {
                const lane = lanes.get(group[0].id), side = lane?.side || 'left';
                return <ol key={group[0].groupId} className='lyric-vocal-group' style={duet ? { gridColumn: side === 'right' ? 2 : 1, gridRow: ++rows[side] } : undefined}>
                  {group.map(line => <LyricRow key={line.id} line={line} agents={document.agents} onSeek={seek} active={activeIds.has(line.id)} showVocalLabels={showVocalLabels} wordByWord={appearance.wordByWord}
                    past={pastIds.has(line.id)} offsetMs={offsetMs} secondary={lanes.get(line.id)?.side === 'right'} split={duet}
                    performer={line.agent?.split(/\s+/).map(id => document.agents[id] || id).join(' + ')} />)}
                </ol>;
              })}
            </div></li>
          </Fragment>;
        })}
        {interludes.has('$outro') && <Interlude id='$outro' gap={interludes.get('$outro')!} active={activeInterlude === '$outro'} offsetMs={offsetMs} onSeek={seek} />}
      </ol>
    </div>
    {!following && <button className='lyrics-resume' onClick={resume}>{t("Resume following")}</button>}
  </div>;
}
