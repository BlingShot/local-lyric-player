import { openLibraryDatabase } from '../library/database';
import { store } from '../store/store';
import { loudnessCurrent } from '../analysis/loudness/repository';
import type { LoudnessRecord } from '../analysis/loudness/types';
import { defaultNormalization, normalizationGain, validNormalization, type NormalizationSettings } from './normalizationMath';
import { configPreference } from '../desktop/config';

interface NormalizationState { settings: NormalizationSettings; ready: boolean; saving: boolean; error: string; message: string; appliedDb: number; limited: boolean }
let state: NormalizationState = { settings: defaultNormalization, ready: false, saving: false, error: '', message: 'Off', appliedDb: 0, limited: false };
const listeners = new Set<() => void>();
export const subscribeNormalization = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const getNormalization = () => state;
const publish = (patch: Partial<NormalizationState>) => {
  if (Object.entries(patch).every(([key, value]) => state[key as keyof NormalizationState] === value)) return;
  state = { ...state, ...patch }; listeners.forEach(fn => fn());
};
let audio: HTMLAudioElement | undefined, context: AudioContext | undefined, source: MediaElementAudioSourceNode | undefined, gain: GainNode | undefined;
let currentId: string | null = null, records: LoudnessRecord[] = [], request = 0, disposed = false, unstore: (() => void) | undefined;
let tracks = store.getState().library.tracks;
let desiredGain = 1, scheduledGain: number | undefined, graphStarting: Promise<void> | undefined;
function apply(immediate = false) {
  const record = records.find(r => r.trackId === currentId && r.kind === 'loudness');
  const valid = record && loudnessCurrent(record, tracks) && record.result.replayGain;
  const output = normalizationGain(state.settings, valid || undefined);
  desiredGain = output.linear;
  if (context && gain && (immediate || scheduledGain !== output.linear)) {
    const now = context.currentTime;
    gain.gain.cancelScheduledValues(now);
    if (immediate) gain.gain.setValueAtTime(output.linear, now);
    else { gain.gain.setValueAtTime(gain.gain.value, now); gain.gain.linearRampToValueAtTime(output.linear, now + .08); }
    scheduledGain = output.linear;
  }
  publish({ appliedDb: output.db, limited: output.limited,
    message: !state.settings.enabled ? 'Off' : !currentId ? 'Select a song' : !valid
      ? record ? 'Saved measurement is stale or unmeasurable. Playing without gain.' : `No ${state.settings.mode} analysis. Playing without gain.`
      : `Track gain${output.limited ? ' · limited by true peak' : ''}${gain ? '' : ' · ready for playback'}` });
}
async function ensureGraph(prepareOnly = false) {
  if (disposed || !audio || (!prepareOnly && !state.settings.enabled && !source)) return;
  if (source && context?.state === 'running') return;
  if (graphStarting) return graphStarting;
  graphStarting = (async () => {
    try {
      // Decode through Electron/Chromium's native media pipeline. Let the output
      // device choose its rate; do not downsample music to the analysis rate.
      context ||= new AudioContext({ latencyHint: 'playback' });
      await context.resume();
      if (disposed || !audio || context.state !== 'running') return;
      if (prepareOnly || (!state.settings.enabled && !source)) return;
      // Connect only after the context can output audio. Off/default playback never
      // creates a graph. Once connected, disabling uses the same graph at unity.
      if (!source) {
        gain = context.createGain(); gain.gain.value = desiredGain;
        source = context.createMediaElementSource(audio);
        source.connect(gain); gain.connect(context.destination);
      }
      apply(true);
    } catch (error) { publish({ error: `Audio output could not start: ${error instanceof Error ? error.message : 'Web Audio unavailable'}. Press Play to retry.` }); }
    finally { graphStarting = undefined; }
  })();
  return graphStarting;
}
const gesture = () => { void ensureGraph(); };
async function reloadResults() {
  const token = ++request;
  try {
    const db = await openLibraryDatabase();
    const saved = await new Promise<LoudnessRecord[]>((resolve, reject) => {
      const r = db.transaction('analysis').objectStore('analysis').getAll(); r.onsuccess = () => resolve(r.result.filter((v: LoudnessRecord) => v && v.kind === 'loudness')); r.onerror = () => reject(r.error);
    });
    if (disposed || token !== request) return;
    records = saved; apply();
  } catch { if (!disposed) { records = []; apply(); publish({ error: 'Saved loudness results could not be read. Playback uses no gain.' }); } }
}
const analysisUpdated = () => { void reloadResults(); };
export function bindNormalization(element: HTMLAudioElement) {
  audio = element; disposed = false;
  document.addEventListener('pointerdown', gesture, true); document.addEventListener('keydown', gesture, true);
  audio.addEventListener('play', gesture);
  window.addEventListener('local-analysis-updated', analysisUpdated);
  unstore = store.subscribe(() => { const next = store.getState().library.tracks; if (next !== tracks) { tracks = next; apply(); } });
  void (async () => {
    try {
      const db = await openLibraryDatabase();
      const saved = await new Promise<NormalizationSettings | undefined>((resolve, reject) => {
        const r = db.transaction('settings').objectStore('settings').get('normalization'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
      });
      if (disposed) return;
      publish({ settings: validNormalization(await configPreference('normalization', saved)), ready: true }); await reloadResults();
    } catch { if (!disposed) publish({ ready: true, error: 'Normalization settings could not be restored. Normalization is off.' }); }
  })();
}
export function selectNormalizationTrack(id: string | null) {
  if (id === currentId) return;
  currentId = id; apply(true);
}
export async function updateNormalization(patch: Partial<NormalizationSettings>) {
  if (!state.ready || state.saving) return;
  const next = validNormalization({ ...state.settings, ...patch });
  publish({ saving: true, error: '' });
  // Start/resume inside the user's gesture; route audio only once it can run.
  const preparing = next.enabled ? ensureGraph(true) : undefined;
  try {
    if (window.localMusicDesktop) await window.localMusicDesktop.setConfig('normalization', next);
    else {
    const db = await openLibraryDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('settings', 'readwrite'); tx.objectStore('settings').put(next, 'normalization');
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error || new Error('Save cancelled'));
    });
    }
    publish({ settings: next, saving: false }); apply();
    await preparing; if (state.settings.enabled || source) void ensureGraph();
  } catch { publish({ saving: false, error: 'Normalization settings were not saved. Previous settings remain active.' }); apply(); }
}
export function disposeNormalization() {
  disposed = true; request++; unstore?.();
  document.removeEventListener('pointerdown', gesture, true); document.removeEventListener('keydown', gesture, true);
  audio?.removeEventListener('play', gesture); window.removeEventListener('local-analysis-updated', analysisUpdated);
  source?.disconnect(); gain?.disconnect(); void context?.close();
  context = undefined; gain = undefined; source = undefined; audio = undefined; currentId = null;
  scheduledGain = undefined;
}
