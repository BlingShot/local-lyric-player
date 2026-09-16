import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NativeAudio } from '../electron/native-audio.mjs';
import { NativeCommandGuard } from '../electron/native-command-guard.mjs';
import { PlaybackFault, audioResult, mpvFault } from '../electron/playback-errors.mjs';
const stamp = (generation = 1, intent = 1, playing = true, seek = 0) => ({ id: `resource-${generation}`, generation, intent, playing, seek });
const value = context => ({ id: context.id, context, bytes: new Uint8Array([1]).buffer, device: 'auto', exclusive: false, position: 0, volume: 50, speed: 1 });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
class Helper extends NativeAudio {
  log = []; loaded = deferred(); release = deferred();
  async start() { this.socket = { destroy() {} }; }
  async devices() { await this.start(); return [{ name: 'auto' }]; }
  async request(command) {
    this.log.push(command);
    if (command[0] === 'loadfile') { this.loaded.resolve(); await this.release.promise; queueMicrotask(() => this.receive({ event: 'file-loaded' })); }
    if (command[1] === 'duration') return 100;
    if (command[1] === 'current-ao') return 'wasapi';
  }
}
async function helper(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'lyric-intent-'));
  const audio = new Helper('unused', path.join(root, 'session'));
  t.after(async () => { audio.release.resolve(); await audio.dispose(); await rm(root, { force: true, recursive: true }); });
  return audio;
}
test('F01 pause supersedes queued play behind a delayed helper load', async t => {
  const audio = await helper(t);
  const load = audio.load(value(stamp())); await audio.loaded.promise;
  const play = assert.rejects(audio.command('play', undefined, stamp()), { kind: 'cancelled' });
  const pause = audio.command('pause', undefined, stamp(1, 2, false));
  audio.release.resolve(); await Promise.all([load, play, pause]);
  assert.equal(audio.log.filter(c => c[0] === 'set_property' && c[1] === 'pause' && c[2] === false).length, 0);
  assert.deepEqual(audio.log.at(-1), ['set_property', 'pause', true]);
});
test('F01 latest play wins play-pause-play and old seek/load cannot affect a new resource', async t => {
  const audio = await helper(t);
  const first = assert.rejects(audio.load(value(stamp())), { kind: 'cancelled' }); await audio.loaded.promise;
  const seek = assert.rejects(audio.command('seek', 70, stamp(1, 1, true, 1)), { kind: 'cancelled' });
  const next = audio.load(value(stamp(2, 2, true)));
  const pause = assert.rejects(audio.command('pause', undefined, stamp(2, 3, false)), { kind: 'cancelled' });
  const play = audio.command('play', undefined, stamp(2, 4, true));
  audio.release.resolve(); await Promise.all([first, seek, next, pause, play]);
  assert.equal(audio.state.id, 'resource-2'); assert.equal(audio.state.time, 0);
  assert.equal(audio.log.filter(c => c[0] === 'seek').length, 0);
  assert.deepEqual(audio.log.at(-1), ['set_property', 'pause', false]);
});
test('F01 main guard rejects malformed, old-resource and out-of-order seek tokens', () => {
  const guard = new NativeCommandGuard();
  assert.throws(() => guard.accept({ ...stamp(), generation: NaN }));
  const old = guard.accept(stamp(1, 1, true, 2)); guard.accept(stamp(1, 2, false, 3));
  assert.equal(guard.valid(old, 'play'), false); assert.equal(guard.valid(old, 'seek'), false);
  assert.equal(guard.valid(old, 'load'), true);
  guard.accept(stamp(2)); assert.throws(() => guard.accept(stamp(1)), { kind: 'cancelled' });
});
test('F05 structured error envelopes survive JSON serialization and unknown helper errors are not decode failures', async () => {
  const result = JSON.parse(JSON.stringify(await audioResult(() => { throw new PlaybackFault('device-exclusive-busy', 'Output is in use.'); })));
  assert.deepEqual(result, { ok: false, error: { kind: 'device-exclusive-busy', message: 'Output is in use.' } });
  assert.equal(mpvFault('audio output initialization failed', true).kind, 'device-unavailable');
  assert.equal(mpvFault('audio/video decoding failed', false).kind, 'decode');
  assert.equal(mpvFault('unrecognized file format', false).kind, 'decode');
  assert.equal(mpvFault('unclassified helper failure', false).kind, 'backend-stopped');
});

test('F05 loss of current-ao on ready audio is a device failure, but intentional stop is not', async t => {
  const audio = await helper(t); audio.release.resolve(); await audio.load(value(stamp()));
  audio.receive({ event: 'property-change', name: 'current-ao', data: null });
  assert.equal(audio.state.error.kind, 'device-unavailable'); assert.equal(audio.state.id, 'resource-1');
  await audio.load(value(stamp(2))); await audio.command('stop', undefined, stamp(2));
  audio.receive({ event: 'property-change', name: 'current-ao', data: null });
  assert.equal(audio.state.error, undefined);
});
