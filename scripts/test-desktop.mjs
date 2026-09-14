import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { taggedWav, png } from './library-fixtures.mjs';

const root = path.resolve('test-results/desktop');
await mkdir(root, { recursive: true });
const profile = await mkdtemp(path.join(root, 'profile-'));
const downloads = await mkdtemp(path.join(root, 'downloads-'));
const env = { ...process.env, DESKTOP_TEST_PROFILE: profile, DESKTOP_TEST_DOWNLOADS: downloads };
const packaged = process.argv.includes('--packaged');
let entry = path.resolve('scripts/desktop-smoke-entry.mjs');
if (packaged) {
  const bundle = pathToFileURL(path.resolve('release/win-unpacked/resources/app.asar/electron/app.mjs')).href;
  entry = path.join(root, 'packaged-entry.mjs');
  await writeFile(entry, (await readFile('scripts/desktop-smoke-entry.mjs', 'utf8')).replace('../electron/app.mjs', bundle));
}
delete env.ELECTRON_RUN_AS_NODE; delete env.LOCAL_MUSIC_DEV_URL;
let application, page;
const errors = [], external = [], checks = [];
const launch = async () => {
  application = await electron.launch({ args: [entry], env, timeout: 30000 });
  page = await application.firstWindow();
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^https?:/.test(request.url())) external.push(request.url()); });
  await page.waitForURL('localmusic://app/');
  await page.getByRole('heading', { name: 'Local library', exact: true }).waitFor();
};
const click = locator => locator.evaluate(element => element.click());
const read = name => page.evaluate(name => new Promise((resolve, reject) => {
  const request = indexedDB.open('local-music-library'); request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const db = request.result, tx = db.transaction(name), q = tx.objectStore(name).getAll();
    tx.oncomplete = () => { db.close(); resolve(q.result); };
  };
}), name);
const until = async (check, label) => {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out: ${label}`);
};
const route = async pathname => {
  await page.evaluate(pathname => { history.pushState(null, '', pathname); window.dispatchEvent(new PopStateEvent('popstate')); }, pathname);
};
const remainHidden = async () => {
  assert.deepEqual(await application.evaluate(({ BrowserWindow }) => ({
    events: globalThis.desktopWindowEvents,
    visible: BrowserWindow.getAllWindows().some(win => win.isVisible()),
    focused: BrowserWindow.getAllWindows().some(win => win.isFocused()),
  })), { events: [], visible: false, focused: false });
};
try {
  await launch();
  const security = await page.evaluate(() => ({ node: typeof window.require, process: typeof window.process,
    secure: window.isSecureContext, folderPicker: typeof window.showDirectoryPicker }));
  assert.deepEqual(security, { node: 'undefined', process: 'undefined', secure: true, folderPicker: 'function' });
  await click(page.getByRole('button', { name: 'Import music', exact: true }).first());
  const audio = prefix => ({ name: `${prefix}.wav`, mimeType: 'audio/wav',
    buffer: taggedWav({ TIT2: `${prefix} desktop test`, TPE1: 'Test artist', TALB: 'Test album' },
      [{ type: 3, data: png(40, 90, 210) }], '[00:00.00]First test line\n[00:03.00]Second test line\n[00:08.00]Last test line', 12, prefix === 'Alpha' ? 44100 : 48000) });
  await page.getByLabel('Choose audio files', { exact: true }).setInputFiles([audio('Alpha'), audio('Beta')]);
  await page.getByRole('status').filter({ hasText: 'Added 2 files' }).waitFor();
  await click(page.getByRole('button', { name: 'Close', exact: true }));
  const tracks = await read('tracks'), alpha = tracks.find(t => t.fileName === 'Alpha.wav'), beta = tracks.find(t => t.fileName === 'Beta.wav');
  assert.equal(tracks.length, 2); assert.equal((await read('audio')).length, 2); assert.equal((await read('lyrics')).length, 2);
  checks.push('Secure local origin, sandboxed renderer, file import, metadata worker, embedded lyrics and IndexedDB audio copies');

  await click(page.getByRole('button', { name: 'Play saved track Alpha desktop test', exact: true }));
  await page.waitForFunction(() => !document.querySelector('audio').paused && document.querySelector('audio').currentTime > .1);
  await page.evaluate(() => { window.desktopAudio = document.querySelector('audio'); });
  await route('/lyrics');
  await page.locator('.lyrics-page').waitFor();
  assert.equal(await page.evaluate(() => document.querySelector('audio') === window.desktopAudio), true);
  await page.evaluate(() => { const audio = document.querySelector('audio'); audio.currentTime = audio.duration - .15; });
  await page.waitForFunction(() => document.body.textContent.includes('Beta desktop test') && document.querySelector('audio').currentTime < 3 && !document.querySelector('audio').paused);
  await page.waitForTimeout(500);
  await remainHidden();
  assert.equal(await page.locator('audio').count(), 1);
  checks.push('Playback across React routes and real ended/automatic next-track event with no window show/focus/restore');
  await page.evaluate(() => document.querySelector('audio').pause());

  await route(`/analyze/${encodeURIComponent(beta.id)}`);
  await page.getByRole('button', { name: 'Analyze BPM & Key', exact: true }).waitFor();
  await click(page.getByRole('button', { name: 'Analyze BPM & Key', exact: true }));
  await until(async () => { const tasks = await read('analysis-tasks'); return tasks.length === 2 && tasks.every(t => ['complete', 'failed'].includes(t.status)); }, 'BPM and Key');
  assert.ok((await read('analysis-tasks')).every(t => t.status === 'complete'), JSON.stringify(await read('analysis-tasks')));
  await click(page.getByRole('button', { name: 'Analyze track loudness', exact: true }));
  await until(async () => (await read('analysis-tasks')).some(t => t.kind === 'loudness' && ['complete', 'failed'].includes(t.status)), 'Loudness');
  assert.equal((await read('analysis-tasks')).find(t => t.kind === 'loudness')?.status, 'complete', JSON.stringify(await read('analysis-tasks')));
  checks.push('Bundled Essentia/WASM and loudness workers complete inside Electron without a server');

  await route(`/studio?trackId=${encodeURIComponent(beta.id)}`);
  await page.locator('.studio-row').first().waitFor();
  await page.getByText('Draft saved', { exact: true }).waitFor();
  assert.equal(await page.locator('audio').count(), 1);
  await click(page.getByRole('button', { name: 'Export ▾', exact: true }));
  await page.getByRole('menuitem', { name: 'Export TTML', exact: true }).click();
  const exported = path.join(downloads, 'Beta.ttml');
  await until(() => access(exported).then(() => true).catch(() => false), 'Native TTML download');
  assert.match(await readFile(exported, 'utf8'), /<tt xmlns=/);
  checks.push('Studio embedded lyric loading, automatic draft save and independent TTML download');
  await page.evaluate(() => { const audio = document.querySelector('audio'); audio.pause(); audio.currentTime = 2.5; });
  await page.waitForTimeout(1200);
  await remainHidden();
  await page.screenshot({ path: path.join(root, 'studio.png') });
  await application.close(); application = undefined;
  await launch();
  await page.waitForFunction(() => document.querySelector('audio')?.currentTime > 2);
  assert.equal((await read('tracks')).length, 2);
  assert.equal((await read('analysis')).length, 3);
  assert.ok(Math.abs(await page.locator('audio').evaluate(audio => audio.currentTime) - 2.5) < .5);
  await route('/studio');
  await page.locator('.studio-row').first().waitFor();
  await remainHidden();
  checks.push('Full Electron restart restores library, analysis, Studio draft and paused playback position from the same profile');
  await route('/');
  await click(page.getByRole('button', { name: 'Settings', exact: true }).first());
  await page.getByRole('heading', { name: 'Storage', exact: true }).waitFor();
  const initialStorage = await page.evaluate(() => window.localMusicDesktop.storageInfo());
  assert.equal(initialStorage.dataPath, profile); assert.ok(initialStorage.dataBytes > 1000000);
  await click(page.getByRole('button', { name: 'Clear cache', exact: true }));
  await page.getByRole('status').filter({ hasText: 'Cache cleared.' }).waitFor();
  assert.equal((await read('tracks')).length, 2); assert.equal((await read('lyrics')).length, 2); assert.equal((await read('analysis')).length, 3);
  await page.screenshot({ path: path.join(root, 'storage.png'), animations: 'disabled' });
  const dataParent = await mkdtemp(path.join(root, 'relocated-data-')), cacheParent = await mkdtemp(path.join(root, 'relocated-cache-'));
  // Select temporary test folders through the real IPC flow without a native dialog appearing.
  await application.evaluate(({ dialog, app }, { dataParent, cacheParent }) => {
    dialog.showOpenDialog = async (_win, options) => ({ canceled: false, filePaths: [options.title.includes(' Data') ? dataParent : cacheParent] });
    app.relaunch = () => {}; // The harness relaunches and reconnects itself below.
  }, { dataParent, cacheParent });
  await click(page.getByRole('button', { name: 'Change data location', exact: true }));
  await page.getByText('Apply on restart', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Change cache location', exact: true }).click();
  await until(async () => (await page.evaluate(() => window.localMusicDesktop.storageInfo())).pending?.cachePath === path.join(cacheParent, 'Local Music Cache'), 'cache selection');
  const closed = application.waitForEvent('close');
  await page.getByRole('button', { name: 'Apply and restart', exact: true }).click();
  await closed; application = undefined;
  await launch();
  await page.waitForFunction(() => document.querySelector('audio')?.currentTime > 2);
  const migrated = await page.evaluate(() => window.localMusicDesktop.storageInfo());
  assert.equal(migrated.dataPath, path.join(dataParent, 'Local Music Data'));
  assert.equal(migrated.cachePath, path.join(cacheParent, 'Local Music Cache'));
  assert.equal(migrated.previousDataPath, profile);
  assert.equal((await read('tracks')).length, 2); assert.equal((await read('audio')).length, 2);
  assert.equal((await read('lyrics')).length, 2); assert.equal((await read('analysis')).length, 3);
  await route('/studio'); await page.locator('.studio-row').first().waitFor();
  await remainHidden();
  checks.push('Settings cache clearing preserves library; real IPC location selection and restart migrate and restore IndexedDB audio, lyrics, drafts, analysis and playback bookmark with the old data retained');
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log(JSON.stringify({ checks, errors, external }, null, 2));
  await writeFile(path.join(root, packaged ? 'packaged-results.json' : 'results.json'), JSON.stringify({ packaged, checks, errors, external }, null, 2));
} catch (error) {
  console.error('Desktop test state:', { checks, errors, tasks: page && !page.isClosed() ? await read('analysis-tasks').catch(() => []) : [] });
  console.error('Downloads:', await application?.evaluate(() => globalThis.desktopDownloads));
  console.error('Studio:', await page?.locator('.studio-page').innerText().catch(() => ''));
  throw error;
} finally { await application?.close(); }
