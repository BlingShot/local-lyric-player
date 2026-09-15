import { useState } from 'react';
import { store, useAppSelector } from '../store/store';
import { uiActions } from '../store/slices/offlineUi';
import { saveLyricsAppearance } from '../library/database';
import { validLyricsAppearance, type LyricsAppearance } from './appearance';
let queue: Promise<unknown> = Promise.resolve();
export function useAppearance() {
  const appearance = useAppSelector(state => state.ui.lyricsAppearance), [error, setError] = useState('');
  const update = (patch: Partial<LyricsAppearance>) => {
    const next = validLyricsAppearance({ ...store.getState().ui.lyricsAppearance, ...patch }); store.dispatch(uiActions.setLyricsAppearance(next));
    queue = queue.catch(() => {}).then(() => saveLyricsAppearance(next));
    void queue.then(() => setError('')).catch(() => setError('Appearance changed for this session but could not be saved.'));
  };
  return { appearance, update, error };
}
