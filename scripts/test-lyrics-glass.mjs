import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { Resvg } from '@resvg/resvg-js';
import { taggedWav } from './library-fixtures.mjs';
import { selectMenu } from './select-menu.mjs';

const root = resolve('test-results/lyrics-glass'); await mkdir(root, { recursive: true });
const origin = 'http://127.0.0.1:4208';
const server = await createServer({ server: { host: '127.0.0.1', port: 4208, strictPort: true,
  watch: { ignored: ['**/release/**', '**/.cache/**', '**/test-results/**'] } } }); await server.listen();
let browser, page, phase = 'setup'; const errors = [], external = [], checks = [];
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1700, height: 1100 } });
  await context.route('**/*', r => { if (new URL(r.request().url()).origin !== origin) { external.push(r.request().url()); return r.abort(); } return r.continue(); });
  page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  const cover = new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640"><rect width="640" height="640" fill="#274470"/><circle cx="80" cy="220" r="210" fill="#70bfd1"/><circle cx="580" cy="470" r="210" fill="#c58c64"/><path d="M150 0L500 640H300L0 0" fill="#97ab8b"/><text x="50" y="330" font-size="65" fill="white">LOCAL MUSIC</text></svg>').render().asPng();
  const file = resolve(root, 'Frosted.wav'); await writeFile(file, taggedWav({ TIT2: 'Frosted song', TPE1: 'Local artist', TALB: 'Frosted album' }, [{ type: 3, data: cover }], undefined, 90));
  await page.goto(origin + '/studio'); await page.getByLabel('Choose studio audio', { exact: true }).setInputFiles(file);
  await page.waitForFunction(() => document.querySelector('audio')?.duration === 90);
  const fixture = await page.evaluate(async () => {
    const m = await import('/src/studio/project.ts'), { store } = await import('/src/store/store.ts');
    const p = m.newProject(store.getState().player.currentId, 'Frosted.wav');
    p.lines = Array.from({ length: 14 }, (_, i) => {
      const l = m.vocalLine(`Line ${i + 1} carries the melody`); l.id = `lead-${i}`; l.startMs = 1000 + i * 5000; l.endMs = l.startMs + 4000;
      l.units.filter(w => w.kind === 'word').forEach((w, n) => { w.startMs = l.startMs + n * 500; w.endMs = w.startMs + 400; }); return l;
    });
    const bg = m.vocalLine('Echo of light', 'background', 'lead-2'); bg.id = 'backing'; bg.startMs = 12500; bg.endMs = 14800;
    bg.units.filter(w => w.kind === 'word').forEach((w, i) => { w.startMs = 12500 + i * 650; w.endMs = w.startMs + 600; });
    bg.annotations = [{ id: 'translation', kind: 'translation', targetId: bg.id, language: 'zh-Hans', text: '光的回声' }];
    p.lines.splice(3, 0, bg); p.selectedId = 'lead-2'; p.settings.mode = 'word'; return p;
  });
  await page.getByLabel('Choose studio project', { exact: true }).setInputFiles({ name: 'glass.lyric-studio.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
  await page.getByRole('button', { name: 'Use imported project', exact: true }).click();
  await page.getByRole('dialog', { name: 'Import into Lyric Studio', exact: true }).waitFor({ state: 'hidden' });
  const seek = async t => { await page.evaluate(t => { const a = document.querySelector('audio'); a.pause(); a.currentTime = t; }, t); await page.waitForTimeout(750); };
  const glass = value => page.evaluate(async value => { await (await import('/src/theme/surface.ts')).setGlassSurface(value); }, value);
  const theme = async value => { await page.evaluate(value => document.documentElement.dataset.theme = value, value); await page.waitForTimeout(220); };
  phase = 'Studio retained backgrounds and current outline';
  const childPreview = page.locator('[data-preview-line="backing"]');
  await seek(12); assert.equal(await childPreview.evaluate(n => n.offsetHeight), 0);
  await seek(13); const height = await childPreview.evaluate(n => n.offsetHeight); assert.ok(height > 30);
  assert.equal(await childPreview.evaluate(n => Number(getComputedStyle(n).opacity)), 1);
  await seek(17); assert.equal(await childPreview.evaluate(n => n.offsetHeight), height);
  assert.equal(await childPreview.evaluate(n => n.hasAttribute('data-past') && !n.firstElementChild.inert), true);
  assert.equal(await childPreview.locator('.studio-preview-annotation').textContent(), '光的回声');
  const pastOpacity = await page.locator('[data-preview-line="lead-2"]').evaluate(n => Number(getComputedStyle(n).opacity));
  assert.ok(pastOpacity < .6);
  assert.equal(await childPreview.evaluate(n => Number(getComputedStyle(n).opacity)), pastOpacity, 'Retained backing vocals must dim like completed lead vocals');
  for (const mode of ['dark', 'light']) {
    await theme(mode); await glass(true); await seek(13); assert.equal(await childPreview.evaluate(n=>Number(getComputedStyle(n).opacity)), 1);
    await seek(17); assert.equal(await childPreview.evaluate(n=>Number(getComputedStyle(n).opacity)), pastOpacity);
    assert.equal(await childPreview.evaluate(n=>n.offsetHeight), height);
    await page.screenshot({path:resolve(root, `studio-past-child-${mode}.png`)});
  }
  await glass(false); await theme('dark');
  await seek(12); assert.equal(await childPreview.evaluate(n => n.offsetHeight), 0);
  const old = page.locator('.studio-row[data-line-id="lead-2"]');
  assert.match(await old.evaluate(n => getComputedStyle(n).boxShadow), /inset/);
  await page.getByLabel('Lyrics line 1', { exact: true }).focus();
  await page.waitForTimeout(300);
  assert.match(await old.evaluate(n => getComputedStyle(n).boxShadow), /inset/);
  assert.equal(await page.locator('.studio-row[data-selected]').evaluate(n => getComputedStyle(n).boxShadow), 'none');
  const backingRow = page.locator('.studio-row[data-line-id="backing"]');
  const framed = async ids => {
    assert.deepEqual(await page.locator('.studio-row[data-playing]').evaluateAll(rows => rows.map(n => n.dataset.lineId).sort()), [...ids].sort());
    for (const id of ['lead-0', 'lead-2', 'lead-3', 'backing']) {
      const shadow = await page.locator(`.studio-row[data-line-id="${id}"]`).evaluate(n => getComputedStyle(n).boxShadow);
      if (ids.includes(id)) assert.match(shadow, /inset/); else assert.equal(shadow, 'none');
    }
  };
  for (const mode of ['dark', 'light']) {
    await theme(mode); await glass(true);
    await seek(12.49); await framed(['lead-2']);
    await seek(12.5); await framed(['lead-2', 'backing']);
    const disclosure = page.locator('.studio-backgrounds');
    if (!await disclosure.evaluate(n => n.open)) await disclosure.locator('summary').click();
    await backingRow.waitFor({state:'visible'}); await framed(['lead-2', 'backing']);
    await seek(14.8); await framed(['lead-2']);
    assert.equal(await childPreview.evaluate(n => Number(getComputedStyle(n).opacity)), pastOpacity);
    assert.equal(await childPreview.evaluate(n => n.offsetHeight), height);
    await seek(15); await framed([]);
    await seek(17); await framed(['lead-3']);
    await seek(13); await framed(['lead-2', 'backing']);
    await disclosure.locator('summary').click(); await backingRow.waitFor({state:'hidden'});
    await seek(15); await disclosure.locator('summary').click(); await backingRow.waitFor({state:'visible'}); await page.waitForTimeout(300); await framed([]);
    await page.screenshot({path:resolve(root, `studio-ended-frames-${mode}.png`)});
  }
  await page.getByRole('button', {name:'LRC', exact:true}).click();
  await seek(13); await framed(['lead-2', 'backing']);
  await seek(15); await framed([]);
  await page.getByRole('button', {name:'TTML Studio', exact:true}).click();
  await glass(false); await theme('dark');
  checks.push('Studio frames follow actual paused/seek media time in LRC and TTML, not editing selection; overlapping lead and child both framed, child end removes only its frame and dims retained text; gaps clear frames, backward seek and collapsed/reopened background groups restore the correct state in both themes');
  phase = 'Back to sync';
  await seek(43); await page.locator('.studio-rows').hover(); await page.mouse.wheel(0, 1200); await page.waitForTimeout(350);
  const button = page.getByRole('button', { name: 'Back to sync', exact: true }); await button.waitFor();
  await button.click(); await button.waitFor({ state: 'hidden' }); await page.waitForTimeout(1200);
  const aligned = await page.locator('.studio-rows').evaluate(n => { const r = n.querySelector('[data-line-id="lead-8"]').getBoundingClientRect(), v = n.getBoundingClientRect(); return r.top >= v.top && r.top < v.bottom - 30; });
  assert.equal(aligned, true); checks.push('Floating Back to sync returns the scrolled editor to the actual media-time line and restores following');
  await glass(true); await page.screenshot({ path: resolve(root, 'studio-frame.png') });
  phase = 'write fixture lyrics for shared players';
  await page.getByRole('button', { name: 'Write to song ▾', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Write word TTML to song copy', exact: true }).click();
  await page.getByRole('button', { name: 'Write lyrics', exact: true }).click();
  await page.getByRole('dialog', { name: 'Audio copy ready', exact: true }).waitFor();
  await page.getByRole('dialog', { name: 'Audio copy ready', exact: true }).getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('link', { name: 'Back to player', exact: true }).click();
  await page.getByRole('button', { name: 'Lyrics', exact: true }).click();
  const checkBackdrop = async (surface, fullscreen = false) => {
    const n = page.locator(surface); await n.locator('.lyric-backdrop img').waitFor();
    const style = await n.evaluate(n => { const back = n.querySelector('.lyric-backdrop'), img = back.querySelector('img'); return {
      filter: getComputedStyle(img).filter, frosted: getComputedStyle(back, '::after').backdropFilter,
      painted: img.complete && img.naturalWidth > 0, position: getComputedStyle(back).position,
      font: getComputedStyle(n.querySelector('.lyric-line-button')).fontSize,
    }; });
    assert.match(style.filter, /blur\(40px\)/); assert.equal(style.painted, true); assert.equal(style.position, 'absolute');
    if (fullscreen) assert.equal(style.frosted, 'none');
    else assert.match(style.frosted, /blur\(18px\)/);
    return style.font;
  };
  const retained = async surface => {
    const row = page.locator(surface + ' .lyric-background');
    await seek(12); assert.equal(await row.evaluate(n => n.offsetHeight), 0);
    await seek(13); const h = await row.evaluate(n => n.offsetHeight); assert.ok(h > 20);
    const activeColor = await row.locator('.lyric-line-button').evaluate(n=>getComputedStyle(n).color);
    await seek(17); assert.equal(await row.evaluate(n => n.offsetHeight), h);
    assert.equal(await row.evaluate(n => n.hasAttribute('data-past') && !n.firstElementChild.inert), true);
    assert.equal(await row.locator('.lyric-translation').textContent(), '光的回声');
    const pastColor = await row.locator('.lyric-line-button').evaluate(n=>getComputedStyle(n).color);
    assert.notEqual(pastColor, activeColor);
    assert.equal(pastColor, await page.locator(surface+' .lyric-row[data-past]:not(.lyric-background) .lyric-line-button').first().evaluate(n=>getComputedStyle(n).color));
    assert.equal(await row.locator('.lyric-word').last().evaluate(n=>getComputedStyle(n).backgroundImage), 'none');
  };
  phase = 'main and fullscreen glass';
  for (const mode of ['dark', 'light']) {
    await theme(mode); const font = await checkBackdrop('.lyrics-page'); await retained('.lyrics-page');
    await page.screenshot({ path: resolve(root, `lyrics-${mode}.png`) });
    await glass(false); assert.equal(await page.locator('.lyric-backdrop').count(), 0);
    assert.equal(await page.locator('.lyrics-page .lyric-line-button').first().evaluate(n => getComputedStyle(n).fontSize), font);
    await glass(true);
    await page.getByRole('button', { name: 'Full screen lyrics', exact: true }).click(); await page.waitForTimeout(500);
    await checkBackdrop('.lyrics-page', true); await retained('.lyrics-page'); await page.screenshot({ path: resolve(root, `fullscreen-${mode}.png`) });
    await page.getByRole('button', { name: 'Exit full screen', exact: true }).click(); await page.waitForTimeout(400);
  }
  checks.push('Main and fullscreen retain past backing vocals; real local cover blur in both themes; disabling glass removes the backdrop without changing lyric font size');
  phase = 'sidebar glass, table header, import buttons';
  await page.getByRole('button', { name: 'File details', exact: true }).click(); await selectMenu(page, 'Right sidebar view', 'lyrics');
  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await page.locator('.offline-navbar .offline-import-button').click();
  await page.getByLabel('Choose audio files', { exact: true }).setInputFiles(Array.from({ length: 18 }, (_, i) => ({
    name: `Library ${i}.wav`, mimeType: 'audio/wav', buffer: taggedWav({ TIT2: `Library melody ${i + 1}`, TPE1: 'Local artist', TALB: 'Frosted album' }, [{ type: 3, data: cover }]),
  })));
  await page.waitForFunction(() => document.querySelectorAll('.offline-track-list tr[data-track-id]').length === 19);
  const importer = page.getByRole('dialog', { name: 'Import local music', exact: true });
  if (await importer.isVisible()) { await importer.getByRole('button', { name: 'Close', exact: true }).click(); await importer.waitFor({ state: 'hidden' }); }
  for (const mode of ['dark', 'light']) {
    await theme(mode); await checkBackdrop('.mini-lyrics'); await retained('.mini-lyrics');
    const head = await page.locator('.offline-track-page thead').evaluate(n => ({ bg: getComputedStyle(n).backgroundColor, filter: getComputedStyle(n).backdropFilter }));
    assert.match(head.filter, /blur\(18px\)/); assert.match(head.bg, /^rgba/);
    const header = page.locator('.offline-track-page thead');
    await page.locator('.offline-table-scroll').evaluate(n => n.scrollTop = 28); await page.waitForTimeout(100);
    const blurred = await header.screenshot();
    await header.evaluate(n => n.style.backdropFilter = 'none'); const sharp = await header.screenshot();
    await header.evaluate(n => n.style.removeProperty('backdrop-filter'));
    assert.equal(blurred.equals(sharp), false, 'Sticky table header must actually blur the scrolled rows below it');
    await page.locator('.offline-table-scroll').evaluate(n => n.scrollTop = 0);
    for (const width of [1700, 1000]) {
      await page.setViewportSize({ width, height: 1100 }); await page.waitForTimeout(400);
      for (const region of ['.offline-navbar', '.offline-page-header']) {
        const result = await page.locator(region + ' .offline-import-button').evaluate(n => {
          const s = getComputedStyle(n), b = n.getBoundingClientRect(), p = n.parentElement.getBoundingClientRect();
          const range = document.createRange(); range.selectNodeContents(n); const text = range.getBoundingClientRect();
          return { radius: parseFloat(s.borderRadius), color: s.color, bg: s.backgroundColor, contained: b.left >= p.left - 1 && b.right <= p.right + 1,
            textInside: text.left >= b.left && text.right <= b.right && text.top >= b.top && text.bottom <= b.bottom, spans: n.querySelectorAll('span').length };
        });
        assert.ok(result.radius >= 100); assert.notEqual(result.color, result.bg); assert.equal(result.contained, true); assert.equal(result.textInside, true); assert.equal(result.spans, 0);
      }
      await page.screenshot({ path: resolve(root, `library-${mode}-${width}.png`) });
    }
    await page.setViewportSize({ width: 1700, height: 1100 });
  }
  checks.push('Sidebar retains child/translation, uses cover blur; table header frosted; import text fits one pill with day/night contrast at 1000/1700px');
  phase = 'local font files in browser storage';
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const appFont = page.locator('[data-font-target="app"]'), lyricFont = page.locator('[data-font-target="lyrics"]');
  const initialSize = await page.getByLabel('Lyric font size', {exact:true}).inputValue();
  await appFont.getByLabel('Application font file', {exact:true}).setInputFiles(resolve('tests/fixtures/fonts/SpotifyMix-Bold.woff2'));
  await appFont.locator('.local-font-name').filter({hasText:'SpotifyMix-Bold.woff2'}).waitFor();
  await lyricFont.getByLabel('Lyric font file', {exact:true}).setInputFiles(resolve('tests/fixtures/fonts/DMSans-Variable.ttf'));
  await lyricFont.locator('.local-font-name').filter({hasText:'DMSans-Variable.ttf'}).waitFor();
  assert.equal(await page.getByLabel('Lyric font size', {exact:true}).inputValue(), initialSize);
  const fontFamilies = await page.evaluate(()=>['--app-font-family','--local-lyrics-font-family'].map(key=>getComputedStyle(document.documentElement).getPropertyValue(key)));
  assert.notEqual(fontFamilies[0],fontFamilies[1]);assert.ok(fontFamilies.every(v=>v.includes('LocalMusicFont')));
  assert.match(await page.locator('.mini-lyrics .lyric-text').first().evaluate(n=>getComputedStyle(n).fontFamily),/LocalMusicFont/);
  assert.equal(await page.evaluate(()=>document.fonts.size),2);
  await appFont.getByLabel('Application font file', {exact:true}).setInputFiles(resolve('tests/fixtures/fonts/DMSans-Variable.woff2'));
  await appFont.locator('.local-font-name').filter({hasText:'DMSans-Variable.woff2'}).waitFor();assert.equal(await page.evaluate(()=>document.fonts.size),2);
  await page.reload();await page.locator('.offline-library').waitFor();
  await page.waitForFunction(()=>['--app-font-family','--local-lyrics-font-family'].every(key=>getComputedStyle(document.documentElement).getPropertyValue(key).includes('LocalMusicFont')));
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await appFont.locator('.local-font-name').filter({hasText:'DMSans-Variable.woff2'}).waitFor();await lyricFont.locator('.local-font-name').filter({hasText:'DMSans-Variable.ttf'}).waitFor();
  await page.screenshot({path:resolve(root,'font-settings.png')});
  await page.getByRole('button',{name:'Reset lyric appearance',exact:true}).click();
  await lyricFont.locator('.local-font-name').filter({hasText:'System default'}).waitFor();assert.equal(await page.evaluate(()=>document.fonts.size),1);
  assert.match(await appFont.locator('.local-font-name').textContent(),/DMSans/);
  checks.push('Browser local WOFF2/TTF choices persist independently in IndexedDB, keep lyric size fixed, release replaced FontFace objects, restore after reload and reset lyrics without changing the application font');
  assert.equal(await page.locator('audio').count(), 1); assert.deepEqual(errors, []); assert.deepEqual(external, []);
  await writeFile(resolve(root, 'report.json'), JSON.stringify({ result: 'passed', checks }, null, 2)); console.log(JSON.stringify({ result: 'passed', checks }));
} catch (e) { console.error('PHASE', phase, e); await page?.screenshot({ path: resolve(root, 'failure.png') }).catch(() => {}); process.exitCode = 1; }
finally { await browser?.close(); await server.close(); }
