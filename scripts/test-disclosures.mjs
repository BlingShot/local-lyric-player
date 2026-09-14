import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { taggedWav } from './library-fixtures.mjs';

const root = resolve('test-results/disclosures');
await mkdir(root, { recursive: true });
const origin = 'http://127.0.0.1:4207';
const server = await createServer({ server: { host: '127.0.0.1', port: 4207, strictPort: true,
  watch: { ignored: ['**/release/**', '**/.cache/**', '**/test-results/**'] } } });
await server.listen();
let browser, page, phase = 'setup';
const checks = [], errors = [], external = [];
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1700, height: 1100 } });
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin !== origin) { external.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  const file = resolve(root, 'Disclosure.wav');
  await writeFile(file, taggedWav({ TIT2: 'Disclosure song', TPE1: 'Test artist', TALB: 'Test album' }, [], undefined, 40));
  await page.goto(origin + '/studio');
  await page.getByLabel('Choose studio audio', { exact: true }).setInputFiles(file);
  await page.waitForFunction(() => document.querySelector('audio')?.duration === 40);
  const fixture = await page.evaluate(async () => {
    const m = await import('/src/studio/project.ts'), { store } = await import('/src/store/store.ts');
    const p = m.newProject(store.getState().player.currentId, 'Disclosure.wav');
    p.lines = ['First gentle line', 'Next gentle line'].map((text, i) => {
      const l = m.vocalLine(text); l.id = `lead-${i}`; l.startMs = 1000 + i * 5000; l.endMs = l.startMs + 4000;
      l.units.filter(w => w.kind === 'word').forEach((w, j) => { w.startMs = l.startMs + j * 1000; w.endMs = w.startMs + 800; });
      return l;
    });
    const bg = m.vocalLine('An echo', 'background', 'lead-0'); bg.id = 'backing'; bg.startMs = 2000; bg.endMs = 4000;
    p.lines.splice(1, 0, bg); p.selectedId = 'lead-0'; p.settings.mode = 'word'; return p;
  });
  await page.getByLabel('Choose studio project', { exact: true }).setInputFiles({ name: 'test.lyric-studio.json',
    mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
  await page.getByRole('button', { name: 'Use imported project', exact: true }).click();
  await page.getByRole('dialog', { name: 'Import into Lyric Studio', exact: true }).waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'TTML Studio', exact: true }).click();
  const saved = async () => {
    await page.locator('.studio-save-status').filter({ hasText: 'Draft saved' }).waitFor();
    return page.evaluate(async () => {
      const { readStudioDraft } = await import('/src/studio/repository.ts'), { store } = await import('/src/store/store.ts');
      return readStudioDraft(store.getState().player.currentId);
    });
  };
  const sampleToggle = async selector => page.locator(selector).evaluate(async node => {
    const height = () => node.getBoundingClientRect().height, samples = [height()];
    node.querySelector(':scope > summary').click();
    const start = performance.now();
    await new Promise(done => {
      function step() { samples.push(height()); if (performance.now() - start < 430) requestAnimationFrame(step); else done(); }
      requestAnimationFrame(step);
    });
    return { samples, open: node.open, content: getComputedStyle(node, '::details-content').contentVisibility };
  });
  const animated = (values, opening) => {
    assert.ok(new Set(values.map(n => Math.round(n))).size >= 4, `Missing intermediate frames: ${values}`);
    assert.ok(opening ? values.at(-1) > values[0] + 20 : values.at(-1) < values[0] - 20);
    for (let i = 1; i < values.length; i++) assert.ok(opening ? values[i] >= values[i - 1] - 1 : values[i] <= values[i - 1] + 1, 'Animation reversed unexpectedly');
  };
  phase = 'word panel open and close';
  const before = await saved();
  let result = await sampleToggle('.studio-word-panel'); animated(result.samples, false); assert.equal(result.open, false);
  assert.equal(result.content, 'hidden');
  assert.ok(await page.locator('.studio-word-panel').evaluate(n => n.getBoundingClientRect().height < 90));
  result = await sampleToggle('.studio-word-panel'); animated(result.samples, true); assert.equal(result.open, true);
  assert.deepEqual((await saved()).lines, before.lines);
  checks.push('Word panel opens and closes through monotonic intermediate heights, keeps all text/word times');
  phase = 'keyboard, rapid reversal, selection and mode changes';
  await page.locator('.studio-word-panel > summary').focus(); await page.keyboard.press('Enter');
  await page.waitForTimeout(340); assert.equal(await page.locator('.studio-word-panel').evaluate(n => n.open), false);
  await page.getByLabel('Lyrics line 3', { exact: true }).focus();
  assert.equal(await page.locator('.studio-word-panel').evaluate(n => n.open), false);
  await page.getByRole('button', { name: 'LRC', exact: true }).click();
  await page.getByRole('button', { name: 'TTML Studio', exact: true }).click();
  assert.equal(await page.locator('.studio-word-panel').evaluate(n => n.open), false);
  await page.locator('.studio-word-panel > summary').focus(); await page.keyboard.press('Space'); await page.waitForTimeout(340);
  assert.equal(await page.locator('.studio-word-panel').evaluate(n => n.open), true);
  await page.locator('.studio-word-panel > summary').evaluate(async n => {
    n.click(); await new Promise(r => setTimeout(r, 65)); n.click(); await new Promise(r => setTimeout(r, 65)); n.click();
  });
  await page.waitForTimeout(340); assert.equal(await page.locator('.studio-word-panel').evaluate(n => n.open), false);
  checks.push('Enter/Space, mid-animation reversal and collapsed preference across lines/LRC/TTML');
  phase = 'background and inspector disclosures';
  result = await sampleToggle('.studio-backgrounds'); animated(result.samples, true);
  result = await sampleToggle('.studio-backgrounds'); animated(result.samples, false);
  result = await sampleToggle('.studio-inspector details:first-child'); animated(result.samples, true);
  result = await sampleToggle('.studio-inspector details:first-child'); animated(result.samples, false);
  checks.push('Background vocal and Performer sections animate in both directions');
  phase = 'reduced motion and small viewport';
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('.studio-backgrounds').evaluate(n => getComputedStyle(n, '::details-content').transitionDuration), '0s');
  await page.setViewportSize({ width: 850, height: 900 }); await page.waitForTimeout(400);
  assert.ok(await page.locator('.studio-word-panel').evaluate(n => n.clientWidth >= n.scrollWidth - 1));
  await page.screenshot({ path: resolve(root, 'studio-collapsed.png') });
  assert.equal(await page.getByText(/Hold T for the word’s start/).count(), 0);
  checks.push('Reduced motion disables animation, narrow collapsed panel fits, redundant paragraph removed');
  phase = 'selected library name and artist';
  await page.setViewportSize({ width: 1700, height: 1100 });
  await page.getByRole('link', { name: 'Back to player', exact: true }).click();
  await page.locator('.offline-track-name').first().click();
  const checkGreen = async () => {
    const colors = await page.locator('tr[aria-selected=true] .offline-track-name').evaluate(n => [...n.querySelectorAll('strong, small')].map(e => getComputedStyle(e).color));
    assert.deepEqual(colors, ['rgb(30, 215, 96)', 'rgb(30, 215, 96)']);
  };
  for (const theme of ['dark', 'light']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme); await checkGreen();
    await page.getByRole('button', { name: 'Group by album', exact: true }).click(); await checkGreen();
    await page.screenshot({ path: resolve(root, `library-${theme}.png`) });
    await page.getByRole('button', { name: 'Group by album', exact: true }).click();
  }
  assert.equal(await page.locator('audio').evaluate(n => n.paused), true);
  checks.push('Selected title and artist green in dark/light, plain/grouped library; single click does not start playback');
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  await writeFile(resolve(root, 'report.json'), JSON.stringify({ result: 'passed', checks }, null, 2));
  console.log(JSON.stringify({ result: 'passed', checks }));
} catch (error) {
  console.error('PHASE', phase, error); await page?.screenshot({ path: resolve(root, 'failure.png') }).catch(() => {}); process.exitCode = 1;
} finally { await browser?.close(); await server.close(); }
