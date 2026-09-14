import { t } from '../../i18n';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useAppSelector } from '../../store/store';
import { getLocalPlayer } from '../../player/runtime';
import { formatTime } from '../../library/importFiles';

export function PlayerProgress() {
  const { currentId, duration, position, status } = useAppSelector(state => state.player);
  const [draft, setDraft] = useState<number | null>(null);
  const dragging = useRef(false);
  useEffect(() => { dragging.current = false; setDraft(null); }, [currentId]);
  return <div className='offline-progress'>
    <span>{formatTime(draft ?? position)}</span>
    <input type='range' min={0} max={duration || 0} step={0.1}
      value={Math.min(draft ?? position, duration)} disabled={!duration || status === 'error'}
      style={{ '--progress-fill': `${duration > 0 ? Math.min(100, Math.max(0, (draft ?? position) / duration * 100)) : 0}%` } as CSSProperties}
      aria-label={t("Playback progress")} aria-valuetext={`${formatTime(draft ?? position)} / ${formatTime(duration)}`}
      onPointerDown={() => { dragging.current = true; }}
      onChange={event => {
        const value = Number(event.target.value);
        if (dragging.current) setDraft(value);
        else getLocalPlayer().seek(value);
      }}
      onPointerUp={event => {
        if (dragging.current) getLocalPlayer().seek(Number(event.currentTarget.value));
        dragging.current = false; setDraft(null);
      }}
      onPointerCancel={() => { dragging.current = false; setDraft(null); }}
      onBlur={event => {
        if (dragging.current) getLocalPlayer().seek(Number(event.currentTarget.value));
        dragging.current = false; setDraft(null);
      }} />
    <span>{formatTime(duration)}</span>
  </div>;
}
