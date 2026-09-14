import { saveLyricOffset } from './repository';
import type { SavedLyrics } from './types';

interface OffsetState { savedAt: number; offsetMs: number; error: string; revision: number }
const offsets = new Map<string, OffsetState>();
const writes = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
let revision = 0;
export const subscribeOffset = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const getOffset = (trackId?: string) => trackId ? offsets.get(trackId) : undefined;
const publish = (trackId: string, state: OffsetState) => { offsets.set(trackId, state); listeners.forEach(listener => listener()); };

export async function updateOffset(saved: SavedLyrics, value: number) {
  if (!Number.isFinite(value)) return;
  const { trackId, savedAt } = saved;
  const state = { savedAt, offsetMs: Math.round(Math.max(-60000, Math.min(60000, value))), error: '', revision: ++revision };
  // Every visible reader and control updates immediately, including on save failure.
  // A delayed database reload cannot roll back a newer in-session adjustment.
  publish(trackId, state);
  const write = (writes.get(trackId) || Promise.resolve()).then(() => saveLyricOffset(trackId, state.offsetMs, savedAt));
  const settled = write.catch(error => {
    if (offsets.get(trackId)?.revision === state.revision) publish(trackId, { ...state,
      error: `Timing changed for this session but could not be saved. ${error instanceof Error ? error.message : 'Check browser storage.'}` });
  });
  writes.set(trackId, settled);
  await settled;
  if (writes.get(trackId) === settled) writes.delete(trackId);
}
