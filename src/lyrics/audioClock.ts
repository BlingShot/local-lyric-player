import { getLocalAudioElement } from '../player/runtime';

export interface AudioClock { time: number; duration: number }
const listeners = new Set<(clock: AudioClock) => void>();
const events = ['timeupdate', 'seeking', 'seeked', 'playing', 'pause', 'ended', 'loadedmetadata', 'durationchange', 'emptied', 'waiting'];
let audio: HTMLAudioElement | undefined, animation = 0;
let previous: AudioClock | undefined;

export function readAudioClock(): AudioClock {
  const element = getLocalAudioElement();
  return { time: Number.isFinite(element.currentTime) ? element.currentTime : 0,
    duration: Number.isFinite(element.duration) ? element.duration : 0 };
}
function sample() {
  const clock = readAudioClock();
  if (previous?.time === clock.time && previous.duration === clock.duration) return;
  previous = clock;
  for (const listener of [...listeners]) listener(clock);
}
function running() { return audio && !audio.paused && !audio.ended && !document.hidden; }
function tick() { animation = 0; sample(); if (running()) animation = requestAnimationFrame(tick); }
function update() {
  sample();
  if (running()) { if (!animation) animation = requestAnimationFrame(tick); }
  else { cancelAnimationFrame(animation); animation = 0; }
}

/** All lyric surfaces sample the existing audio element through a single RAF. */
export function subscribeAudioClock(listener: (clock: AudioClock) => void) {
  if (!listeners.size) {
    audio = getLocalAudioElement(); previous = undefined;
    events.forEach(event => audio!.addEventListener(event, update));
    document.addEventListener('visibilitychange', update);
  }
  listeners.add(listener); listener(readAudioClock()); update();
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      cancelAnimationFrame(animation); animation = 0;
      events.forEach(event => audio?.removeEventListener(event, update));
      document.removeEventListener('visibilitychange', update); audio = undefined; previous = undefined;
    }
  };
}
