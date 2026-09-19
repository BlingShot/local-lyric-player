import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const origin = 'http://127.0.0.1:4191', output = 'test-results/lyric-polish';
await mkdir(output, { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 4191, strictPort: true }, plugins: [{
  name: 'lyric-polish-fixture', configureServer(server) { server.middlewares.use('/__polish', async (_request, response) => {
    response.setHeader('Content-Type', 'text/html'); response.end(await server.transformIndexHtml('/__polish', '<!doctype html><html><body><div id="root"></div></body></html>'));
  }); },
}] });
const checks = [], errors = [];
let browser;
const call = (page, name, args = []) => page.evaluate(async ({ name, args }) => (await import('/tests/lyric-polish-browser.tsx'))[name](...args), { name, args });
try {
  await server.listen(); browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1500, height: 1000 } });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); await page.goto(origin + '/__polish');
  await call(page, 'seed'); await call(page, 'mountApp');
  await page.waitForFunction(() => document.querySelector('.lyrics-scroll')?.dataset.followReady === 'true'); await page.waitForTimeout(700);
  const anchor = () => page.evaluate(() => { const viewport = document.querySelector('.lyrics-page .lyrics-scroll'), row = viewport.querySelector('[data-line-id="line-20"]'); return { scroll: viewport.scrollTop, top: row.getBoundingClientRect().top - viewport.getBoundingClientRect().top, height: viewport.clientHeight }; });
  const before = await anchor(); assert.ok(before.scroll > 500);
  // Sample every animation frame: toggles may not pass through the beginning of the song.
  await page.evaluate(() => { window.__samples = []; window.__sampling = true; const sample = () => { window.__samples.push(document.querySelector('.lyrics-page .lyrics-scroll').scrollTop); if (window.__sampling) requestAnimationFrame(sample); }; sample(); });
  await page.getByRole('button', { name: 'Lyric display', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Show performer labels', exact: true }).uncheck(); await page.waitForTimeout(200);
  let after = await anchor(); assert.ok(Math.abs(after.top - before.top) < 12, `label toggle moved the anchor: ${JSON.stringify({ before, after })}`);
  await page.getByRole('checkbox', { name: 'Show translations', exact: true }).uncheck(); await page.waitForTimeout(150);
  assert.equal(await page.locator('.lyrics-page .lyric-translation').count(), 0); assert.ok(await page.locator('.lyrics-page .lyric-romanization').count() > 0);
  after = await anchor(); assert.ok(Math.abs(after.top - before.top) < 12, 'translation toggle moved the anchor');
  await page.getByRole('checkbox', { name: 'Show translations', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Show performer labels', exact: true }).check(); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  const samples = await page.evaluate(() => { window.__sampling = false; return window.__samples; }); assert.ok(Math.min(...samples) > 300, 'toggle scrolled through the first line');
  checks.push('Performer/translation toggles keep the current line anchored; romanization stays visible; no scroll-to-zero frame.');
  const activeTranslation = page.locator('.lyrics-page [data-line-id="line-20"] .lyric-translation'); await activeTranslation.hover();
  assert.ok((await activeTranslation.evaluate(element => getComputedStyle(element).textDecorationLine)).includes('underline'));
  await page.screenshot({ path: `${output}/main-lyrics.png` });
  // Current line with its immediate neighbours, not the first three lines.
  await page.getByRole('button', { name: 'Export image', exact: true }).click();
  const selected = await page.locator('.lyric-image-lines label:has(input:checked)').allTextContents();
  assert.equal(selected.length, 3); assert.ok(selected[0].includes('Line 19') && selected[1].includes('Line 20') && selected[2].includes('Line 21'));
  await page.getByRole('combobox', { name: 'Image theme' }).click(); assert.equal(await page.getByRole('option').count(), 7);
  await page.getByRole('option', { name: 'Dusk', exact: true }).click();
  await page.locator('input[aria-label="Import image theme"]').setInputFiles({ name: 'custom.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: 1, name: 'Custom test', background: ['#121212', '#343434'], text: '#ffffff', secondary: '#cccccc', border: '#888888' })) });
  await page.waitForFunction(() => document.querySelector('[aria-label="Image theme"]')?.textContent.includes('Custom test'));
  await page.locator('.lyric-image-preview img').waitFor(); assert.equal(await page.locator('.lyric-image-modal canvas').evaluate(c => c.toDataURL('image/png')), await page.locator('.lyric-image-preview img').getAttribute('src'));
  await page.screenshot({ path: `${output}/image-export.png` }); await page.locator('.lyric-image-modal .ant-modal-close').click();
  checks.push('Image export selects previous/current/next; seven presets and custom JSON import work; preview equals exported PNG.');
  // Interlude exits in media time and is gone before vocal activation.
  for (const t of [90, 93.4, 93.65, 93.9, 94, 95, 190, 205, 90]) {
    await call(page, 'setClock', [t]); await page.waitForTimeout(70);
    const gap = await page.locator('[data-interlude-id="interlude:line-20"]').evaluate(e => ({ height: e.getBoundingClientRect().height, phase: e.dataset.phase, opacity: Number(getComputedStyle(e.querySelector('button')).opacity) }));
    if (t >= 94) assert.equal(gap.height, 0);
    if (t === 90) assert.equal(gap.phase, 'visible');
    if (t === 93.9) assert.ok(gap.opacity < .1);
    assert.equal(await page.locator('[data-kind="outro"]').count(), 0);
  }
  await call(page, 'setClock', [93.7]); const paused = await page.locator('[data-interlude-id="interlude:line-20"]').getAttribute('style'); await page.waitForTimeout(180); assert.equal(await page.locator('[data-interlude-id="interlude:line-20"]').getAttribute('style'), paused);
  await call(page, 'setClock', [96]); await page.waitForTimeout(650);
  checks.push('Interlude fades and reclaims height before vocals; pause and backward seek are deterministic; no outro interlude.');
  await call(page, 'fullscreen', [true]); await page.waitForTimeout(500);
  await page.locator('.offline-details-button').click(); await page.locator('.ant-drawer-open .offline-file-details').waitFor({ state: 'visible' });
  const mask = await page.locator('.lyrics-page .lyrics-scroll').evaluate(e => ({ mask: getComputedStyle(e).maskImage, before: getComputedStyle(e.closest('.lyrics-reader'), '::before').content, after: getComputedStyle(e.closest('.lyrics-reader'), '::after').content }));
  assert.ok(mask.mask.includes('linear-gradient')); assert.equal(mask.before, 'none'); assert.equal(mask.after, 'none');
  await page.waitForTimeout(350);
  const drawer = await page.locator('.ant-drawer-open .offline-file-details').boundingBox(); assert.ok(drawer && drawer.x >= 0 && drawer.x + drawer.width <= 1501, 'Fullscreen drawer is outside the viewport');
  await page.screenshot({ path: `${output}/fullscreen-sidebar.png` });
  await page.keyboard.press('Escape'); await page.waitForTimeout(250);
  assert.equal(await page.locator('.offline-app[data-lyrics-fullscreen]').count(), 1, 'closing sidebar exited fullscreen');
  checks.push('Fullscreen exposes the existing sidebar button and drawer; Escape closes drawer first; lyric edges use a continuous mask.');
  await call(page, 'fullscreen', [false]); await call(page, 'settings', [true]);
  await page.getByRole('combobox', { name: 'App theme' }).click(); await page.getByRole('option', { name: 'Day mode', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  await page.getByRole('combobox', { name: 'Interface language' }).click(); await page.getByRole('option', { name: '简体中文', exact: true }).click();
  await page.waitForTimeout(250);
  await page.locator('.settings-navigation button').nth(2).click();
  await page.waitForTimeout(250);
  const surface = await page.locator('.settings-window .ant-modal-content').evaluate(e => getComputedStyle(e).backgroundColor);
  assert.equal(surface, 'rgb(255, 255, 255)', 'Day-mode modal retained its legacy dark background');
  const totals = await page.locator('.listening-totals').innerText(); assert.ok(totals.includes('秒') && !totals.includes('种'));
  await page.locator('.listening-totals').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${output}/settings-day-chinese.png` });
  await page.setViewportSize({ width: 800, height: 800 });
  await page.waitForTimeout(200);
  assert.equal(await page.locator('.settings-pages').evaluate(e => e.scrollWidth > e.clientWidth + 1), false, 'Settings overflow horizontally at narrow desktop width');
  await page.screenshot({ path: `${output}/settings-narrow.png` });
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.locator('.settings-navigation button').nth(1).click(); assert.equal(await page.getByRole('checkbox', { name: '显示翻译', exact: true }).count(), 1);
  await call(page, 'settings', [false]);
  checks.push('Day mode is selectable; Settings exposes translation visibility; Chinese listening-time unit is 秒.');
  // Real compact components, not duplicated mock markup.
  await call(page, 'mountMini'); await page.locator('.mini-lyrics .lyric-translation').first().waitFor();
  const miniSize = await page.locator('.mini-lyrics .lyric-translation').first().evaluate(e => parseFloat(getComputedStyle(e).fontSize)); assert.equal(miniSize, 13);
  await call(page, 'mountPreview'); await page.locator('.studio-preview-annotation[data-kind="translation"]').first().waitFor();
  const previewSize = await page.locator('.studio-preview-annotation[data-kind="translation"]').first().evaluate(e => parseFloat(getComputedStyle(e).fontSize)); assert.equal(previewSize, 14);
  await page.screenshot({ path: `${output}/studio-preview.png` });
  checks.push({ translationSizes: { sidebar: miniSize, studio: previewSize, main: 20 } });
  await call(page, 'seedOldDraft'); await call(page, 'mountApp', ['/studio?trackId=polish']);
  await page.waitForFunction(() => document.querySelector('.studio-page')?.dataset.studioFormat === 'ttml');
  await page.waitForFunction(() => document.querySelector('.studio-line-text')?.value.startsWith('Line 0'));
  const source = await call(page, 'studioState'); assert.equal(source.current.playerSource.format, 'ttml'); assert.ok(source.backups.some(b => b.project.lines[0].text === 'OLD DRAFT MUST SURVIVE'));
  await page.locator('.studio-line-text').first().fill('EDITED DRAFT MUST SURVIVE'); await page.waitForTimeout(300);
  await call(page, 'mountApp', ['/lyrics']); await call(page, 'mountApp', ['/studio?trackId=polish']);
  await page.waitForFunction(() => document.querySelector('.studio-line-text')?.value === 'EDITED DRAFT MUST SURVIVE');
  assert.equal((await call(page, 'studioState')).current.lines[0].text, 'EDITED DRAFT MUST SURVIVE');
  checks.push('Studio opens the current AMLL TTML over a stale embedded-LRC draft, persists the old draft as backup, and preserves edits on reopening.');
  checks.push({ translation: await call(page, 'translationScenario') });
  for (const kind of ['api', 'repository', 'concurrent', 'ambiguous', 'mismatch', 'existing', 'offline']) checks.push({ amll: await call(page, 'amllScenario', [kind]) });
  checks.push({ diagnostics: await call(page, 'diagnosticsScenario') });
  const pulse = await context.newPage(); pulse.on('pageerror', error => errors.push(error.message)); await pulse.goto(origin + '/__polish');
  await call(pulse, 'mountApp', ['/lyrics']);
  assert.equal(await pulse.locator('.lyric-music-pulse').count(), 0, 'fullscreen music-reactive layer was removed');
  checks.push('Music-reactive fullscreen background is gone from the lyric surface.');
  assert.deepEqual(errors, [], 'Unexpected browser errors');
  await writeFile(`${output}/checks.json`, JSON.stringify({ success: true, checks }, null, 2)); console.log(JSON.stringify({ success: true, checks }, null, 2));
} catch (error) { await writeFile(`${output}/failure.txt`, error.stack || String(error)); throw error; }
finally { await browser?.close(); await server.close(); }
