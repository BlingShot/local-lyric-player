import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const project = process.env.STUDIO_PROJECT || resolve(dirname(fileURLToPath(import.meta.url)), '..');
const overlay = process.env.STUDIO_OVERLAY;
const output = process.env.STUDIO_OUTPUT || resolve(project, 'test-results/studio-six-fixes');
await mkdir(output, { recursive: true });
const require = createRequire(resolve(project, 'package.json'));
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href);
const { default: react } = await import(pathToFileURL(require.resolve('@vitejs/plugin-react')).href);
const { chromium } = require('playwright');
const { taggedWav } = await import(pathToFileURL(resolve(project, 'scripts/library-fixtures.mjs')).href);
const { selectMenu } = await import(pathToFileURL(resolve(project, 'scripts/select-menu.mjs')).href);
const overrides = new Map();
if (overlay) {
  for (const entry of JSON.parse(await readFile(resolve(overlay, 'manifest.json'), 'utf8'))) {
    overrides.set(resolve(project, entry.path).replaceAll('\\', '/'), await readFile(resolve(overlay, 'staged', entry.path), 'utf8'));
  }
}
const server = await createServer({ root: project, configFile: false, optimizeDeps: { include: ['music-metadata'] },
  cacheDir: overlay ? resolve(overlay, 'vite-cache') : resolve(project, 'node_modules/.vite-studio-six-fixes'),
  plugins: [{ name: 'studio-regression-overlay', enforce: 'pre',
    resolveId(source, importer) {
      if (!source.startsWith('.') && !source.startsWith('/')) return;
      const candidate = source.startsWith('/src/') ? resolve(project, source.slice(1)) : resolve(importer ? dirname(importer.split('?')[0]) : project, source);
      for (const suffix of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
        const path = (candidate + suffix).replaceAll('\\', '/'); if (overrides.has(path)) return path;
      }
    },
    load(id) { return overrides.get(id.split('?')[0]); },
  }, react()], server: { host: '127.0.0.1', port: 0, strictPort: false },
});
let browser, page, phase = 'startup'; const errors = [], checks = [];
try {
  await server.listen(); const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  page = await browser.newPage({ viewport: { width: 1500, height: 1100 }, locale: 'en-US' });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/studio'); await page.getByLabel('Lyrics line 1', { exact: true }).waitFor();
  await page.getByLabel('Choose studio audio', { exact: true }).setInputFiles({ name: 'Studio fixes.wav', mimeType: 'audio/wav', buffer: taggedWav({ TIT2: 'Studio fixes' }, [], undefined, 40) });
  await page.waitForFunction(() => document.querySelector('audio')?.duration === 40);
  const seed = await page.evaluate(async () => {
    const { newProject, vocalLine } = await import('/src/studio/project.ts');
    const { store } = await import('/src/store/store.ts');
    const project = newProject(store.getState().player.currentId, 'Studio fixes.wav');
    project.metadataInitialized = true;
    project.performers = ['Alice', 'Bob', 'Carol'].map((name, i) => ({ id: `v${i + 1}`, name, type: 'person', color: '#1ed760', align: 'auto' }));
    const line = (id, text, performerId, role = 'lead', parentId) => ({ ...vocalLine(text, role, parentId), id, performerId });
    project.lines = [line('a1', 'Alpha Beta', 'v1'), line('b1', 'One Two', 'v2'), line('bg1', 'Harmony', 'v3', 'background', 'a1'), line('a2', 'Delta Echo', 'v1'), line('b2', 'Three Four', 'v2'), line('bg2', 'Again', 'v3', 'background', 'a2'), ...Array.from({ length: 20 }, (_, i) => line(`tail${i}`, `Later lyric line ${i + 1}`, 'v1'))];
    project.lines.slice(0, 3).forEach(line => { line.startMs = 0; line.endMs = 12_000; });
    project.selectedId = 'a1'; project.selectedUnitId = project.lines[0].units[0].id;
    project.settings = { ...project.settings, mode: 'word', preview: true, wordArrowKeys: true, preRollMs: 0 };
    project.boundaries = { startMs: null, endMs: 30_000 };
    project.sections = [{ id: 'verse', tag: 'VERSE', lineIds: ['a1', 'b1'], startMs: null, endMs: null }];
    return project;
  });
  await page.getByLabel('Choose studio project', { exact: true }).setInputFiles({ name: 'voices.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(seed)) });
  await page.getByRole('button', { name: 'Use imported project', exact: true }).click();
  await page.getByRole('dialog', { name: 'Import into Lyric Studio', exact: true }).waitFor({ state: 'hidden' });
  await page.locator('[data-voice-key="3"]').waitFor();
  await page.evaluate(() => {
    const audio = document.querySelector('audio'); let time = 1;
    Object.defineProperty(audio, 'currentTime', { configurable: true, get: () => time, set: value => { time = value; } });
    Object.defineProperty(audio, 'paused', { configurable: true, get: () => false });
    Object.defineProperty(audio, 'ended', { configurable: true, get: () => false });
    window.__studioClock = value => { time = value; audio.dispatchEvent(new Event('timeupdate')); };
    document.activeElement?.blur(); window.__studioClock(1);
  });
  const at = time => page.evaluate(time => window.__studioClock(time), time);
  const saved = () => page.evaluate(async () => {
    const { readStudioDraft } = await import('/src/studio/repository.ts');
    const { store } = await import('/src/store/store.ts');
    return readStudioDraft(store.getState().player.currentId);
  });
  phase = 'parallel word recording';
  await page.keyboard.down('Digit1'); await at(1.1); await page.keyboard.down('Digit2'); await at(1.2); await page.keyboard.down('Digit3');
  await page.waitForFunction(() => document.querySelectorAll('.studio-voice-recorders button[aria-pressed=true]').length === 3 && document.querySelectorAll('[data-preview-word][data-recording]').length === 3);
  await at(1.3); await page.keyboard.up('Digit1');
  assert.equal(await page.locator('.studio-voice-recorders button[aria-pressed=true]').count(), 2);
  await at(1.7); await page.keyboard.up('Digit2'); await at(1.9); await page.keyboard.up('Digit3');
  await at(2); await page.keyboard.down('Digit1'); await page.keyboard.down('Digit2');
  await at(2.2); await page.keyboard.up('Digit1'); await at(2.4); await page.keyboard.up('Digit2');
  await page.waitForFunction(() => document.querySelector('.studio-sync-context strong')?.textContent === 'Delta');
  let draft = await saved();
  const wordTimes = id => draft.lines.find(line => line.id === id).units.filter(word => word.kind === 'word').map(word => [word.startMs, word.endMs]);
  assert.deepEqual(wordTimes('a1'), [[1000, 1300], [2000, 2200]]);
  assert.deepEqual(wordTimes('b1'), [[1100, 1700], [2000, 2400]]);
  assert.deepEqual(wordTimes('bg1'), [[1200, 1900]]);
  assert.equal(draft.selectedId, 'a2');
  await at(3); await page.keyboard.down('Digit1'); await page.keyboard.down('Digit2');
  await page.evaluate(() => document.querySelector('audio').dispatchEvent(new Event('seeking')));
  await at(3.4); await page.keyboard.up('Digit1'); await page.keyboard.up('Digit2');
  draft = await saved(); assert.deepEqual(wordTimes('a2'), [[null, null], [null, null]]); assert.deepEqual(wordTimes('b2'), [[null, null], [null, null]]);
  checks.push('Three simultaneous lead/backing keys record separate overlapping intervals; release, next-voice cursors and seek cancellation stay independent');

  phase = 'sync scrolling while playing';
  await selectMenu(page, 'Timing mode', 'line');
  await page.locator('[data-line-id="a1"] .studio-line-text').click();
  await page.evaluate(() => document.activeElement?.blur());
  await at(5); await page.keyboard.press('ArrowDown');
  await page.waitForFunction(() => document.querySelector('.studio-sync-row[data-sync-current]')?.getAttribute('data-line-id') === 'b1');
  assert.notEqual(await page.locator('.studio-sync-row[data-sync-current]').evaluate(node => getComputedStyle(node).boxShadow), 'none');
  for (let i = 0; i < 14; i++) { await at(6 + i / 10); await page.keyboard.press('ArrowDown'); }
  await page.waitForFunction(() => {
    const row = document.querySelector('.studio-sync-row[data-sync-current]'), port = document.querySelector('.studio-rows');
    if (!row || !port) return false;
    const r = row.getBoundingClientRect(), p = port.getBoundingClientRect();
    return r.top >= p.top && r.bottom <= p.bottom;
  });
  checks.push('Sync outline and viewport follow repeated destination changes even while the earlier singer remains active');

  phase = 'end marker'; await at(30);
  await page.waitForFunction(() => document.querySelector('.studio-boundary[data-playing]')?.getAttribute('data-line-id') === 'studio:lyric-end');
  assert.notEqual(await page.locator('.studio-boundary[data-playing]').evaluate(node => getComputedStyle(node).boxShadow), 'none');
  await at(29); await page.waitForFunction(() => !document.querySelector('.studio-boundary[data-playing]'));
  checks.push('End of Lyric gets its timed outline, including backward seeking');

  phase = 'inspector animations';
  const initial = await page.locator('.studio-inspector > details > summary').evaluateAll(nodes => nodes.map(node => ({ x: node.getBoundingClientRect().x, width: node.getBoundingClientRect().width })));
  for (const index of [0, 1, 2, 1, 1]) {
    await page.locator('.studio-inspector > details > summary').nth(index).click();
    const samples = await page.evaluate(async () => {
      const values = [], start = performance.now();
      while (performance.now() - start < 340) {
        values.push([...document.querySelectorAll('.studio-inspector > details > summary')].map(node => ({ x: node.getBoundingClientRect().x, width: node.getBoundingClientRect().width })));
        await new Promise(requestAnimationFrame);
      }
      return values;
    });
    assert.ok(samples.every(rows => rows.every((row, i) => Math.abs(row.x - initial[i].x) < 1 && Math.abs(row.width - initial[i].width) < 1)), 'Inspector columns shifted during expansion');
  }
  await page.screenshot({ path: resolve(output, 'studio-inspector-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: resolve(output, 'studio-mobile.png') });
  await page.setViewportSize({ width: 1500, height: 1100 });
  checks.push('Performer, structure and metadata headers retain their columns throughout open/close animations; mobile does not overflow');

  phase = 'studio drop ownership';
  const transfer = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['<tt xmlns="http://www.w3.org/ns/ttml"><body><p begin="1s" end="3s">Imported lyrics</p></body></tt>'], 'drop.ttml', { type: 'application/ttml+xml' }));
    return transfer;
  });
  await page.locator('.offline-file-drop-zone').dispatchEvent('dragenter', { dataTransfer: transfer });
  await page.locator('.offline-drop-overlay').waitFor();
  await page.locator('.studio-page').dispatchEvent('dragenter', { dataTransfer: transfer });
  await page.waitForFunction(() => !document.querySelector('.offline-drop-overlay'));
  await page.locator('.studio-page').dispatchEvent('drop', { dataTransfer: transfer });
  await page.getByRole('dialog', { name: 'Import into Lyric Studio', exact: true }).waitFor();
  assert.equal(await page.locator('.offline-drop-overlay').count(), 0);
  await page.getByRole('button', { name: 'Use imported project', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('textarea[aria-label="Lyrics line 1"]')?.value === 'Imported lyrics');
  checks.push('An outer music drag can enter Studio and import TTML without leaving the music overlay stuck');

  phase = 'fullscreen glass';
  await page.evaluate(async () => {
    const { parseLyrics, LYRICS_PARSER_VERSION } = await import('/src/lyrics/parse.ts');
    const { saveLyrics } = await import('/src/lyrics/repository.ts');
    const { store } = await import('/src/store/store.ts');
    const source = '[00:01.000]First line\n[00:02.000]Second line\n[00:03.000]Last line';
    await saveLyrics({ trackId: store.getState().player.currentId, fileName: 'glass.lrc', source, document: parseLyrics(source, 'glass.lrc'), parserVersion: LYRICS_PARSER_VERSION, savedAt: Date.now(), origin: 'file' });
  });
  await page.goto(origin + '/lyrics'); await page.locator('.lyrics-reader').waitFor();
  await page.evaluate(() => { document.documentElement.dataset.glass = 'true'; document.querySelector('.offline-app').setAttribute('data-lyrics-fullscreen', 'true'); });
  const glass = await page.evaluate(() => {
    const reader = document.querySelector('.lyrics-reader'), scroll = document.querySelector('.lyrics-scroll'), main = document.querySelector('.Main-section');
    return { top: getComputedStyle(reader, '::before').content, bottom: getComputedStyle(reader, '::after').content, mask: getComputedStyle(scroll).maskImage, clip: getComputedStyle(main).clipPath, shadow: getComputedStyle(main).boxShadow };
  });
  assert.equal(glass.top, 'none'); assert.equal(glass.bottom, 'none'); assert.ok(glass.mask.startsWith('linear-gradient')); assert.equal(glass.clip, 'none'); assert.equal(glass.shadow, 'none');
  await page.screenshot({ path: resolve(output, 'fullscreen-glass.png') });
  checks.push('Fullscreen glass uses one continuous backdrop and a text fade, with no rectangular top/bottom blur overlays');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, checks, output }, null, 2));
} catch (error) {
  await page?.screenshot({ path: resolve(output, 'failure.png') }).catch(() => {});
  console.error(JSON.stringify({ phase, errors, error: String(error) })); throw error;
} finally { await browser?.close(); await server.close(); }
