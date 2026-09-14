import type { MouseEvent } from 'react';
import { store } from '../../store/store';
import { libraryActions } from '../../store/slices/library';

// Pointer single clicks select only; native keyboard activation stays accessible.
export function trackActivation(id: string, play: () => void) {
  return { onClick: (event: MouseEvent<HTMLElement>) => { store.dispatch(libraryActions.selectTrack(id)); if (event.detail === 0) play(); }, onDoubleClick: () => play() };
}
