import { t } from '../../i18n';
import { trackActivation } from './trackActivation';
import { Drawer } from 'antd';
import { useMemo } from 'react';
import { useAppDispatch, useAppSelector } from '../../store/store';
import { uiActions } from '../../store/slices/offlineUi';
import { getLocalPlayer } from '../../player/runtime';
import { ShuffleButton, RepeatButton } from './PlaybackModes';
import { VolumeIcon } from '../Icons';
import { trackCover } from '../../library/importFiles';

export function QueueDrawer() {
  const dispatch = useAppDispatch();
  const open = useAppSelector(state => state.ui.queueOpen);
  const queue = useAppSelector(state => state.player.queue), currentId = useAppSelector(state => state.player.currentId), volume = useAppSelector(state => state.player.volume);
  const tracks = useAppSelector(state => state.library.tracks);
  const byId = useMemo(() => new Map(tracks.map(track => [track.id, track])), [tracks]);
  return <Drawer title={t("Playback queue")} open={open} onClose={() => dispatch(uiActions.toggleQueue())} width={360}>
    {open && <><div className='offline-queue-modes'>
      <ShuffleButton /><RepeatButton /><VolumeIcon />
      <input type='range' min={0} max={1} step={0.01} value={volume} aria-label={t("Queue volume")}
        onChange={event => getLocalPlayer().setVolume(Number(event.target.value))} />
    </div>
    {!queue.length && <p className='offline-muted'>{t("Your queue is empty. Import music to get started.")}</p>}
    <ol className='offline-queue-list' aria-label={t("Queue tracks")}>
      {queue.map(id => {
        const track = byId.get(id);
        if (!track) return null;
        return <li key={id}>
          <button aria-current={id === currentId ? 'true' : undefined}
            {...trackActivation(id, () => getLocalPlayer().play(id))}>
            <img src={trackCover(track)} width={40} height={40} alt='' />
            <span>{track.name}<small>{track.error ? t("Unable to play") : id === currentId ? t("Current track") : track.artist || t("Local file")}</small></span>
          </button>
        </li>;
      })}
    </ol></>}
  </Drawer>;
}
