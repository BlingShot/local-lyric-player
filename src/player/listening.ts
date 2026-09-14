import { useSyncExternalStore } from 'react';
import { ListeningCounter, emptyListeningTotals, parseListeningTotals, type ListeningTotals } from './listeningTime';

export const LISTENING_TIME_KEY = 'local-music-listening-time';
let snapshot: ListeningTotals & { error: string } = { ...emptyListeningTotals(Date.now()), error: '' };
const listeners = new Set<() => void>();
let retry = () => {};
export const retryListeningSave = () => retry();
export const useListeningTime = () => useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => snapshot);

/** Bound once to the app-owned element. No extra audio, interval, or per-tick disk writes. */
export function bindListeningTime(audio: HTMLAudioElement) {
  const counter = new ListeningCounter(emptyListeningTotals(Date.now()));
  let loaded = false, signature = '', lastSave = performance.now(), waiting = false;
  const publish = (error = snapshot.error) => {
    const v = counter.totals;
    if (error === snapshot.error && v.day === snapshot.day && Math.floor(v.totalMs / 1000) === Math.floor(snapshot.totalMs / 1000) && Math.floor(v.todayMs / 1000) === Math.floor(snapshot.todayMs / 1000)) return;
    snapshot = { ...v, error }; listeners.forEach(listener => listener());
  };
  const restore = () => {
    try { counter.totals = parseListeningTotals(localStorage.getItem(LISTENING_TIME_KEY), Date.now()); loaded = true; publish(''); }
    catch { publish('Listening time could not be restored. Its saved record has been preserved.'); }
    counter.resetAnchor();
  };
  const sample = () => {
    if (!loaded) return;
    counter.sample({ source: audio.currentSrc, mediaMs: audio.currentTime * 1000, monotonicMs: performance.now(), wallMs: Date.now(), rate: audio.playbackRate,
      playing: !audio.paused && !audio.ended && !audio.seeking && !waiting && audio.readyState >= 2 });
    publish();
  };
  const flush = () => {
    if (!loaded) return;
    const json = JSON.stringify(counter.totals); if (json === signature) return;
    lastSave = performance.now();
    try { localStorage.setItem(LISTENING_TIME_KEY, json); signature = json; publish(''); }
    catch { publish('Listening time is counted for this session but could not be saved. Check data storage and retry.'); }
  };
  const tick = () => { sample(); if (performance.now() - lastSave >= 60000) flush(); };
  const playing = () => { waiting = false; sample(); };
  const pause = () => { sample(); flush(); counter.resetAnchor(); };
  const stall = () => { sample(); waiting = true; counter.resetAnchor(); };
  // A stalled download can still have playable buffered audio.
  const downloadStalled = () => { if (audio.readyState < 3) stall(); };
  const reset = () => { counter.resetAnchor(); };
  const seeked = () => { waiting = false; counter.resetAnchor(); sample(); };
  const leave = () => { sample(); flush(); };
  const visibility = () => { sample(); if (document.hidden) flush(); };
  const events: [string, () => void][] = [['timeupdate', tick], ['playing', playing], ['pause', pause], ['ended', pause], ['waiting', stall], ['stalled', downloadStalled],
    ['seeking', reset], ['seeked', seeked], ['ratechange', seeked], ['emptied', reset], ['error', pause]];
  restore(); retry = () => { if (!loaded) restore(); else flush(); };
  events.forEach(([event, handler]) => audio.addEventListener(event, handler));
  window.addEventListener('pagehide', leave); window.addEventListener('beforeunload', leave); document.addEventListener('visibilitychange', visibility);
  return () => { leave(); events.forEach(([event, handler]) => audio.removeEventListener(event, handler)); window.removeEventListener('pagehide', leave); window.removeEventListener('beforeunload', leave); document.removeEventListener('visibilitychange', visibility); retry = () => {}; };
}
