import { useEffect, useState, type RefObject } from 'react';
import { useAudioOutput } from '../player/audioOutput';
import { readAudioEnergy, retainAudioMeter } from '../player/normalization';
import { getLocalAudioElement } from '../player/runtime';

export function useMusicPulse(surface: RefObject<HTMLDivElement | null>, enabled: boolean) {
  const output = useAudioOutput();
  const [allowed, setAllowed] = useState(() => !document.hidden && !matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setAllowed(!document.hidden && !reduced.matches);
    reduced.addEventListener('change', update); document.addEventListener('visibilitychange', update);
    update();
    return () => { reduced.removeEventListener('change', update); document.removeEventListener('visibilitychange', update); };
  }, []);
  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    element.style.setProperty('--music-pulse', '0');
    if (!enabled || !allowed || output.busy) return;
    const audio = getLocalAudioElement();
    const native = (audio as HTMLAudioElement & { backendKind?: string }).backendKind === 'native';
    const desktop = window.localMusicDesktop;
    if (native && (!desktop?.nativeAudioMeter || !desktop.nativeAudioEnergy)) return;
    let disposed = false, frame = 0, nativeReady = false, pending = false, rms = 0;
    let lastPoll = 0, previousTime = performance.now(), baseline = 0, envelope = 0;
    const release = native ? undefined : retainAudioMeter();
    const playing = () => !audio.paused && !audio.ended && !audio.seeking && audio.readyState >= 2;
    const draw = (now: number) => {
      frame = 0; if (disposed) return;
      const active = playing(), dt = Math.min(.064, Math.max(0, (now - previousTime) / 1000)); previousTime = now;
      if (native && nativeReady && active && !pending && now - lastPoll >= 80) {
        pending = true; lastPoll = now;
        void desktop!.nativeAudioEnergy().then(value => {
          if (!disposed) rms = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
        }).catch(() => { rms = 0; }).finally(() => { pending = false; });
      }
      const measured = active ? native ? rms : readAudioEnergy() : 0;
      const level = Math.min(1, Math.sqrt(measured) * 1.6);
      baseline += (level - baseline) * (1 - Math.exp(-dt / 1.2));
      const target = Math.min(1, level * .55 + Math.max(0, level - baseline) * 1.8);
      // Soft attack/release, a capped background-only wash, never a white flash.
      envelope += (target - envelope) * (1 - Math.exp(-dt / (target > envelope ? .14 : .55)));
      element.style.setProperty('--music-pulse', envelope.toFixed(4));
      const phase = Number.isFinite(audio.currentTime) ? audio.currentTime * .16 : 0;
      element.style.setProperty('--music-x', `${Math.sin(phase) * envelope * 4}%`);
      element.style.setProperty('--music-y', `${Math.cos(phase * .73) * envelope * 3}%`);
      if (active || envelope > .001) frame = requestAnimationFrame(draw);
      else element.style.setProperty('--music-pulse', '0');
    };
    const wake = () => {
      if (!frame && !disposed) { previousTime = performance.now(); frame = requestAnimationFrame(draw); }
    };
    const reset = () => { rms = 0; baseline = 0; wake(); };
    const events = ['play', 'playing', 'pause', 'waiting', 'ended', 'seeked', 'loadeddata'];
    events.forEach(event => audio.addEventListener(event, wake));
    audio.addEventListener('emptied', reset); audio.addEventListener('seeking', reset);
    if (native) void desktop!.nativeAudioMeter(true).then(() => { if (!disposed) { nativeReady = true; wake(); } }).catch(() => {
      // A missing meter leaves a static background; it must not fail playback.
    });
    wake();
    return () => {
      disposed = true; cancelAnimationFrame(frame); release?.();
      events.forEach(event => audio.removeEventListener(event, wake));
      audio.removeEventListener('emptied', reset); audio.removeEventListener('seeking', reset);
      element.style.setProperty('--music-pulse', '0');
      if (native) void desktop!.nativeAudioMeter(false).catch(() => {});
    };
  }, [surface, enabled, allowed, output.busy, output.settings.device]);
}
