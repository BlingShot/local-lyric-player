import { nativeVolumePercent } from './normalizationMath';
import { getNormalization, subscribeNormalization, setNativeNormalizationMode } from './normalization';
export interface AudioOutputChoice { device: string; exclusive: boolean }
type NativeState = Parameters<NonNullable<Window['localMusicDesktop']>['onNativeAudioState']>[0] extends (state: infer T) => void ? T : never;
let switchOutput: ((choice: AudioOutputChoice) => Promise<void>) | undefined;
export async function configureNativeOutput(choice: AudioOutputChoice) {
  if (!switchOutput) { if (choice.device !== 'browser') throw new Error('Audio player is not ready.'); return; }
  await switchOutput(choice);
}
const report = (error: unknown) => window.dispatchEvent(new CustomEvent('native-audio-error', { detail: error instanceof Error ? error.message : String(error) }));

export function attachNativeAudio(audio: HTMLAudioElement, getBlob: () => Blob | undefined) {
  const desktop = window.localMusicDesktop;
  if (!desktop?.nativeAudioLoad) return;
  const properties = new Map<string, PropertyDescriptor>();
  for (let prototype = Object.getPrototypeOf(audio); prototype; prototype = Object.getPrototypeOf(prototype)) for (const key of Object.getOwnPropertyNames(prototype)) if (!properties.has(key)) properties.set(key, Object.getOwnPropertyDescriptor(prototype, key)!);
  const read = (key: string) => properties.get(key)?.get?.call(audio);
  const write = (key: string, value: unknown) => properties.get(key)?.set?.call(audio, value);
  const originalPlay = audio.play.bind(audio), originalPause = audio.pause.bind(audio), originalLoad = audio.load.bind(audio), originalRemove = audio.removeAttribute.bind(audio);
  let choice: AudioOutputChoice = { device: 'browser', exclusive: false }, switching = false, synthetic = false, generation = 0, pending: Promise<void> = Promise.resolve();
  let source = '', volume = audio.volume, speed = audio.playbackRate, sampleAt = performance.now(), mediaError: MediaError | null = null;
  let state: NativeState = { id: '', time: 0, duration: 0, paused: true, ended: false, ready: false };
  let snapshot: { time: number; duration: number; src: string; currentSrc: string; readyState: number; ended: boolean } | undefined;
  let browserEvent: ((event: Event) => void) | undefined;
  const native = () => choice.device !== 'browser';
  const emit = (event: string) => { if (switching) return; synthetic = true; try { audio.dispatchEvent(new Event(event)); } finally { synthetic = false; } };
  const intercept = (event: Event) => {
    if (synthetic) return;
    if (switching && !native()) browserEvent?.(event);
    if (native() || switching) event.stopImmediatePropagation();
  };
  const waitForBrowser = (eventName: string, action: () => void) => new Promise<void>((resolve, reject) => {
    const done = (error?: Error) => { clearTimeout(timer); browserEvent = undefined; error ? reject(error) : resolve(); };
    const timer = setTimeout(() => done(new Error('Browser audio could not resume.')), 15000);
    browserEvent = event => {
      if (event.type === eventName) done();
      else if (event.type === 'error') done(new Error('Browser audio could not resume.'));
    };
    try { action(); } catch (error) { done(error instanceof Error ? error : new Error(String(error))); }
  });
  const events = ['loadstart', 'loadedmetadata', 'loadeddata', 'durationchange', 'canplay', 'canplaythrough', 'timeupdate', 'play', 'playing', 'pause', 'waiting', 'stalled', 'seeking', 'seeked', 'ended', 'error', 'emptied', 'volumechange', 'ratechange'];
  events.forEach(event => audio.addEventListener(event, intercept, true));
  const time = () => Math.min(state.duration || Infinity, state.time + (state.ready && !state.paused && !state.ended ? Math.min(.3, (performance.now() - sampleAt) / 1000) * speed : 0));
  const outputVolume = () => nativeVolumePercent(volume, getNormalization().appliedDb);
  const fail = (error: unknown) => {
    if (switching) { report(error); return; }
    mediaError = { code: 3, message: error instanceof Error ? error.message : String(error) } as MediaError;
    state = { ...state, paused: true, ready: false }; report(error); emit('error');
  };
  const command = (name: Parameters<typeof desktop.nativeAudioCommand>[0], value?: number) => desktop.nativeAudioCommand(name, value);
  const load = () => {
    const token = ++generation, blob = getBlob(), id = crypto.randomUUID();
    state = { id, time: 0, duration: 0, paused: true, ended: false, ready: false }; mediaError = null; sampleAt = performance.now();
    emit('emptied'); emit('loadstart');
    pending = (async () => {
      if (!blob) throw new Error('The saved audio copy is unavailable.');
      const bytes = await blob.arrayBuffer(); if (token !== generation) return;
      await desktop.nativeAudioLoad({ id, bytes, device: choice.device, exclusive: choice.exclusive, position: 0, volume: outputVolume(), speed });
    })();
    void pending.catch(error => { if (token === generation && native()) fail(error); });
    return pending;
  };
  const unsubscribe = desktop.onNativeAudioState(next => {
    if (!native() || next.id !== state.id) return;
    const previous = state; state = { ...next, paused: next.paused || next.ended }; sampleAt = performance.now();
    if (next.error && next.error !== previous.error) { fail(new Error(next.error)); return; }
    if (state.ready && !previous.ready) { emit('loadedmetadata'); emit('loadeddata'); emit('canplay'); }
    if (state.duration !== previous.duration) emit('durationchange');
    if (!state.paused && previous.paused) { emit('play'); emit('playing'); }
    if (state.paused && !previous.paused && !state.ended) emit('pause');
    if (state.time !== previous.time) emit('timeupdate');
    if (state.ended && !previous.ended) emit('ended');
  });
  const descriptors: PropertyDescriptorMap = {
    src: { get: () => native() ? source : read('src'), set: value => { if (native()) source = String(value); else write('src', value); } },
    currentSrc: { get: () => snapshot?.currentSrc ?? (native() ? source : read('currentSrc')) },
    currentTime: { get: () => snapshot?.time ?? (native() ? time() : read('currentTime')), set: value => {
      if (snapshot && Number.isFinite(value)) { snapshot.time = Math.max(0, Math.min(snapshot.duration || Infinity, value)); return; }
      if (!native()) { write('currentTime', value); return; }
      if (!Number.isFinite(value)) return; const token = generation, position = Math.max(0, Math.min(state.duration || Infinity, value));
      state = { ...state, time: position, ended: false }; sampleAt = performance.now(); emit('seeking'); emit('timeupdate');
      void pending.then(() => token === generation ? command('seek', position) : undefined).then(() => { if (token === generation) { state = { ...state, time: position }; sampleAt = performance.now(); emit('seeked'); emit('timeupdate'); } }).catch(error => { if (token === generation) fail(error); });
    } },
    duration: { get: () => snapshot?.duration ?? (native() ? state.duration || NaN : read('duration')) },
    paused: { get: () => switching || (native() ? state.paused : read('paused')) },
    ended: { get: () => snapshot?.ended ?? (native() ? state.ended : read('ended')) },
    readyState: { get: () => snapshot?.readyState ?? (native() ? state.ready ? 4 : 0 : read('readyState')) },
    error: { get: () => native() ? mediaError : read('error') },
    volume: { get: () => native() ? volume : read('volume'), set: value => {
      if (!native()) { write('volume', value); return; } if (!Number.isFinite(value)) return; volume = Math.max(0, Math.min(1, value)); emit('volumechange');
      void command('volume', outputVolume()).catch(report);
    } },
    playbackRate: { get: () => native() ? speed : read('playbackRate'), set: value => {
      if (!native()) { write('playbackRate', value); return; } if (!Number.isFinite(value) || value < .5 || value > 1.5) return;
      state = { ...state, time: time() }; sampleAt = performance.now(); speed = value; emit('ratechange'); void command('speed', speed).catch(report);
    } },
  };
  for (const descriptor of Object.values(descriptors)) descriptor.configurable = true;
  Object.defineProperties(audio, descriptors);
  audio.load = () => { if (native()) void load(); else originalLoad(); };
  audio.play = async () => {
    if (!native()) return originalPlay();
    const token = generation; await pending; if (token !== generation || !native()) return;
    if (state.ended) await command('seek', 0);
    await command('play');
  };
  audio.pause = () => {
    if (!native()) { originalPause(); return; }
    state = { ...state, time: time(), paused: true }; sampleAt = performance.now(); emit('pause'); void command('pause').catch(report);
  };
  audio.removeAttribute = name => {
    if (native() && name === 'src') { generation++; source = ''; state = { id: '', time: 0, duration: 0, paused: true, ended: false, ready: false }; void command('stop').catch(report); emit('emptied'); }
    originalRemove(name);
  };
  const unnormalize = subscribeNormalization(() => { if (native() && state.id) void command('volume', outputVolume()).catch(report); });
  switchOutput = async next => {
    if (choice.device === next.device && choice.exclusive === next.exclusive) return;
    if (switching) throw new Error('An audio output switch is already in progress.');
    const previous = { ...choice }, playing = !audio.paused, url = audio.src;
    snapshot = { time: Number.isFinite(audio.currentTime) ? audio.currentTime : 0, duration: audio.duration, src: url, currentSrc: audio.currentSrc, readyState: audio.readyState, ended: audio.ended };
    volume = audio.volume; speed = audio.playbackRate; switching = true;
    const apply = async (output: AudioOutputChoice) => {
      generation++; audio.pause(); originalPause();
      if (native()) await command('stop');
      choice = { ...output }; source = url; mediaError = null;
      await setNativeNormalizationMode(native());
      if (!url) return;
      if (native()) {
        await load();
        const position = snapshot!.time;
        if (position) await command('seek', position);
        state = { ...state, time: position, ended: false }; sampleAt = performance.now();
        if (playing) { await audio.play(); state = { ...state, paused: false }; sampleAt = performance.now(); }
      } else {
        write('src', url); write('volume', volume); write('playbackRate', speed);
        await waitForBrowser('loadedmetadata', originalLoad);
        const position = snapshot!.time;
        if (Math.abs(read('currentTime') - position) > .001) await waitForBrowser('seeked', () => write('currentTime', position));
        if (playing) await originalPlay();
      }
    };
    try { await apply(next); }
    catch (error) {
      try { await apply(previous); } catch { report(new Error('Previous output could not resume. Select Browser audio to recover.')); }
      throw error;
    } finally {
      // Publish only the restored clock. Internal load/seek events must never
      // reset lyric focus, clear Studio recordings, or mark the song damaged.
      switching = false; snapshot = undefined; browserEvent = undefined;
      if (url) {
        emit('loadedmetadata'); emit('durationchange'); emit('timeupdate');
        emit(audio.paused ? 'pause' : 'playing');
      }
    }
  };
  if (import.meta.hot) import.meta.hot.dispose(() => { unsubscribe(); unnormalize(); switchOutput = undefined; void command('stop').catch(() => {}); });
}
