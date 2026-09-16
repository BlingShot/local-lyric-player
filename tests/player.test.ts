import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LocalAudioPlayer, type AudioPort, type PlaybackState } from '../src/player/LocalAudioPlayer.ts';
import { adjacentTrack, shuffled } from '../src/player/queue.ts';

class FakeAudio extends EventTarget {
  src = ''; currentSrc = ''; currentTime = 0; duration = NaN;
  volume = 1; paused = true; ended = false; readyState = 0;
  error: { code: number } | null = null;
  playResult: (() => Promise<void>) | null = null;
  play() {
    if (this.playResult) return this.playResult();
    this.paused = false;
    this.ended = false;
    this.dispatchEvent(new Event('playing'));
    return Promise.resolve();
  }
  pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
  load() {
    this.currentSrc = this.src; this.currentTime = 0; this.readyState = 0;
    this.duration = NaN; this.error = null; this.ended = false;
  }
  removeAttribute() { this.src = ''; }
  metadata(duration = 10) {
    this.readyState = 4; this.duration = duration;
    this.dispatchEvent(new Event('loadedmetadata'));
  }
  finish() {
    this.currentTime = this.duration; this.ended = true; this.paused = true;
    this.dispatchEvent(new Event('ended'));
  }
  fail() { this.error = { code: 3 }; this.dispatchEvent(new Event('error')); }
}

function setup(timeout = 1000) {
  const audio = new FakeAudio();
  const revoked: string[] = [], failures: string[] = [];
  const changes: PlaybackState[] = [];
  const player = new LocalAudioPlayer(audio as unknown as AudioPort, {
    onChange: state => changes.push(state), onDuration: () => {}, onSelect: () => {},
    onFailure: id => failures.push(id), revokeUrl: url => revoked.push(url),
    random: () => 0, loadTimeoutMs: timeout,
  });
  player.addTracks(['a', 'b', 'c'].map(id => ({ id, url: 'blob:' + id })));
  return { player, audio, revoked, failures, changes };
}

test('duration and progress follow actual media values; seek clamps to duration', () => {
  const { player, audio } = setup();
  try {
    player.play('a'); audio.metadata(12);
    audio.currentTime = 3.25; audio.dispatchEvent(new Event('timeupdate'));
    assert.equal(player.getState().position, 3.25);
    assert.equal(player.getState().duration, 12);
    player.seek(30);
    assert.equal(audio.currentTime, 12);
    player.pause();
    assert.equal(player.getState().status, 'paused');
  } finally { player.dispose(); }
});

test('sequential completion advances once and stops at the end with repeat off', () => {
  const { player, audio } = setup();
  try {
    player.play('a'); audio.metadata(); audio.finish();
    assert.equal(player.getState().currentId, 'b');
    audio.metadata(); audio.finish();
    assert.equal(player.getState().currentId, 'c');
    audio.metadata(); audio.finish();
    assert.equal(player.getState().status, 'ended');
    assert.equal(player.getState().position, 10);
  } finally { player.dispose(); }
});

test('repeat all wraps, repeat one restarts, and manual next overrides repeat one', () => {
  const { player, audio } = setup();
  try {
    player.cycleRepeat(); player.play('c'); audio.metadata(); audio.finish();
    assert.equal(player.getState().currentId, 'a');
    player.cycleRepeat(); audio.metadata(); audio.finish();
    assert.equal(player.getState().currentId, 'a');
    assert.equal(audio.currentTime, 0);
    player.next();
    assert.equal(player.getState().currentId, 'b');
  } finally { player.dispose(); }
});

test('shuffle preserves current song and visits a permutation without duplicates', () => {
  const { player } = setup();
  try {
    player.play('b'); player.toggleShuffle();
    assert.equal(player.getState().queue[0], 'b');
    assert.equal(new Set(player.getState().queue).size, 3);
    assert.deepEqual([...player.getState().queue].sort(), ['a', 'b', 'c']);
    player.toggleShuffle();
    assert.deepEqual(player.getState().queue, ['a', 'b', 'c']);
    assert.equal(player.getState().currentId, 'b');
  } finally { player.dispose(); }
  assert.deepEqual([...shuffled([1, 2, 3], () => 0)].sort(), [1, 2, 3]);
});

test('decode failures skip forward and terminate even with repeat all and every file broken', () => {
  const { player, audio, failures } = setup();
  try {
    player.cycleRepeat(); player.play('a'); audio.fail();
    assert.equal(player.getState().currentId, 'b');
    audio.fail();
    assert.equal(player.getState().currentId, 'c');
    audio.fail();
    assert.equal(player.getState().status, 'error');
    assert.deepEqual(failures, ['a', 'b', 'c']);
    assert.equal(audio.paused, true);
    player.play('a'); audio.metadata();
    assert.equal(player.getState().status, 'playing');
  } finally { player.dispose(); }
});

test('late play rejection cannot stop a different track or override pause', async () => {
  const { player, audio } = setup();
  try {
    let reject!: (error: Error) => void;
    audio.playResult = () => new Promise((_resolve, fail) => { reject = fail; });
    player.play('a');
    audio.playResult = null;
    player.play('b'); audio.metadata();
    reject(new Error('old request failed'));
    await Promise.resolve();
    assert.equal(player.getState().currentId, 'b');
    assert.equal(player.getState().status, 'playing');
    audio.playResult = () => Promise.reject(new DOMException('paused', 'AbortError'));
    player.play(); player.pause();
    await Promise.resolve();
    assert.equal(player.getState().status, 'paused');
    assert.equal(player.getState().error, null);
  } finally { player.dispose(); }
});

