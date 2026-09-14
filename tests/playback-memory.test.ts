import test from 'node:test';
import assert from 'node:assert/strict';
import { PlaybackMemory } from '../src/player/playbackMemory.ts';
import { initialPlaybackState, type AudioPort, type PlaybackState } from '../src/player/LocalAudioPlayer.ts';

test('playback bookmarks write at five-second intervals and flush on pause, seek and exit', () => {
  const audio = Object.assign(new EventTarget(), { currentTime: 0, duration: 100, readyState: 1 });
  const page = new EventTarget(), document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  let now = 0;
  let state: PlaybackState = { ...initialPlaybackState, queue: [] };
  const writes: string[] = [];
  const memory = new PlaybackMemory({ audio: audio as unknown as AudioPort, page, document,
    player: { getState: () => state, cue() {}, seek() {} },
    storage: { getItem: () => null, setItem: (_key, value) => { writes.push(value); } },
    onError(message) { assert.equal(message, ''); }, onNotice() {}, now: () => now });
  memory.restore([]);
  state = { ...state, currentId: 'song', status: 'playing', duration: 100 }; memory.observe(state);
  assert.equal(writes.length, 1);
  for (let second = 1; second < 5; second++) { now = second * 1000; audio.currentTime = second; memory.observe(state); }
  assert.equal(writes.length, 1);
  now = 5000; audio.currentTime = 5; memory.observe(state); assert.equal(writes.length, 2);
  now = 5500; audio.currentTime = 5.5; state = { ...state, status: 'paused' }; memory.observe(state);
  assert.equal(writes.length, 3);
  audio.currentTime = 9; audio.dispatchEvent(new Event('seeked')); assert.equal(JSON.parse(writes.at(-1)!).position, 9);
  audio.currentTime = 9.5; page.dispatchEvent(new Event('pagehide')); assert.equal(JSON.parse(writes.at(-1)!).position, 9.5);
  memory.dispose();
});
