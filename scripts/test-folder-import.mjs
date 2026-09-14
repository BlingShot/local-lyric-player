import { chromium } from 'playwright';
import { preview } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { taggedWav } from './library-fixtures.mjs';

const origin = 'http://127.0.0.1:4177';
const profile = resolve(`test-results/folder-profile-${Date.now()}`);
await mkdir('test-results', { recursive: true });
const server = await preview({ preview: { host: '127.0.0.1', port: 4177, strictPort: true } });
const errors = [], external = [], checks = [];
let context, page, phase = 'startup';
const launch = async () => {
  const context = await chromium.launchPersistentContext(profile, { headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge', viewport: { width: 1440, height: 960 } });
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin !== origin) { external.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  // Exercise real, serializable browser directory/file handles. Only the native chooser and permission UI are simulated.
  await context.addInitScript(() => {
    window.__audioCount = 0; const Audio = window.Audio;
    window.Audio = class extends Audio { constructor(...args) { super(...args); window.__audioCount++; } };
    window.__folderPermission = 'granted'; window.__permissionRequests = 0;
    FileSystemHandle.prototype.queryPermission = async () => window.__folderPermission;
    FileSystemHandle.prototype.requestPermission = async () => { window.__permissionRequests++; window.__folderPermission = 'granted'; return 'granted'; };
    const values = FileSystemDirectoryHandle.prototype.values;
    window.__scans = 0;
    FileSystemDirectoryHandle.prototype.values = function(...args) {
      window.__scans++;
      if (window.__missingFolder) throw new DOMException('The folder is no longer available. Choose it again.', 'NotFoundError');
      return values.apply(this, args);
    };
    window.showDirectoryPicker = async options => {
      window.__pickerOptions = options;
      if (window.__cancelPicker) throw new DOMException('Cancelled', 'AbortError');
      return (await navigator.storage.getDirectory()).getDirectoryHandle('Auto import test', { create: true });
    };
  });
  for (const page of context.pages()) page.on('pageerror', error => errors.push(phase + ': ' + error.message));
  return context;
};
const settings = () => page.getByRole('dialog', { name: 'Settings', exact: true });
const folder = () => settings().locator('.settings-auto-import');
const openSettings = async () => { await page.getByRole('button', { name: 'Settings', exact: true }).click(); await folder().waitFor(); };
const closeSettings = async () => { await settings().getByRole('button', { name: 'Close', exact: true }).click(); await settings().waitFor({ state: 'hidden' }); };
const addFile = async (path, title) => page.evaluate(async ({ path, bytes }) => {
  let dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('Auto import test', { create: true });
  const parts = path.split('/');
  for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create: true });
  const file = await dir.getFileHandle(parts.at(-1), { create: true });
  const writer = await file.createWritable(); await writer.write(new Uint8Array(bytes)); await writer.close();
}, { path, bytes: [...taggedWav({ TIT2: title })] });
const readRecords = () => page.evaluate(() => new Promise((resolve, reject) => {
  const open = indexedDB.open('local-music-library');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => { const db = open.result, tx = db.transaction('tracks'), get = tx.objectStore('tracks').getAll(); get.onsuccess = () => resolve(get.result); tx.oncomplete = () => db.close(); };
}));
const scanned = () => folder().getByRole('status').filter({ hasText: /Up to date|Added \d+ new/ }).waitFor({ timeout: 45_000 });
try {
  context = await launch(); page = context.pages()[0];
  await page.goto(origin); await page.getByRole('heading', { name: 'Your library is empty' }).last().waitFor();
  await addFile('first.wav', 'Folder first'); await addFile('nested/second.wav', 'Folder second');
  await addFile('ignored.txt', 'Ignored');
  await openSettings();
  phase = 'cancel and folder-setting failure';
  await page.evaluate(() => window.__cancelPicker = true);
  await folder().getByRole('button', { name: 'Choose folder', exact: true }).click();
  assert.equal(await folder().getByRole('alert').count(), 0);
  await page.evaluate(() => {
    window.__cancelPicker = false; window.__put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(...args) { if (this.name === 'settings' && args[1] === 'auto-import-folder') throw new DOMException('Test full storage', 'QuotaExceededError'); return window.__put.apply(this, args); };
  });
  await folder().getByRole('button', { name: 'Choose folder', exact: true }).click();
  await folder().getByRole('alert').filter({ hasText: 'Browser storage is full' }).waitFor();
  assert.equal((await readRecords()).length, 0);
  await page.evaluate(() => IDBObjectStore.prototype.put = window.__put);
  phase = 'recursive import';
  await folder().getByRole('button', { name: 'Choose folder', exact: true }).click(); await scanned();
  assert.equal((await readRecords()).length, 2);
  assert.deepEqual(await page.evaluate(() => window.__pickerOptions), { mode: 'read', id: 'local-music-auto-import', startIn: 'music' });
  await folder().getByRole('button', { name: 'Scan now', exact: true }).click(); await scanned();
  assert.equal((await readRecords()).length, 2);
  checks.push('read-only folder selection imports supported audio in nested folders, skips other files and duplicates, and does not claim success when saving the folder handle fails');
  phase = 'startup-only scanning and remove suppression';
  await closeSettings();
  await page.getByRole('button', { name: 'Folder first Local file', exact: true }).click();
  await page.getByRole('button', { name: 'Remove Folder second', exact: true }).click();
  await page.getByRole('button', { name: 'Remove Folder second', exact: true }).waitFor({ state: 'detached' });
  await addFile('nested/third.wav', 'Folder third');
  const previousScans = await page.evaluate(() => window.__scans);
  await page.evaluate(() => { dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(31_000);
  assert.equal(await page.evaluate(() => window.__scans), previousScans, 'No periodic or foreground directory scans');
  assert.deepEqual((await readRecords()).map(track => track.name), ['Folder first']);
  await page.reload();
  await page.getByRole('button', { name: 'Folder third Local file', exact: true }).waitFor();
  assert.deepEqual((await readRecords()).map(track => track.name).sort(), ['Folder first', 'Folder third']);
  assert.equal(await page.evaluate(() => window.__audioCount), 1);
  await openSettings(); await scanned();
  checks.push('31 seconds plus focus/visibility events perform no directory enumeration; startup imports the new file once and does not restore a removed song; one audio instance');
  phase = 'permission and missing-folder recovery';
  await page.evaluate(() => window.__folderPermission = 'prompt');
  await folder().getByRole('button', { name: 'Scan now', exact: true }).click();
  await folder().getByRole('button', { name: 'Allow folder access', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__permissionRequests), 0);
  await folder().getByRole('button', { name: 'Allow folder access', exact: true }).click(); await scanned();
  assert.equal(await page.evaluate(() => window.__permissionRequests), 1);
  await page.evaluate(() => window.__missingFolder = true);
  await folder().getByRole('button', { name: 'Scan now', exact: true }).click();
  await folder().getByRole('alert').filter({ hasText: 'no longer available' }).waitFor();
  await page.evaluate(() => window.__missingFolder = false);
  await folder().getByRole('button', { name: 'Scan now', exact: true }).click(); await scanned();
  checks.push('lost permission pauses import without opening a prompt automatically; explicit Allow access resumes, and missing folders have a recoverable error');
  phase = 'audio quota failure';
  await addFile('fourth.wav', 'Folder fourth');
  await page.evaluate(() => {
    window.__put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(...args) { if (this.name === 'audio') throw new DOMException('Test full storage', 'QuotaExceededError'); return window.__put.apply(this, args); };
  });
  await folder().getByRole('button', { name: 'Scan now', exact: true }).click();
  await folder().getByRole('alert').filter({ hasText: 'Audio could not be saved' }).waitFor();
  assert.equal((await readRecords()).length, 2);
  await page.evaluate(() => IDBObjectStore.prototype.put = window.__put);
  await folder().getByRole('button', { name: 'Scan now', exact: true }).click(); await scanned();
  assert.equal((await readRecords()).length, 3);
  await page.screenshot({ path: 'test-results/settings-auto-import.png' });
  checks.push('a failed audio-copy transaction adds no track, reports failure, and retries the new file successfully after storage recovers');
  phase = 'browser restart restores handle and scan history';
  await addFile('fifth.wav', 'Folder fifth');
  await context.close(); context = await launch(); page = context.pages()[0];
  await page.goto(origin); await page.getByRole('button', { name: 'Folder third Local file', exact: true }).waitFor();
  await openSettings(); await scanned();
  assert.equal((await readRecords()).length, 4);
  await folder().getByRole('button', { name: 'Scan now', exact: true }).click(); await scanned();
  assert.equal((await readRecords()).length, 4);
  checks.push('a full browser close/relaunch restores a real IndexedDB directory handle and scan history, excludes previously removed songs, and can read new files');
  phase = 'disconnect';
  await folder().getByRole('button', { name: 'Disconnect folder', exact: true }).click();
  await folder().getByRole('button', { name: 'Choose folder', exact: true }).waitFor();
  assert.equal((await readRecords()).length, 4);
  const originalCount = await page.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('Auto import test');
    const nested = await dir.getDirectoryHandle('nested');
    return (await (await nested.getFileHandle('second.wav')).getFile()).size;
  });
  assert.ok(originalCount > 0);
  await page.reload(); await openSettings();
  await folder().getByRole('button', { name: 'Choose folder', exact: true }).waitFor();
  checks.push('disconnect is persisted, keeps imported audio copies and leaves the removed song’s original file intact');
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  const report = { result: 'passed', checks, errors, external, limitation: 'Native folder chooser and permission dialogs are simulated; directory enumeration, handles, IndexedDB, audio imports, 31-second idle and process restart use real browser APIs.' };
  await writeFile('test-results/folder-import.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} catch (error) { console.error(JSON.stringify({ phase, errors, external })); throw error; }
finally { await context?.close(); await new Promise(resolve => server.httpServer.close(resolve)); }