test('removing the current file advances and revokes URLs; disposing revokes the remainder', () => {
  const { player, audio, revoked } = setup();
  player.play('a'); audio.metadata(); player.removeTrack('a');
  assert.equal(player.getState().currentId, 'b');
  assert.deepEqual(revoked, ['blob:a']);
  player.removeTrack('b'); player.removeTrack('c');
  assert.equal(player.getState().status, 'idle');
  assert.equal(audio.src, '');
  player.dispose();
  assert.deepEqual(revoked, ['blob:a', 'blob:b', 'blob:c']);
});

test('a source that never loads leaves loading and reports failure within a bounded time', async () => {
  const { player, audio, failures } = setup(10);
  try {
    audio.playResult = () => new Promise(() => {});
    player.play('c');
    await new Promise(resolve => setTimeout(resolve, 35));
    assert.equal(player.getState().status, 'error');
    assert.deepEqual(failures, ['c']);
  } finally { player.dispose(); }
});

test('volume follows volumechange and queue search is bounded when no song is playable', () => {
  const { player, audio } = setup();
  try {
    player.setVolume(.35); audio.dispatchEvent(new Event('volumechange'));
    assert.equal(player.getState().volume, .35);
    player.setVolume(2);
    assert.equal(audio.volume, 1);
    assert.equal(adjacentTrack(['a', 'b'], 'a', 1, true, new Set(['a', 'b'])), null);
  } finally { player.dispose(); }
});

test('F08 repeated play is idempotent without another playing event or watchdog skip', async () => {
  const { player, audio, failures, changes } = setup(15);
  try {
    player.play('a'); audio.metadata(); audio.currentTime = 4;
    const count = changes.length;
    audio.playResult = () => { throw new Error('Already-playing source must not be restarted'); };
    for (let i = 0; i < 5; i++) player.play('a');
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(audio.currentTime, 4);
    assert.equal(player.getState().currentId, 'a');
    assert.equal(player.getState().status, 'playing');
    assert.equal(changes.length, count);
    assert.deepEqual(failures, []);
  } finally { player.dispose(); }
});

test('F08 play fulfillment confirms playback without an event but cannot override pause or a newer source', async () => {
  const { player, audio } = setup();
  try {
    audio.playResult = () => { audio.paused = false; return Promise.resolve(); };
    player.play('a'); audio.metadata(); await Promise.resolve();
    assert.equal(player.getState().status, 'playing');
    player.pause();
    let resolve!: () => void;
    audio.playResult = () => new Promise(done => { resolve = done; });
    player.play(); player.pause(); audio.paused = false; resolve(); await Promise.resolve();
    assert.equal(player.getState().status, 'paused');
    player.play('b');
    const oldResolve = resolve;
    player.play('c'); audio.metadata(); audio.paused = false;
    oldResolve(); await Promise.resolve();
    assert.equal(player.getState().status, 'loading');
    resolve(); await Promise.resolve();
    assert.equal(player.getState().currentId, 'c');
    assert.equal(player.getState().status, 'playing');
  } finally { player.dispose(); }
});

test('F08 genuine stalled playback still fails within the watchdog deadline', async () => {
  const { player, audio, failures } = setup(15);
  try {
    player.play('c'); audio.metadata();
    audio.readyState = 2; audio.dispatchEvent(new Event('waiting'));
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(player.getState().status, 'error');
    assert.deepEqual(failures, ['c']);
  } finally { player.dispose(); }
});

test('F05 device/backend errors retain song, queue and position without marking normal audio failed', async () => {
  for (const kind of ['device-unavailable', 'device-exclusive-busy', 'backend-stopped', 'timeout'] as const) {
    const { audio, player, failures } = setup();
    try {
      player.play('a'); audio.metadata(90); audio.currentTime = 27; audio.dispatchEvent(new Event('timeupdate'));
      Object.defineProperty(audio, 'playbackError', { configurable: true, value: { kind, message: 'Output unavailable.' } });
      audio.dispatchEvent(new Event('error'));
      assert.equal(player.getState().currentId, 'a'); assert.equal(player.getState().position, 27);
      assert.equal(player.getState().error?.kind, kind); assert.equal(audio.paused, true); assert.equal(failures.length, 0);
      assert.deepEqual(player.getState().queue, ['a', 'b', 'c']);
      Object.defineProperty(audio, 'playbackError', { configurable: true, value: null });
      player.play(); audio.metadata(90); await Promise.resolve();
      assert.equal(player.getState().currentId, 'a'); assert.equal(audio.currentTime, 27);
    } finally { player.dispose(); }
  }
});
test('F05 cancelled native operations stay quiet and genuine media faults still skip', () => {
  const { audio, player, failures } = setup();
  try {
    player.play('a'); audio.metadata();
    Object.defineProperty(audio, 'playbackError', { configurable: true, value: { kind: 'cancelled', message: 'Old request.' } });
    audio.dispatchEvent(new Event('error'));
    assert.equal(player.getState().status, 'playing'); assert.equal(failures.length, 0);
    Object.defineProperty(audio, 'playbackError', { configurable: true, value: { kind: 'decode', message: 'Unsupported audio.' } });
    audio.dispatchEvent(new Event('error')); assert.equal(player.getState().currentId, 'b'); assert.equal(failures.length, 1);
  } finally { player.dispose(); }
});

test('F05 native watchdog timeout is a backend error, not a failed-file skip', async () => {
  const { audio, player, failures } = setup(8);
  Object.defineProperty(audio, 'backendKind', { value: 'native' });
  audio.playResult = () => new Promise<void>(() => {});
  try {
    player.play('a'); await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(player.getState().currentId, 'a'); assert.equal(player.getState().error?.kind, 'timeout'); assert.equal(failures.length, 0);
  } finally { player.dispose(); }
});
