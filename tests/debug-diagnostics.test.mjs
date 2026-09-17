import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, stat, rm, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DesktopLogger } from '../electron/logging.mjs';
import { redactDiagnostic, redactLogText, serializeDebugReport } from '../electron/log-redaction.mjs';
import { NativeAudio } from '../electron/native-audio.mjs';

async function temporary(t) { const dir = await mkdtemp(path.join(os.tmpdir(), 'debug-test-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; }
test('nested credentials, URL credentials, user paths and error causes are redacted before serialization', () => {
  const error = new Error('open C:\\Users\\Alice\\Music\\song.flac failed', { cause: new Error('Bearer very-private-secret') });
  const input = { apiKey: 'api-private', nested: { access_token: 'access-private', refreshToken: 'refresh-private', Cookie: 'cookie-private', password: 'pw-private' },
    error, urls: ['https://bob:secret@example.com/file?key=sensitive', 'file:///home/Alice/Music/song.flac', 'file:///C:/Users/Alice/Music/song.flac'],
    path: '/Users/Alice/Music/song.flac', bytes: new Uint8Array([1, 2, 3]) };
  input.circular = input;
  const result = JSON.stringify(redactDiagnostic(input));
  for (const secret of ['Alice', 'api-private', 'access-private', 'refresh-private', 'cookie-private', 'pw-private', 'very-private-secret', 'bob:secret', 'key=sensitive']) assert.ok(!result.includes(secret), secret);
  assert.ok(result.includes('song.flac')); assert.ok(result.includes('stack')); assert.ok(result.includes('[CIRCULAR]')); assert.ok(result.includes('[BINARY 3 bytes]'));
  assert.equal(redactLogText('Cookie: sid=abc; session=def\nnext line'), 'Cookie: [REDACTED]\nnext line');
});
test('report keeps all section names, independently sanitizes each and stays within a byte budget', () => {
  const report = serializeDebugReport({ environment: { apiKey: 'never-save-this' }, lyrics: { words: Array.from({ length: 500 }, () => ({ text: '字'.repeat(5000) })) },
    performance: { fps: 60 }, recentErrors: [{ message: 'retained' }], recentLogs: Array.from({ length: 500 }, () => ({ message: 'log'.repeat(1000) })) }, 65536);
  assert.ok(Buffer.byteLength(report) <= 65536); const value = JSON.parse(report);
  for (const key of ['environment', 'lyrics', 'performance', 'recentErrors', 'recentLogs']) assert.ok(key in value);
  assert.equal(value.performance.fps, 60); assert.ok(!report.includes('never-save-this'));
});
test('multibyte entries, concurrent rotation, queue overflow and normal-mode filtering remain bounded', async t => {
  const root = await temporary(t), logger = new DesktopLogger(root, { maxBytes: 1024, maxFiles: 3, maxQueued: 8 });
  logger.setDebug(true);
  await Promise.all(Array.from({ length: 100 }, (_, i) => logger.write({ level: 'debug', scope: 'test', message: `${i} ${'字'.repeat(5000)}`, data: { token: 'must-not-remain' } })));
  assert.ok(logger.dropped > 0);
  await logger.write({ level: 'error', scope: 'audio', message: 'decode failed', data: { error: new Error('corrupt.flac') } });
  const names = await readdir(logger.directory); assert.ok(names.length <= 3);
  for (const name of names) assert.ok((await stat(path.join(logger.directory, name))).size <= 1024);
  const text = await logger.read(); assert.ok(text.includes('decode failed')); assert.ok(!text.includes('must-not-remain'));
  for (const line of text.trim().split('\n')) JSON.parse(line);
  logger.setDebug(false); await logger.write({ level: 'debug', scope: 'test', message: 'off-only' });
  for (const level of ['info', 'warn', 'error']) await logger.write({ level, scope: 'test', message: `kept-${level}` });
  const normal = await logger.read(); assert.ok(!normal.includes('off-only')); for (const level of ['info', 'warn', 'error']) assert.ok(normal.includes(`kept-${level}`));
});
test('clear is ordered after pending writes, preserves unrelated files and logger survives write failures', async t => {
  const root = await temporary(t), logger = new DesktopLogger(root, { maxBytes: 1024 });
  const first = logger.write({ level: 'info', scope: 'test', message: 'before-clear' });
  const clear = logger.clear(); await Promise.all([first, clear]);
  assert.equal(await logger.read(), ''); assert.equal((await logger.info()).recent.length, 0);
  await writeFile(path.join(logger.directory, 'user-notes.txt'), 'keep');
  await logger.clear(); assert.equal(await readFile(path.join(logger.directory, 'user-notes.txt'), 'utf8'), 'keep');
  await rm(logger.directory, { recursive: true }); await writeFile(logger.directory, 'blocked');
  await assert.rejects(logger.write({ level: 'error', scope: 'test', message: 'cannot-write' }));
  await rm(logger.directory); await logger.write({ level: 'error', scope: 'test', message: 'recovered' });
  assert.ok((await logger.read()).includes('recovered'));
});
test('native decode reports concrete stage and original exception without changing load failure semantics', async t => {
  const root = await temporary(t), events = [];
  class Helper extends NativeAudio {
    async devices() { return [{ name: 'auto' }]; }
    async request(command) { if (command[0] === 'loadfile') throw new Error('specific decoder initialization failure'); }
  }
  const audio = new Helper('unused', path.join(root, 'audio'), { diagnostic: (level, stage, data) => events.push({ level, stage, data }) });
  await assert.rejects(audio.load({ id: 'test', bytes: new Uint8Array([1]).buffer, device: 'auto', exclusive: false, position: 0, volume: 50, speed: 1 }), /specific decoder/);
  const failed = events.find(event => event.stage === 'LoadFailed'); assert.equal(failed.data.stage, 'Decode'); assert.ok(failed.data.error.stack.includes('specific decoder'));
  await audio.dispose();
});
test('throwing diagnostic sinks cannot stop native transport', async t => {
  const root = await temporary(t), audio = new NativeAudio('unused', path.join(root, 'audio'), { diagnostic: () => { throw new Error('sink failed'); } });
  assert.doesNotThrow(() => audio.debugEvent('error', 'test')); await audio.dispose();
});
