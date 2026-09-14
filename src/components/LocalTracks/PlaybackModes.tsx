import { t } from '../../i18n';
import { Replay, ReplayOne, ShuffleIcon } from '../Icons';
import { useAppSelector } from '../../store/store';
import { getLocalPlayer } from '../../player/runtime';

export const repeatLabels = { off: 'Off', all: 'All', one: 'One' } as const;

export function ShuffleButton() {
  const active = useAppSelector(state => state.player.shuffle);
  return <button aria-label={t("Shuffle")} aria-pressed={active} title={t("Shuffle")}
    onClick={() => getLocalPlayer().toggleShuffle()}><ShuffleIcon active={active} /></button>;
}

export function RepeatButton() {
  const repeat = useAppSelector(state => state.player.repeat);
  return <button aria-label={t("Repeat: {0}", repeatLabels[repeat])} title={t("Repeat: {0}", repeatLabels[repeat])}
    onClick={() => getLocalPlayer().cycleRepeat()}>
    {repeat === 'one' ? <ReplayOne active /> : <Replay active={repeat === 'all'} />}
  </button>;
}
