import { useSyncExternalStore } from 'react';
import { configPreference } from '../desktop/config';
import { configureNativeOutput, type AudioOutputChoice } from './nativeAudio';
interface OutputState { settings: AudioOutputChoice; devices: { name: string; description: string }[]; busy: boolean; ready: boolean; error: string }
let state: OutputState = { settings: { device: 'browser', exclusive: false }, devices: [], busy: false, ready: false, error: '' };
const listeners = new Set<() => void>();
const publish = (patch: Partial<OutputState>) => { state = { ...state, ...patch }; listeners.forEach(fn => fn()); };
export const useAudioOutput = () => useSyncExternalStore(fn => { listeners.add(fn); return () => { listeners.delete(fn); }; }, () => state);
window.addEventListener('native-audio-error', event => publish({ error: (event as CustomEvent<string>).detail }));
export async function refreshAudioDevices() {
  if (!window.localMusicDesktop?.nativeAudioDevices) return;
  try { publish({ devices: await window.localMusicDesktop.nativeAudioDevices() }); }
  catch (error) { publish({ error: error instanceof Error ? error.message : 'Playback devices could not be loaded.' }); }
}
export async function updateAudioOutput(patch: Partial<AudioOutputChoice>, persist = true) {
  if (state.busy) return;
  const previous = state.settings, next = { ...previous, ...patch };
  if (next.device === 'browser' && next.exclusive) next.device = 'auto';
  publish({ busy: true, error: '' });
  try {
    await configureNativeOutput(next);
    if (persist && window.localMusicDesktop) await window.localMusicDesktop.setConfig('audio-output', next);
    publish({ settings: next });
  } catch (error) {
    let message = error instanceof Error ? error.message : 'The audio device could not be opened.';
    try { await configureNativeOutput(previous); } catch { message += ' Previous output could not resume. Select Browser audio to recover.'; }
    publish({ error: message });
  } finally { publish({ busy: false, ready: true }); }
}
export async function initializeAudioOutput() {
  const saved = await configPreference<AudioOutputChoice>('audio-output', { device: 'browser', exclusive: false });
  if (window.localMusicDesktop?.nativeAudioLoad && saved && (saved.device === 'auto' || /^wasapi\//.test(saved.device))) await updateAudioOutput({ device: saved.device, exclusive: saved.exclusive === true }, false);
  else publish({ ready: true });
}

export function getAudioOutputDiagnostics() { return { ...state.settings, deviceLabel: state.devices.find(device => device.name === state.settings.device)?.description, ready: state.ready, busy: state.busy, error: state.error }; }
