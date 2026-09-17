import { t } from '../../../../i18n';
import { useRef } from 'react';
import { shallowEqual } from 'react-redux';
import { useLocation, useNavigate } from 'react-router-dom';
import { Pause, Play, SkipBack, SkipNext, VolumeIcon, DetailsIcon, ListIcon, MicrophoneIcon } from '../../../Icons';
import { useAppDispatch, useAppSelector } from '../../../../store/store';
import { uiActions } from '../../../../store/slices/offlineUi';
import { getLocalPlayer } from '../../../../player/runtime';
import { PlayerProgress } from '../../../LocalTracks/PlayerProgress';
import { ShuffleButton, RepeatButton } from '../../../LocalTracks/PlaybackModes';
import { QueueDrawer } from '../../../LocalTracks/QueueDrawer';
import { trackCover } from '../../../../library/importFiles';

const statusLabels = { idle: 'Import music to start listening', loading: 'Loading audio…', playing: 'Playing',
  paused: 'Paused', ended: 'Playback ended', error: 'Unable to play this file' } as const;

export default function PlayingBar() {
  const dispatch = useAppDispatch();
  const location = useLocation(), navigate = useNavigate();
  const previousPage = useRef('/');
  const lyricsOpen = location.pathname === '/lyrics';
  if (!lyricsOpen) previousPage.current = location.pathname + location.search;
  const player = useAppSelector(({ player: p }) => ({ currentId: p.currentId, queue: p.queue, status: p.status, volume: p.volume, repeat: p.repeat, error: p.error }), shallowEqual);
  const track = useAppSelector(state => state.library.tracks.find(item => item.id === state.player.currentId));
  const failedTrack = useAppSelector(state => state.library.tracks.find(item => item.id === state.player.error?.trackId));
  const { detailsOpen, queueOpen, lyricsImmersive } = useAppSelector(state => state.ui);
  const playing = player.status === 'playing' || player.status === 'loading';
  const queueIndex = player.currentId ? player.queue.indexOf(player.currentId) : -1;
  const canNext = player.queue.length > 0 && (queueIndex < player.queue.length - 1 || player.repeat === 'all');
  return (
    <>
      {player.error && <div className='offline-playback-error' role='alert'>
        <span>{failedTrack?.name ? `“${failedTrack.name}”：` : ''}{t(player.error.message)}</span>
        <button aria-label={t("Dismiss playback error")} onClick={() => getLocalPlayer().dismissError()}>×</button>
      </div>}
      <footer className='offline-playing-bar' aria-label={t("Player")} inert={lyricsImmersive || undefined} aria-hidden={lyricsImmersive || undefined}>
        <div className='offline-song-details'>
          <img className='album-cover' src={trackCover(track)} alt='' width={56} height={56} />
          <div><p className='song-title'>{track?.name ?? t("No track selected")}</p>
            <p className='offline-muted' aria-live='polite'>{track?.artist && <span>{track.artist} · </span>}<span>{t(statusLabels[player.status])}</span></p></div>
        </div>
        <div className='offline-player-controls'>
          <div className='offline-transport' aria-label={t("Playback controls")}>
            <ShuffleButton />
            <button disabled={!player.currentId} aria-label={t("Previous")} title={t("Previous")} onClick={() => getLocalPlayer().previous()}><SkipBack /></button>
            <button disabled={!player.queue.length} aria-label={playing ? t("Pause") : t("Play")}
              className={`player-pause-button ${!player.queue.length ? 'disabled' : ''}`} onClick={() => getLocalPlayer().toggle()}>
              {playing ? <Pause /> : <Play />}
            </button>
            <button disabled={!canNext} aria-label={t("Next")} title={t("Next")} onClick={() => getLocalPlayer().next()}><SkipNext /></button>
            <RepeatButton />
          </div>
          <PlayerProgress />
        </div>
        <div className='offline-player-extra'>
          <button aria-label={t("Lyrics")} title={t("Lyrics")} aria-pressed={lyricsOpen} className='offline-icon-button offline-lyrics-button'
            onClick={() => navigate(lyricsOpen ? previousPage.current : '/lyrics')}><MicrophoneIcon /></button>
          <button aria-label={t("File details")} aria-pressed={detailsOpen} className='offline-icon-button offline-details-button'
            onClick={() => dispatch(uiActions.toggleDetails())}><DetailsIcon active={detailsOpen} /></button>
          <button aria-label={t("Playback queue")} aria-pressed={queueOpen} className='offline-icon-button'
            onClick={() => dispatch(uiActions.toggleQueue())}><ListIcon active={queueOpen} /></button>
          <VolumeIcon /><input type='range' min={0} max={1} step={0.01} value={player.volume} aria-label={t("Volume")}
            onChange={event => getLocalPlayer().setVolume(Number(event.target.value))} />
        </div>
      </footer>
      <QueueDrawer />
    </>
  );
}
