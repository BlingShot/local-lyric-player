import { nativeVolumePercent } from './normalizationMath';
import { getNormalization, subscribeNormalization, setNativeNormalizationMode } from './normalization';
import { NativePlaybackError, playbackError, unwrapAudioResult, type NativeCommandContext, type PlaybackErrorInfo } from './playbackErrors';
export interface AudioOutputChoice { device: string; exclusive: boolean }
type NativeState = Parameters<NonNullable<Window['localMusicDesktop']>['onNativeAudioState']>[0] extends (state: infer T) => void ? T : never;
let switchOutput: ((choice: AudioOutputChoice) => Promise<void>) | undefined;
export async function configureNativeOutput(choice: AudioOutputChoice) {
  if (!switchOutput) { if (choice.device !== 'browser') throw new Error('Audio player is not ready.'); return; }
  await switchOutput(choice);
}
const cancelled = () => new NativePlaybackError({ kind: 'cancelled', message: 'Playback request was superseded.' });
const report = (error: unknown) => {
  if (playbackError(error)?.kind === 'cancelled') return;
  window.dispatchEvent(new CustomEvent('native-audio-error', { detail: error instanceof Error ? error.message : String(error) }));
};
export function attachNativeAudio(audio: HTMLAudioElement, getBlob: () => Blob | undefined) {
  const desktop = window.localMusicDesktop;
  if (!desktop?.nativeAudioLoad) return;
  const properties = new Map<string, PropertyDescriptor>();
  for (let prototype = Object.getPrototypeOf(audio); prototype; prototype = Object.getPrototypeOf(prototype))
    for (const key of Object.getOwnPropertyNames(prototype)) if (!properties.has(key)) properties.set(key, Object.getOwnPropertyDescriptor(prototype, key)!);
  const read = (key: string) => properties.get(key)?.get?.call(audio);
  const write = (key: string, value: unknown) => properties.get(key)?.set?.call(audio, value);
  const originalPlay = audio.play.bind(audio), originalPause = audio.pause.bind(audio), originalLoad = audio.load.bind(audio), originalRemove = audio.removeAttribute.bind(audio);
  let choice: AudioOutputChoice = { device: 'browser', exclusive: false }, switching = false, synthetic = false;
  let generation = 0, intent = 0, seekSequence = 0, sourceVersion = 0, desiredPlaying = false, resourceId = crypto.randomUUID();
  let pending: Promise<void> = Promise.resolve(), pendingSeek: Promise<void> = Promise.resolve(), switchTask: Promise<void> | undefined;
  let pendingSeekTarget: number | undefined;
  let source = '', volume = audio.volume, speed = audio.playbackRate, sampleAt = performance.now(), fault: PlaybackErrorInfo | null = null;
  let state: NativeState = { id: '', time: 0, duration: 0, paused: true, ended: false, ready: false };
  let snapshot: { time: number; duration: number; src: string; currentSrc: string; readyState: number; ended: boolean } | undefined;
  let browserEvent: ((event: Event) => void) | undefined;
  const native = () => choice.device !== 'browser';
  const context = (): NativeCommandContext => ({ id: resourceId, generation, intent, seek: seekSequence, playing: desiredPlaying });
  const command = async (name: Parameters<typeof desktop.nativeAudioCommand>[0], value?: number, stamp = context()) =>
    unwrapAudioResult(await desktop.nativeAudioCommand(name, value, stamp));
  const emit = (event: string) => { if (switching) return; synthetic = true; try { audio.dispatchEvent(new Event(event)); } finally { synthetic = false; } };
  const intercept = (event: Event) => {
    if (synthetic) return;
    if (switching && !native()) browserEvent?.(event);
    if (native() || switching) event.stopImmediatePropagation();
  };
  const waitForBrowser = (eventName: string, action: () => void) => new Promise<void>((resolve, reject) => {
    const done = (error?: Error) => { clearTimeout(timer); browserEvent = undefined; error ? reject(error) : resolve(); };
    const timer = setTimeout(() => done(new Error('Browser audio could not resume.')), 15000);
    browserEvent = event => { if (event.type === eventName) done(); else if (event.type === 'error') done(new Error('Browser audio could not resume.')); };
    try { action(); } catch (error) { done(error instanceof Error ? error : new Error(String(error))); }
  });
  const events = ['loadstart', 'loadedmetadata', 'loadeddata', 'durationchange', 'canplay', 'canplaythrough', 'timeupdate', 'play', 'playing', 'pause', 'waiting', 'stalled', 'seeking', 'seeked', 'ended', 'error', 'emptied', 'volumechange', 'ratechange'];
  events.forEach(event => audio.addEventListener(event, intercept, true));
  const time = () => Math.min(state.duration || Infinity, state.time + (state.ready && !state.paused && !state.ended ? Math.min(.3, (performance.now() - sampleAt) / 1000) * speed : 0));
  const outputVolume = () => nativeVolumePercent(volume, getNormalization().appliedDb);
  const fail = (error: unknown) => {
    const info = playbackError(error) || { kind: 'backend-stopped' as const, message: error instanceof Error ? error.message : String(error) };
    if (info.kind === 'cancelled') return;
    if (switching) { report(error); return; }
    fault = info; state = { ...state, time: time(), paused: true, ready: false };
    report(new NativePlaybackError(info)); emit('error');
  };
  const load = () => {
    const token = ++generation, blob = getBlob(), id = crypto.randomUUID(), output = { ...choice };
    resourceId = id; pendingSeek = Promise.resolve(); pendingSeekTarget = undefined;
    state = { id, time: 0, duration: 0, paused: true, ended: false, ready: false }; fault = null; sampleAt = performance.now();
    emit('emptied'); emit('loadstart');
    pending = (async () => {
      if (!blob) throw new NativePlaybackError({ kind: 'file-unavailable', message: 'The saved audio copy is unavailable.' });
      const bytes = await blob.arrayBuffer();
      if (token !== generation || !native()) throw cancelled();
      unwrapAudioResult(await desktop.nativeAudioLoad({ id, bytes, device: output.device, exclusive: output.exclusive, position: 0, volume: outputVolume(), speed, context: context() }));
      if (token !== generation || !native()) throw cancelled();
    })();
    void pending.catch(error => { if (token === generation && native()) fail(error); });
    return pending;
  };
  const unsubscribe = desktop.onNativeAudioState(next => {
    if (!native() || next.id !== state.id) return;
    const previous = state;
    state = { ...next, time: pendingSeekTarget ?? next.time, paused: next.paused || next.ended || !desiredPlaying }; sampleAt = performance.now();
    if (next.error && (next.error.kind !== previous.error?.kind || next.error.message !== previous.error?.message)) { fail(new NativePlaybackError(next.error)); return; }
    if (state.ready && !previous.ready) { emit('loadedmetadata'); emit('loadeddata'); emit('canplay'); }
    if (state.duration !== previous.duration) emit('durationchange');
    if (!state.paused && previous.paused) { emit('play'); emit('playing'); }
    if (state.paused && !previous.paused && !state.ended) emit('pause');
    if (state.time !== previous.time) emit('timeupdate');
    if (state.ended && !previous.ended) emit('ended');
  });
  const seekNative = (position: number) => {
    const token = generation, sequence = ++seekSequence; pendingSeekTarget = position;
    state = { ...state, time: position, ended: false }; sampleAt = performance.now(); emit('seeking'); emit('timeupdate');
    pendingSeek = pending.then(async () => {
      if (token !== generation || sequence !== seekSequence || !native()) return;
      await command('seek', position);
      if (token === generation && sequence === seekSequence && native()) {
        pendingSeekTarget = undefined; state = { ...state, time: position }; sampleAt = performance.now(); emit('seeked'); emit('timeupdate');
      }
    });
    void pendingSeek.catch(error => { if (token === generation && sequence === seekSequence) fail(error); });
  };
  const descriptors: PropertyDescriptorMap = {
    src: { get: () => native() ? source : read('src'), set: value => { sourceVersion++; snapshot = undefined; if (native()) source = String(value); else write('src', value); } },
    currentSrc: { get: () => snapshot?.currentSrc ?? (native() ? source : read('currentSrc')) },
    currentTime: { get: () => snapshot?.time ?? (native() ? time() : read('currentTime')), set: value => {
      if (!Number.isFinite(value)) return;
      if (snapshot) { snapshot.time = Math.max(0, Math.min(snapshot.duration || Infinity, value)); if (native() && state.ready) seekNative(snapshot.time); return; }
      if (!native()) { write('currentTime', value); return; }
      seekNative(Math.max(0, Math.min(state.duration || Infinity, value)));
    } },
    duration: { get: () => snapshot?.duration ?? (native() ? state.duration || NaN : read('duration')) },
    paused: { get: () => switching || (native() ? state.paused : read('paused')) },
    ended: { get: () => snapshot?.ended ?? (native() ? state.ended : read('ended')) },
    readyState: { get: () => snapshot?.readyState ?? (native() ? state.ready ? 4 : 0 : read('readyState')) },
    error: { get: () => native() ? null : read('error') },
    playbackError: { get: () => native() ? fault : null },
    backendKind: { get: () => native() ? 'native' : 'browser' },
    volume: { get: () => native() ? volume : read('volume'), set: value => {
      if (!native()) { write('volume', value); return; } if (!Number.isFinite(value)) return;
      volume = Math.max(0, Math.min(1, value)); emit('volumechange'); void command('volume', outputVolume()).catch(report);
    } },
    playbackRate: { get: () => native() ? speed : read('playbackRate'), set: value => {
      if (!native()) { write('playbackRate', value); return; } if (!Number.isFinite(value) || value < .5 || value > 1.5) return;
      state = { ...state, time: time() }; sampleAt = performance.now(); speed = value; emit('ratechange'); void command('speed', speed).catch(report);
    } },
  };
  for (const descriptor of Object.values(descriptors)) descriptor.configurable = true;
  Object.defineProperties(audio, descriptors);
  audio.load = () => {
    sourceVersion++; snapshot = undefined; desiredPlaying = false; intent++;
    if (native()) { if (source) void load(); else pending = Promise.resolve(); } else originalLoad();
  };
  audio.play = async () => {
    desiredPlaying = true; const wanted = ++intent, version = sourceVersion;
    if (switchTask) await switchTask;
    const token = generation;
    const current = () => desiredPlaying && wanted === intent && version === sourceVersion && token === generation;
    if (!current()) throw cancelled();
    if (!native()) {
      await originalPlay();
      if (version === sourceVersion && !desiredPlaying) originalPause();
      return;
    }
    await pending; if (!current() || !native()) throw cancelled();
    await pendingSeek; if (!current() || !native()) throw cancelled();
    if (fault) throw new NativePlaybackError(fault);
    if (state.ended) { ++seekSequence; await command('seek', 0); if (!current()) throw cancelled(); }
    await command('play');
  };
  audio.pause = () => {
    desiredPlaying = false; intent++;
    if (!native()) { originalPause(); return; }
    state = { ...state, time: time(), paused: true }; sampleAt = performance.now(); emit('pause');
    void command('pause').catch(report);
  };
  audio.removeAttribute = name => {
    if (name === 'src') {
      sourceVersion++; snapshot = undefined; generation++; desiredPlaying = false; intent++; resourceId = crypto.randomUUID();
      if (native()) { source = ''; state = { id: '', time: 0, duration: 0, paused: true, ended: false, ready: false }; fault = null; void command('stop').catch(report); emit('emptied'); }
    }
    originalRemove(name);
  };
  const unnormalize = subscribeNormalization(() => { if (native() && state.id) void command('volume', outputVolume()).catch(report); });
  switchOutput = next => {
    if (choice.device === next.device && choice.exclusive === next.exclusive && !fault) return Promise.resolve();
    if (switching) return Promise.reject(new Error('An audio output switch is already in progress.'));
    const previous = { ...choice }, url = audio.src, version = sourceVersion;
    const continuing = desiredPlaying && !audio.ended || !audio.paused;
    if (desiredPlaying !== continuing) { desiredPlaying = continuing; intent++; }
    snapshot = { time: Number.isFinite(audio.currentTime) ? audio.currentTime : 0, duration: audio.duration, src: url, currentSrc: audio.currentSrc, readyState: audio.readyState, ended: audio.ended };
    volume = audio.volume; speed = audio.playbackRate; switching = true;
    const current = () => { if (version !== sourceVersion || !snapshot) throw cancelled(); };
    const apply = async (output: AudioOutputChoice) => {
      current(); originalPause();
      if (native()) await command('stop');
      current(); generation++; choice = { ...output }; source = url; fault = null;
      await setNativeNormalizationMode(native()); current();
      if (!url) return;
      if (native()) {
        await load(); current();
        const position = snapshot!.time;
        if (position) { ++seekSequence; await command('seek', position); current(); }
        state = { ...state, time: snapshot!.time, ended: false }; sampleAt = performance.now();
        // A pause/play while switching supersedes the state captured on entry.
        if (desiredPlaying) {
          const wanted = intent;
          await command('play'); current();
          if (desiredPlaying && intent === wanted) { state = { ...state, paused: false }; sampleAt = performance.now(); }
        }
      } else {
        write('src', url); write('volume', volume); write('playbackRate', speed);
        await waitForBrowser('loadedmetadata', originalLoad); current();
        const position = snapshot!.time;
        if (Math.abs(read('currentTime') - position) > .001) { await waitForBrowser('seeked', () => write('currentTime', position)); current(); }
        if (desiredPlaying) {
          try { await originalPlay(); } catch (error) { if (!desiredPlaying && error instanceof Error && error.name === 'AbortError') throw cancelled(); throw error; }
          current(); if (!desiredPlaying) originalPause();
        }
      }
    };
    switchTask = (async () => {
      try { await apply(next); }
      catch (error) {
        if (version === sourceVersion && playbackError(error)?.kind !== 'cancelled') {
          try { await apply(previous); } catch { report(new Error('Previous output could not resume. Select Browser audio to recover.')); }
        }
        // Superseded transport is not an output failure and must not roll back a new song.
        if (playbackError(error)?.kind !== 'cancelled') throw error;
      } finally {
        switching = false; snapshot = undefined; browserEvent = undefined; switchTask = undefined;
        // Events suppressed during output changes must be replayed for the NEW source too.
        if (audio.currentSrc && audio.readyState >= 1) { emit('loadedmetadata'); emit('durationchange'); emit('timeupdate'); emit(audio.paused ? 'pause' : 'playing'); }
      }
    })();
    return switchTask;
  };
  const dispose = () => { audio.pause(); audio.removeAttribute('src'); unsubscribe(); unnormalize(); switchOutput = undefined; events.forEach(event => audio.removeEventListener(event, intercept, true)); };
  if (import.meta.hot) import.meta.hot.dispose(dispose);
  return dispose;
}
