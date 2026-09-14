import { useSyncExternalStore } from 'react';
import type { SavedLyrics } from './types';
import { getOffset, subscribeOffset, updateOffset } from './offsetState';

export function useLyricOffset(saved?: SavedLyrics) {
  const live = useSyncExternalStore(subscribeOffset, () => getOffset(saved?.trackId));
  const current = saved && live?.savedAt === saved.savedAt ? live : undefined;
  return { offsetMs: current?.offsetMs ?? saved?.offsetMs ?? 0, error: current?.error || '',
    update: (value: number) => saved ? updateOffset(saved, value) : Promise.resolve() };
}
