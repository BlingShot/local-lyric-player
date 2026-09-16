import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readdir, readFile, writeFile, unlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { AudioTempFiles, cleanupStaleAudioSessions } from '../electron/audio-temp-files.mjs';
import { NativeAudio } from '../electron/native-audio.mjs';

const request = () => ({ id: randomUUID(), bytes: new Uint8Array([1, 2, 3]).buffer, device: 'auto', exclusive: false, position: 0, volume: 50, speed: 1 });
async function root(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'lyric-file-test-'));
  t.after(() => rm(root, { recursive: true, force: true })); return root;
}
class Helper extends NativeAudio {
  mode = 'corrupt';
  async devices() { this.assertOpen(); return [{ name: 'auto' }]; }
  async request(command) {
    this.assertOpen();
    if (command[0] === 'loadfile') {
      if (this.mode === 'timeout') return;
      queueMicrotask(() => this.receive(this.mode === 'corrupt' ? { event: 'end-file', reason: 'error' } : { event: 'file-loaded' }));
    }
    if (command[1] === 'duration') return 10;
    if (command[1] === 'current-ao') return this.mode === 'output-failure' ? 'null' : 'wasapi';
  }
}

test('F11 corrupt files, load timeouts and failed output checks do not accumulate audio copies', async t => {
  const directory = path.join(await root(t), `lyric-player-audio-${randomUUID()}`);
  const audio = new Helper('unused', directory, { loadTimeoutMs: 5 });
  for (const mode of ['corrupt', 'timeout', 'output-failure']) {
    audio.mode = mode;
    for (let i = 0; i < 5; i++) {
      await assert.rejects(audio.load(request()));
      assert.equal(audio.files.size, 0);
      assert.equal((await readdir(directory)).filter(name => name.endsWith('.audio')).length, 0);
    }
  }
  audio.mode = 'success'; await audio.load(request());
  assert.equal(audio.files.size, 1);
  await audio.load(request()); assert.equal(audio.files.size, 1);
  await audio.dispose();
  await assert.rejects(readdir(directory), { code: 'ENOENT' });
});

test('F11 busy deletes retain ownership, have bounded retries and cap live copies', async t => {
  let busy = true, calls = 0; const warnings = [];
  const pool = new AudioTempFiles(path.join(await root(t), 'session'), {
    remove: async file => { calls++; if (busy) throw Object.assign(new Error('locked'), { code: 'EBUSY' }); await unlink(file); },
    retryDelays: [1, 2], warn: (...args) => warnings.push(args),
  });
  await pool.create(new Uint8Array([1]));
  assert.equal(await pool.cleanup(), false); assert.equal(calls, 3); assert.equal(pool.files.size, 1);
  await pool.create(new Uint8Array([2]));
  await assert.rejects(pool.create(new Uint8Array([3])), /still in use/);
  assert.equal(pool.files.size, 2); assert.ok(warnings.length);
  busy = false; await pool.cleanup(); assert.equal(pool.files.size, 0); await pool.finish();
});

test('F11 disposal waits for a pending file write and rejects queued loads before sweeping', async t => {
  const directory = path.join(await root(t), 'session'), audio = new Helper('unused', directory);
  let release, created;
  const gate = new Promise(resolve => { release = resolve; });
  const wrote = new Promise(resolve => { created = resolve; });
  const original = audio.temp.create.bind(audio.temp);
  audio.temp.create = async bytes => { const file = await original(bytes); created(); await gate; return file; };
  const first = assert.rejects(audio.load(request()), /closed/);
  await wrote;
  const second = assert.rejects(audio.load(request()), /closed/);
  const closing = audio.dispose(); assert.equal(closing, audio.dispose());
  release(); await Promise.all([first, second, closing]);
  assert.equal(audio.files.size, 0);
  await assert.rejects(readdir(directory), { code: 'ENOENT' });
});

test('F11 disposal cancels an outstanding helper load without waiting for its timeout', async t => {
  const audio = new Helper('unused', path.join(await root(t), 'session'));
  audio.mode = 'timeout';
  const loading = assert.rejects(audio.load(request()), /closed/);
  for (let i = 0; i < 200 && !audio.listenerCount('closing'); i++) await new Promise(r => setTimeout(r, 2));
  assert.ok(audio.listenerCount('closing'));
  await audio.dispose(); await loading; assert.equal(audio.files.size, 0);
});

test('F11 crash sweep requires an owned marker and dead owner; originals and unmarked folders stay untouched', async t => {
  const base = await root(t);
  const owned = path.join(base, `lyric-player-audio-${randomUUID()}`);
  const pool = new AudioTempFiles(owned); await pool.create(new Uint8Array([1]));
  const unmarked = path.join(base, `lyric-player-audio-${randomUUID()}`);
  await mkdir(unmarked); await writeFile(path.join(unmarked, 'original.mp3'), 'original');
  const foreign = path.join(base, `lyric-player-audio-${randomUUID()}`);
  const foreignPool = new AudioTempFiles(foreign); await foreignPool.create(new Uint8Array([2]));
  await writeFile(path.join(foreign, 'original.wav'), 'original');
  // A live owner, even with old files, must never be swept.
  await cleanupStaleAudioSessions(base, { isAlive: () => true });
  assert.equal(pool.files.size, 1); assert.ok((await readdir(owned)).length);
  await cleanupStaleAudioSessions(base, { isAlive: () => false });
  await assert.rejects(readdir(owned), { code: 'ENOENT' });
  assert.equal(await readFile(path.join(unmarked, 'original.mp3'), 'utf8'), 'original');
  assert.equal(await readFile(path.join(foreign, 'original.wav'), 'utf8'), 'original');
  assert.ok((await readdir(foreign)).includes('.lyric-player-audio.json'));
});

test('F11 a real Windows exclusive handle survives failed deletes then cleans after release', { skip: process.platform !== 'win32', timeout: 20000 }, async t => {
  const pool = new AudioTempFiles(path.join(await root(t), 'session'), { retryDelays: [5, 10], warn: () => {} });
  const file = await pool.create(new Uint8Array([1, 2, 3]));
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "$h = [IO.File]::Open($env:LOCK_FILE, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None); [Console]::WriteLine('locked'); [Console]::ReadLine() | Out-Null; $h.Dispose()"],
    { env: { ...process.env, LOCK_FILE: file }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  t.after(() => child.kill());
  const ready = await new Promise((resolve, reject) => {
    let output = ''; const timer = setTimeout(() => reject(new Error('Lock helper did not start')), 10000);
    child.on('error', reject); child.stdout.on('data', bytes => { output += bytes; if (output.includes('locked')) { clearTimeout(timer); resolve(true); } });
    child.on('exit', code => { if (!output.includes('locked')) { clearTimeout(timer); reject(new Error(`Lock helper exited: ${code}`)); } });
  });
  assert.equal(ready, true);
  assert.equal(await pool.cleanup(), false); assert.equal(pool.files.size, 1);
  const exited = once(child, 'exit'); child.stdin.end('\n'); await exited;
  assert.equal(await pool.cleanup(), true); assert.equal(pool.files.size, 0); await pool.finish();
});
