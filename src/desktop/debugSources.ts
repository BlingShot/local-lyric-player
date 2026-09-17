import { store } from '../store/store';
import { getLocalAudioElement } from '../player/runtime';
import { readLyrics } from '../lyrics/repository';
import { lyricDebugSnapshot } from '../lyrics/debugSnapshot';
import type { SavedLyrics } from '../lyrics/types';
import { getAudioGraphDiagnostics } from '../player/normalization';
import { getAudioOutputDiagnostics } from '../player/audioOutput';
import { isDebugMode, registerDebugSource, diagnosticLog, diagnosticMetric, subscribeDebugMode } from './diagnostics';

let current: SavedLyrics | undefined, key = '', request = 0, dirty = 0, lastSignature = '';
let realtimeBitrate: number | undefined, bitrateTrack = '', bitrateAt = 0, bitratePending = false;
window.addEventListener('local-lyrics-updated', () => { if (isDebugMode()) dirty++; });
subscribeDebugMode(() => {
  if (!isDebugMode()) {
    request++; key = ''; current = undefined; lastSignature = '';
    realtimeBitrate = undefined; bitrateTrack = ''; bitrateAt = 0;
  }
});
const track = () => { const state = store.getState(); return state.library.tracks.find(track => track.id === state.player.currentId); };
function refreshRealtimeBitrate(audio: HTMLAudioElement, trackId: string) {
  const backend = (audio as HTMLAudioElement & { backendKind?: string }).backendKind || 'browser';
  const desktop = window.localMusicDesktop;
  if (!isDebugMode() || backend !== 'native' || !trackId || !desktop?.nativeAudioBitrate) {
    realtimeBitrate = undefined; bitrateTrack = trackId; return;
  }
  if (bitrateTrack !== trackId) { bitrateTrack = trackId; realtimeBitrate = undefined; bitrateAt = 0; }
  const now = performance.now();
  if (bitratePending || now - bitrateAt < 400) return;
  bitrateAt = now; bitratePending = true;
  const expected = trackId;
  void desktop.nativeAudioBitrate().then(value => {
    const state = store.getState();
    const currentAudio = getLocalAudioElement() as HTMLAudioElement & { backendKind?: string };
    if (!isDebugMode() || state.player.currentId !== expected || currentAudio.backendKind !== 'native') return;
    realtimeBitrate = typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
  }).catch(() => {
    if (store.getState().player.currentId === expected) realtimeBitrate = undefined;
  }).finally(() => { bitratePending = false; });
}
registerDebugSource('live', () => {
  const state = store.getState(), song = track();
  return { song: song && { id: song.id, name: song.name, artist: song.artist, fileName: song.fileName }, player: { ...state.player, queue: { length: state.player.queue.length, currentIndex: state.player.queue.indexOf(state.player.currentId || '') } } };
});
registerDebugSource('audio', () => {
  const audio = getLocalAudioElement(), song = track();
  refreshRealtimeBitrate(audio, song?.id || '');
  return { file: song && { name: song.fileName, bytes: song.size, unavailable: song.unavailable, ...song.analysisMetadata },
    pipeline: { backend: (audio as HTMLAudioElement & { backendKind?: string }).backendKind || 'browser', currentTime: audio.currentTime, duration: audio.duration, paused: audio.paused,
      readyState: audio.readyState, networkState: audio.networkState, playbackRate: audio.playbackRate, realtimeBitrate,
      error: audio.error && { code: audio.error.code, message: audio.error.message } },
    audioContext: getAudioGraphDiagnostics(), output: getAudioOutputDiagnostics() };
});
registerDebugSource('lyrics', () => {
  const state = store.getState(), id = state.player.currentId, next = `${id}:${dirty}`;
  if (next !== key) {
    key = next; current = undefined; lastSignature = ''; const token = ++request;
    if (id) void readLyrics(id).then(saved => { if (isDebugMode() && token === request) current = saved; }).catch(error => { if (token === request && isDebugMode()) diagnosticLog('warn', 'lyrics.debug', 'Could not read current lyrics.', { error }); });
  }
  const audio = getLocalAudioElement(), result = lyricDebugSnapshot(current, audio.currentTime, audio.duration, state.ui.lyricsAppearance);
  const readers = [...document.querySelectorAll<HTMLElement>('.lyrics-scroll')].slice(0, 3).map(element => ({ following: element.dataset.followReady, scrollTop: element.scrollTop,
    activeIds: [...element.querySelectorAll<HTMLElement>('[data-active=true][data-line-id]')].map(row => row.dataset.lineId) }));
  const signature = JSON.stringify([id, result.activeLines?.map(line => [line.id, line.currentWords.map(word => word.index)]), result.interlude, result.translation]);
  if (signature !== lastSignature) { lastSignature = signature; diagnosticLog('debug', 'lyrics.frame', 'Lyric/word/interlude state changed.', result); }
  return { ...result, rendered: readers };
});
// Observe media events only; never call play/load/resume or add a second AudioContext.
export function observeAudioDiagnostics(audio: HTMLAudioElement) {
  let started = 0, attempt = 0, previousId: string | null = null;
  for (const event of ['loadstart', 'loadedmetadata', 'canplay', 'playing', 'waiting', 'stalled', 'error', 'abort', 'ended']) audio.addEventListener(event, () => {
    const id = store.getState().player.currentId;
    if (event === 'loadstart') { started = performance.now(); attempt = id === previousId ? attempt + 1 : 1; previousId = id; }
    if (event === 'playing' && started) { diagnosticMetric('songSwitchMs', Math.round(performance.now() - started)); started = 0; }
    if (!isDebugMode() && event !== 'error') return;
    diagnosticLog(event === 'error' ? 'error' : 'debug', 'audio.media', event, { trackId: id, attempt, stage: event,
      readyState: audio.readyState, networkState: audio.networkState, error: audio.error && { code: audio.error.code, message: audio.error.message },
      playerError: store.getState().player.error, file: track()?.fileName });
  });
}
