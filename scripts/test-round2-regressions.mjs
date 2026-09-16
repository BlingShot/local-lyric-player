import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const origin = 'http://127.0.0.1:4190', output = 'test-results/issues-1-6';
await mkdir(output, { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 4190, strictPort: true }, plugins: [{
  name: 'round2-regression-page', configureServer(server) {
    server.middlewares.use('/__round2', async (_request, response) => {
      response.setHeader('Content-Type', 'text/html');
      response.end(await server.transformIndexHtml('/__round2', '<!doctype html><html><body><div id="root"></div></body></html>'));
    });
  },
}] });
const call = async (page, name, args = []) => {
  let timer;
  try { return await Promise.race([page.evaluate(async ({ name, args }) => {
  const module = await import('/tests/issue-round2-browser.ts'); return module[name](...args);
}, { name, args }), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Browser regression timed out: ${name}`)), 30000); })]); }
  finally { clearTimeout(timer); }
};
let browser; const checks = [];
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const a = await context.newPage(), b = await context.newPage();
  await Promise.all([a.goto(origin + '/__round2'), b.goto(origin + '/__round2')]);
  // Seed a true version-4 database BEFORE the new repository module is imported.
  await a.evaluate(async () => {
    const oldId = JSON.stringify(['same.wav', 4, 123]);
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('local-music-library', 4);
      request.onupgradeneeded = () => {
        for (const name of ['tracks', 'audio', 'covers', 'settings', 'playlists', 'lyrics', 'analysis', 'analysis-edits', 'analysis-tasks']) request.result.createObjectStore(name);
      };
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction([...db.objectStoreNames], 'readwrite');
      tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
      tx.objectStore('tracks').put({ id: oldId, name: 'Renamed title', size: 4, lastModified: 123, lastPlayedAt: 456 }, oldId);
      tx.objectStore('audio').put(new Blob(['AAAA']), oldId); tx.objectStore('covers').put(new Blob(['cover']), oldId);
      tx.objectStore('lyrics').put({ trackId: oldId, source: '[00:01]Legacy', fileName: 'legacy.lrc', savedAt: 1 }, oldId);
      tx.objectStore('playlists').put({ id: 'p', name: 'Old playlist', trackIds: [oldId] }, 'p');
      for (const store of ['analysis', 'analysis-tasks']) tx.objectStore(store).put({ trackId: oldId, retained: true }, [oldId, 'a']);
      tx.objectStore('analysis-edits').put({ trackId: oldId, retained: true }, oldId);
      tx.objectStore('settings').put({ trackId: oldId, retained: true }, 'lyric-studio:' + oldId);
    }); db.close();
  });
  checks.push({ F06: await call(a, 'collisionImportAndMigration') });
  // A retains an early snapshot; B writes actual IndexedDB commits in another page.
  let before = await call(a, 'seedTrack', ['versioned']);
  await call(b, 'saveLyricOffset', ['versioned', 1250, before.lyrics.savedAt]);
  await assert.rejects(call(a, 'writeCopy', [before]), /timing offset changed/);
  let current = await call(b, 'snapshot', ['versioned']);
  assert.equal(current.audio, 'original'); assert.equal(current.lyrics.offsetMs, 1250); assert.notEqual(current.token, before.token);
  before = current; await call(b, 'replaceLyrics', ['versioned']);
  await assert.rejects(call(a, 'writeCopy', [before]), /timing offset changed/);
  current = await call(a, 'snapshot', ['versioned']); assert.equal(current.lyrics.fileName, 'new.lrc'); assert.equal(current.audio, 'original');
  before = current; await call(a, 'writeCopy', [before]);
  current = await call(b, 'snapshot', ['versioned']); assert.equal(current.audio, 'modified-copy'); assert.notEqual(current.token, before.token);
  await assert.rejects(call(b, 'writeCopy', [before]), /audio changed/);
  before = current; await call(b, 'deleteTrack', ['versioned']);
  await assert.rejects(call(a, 'writeCopy', [before]), /removed/);
  current = await call(a, 'snapshot', ['versioned']); assert.equal(current.track, undefined); assert.equal(current.audio, undefined); assert.equal(current.token, null);
  checks.push('F02: real two-page IndexedDB offset/source/audio revision/deletion conflicts are atomic; valid copy commits succeed.');
  // Abort real IndexedDB transactions after put; neither project may replace the other's recovery.
  await assert.rejects(call(a, 'draftSave', ['draft-A', true]));
  await assert.rejects(call(a, 'draftSave', ['draft-B', true]));
  await a.reload();
  assert.deepEqual((await call(a, 'recoveries')).map(x => x.trackId).sort(), ['draft-A', 'draft-B']);
  for (const id of ['draft-A', 'draft-B']) assert.equal((await call(a, 'readStudioDraft', [id])).lines[0].text, 'Unsaved ' + id);
  await call(a, 'saveRestored', ['draft-B']); assert.deepEqual((await call(a, 'recoveries')).map(x => x.trackId), ['draft-A']);
  await assert.rejects(call(a, 'draftSave', ['draft-C', true, true]), /Draft and recovery copy could not be saved/);
  assert.deepEqual((await call(a, 'recoveries')).map(x => x.trackId), ['draft-A']);
  await call(a, 'saveRestored', ['draft-A']); assert.deepEqual(await call(a, 'recoveries'), []);
  await call(a, 'seedLegacyDraft'); await call(a, 'saveRestored', ['legacy-draft']);
  assert.equal(await a.evaluate(() => localStorage.getItem('lyric-studio-recovery')), null);
  checks.push('F03: real transaction abort, two-project recovery across reload, isolated cleanup, quota failure and legacy recovery migration passed.');
  for (const name of ['nativeIntentRegressions', 'bridgeDeviceFaults']) {
    const page = await context.newPage(); await page.goto(origin + '/__round2');
    checks.push({ [name]: await call(page, name) }); await page.close();
  }
  await writeFile(`${output}/checks.json`, JSON.stringify(checks, null, 2));
  console.log(JSON.stringify({ success: true, checks }, null, 2));
} catch (error) { await writeFile(`${output}/failure.txt`, error.stack || String(error)); throw error; }
finally { await browser?.close(); await server.close(); }
