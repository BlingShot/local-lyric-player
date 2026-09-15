import { VolumeControl } from '../VolumeControl';
import { t } from '../../i18n';
import { AppSelect } from '../Menu';
import { useAppSelector } from '../../store/store';
import { getLocalPlayer } from '../../player/runtime';
import { useStudioAudio } from '../../studio/useStudioAudio';
import { PlayerProgress } from '../LocalTracks/PlayerProgress';
import { Pause, Play } from '../Icons';

export function StudioTransport({ trackId }: { trackId: string }) {
  const { rate, changeRate } = useStudioAudio();
  const status = useAppSelector(state => state.player.status);
  const currentId = useAppSelector(state => state.player.currentId);
  const error = useAppSelector(state => state.player.error);
  const playing = status === 'playing' || status === 'loading';
  return <footer className='studio-transport' aria-label={t("Studio player")}>
    {error && <p className='studio-audio-error' role='alert'>{t(error.message)}</p>}
    <button className='player-pause-button' aria-label={playing ? t("Pause") : t("Play")} disabled={currentId !== trackId || !currentId} onClick={() => getLocalPlayer().toggle()}>{playing ? <Pause /> : <Play />}</button>
    <PlayerProgress /><VolumeControl label="Studio volume" />
    <div className='studio-speed'>{t("Speed")}<AppSelect label={t("Playback speed")} value={String(rate)} onChange={value => changeRate(Number(value))} options={[.5, .75, 1, 1.25, 1.5].map(value => ({ value: String(value), label: `${value}×` }))} /></div>
  </footer>;
}
