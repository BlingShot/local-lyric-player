import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const origin = 'http://127.0.0.1:4189', output = 'test-results/issues-7-11';
await mkdir(output, { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 4189, strictPort: true }, plugins: [{
  name: 'issue-regression-page', configureServer(server) {
    server.middlewares.use('/__regressions', async (_request, response) => {
      response.setHeader('Content-Type', 'text/html');
      response.end(await server.transformIndexHtml('/__regressions', '<!doctype html><html><body><div id="root"></div></body></html>'));
    });
  },
}] });
let browser; const checks = [];
const call = (page, name, args = []) => page.evaluate(async ({ name, args }) => {
  const module = await import('/tests/issue-browser.tsx'); return module[name](...args);
}, { name, args });
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const a = await context.newPage(), b = await context.newPage();
  await Promise.all([a.goto(origin + '/__regressions'), b.goto(origin + '/__regressions')]);
  for (const marked of [false, true]) checks.push({ ttml: marked ? 'encoded/collision' : 'raw/external', result: await call(a, 'ttmlRoundtrip', [marked]) });
  await a.evaluate(async () => {
    const db = await import('/tests/issue-browser.tsx');
    await db.saveTracks([{ track: { id: 'shared', name: 'Before', size: 4, lastModified: 1, audioRevision: 'r1' }, audio: new Blob(['1234']) }]);
  });
  const before = (await call(a, 'readLibrary')).tracks[0];
  await call(b, 'patchExistingTracks', [[{ id: 'shared', patch: { name: 'From B', album: 'New album' }, expected: { metadataRevision: undefined } }]]);
  await call(a, 'patchExistingTracks', [[{ id: 'shared', patch: { duration: 42, lastPlayedAt: 200 } }]]);
  const latest = (await call(b, 'readLibrary')).tracks[0];
  assert.equal(latest.name, 'From B'); assert.equal(latest.album, 'New album'); assert.equal(latest.duration, 42);
  await assert.rejects(call(a, 'patchExistingTracks', [[{ id: 'shared', patch: { name: 'Stale edit' }, expected: { metadataRevision: before.metadataRevision } }]]), /changed in another tab/);
  await call(a, 'patchExistingTracks', [[{ id: 'shared', patch: { lastPlayedAt: 100 } }]]);
  assert.equal((await call(a, 'readLibrary')).tracks[0].lastPlayedAt, 200);
  checks.push('Shared IndexedDB: unrelated fields merge, stale edits conflict, history stays monotonic.');
  await assert.rejects(a.evaluate(async () => {
    const db = await import('/tests/issue-browser.tsx');
    await db.saveTracks([{ track: { id: 'shared', name: 'Duplicate', size: 4, lastModified: 1 }, audio: new Blob(['5678']) }]);
  }), /already imported/);
  await call(b, 'deleteTrack', ['shared']);
  assert.deepEqual(await call(a, 'patchExistingTracks', [[{ id: 'shared', patch: { duration: 45, lastPlayedAt: 300 } }]]), [undefined]);
  await assert.rejects(a.evaluate(async () => {
    const db = await import('/tests/issue-browser.tsx');
    await db.patchExistingTracks([{ id: 'shared', patch: { size: 4, audioRevision: 'r2' }, audio: new Blob(['5678']), expected: { audioRevision: 'r1' } }]);
  }), /removed in another tab/);
  await a.reload();
  const saved = await call(a, 'readLibrary'); assert.deepEqual(saved.tracks, []);
  assert.equal(await a.evaluate(async () => {
    const { openLibraryDatabase } = await import('/tests/issue-browser.tsx'); const db = await openLibraryDatabase();
    return new Promise(resolve => { const request = db.transaction('audio').objectStore('audio').count(); request.onsuccess = () => resolve(request.result); });
  }), 0);
  checks.push('Shared IndexedDB: duplicate imports do not overwrite; deletion survives stale writes/restores and reload.');
  const geometry = await context.newPage(); await geometry.goto(origin + '/__regressions');
  const boxes = () => geometry.evaluate(() => [...document.querySelectorAll('.lyric-vocal-group')].map(group => {
    const box = group.getBoundingClientRect(), scene = group.closest('.lyric-scene-columns').getBoundingClientRect();
    return { left: box.left - scene.left, width: box.width, row: group.style.gridRow, column: group.style.gridColumn };
  }));
  for (const mode of ['main', 'sidebar', 'fullscreen']) {
    await call(geometry, 'renderGeometry', [mode]); await geometry.waitForTimeout(250);
    const base = await boxes(); assert.equal(base.length, 2); assert.ok(base[1].left > base[0].left);
    for (const time of [0, 1.5, 2.5, 4.5, 7, 2.5, 1.5]) {
      await call(geometry, 'setClock', [time]); await geometry.waitForTimeout(60);
      assert.deepEqual(await boxes(), base, `${mode}: 0/1/2/1/0/backwards changed the grid`);
      const sides = await geometry.locator('[data-preview-line=b]').getAttribute('data-vocal-side'); assert.equal(sides, 'right');
    }
    await geometry.screenshot({ path: `${output}/${mode}.png`, fullPage: true });
  }
  await call(geometry, 'renderGeometry', ['main', true]); await geometry.waitForTimeout(100);
  const cells = await boxes(); assert.equal(cells.length, 3); assert.ok(cells.some(cell => cell.row === '1 / span 2'));
  await call(geometry, 'renderGeometry', ['main', false, false]); await geometry.waitForTimeout(100);
  assert.ok((await boxes()).every(cell => !cell.column));
  checks.push('Shared LyricsView and Studio preview: stable lanes at three surface sizes, backwards seeks, chained row span, alignment off.');
  const native = await context.newPage(); await native.goto(origin + '/__regressions');
  checks.push({ nativeBridge: await call(native, 'repeatNativePlay') });
  await writeFile(`${output}/checks.json`, JSON.stringify(checks, null, 2));
  console.log(JSON.stringify({ success: true, checks }, null, 2));
} catch (error) {
  await writeFile(`${output}/failure.txt`, error.stack || String(error)); throw error;
} finally { await browser?.close(); await server.close(); }
