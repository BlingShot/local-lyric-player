import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DesktopStorage, copyDatabase, directoryBytes, separatePaths } from '../electron/storage.mjs';

fs.mkdirSync('test-results/desktop-storage', { recursive: true });
const fixture = () => {
  const root = fs.mkdtempSync(path.resolve('test-results/desktop-storage/run-'));
  const options = { controlRoot: path.join(root, 'control'), defaultData: path.join(root, 'data'), defaultCache: path.join(root, 'cache') };
  const storage = new DesktopStorage(options); storage.startup();
  return { root, options, storage };
};
test('cache directories live in a separate location and are excluded from database size', async () => {
  const { storage } = fixture(), { dataPath, cachePath } = storage.config;
  fs.mkdirSync(path.join(dataPath, 'IndexedDB'));
  fs.writeFileSync(path.join(dataPath, 'IndexedDB', 'song.blob'), 'audio');
  fs.writeFileSync(path.join(dataPath, 'Cache', 'temporary'), Buffer.alloc(1000));
  assert.ok(fs.lstatSync(path.join(dataPath, 'Cache')).isSymbolicLink());
  assert.equal(fs.readFileSync(path.join(cachePath, 'Cache', 'temporary')).length, 1000);
  assert.ok(await directoryBytes(dataPath) < 1000);
});
test('closed-profile migration preserves verified audio, lyrics and settings and leaves a backup', async () => {
  const { root, options, storage } = fixture(), from = storage.config.dataPath;
  fs.mkdirSync(path.join(from, 'IndexedDB')); fs.mkdirSync(path.join(from, 'Local Storage'));
  const bytes = Buffer.from('Audio \0 lyrics & 草稿');
  fs.writeFileSync(path.join(from, 'IndexedDB', 'library'), bytes);
  fs.writeFileSync(path.join(from, 'Local Storage', 'settings'), 'position=12.5');
  fs.mkdirSync(path.join(root, 'new'));
  await storage.stage('data', path.join(root, 'new')); await storage.schedule();
  assert.equal(storage.config.dataPath, from, 'Never move the live database');
  const reopened = new DesktopStorage(options); reopened.startup();
  assert.deepEqual(fs.readFileSync(path.join(reopened.config.dataPath, 'IndexedDB', 'library')), bytes);
  assert.equal(fs.readFileSync(path.join(reopened.config.dataPath, 'Local Storage', 'settings'), 'utf8'), 'position=12.5');
  assert.equal(reopened.config.previousDataPath, from);
  assert.ok(fs.existsSync(path.join(from, 'IndexedDB', 'library')));
});
test('occupied destination fails safely and keeps the old database active', async () => {
  const { root, options, storage } = fixture(); fs.mkdirSync(path.join(root, 'new'));
  await storage.stage('data', path.join(root, 'new')); await storage.schedule();
  fs.mkdirSync(storage.pending.dataPath); fs.writeFileSync(path.join(storage.pending.dataPath, 'keep.txt'), 'untouched');
  const reopened = new DesktopStorage(options); reopened.startup();
  assert.equal(reopened.config.dataPath, options.defaultData); assert.match(reopened.config.error, /failed/);
  assert.equal(fs.readFileSync(path.join(storage.pending.dataPath, 'keep.txt'), 'utf8'), 'untouched');
});
test('unsafe paths, linked data, missing drives and corrupt configuration fail explicitly', () => {
  const { root, options, storage } = fixture();
  assert.throws(() => separatePaths(path.join(root, 'data'), path.join(root, 'data/cache')));
  assert.throws(() => copyDatabase(storage.config.dataPath, path.join(storage.config.dataPath, 'nested')));
  fs.symlinkSync(root, path.join(storage.config.dataPath, 'unexpected-link'), 'junction');
  assert.throws(() => copyDatabase(storage.config.dataPath, path.join(root, 'copy')), /linked/);
  fs.writeFileSync(storage.file, JSON.stringify({ version: 1, dataPath: path.join(root, 'missing-drive'), cachePath: options.defaultCache }));
  assert.throws(() => new DesktopStorage(options).startup(), /unavailable/);
  fs.writeFileSync(storage.file, '{ broken');
  assert.throws(() => new DesktopStorage(options));
});
