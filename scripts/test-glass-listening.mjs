import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { taggedWav } from './library-fixtures.mjs';
import { selectMenu } from './select-menu.mjs';

const root = resolve('test-results/glass-listening'); await mkdir(root, { recursive: true });
const origin = 'http://127.0.0.1:4198';
const server = await createServer({ server: { host: '127.0.0.1', port: 4198, strictPort: true, watch: null } }); await server.listen();
let browser, page, phase = 'startup'; const errors = [], external = [], requests = [], checks = [];
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1440, height: 1000 } });
  await context.route('**/*', route => { const url = route.request().url(); requests.push(url); if (new URL(url).origin !== origin) { external.push(url); return route.abort(); } return route.continue(); });
  page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin); await page.getByRole('heading', { name: 'Local library', exact: true }).waitFor();
  assert.equal(requests.some(url => /\/src\/pages\/(Studio|Analyze)\//.test(url)), false, 'heavy pages are not fetched at startup');
  const settings = async () => { await page.getByRole('button', { name: 'Settings', exact: true }).first().click(); await page.getByLabel('Liquid glass', { exact: true }).waitFor(); };
  await settings(); assert.equal(await page.getByLabel('Liquid glass', { exact: true }).isChecked(), false);
  await page.waitForTimeout(500); const before = await page.locator('.Main-section').boundingBox(); await page.getByLabel('Liquid glass', { exact: true }).check();
  await page.waitForFunction(() => document.documentElement.dataset.glass === 'true');
  const after = await page.locator('.Main-section').boundingBox(); assert.ok(Object.keys(before).every(k => Math.abs(before[k] - after[k]) < 1), 'glass does not change panel layout');
  assert.match(await page.locator('.Main-section').evaluate(n => getComputedStyle(n).backdropFilter), /blur/);
  for (const theme of ['dark', 'light']) {
    await selectMenu(page, 'App theme', theme); await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme); await page.waitForTimeout(350);
    await page.screenshot({ path: resolve(root, `glass-${theme}.png`) });
    await page.locator('.ant-drawer-close').click(); await page.waitForTimeout(250); await page.screenshot({ path: resolve(root, `glass-overview-${theme}.png`) }); await settings();
  }
  await page.locator('.ant-drawer-close').click(); await page.reload(); await settings();
  assert.equal(await page.getByLabel('Liquid glass', { exact: true }).isChecked(), true);
  await selectMenu(page, 'App theme', 'dark'); await page.locator('.ant-drawer-close').click();
  checks.push('Studio/Analyze are lazy; glass defaults off, survives reload, day/night panels have identical geometry');
  phase = 'fixture and vocal labels';
  const audioPath = resolve(root, 'Settings test.wav'); await writeFile(audioPath, taggedWav({ TIT2: 'Settings test', TPE1: 'Local fixture' }, [], undefined, 90));
  await page.goto(origin + '/studio'); await page.getByLabel('Choose studio audio', { exact: true }).setInputFiles(audioPath);
  await page.waitForFunction(() => document.querySelector('audio')?.duration === 90);
  const fixture = await page.evaluate(async () => {
    const m = await import('/src/studio/project.ts'), ex = await import('/src/studio/projectExport.ts'), repo = await import('/src/lyrics/repository.ts'), runtime = await import('/src/player/runtime.ts'), { store } = await import('/src/store/store.ts');
    const id = store.getState().library.tracks[0].id, p = m.newProject(id, 'Settings test.wav');
    p.performers = [{ id: 'v1', name: 'Lead singer', type: 'person', color: '#2f80ed', align: 'left' }, { id: 'v2', name: 'Harmony singer', type: 'person', color: '#1ed760', align: 'right' }];
    p.lines = Array.from({ length: 100 }, (_, i) => { const l = m.vocalLine(`Keep this lyric ${i}`); l.startMs = i * 800; l.endMs = i * 800 + 700; l.performerId = 'v1'; l.units.filter(w => w.kind === 'word').forEach((w, j) => { w.startMs = l.startMs + j * 130; w.endMs = w.startMs + 120; }); return l; });
    const bg = m.vocalLine('Background melody', 'background', p.lines[0].id); bg.startMs = 0; bg.endMs = 700; bg.performerId = 'v2'; bg.units.filter(w => w.kind === 'word').forEach((w, i) => { w.startMs = i * 250; w.endMs = i * 250 + 200; }); p.lines.splice(1, 0, bg);
    p.selectedId = p.lines[0].id; p.settings.mode = 'word'; const source = ex.exportProjectTtml(p, 90000, 'word');
    await repo.saveLyrics(await repo.readLyricFile(new File([source], 'Settings test.ttml', { type: 'application/xml' }), id));
    runtime.getLocalPlayer().cue(id); return { project: p, source, id };
  });
  const projectPath = resolve(root, 'Settings.lyric-studio.json'); await writeFile(projectPath, JSON.stringify(fixture.project));
  await page.getByLabel('Choose studio project', { exact: true }).setInputFiles(projectPath); await page.getByRole('button', { name: 'Use imported project', exact: true }).click();
  await page.getByRole('dialog', { name: 'Import into Lyric Studio', exact: true }).waitFor({ state: 'hidden' });
  assert.ok(await page.locator('.studio-preview-line small').count() > 0);
  await page.getByText('Metadata & preview', { exact: true }).click(); await page.getByLabel('Show vocal labels', { exact: true }).uncheck();
  assert.equal(await page.locator('.studio-preview-line small').count(), 0);
  await page.getByText('Metadata & preview', { exact: true }).click();
  phase = 'preview mutation cost';
  const mutations = await page.evaluate(async () => {
    const root = document.querySelector('.studio-live-preview'), a = document.querySelector('audio'); let inactiveWordChanges = 0;
    a.currentTime = .05; await new Promise(resolve => setTimeout(resolve, 100));
    const observer = new MutationObserver(items => { for (const i of items) if (i.target.hasAttribute('data-preview-word') && !i.target.closest('.studio-preview-line').hasAttribute('data-active')) inactiveWordChanges++; });
    observer.observe(root, { subtree: true, attributes: true });
    await a.play(); await new Promise(resolve => setTimeout(resolve, 300)); a.pause(); observer.disconnect(); return inactiveWordChanges;
  });
  assert.equal(mutations, 0, 'inactive 100-line preview is not rewritten every frame');
  await page.getByRole('link', { name: 'Back to player', exact: true }).click();
  await page.getByRole('button', { name: 'Lyrics', exact: true }).click(); await page.locator('.lyrics-lines').waitFor();
  assert.equal(await page.locator('.lyric-performer').count(), 0); assert.ok(await page.locator('.lyric-background').count() > 0);
  await settings(); await page.getByLabel('Show vocal labels', { exact: true }).check(); await page.locator('.ant-drawer-close').click();
  assert.ok(await page.locator('.lyric-performer').count() > 0);
  const savedSource = await page.evaluate(async id => (await (await import('/src/lyrics/repository.ts')).readLyrics(id)).source, fixture.id); assert.equal(savedSource, fixture.source);
  checks.push('Global label option covers TTML Studio/player without dropping voices or changing saved TTML; inactive words have zero frame-by-frame mutations');
  phase = 'actual listening and low write rate';
  const measure = await page.evaluate(async () => {
    const a = document.querySelector('audio'), key = 'local-music-listening-time'; let writes = 0;
    const original = Storage.prototype.setItem; Storage.prototype.setItem = function(k, v) { if (k === key) writes++; return original.call(this, k, v); };
    const total = () => JSON.parse(localStorage.getItem(key) || '{"totalMs":0}').totalMs;
    a.pause(); const before = total(); a.currentTime = 10; await new Promise(r => setTimeout(r, 100)); a.playbackRate = 1.5;
    await a.play(); await new Promise(r => setTimeout(r, 3200)); const during = writes; a.pause(); await new Promise(r => setTimeout(r, 100)); const played = total() - before;
    a.currentTime = 60; await new Promise(r => setTimeout(r, 1000)); const afterSeek = total();
    Storage.prototype.setItem = original; return { played, during, writes, stable: afterSeek === before + played, total: afterSeek };
  });
  assert.ok(measure.played > 2700 && measure.played < 3700, JSON.stringify(measure)); assert.equal(measure.during, 0); assert.equal(measure.writes, 1); assert.equal(measure.stable, true);
  await page.reload(); await settings(); const restored = await page.evaluate(() => JSON.parse(localStorage.getItem('local-music-listening-time')).totalMs); assert.equal(restored, measure.total);
  assert.notEqual(await page.getByLabel('Total listening time', { exact: true }).textContent(), '0h 0m 0s');
  // Force a storage error, preserving the last committed aggregate.
  const errorTotal = await page.evaluate(async () => { const a = document.querySelector('audio'), original = Storage.prototype.setItem; window.restoreTestStorage = () => Storage.prototype.setItem = original;
    Storage.prototype.setItem = function(k, v) { if(k === 'local-music-listening-time') throw new DOMException('full', 'QuotaExceededError'); return original.call(this,k,v); };
    a.currentTime = 5; await new Promise(r=>setTimeout(r,100)); await a.play(); await new Promise(r=>setTimeout(r,1100)); a.pause(); return JSON.parse(localStorage.getItem('local-music-listening-time')).totalMs; });
  assert.equal(errorTotal, measure.total); await page.getByRole('alert').filter({ hasText: 'Listening time is counted' }).waitFor();
  await page.evaluate(() => window.restoreTestStorage()); await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Listening time is counted' }).waitFor({ state: 'hidden' });
  await page.getByLabel('Liquid glass', { exact: true }).uncheck(); assert.equal(await page.locator('.Main-section').evaluate(n => getComputedStyle(n).backdropFilter), 'none');
  checks.push('1.5x actual playback counts elapsed seconds, no per-second writes, pause/seek do not inflate totals; reload and failed-save retry preserve aggregates');
  await page.locator('.ant-drawer-close').click(); await page.setViewportSize({ width: 900, height: 1000 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); assert.equal(await page.locator('audio').count(), 1);
  await page.evaluate(async () => { await document.fonts.load('700 20px "Spotify Mix"'); await document.fonts.load('700 20px "DM Sans"'); });
  assert.equal(await page.evaluate(() => document.fonts.check('700 20px "Spotify Mix"') && document.fonts.check('700 20px "DM Sans"')), true);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  await writeFile(resolve(root, 'report.json'), JSON.stringify({ result: 'passed', checks, measure, mutations, errors, external }, null, 2)); console.log(JSON.stringify({ result: 'passed', checks, measure }, null, 2));
} catch (error) { await page?.screenshot({ path: resolve(root, 'failure.png') }).catch(() => {}); console.error({ phase, errors, external }); throw error; }
finally { await browser?.close(); await server.close(); }
