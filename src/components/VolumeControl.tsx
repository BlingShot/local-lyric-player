import { useRef } from 'react';
import { t } from '../i18n';
import { useAppSelector } from '../store/store';
import { getLocalPlayer } from '../player/runtime';
export function VolumeControl({ label = 'Volume' }: { label?: string }) {
  const volume = useAppSelector(state => state.player.volume), previous = useRef(.7);
  return <div className='shared-volume-control'><button aria-label={t(volume > 0 ? 'Mute' : 'Unmute')} title={t(volume > 0 ? 'Mute' : 'Unmute')} onClick={() => { if (volume > 0) { previous.current = volume; getLocalPlayer().setVolume(0); } else getLocalPlayer().setVolume(previous.current); }}>
    <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.8' aria-hidden='true'><path d='M4 9h4l5-4v14l-5-4H4z' />{volume > 0 ? <path d='M16 8q5 4 0 8M19 5q7 7 0 14' /> : <path d='m17 9 5 6m0-6-5 6' />}</svg>
  </button><input type='range' aria-label={t(label)} min={0} max={1} step={.01} value={volume} onChange={e => getLocalPlayer().setVolume(Number(e.target.value))} /><output>{Math.round(volume * 100)}%</output></div>;
}
