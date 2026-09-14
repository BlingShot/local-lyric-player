import { selectMenu } from './select-menu.mjs';
import { chromium } from 'playwright';
import { dropLyricFile } from './drop-lyric-file.mjs';
import { preview } from 'vite';
import ts from 'typescript';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { taggedWav, png } from './library-fixtures.mjs';

const development = process.argv.includes('--dev');
const port = Number(process.env.LYRICS_TEST_PORT || 4176);
const origin = development ? 'http://127.0.0.1:3000' : `http://127.0.0.1:${port}`;
const server = development ? null : await preview({ preview: { host: '127.0.0.1', port, strictPort: true } });
const root = resolve('test-results/fixtures/lyrics');
await mkdir(root, { recursive: true });
const ttml = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" itunes:timing="Word">
<head><metadata><ttm:agent xml:id="v1"><ttm:name>Voice A</ttm:name></ttm:agent><ttm:agent xml:id="v2"><ttm:name>Voice B</ttm:name></ttm:agent></metadata></head>
<body><div itunes:song-part="Verse">
<p begin="0" end="4" ttm:agent="v1">First light over the hills</p>
<p begin="4" end="14" ttm:agent="v1" itunes:key="L2"><span begin="4" end="7">Golden </span><span begin="7" end="10">windows </span><span begin="10" end="14">glow</span><span ttm:role="x-bg" begin="8" end="12"><span begin="8" end="10">Softly </span><span begin="10" end="12">now</span></span><span ttm:role="x-translation" xml:lang="zh">金色窗光</span></p>
<p begin="8" end="13" ttm:agent="v2"><span begin="8" end="10">And the night </span><span begin="10" end="13">answers</span></p>
<p begin="14" end="18" ttm:agent="v1">We carry the quiet into the morning</p>
<p begin="18" end="22" ttm:agent="v1">Long shadows gather beyond the garden gate</p>
<p begin="22" end="26" ttm:agent="v2">The small river keeps its own time</p>
<p begin="26" end="30" ttm:agent="v1">Every window holds another little sky</p>
<p begin="30" end="34" ttm:agent="v1">Footsteps fade along the avenue</p>
<p begin="34" end="40" ttm:agent="v1">We leave the lantern by the door</p>
</div></body></tt>`;
const lrc = '[ti:Local test]\n[00:00.00]A quiet beginning\n[00:04.00]The garden wakes\n[00:08.00]Birds gather by the window\n[00:14.00]We follow the river\n[00:20.00]Home again\n[00:30.00]Last light';
await writeFile(resolve(root, 'voices.ttml'), ttml);
await writeFile(resolve(root, 'lines.lrc'), lrc);
await writeFile(resolve(root, 'bad.ttml'), ttml.replace('<div itunes:song-part="Verse">', '<div timeContainer="seq">'));
await writeFile(resolve(root, 'one.wav'), taggedWav({}, [{ type: 3, data: png(220, 40, 25) }], undefined, 45));
await writeFile(resolve(root, 'two.wav'), taggedWav({}, [{ type: 3, data: png(30, 75, 220) }], undefined, 45));
for (const name of ['embedded.wav', 'legacy.wav', 'quota-embedded.wav']) await writeFile(resolve(root, name), taggedWav({}, [], lrc, 45));
await writeFile(resolve(root, 'plain.wav'), taggedWav({}, [], 'Plain text without invented timing', 45));
let browser, phase = 'parser';
const errors = [], external = [], violations = [], checks = [];
try {
  browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' });
  const parserPage = await browser.newPage();
  const sources = {};
  for (const name of ['types', 'parseTtml']) sources[name] = ts.transpileModule(await readFile(`src/lyrics/${name}.ts`, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const parse = source => parserPage.evaluate(({ sources, source }) => {
    const types = {}, parser = {};
    new Function('exports', sources.types)(types);
    new Function('require', 'exports', sources.parseTtml)(() => types, parser);
    try { return { document: parser.parseTtml(source) }; } catch (error) { return { error: error.message }; }
  }, { sources, source });
  const voices = (await parse(ttml)).document;
  assert.equal(voices.profile, 'apple'); assert.equal(voices.lines.length, 10);
  assert.deepEqual(voices.lines.find(line => line.role === 'background').parts.map(part => [part.start, part.end]), [[8, 10], [10, 12]]);
  assert.equal(voices.agents.v2, 'Voice B');
  assert.equal(voices.lines[1].annotations[0].text, '金色窗光');
  const relative = await parse('<tt xmlns="http://www.w3.org/ns/ttml"><body begin="10s"><div begin="2s"><p begin="1s" dur="3s"><span begin="0s" dur="1s">A </span><span begin="1s" dur="2s">B</span></p></div></body></tt>');
  assert.deepEqual(relative.document.lines[0].parts.map(part => [part.start, part.end]), [[13, 14], [14, 16]]);
  for (const bad of [ttml.replace('itunes:song-part="Verse"', 'timeContainer="seq"'), ttml.replace('begin="4"', 'begin="4f"'),
    ttml.replace('x-bg', 'x-unknown'), ttml.replace('<span begin="4"', '<span xmlns:tts="http://www.w3.org/ns/ttml#styling" tts:ruby="base" begin="4"'),
    '<!DOCTYPE tt [<!ENTITY external SYSTEM "https://invalid.example/lyrics">]><tt/>', '<tt><body><div><p>Untimed text</p></div></body></tt>', '<tt><body>Broken</tt>']) {
    assert.ok((await parse(bad)).error, 'Unsupported structures must fail explicitly');
  }
  await parserPage.close();
  checks.push('TTML absolute Apple/AMLL and standard relative timing, words, background vocals, named duet voices, annotations; unsupported timing/roles/ruby/DTD/malformed XML fail explicitly');

  phase = 'startup and database upgrade';
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin !== origin) { external.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  await context.exposeBinding('recordViolation', (_, value) => violations.push(value));
  await context.addInitScript(() => {
    window.__audioCount = 0; const Audio = window.Audio;
    window.Audio = class extends Audio { constructor(...args) { super(...args); window.__audioCount++; } };
    document.addEventListener('securitypolicyviolation', event => window.recordViolation(event.violatedDirective + ': ' + event.blockedURI));
  });
  let page = await context.newPage();
  page.on('pageerror', error => errors.push(phase + ': ' + error.message));
  await page.route(origin + '/', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body>Database migration test</body></html>' }), { times: 1 });
  await page.goto(origin);
  await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('local-music-library', 1);
    request.onupgradeneeded = () => { for (const name of ['tracks', 'audio', 'covers', 'settings', 'playlists']) request.result.createObjectStore(name); };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction(['settings', 'playlists'], 'readwrite');
      tx.objectStore('settings').put({ volume: .4, shuffle: false, repeat: 'off' }, 'playback');
      tx.objectStore('playlists').put({ id: 'old-playlist', name: 'Existing local playlist', trackIds: [] }, 'old-playlist');
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => reject(tx.error);
    };
  }));
  await page.reload();
  const bar = () => page.getByRole('contentinfo', { name: 'Player', exact: true });
  const dialog = () => page.getByRole('dialog', { name: 'Import local lyrics', exact: true });
  const readStore = name => page.evaluate(name => new Promise((resolve, reject) => {
    const open = indexedDB.open('local-music-library');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => { const db = open.result, tx = db.transaction(name), request = tx.objectStore(name).getAll(); request.onsuccess = () => resolve(request.result); tx.oncomplete = () => db.close(); };
  }), name);
  const seek = value => page.getByRole('slider', { name: 'Playback progress', exact: true }).evaluate((input, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  const importLyrics = async name => {
    if (await page.getByRole('button', { name: 'Import lyrics', exact: true }).count()) await page.getByRole('button', { name: 'Import lyrics', exact: true }).click();
    else await dropLyricFile(page, resolve(root, name));
    await dialog().getByLabel('Choose lyric file', { exact: true }).setInputFiles(resolve(root, name));
    await dialog().getByRole('button', { name: 'Save lyrics', exact: true }).click();
    await dialog().waitFor({ state: 'hidden' });
    await page.getByRole('region', { name: 'Synced lyrics', exact: true }).waitFor();
  };
  await page.waitForFunction(() => !document.querySelector('.offline-storage-busy'));
  assert.deepEqual(await readStore('playlists'), [{ id: 'old-playlist', name: 'Existing local playlist', trackIds: [] }]);
  assert.equal(Number(await page.getByRole('slider', { name: 'Volume', exact: true }).inputValue()), .4);
  checks.push('database version 1 upgrades to version 4 with lyric, analysis and task stores while preserving existing playback settings and playlist records');
  await page.getByRole('button', { name: 'Import music', exact: true }).first().click();
  const audioDialog = page.getByRole('dialog', { name: 'Import local music', exact: true });
  await audioDialog.getByLabel('Choose audio files', { exact: true }).setInputFiles([resolve(root, 'one.wav'), resolve(root, 'two.wav')]);
  await audioDialog.getByRole('status').filter({ hasText: 'Added 2 files' }).waitFor();
  await audioDialog.getByRole('button', { name: 'Close', exact: true }).click(); await audioDialog.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'one.wav Local file', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('audio').paused && document.querySelector('audio').currentTime > .05);
  await bar().getByRole('button', { name: 'Pause', exact: true }).click();
  await bar().getByRole('button', { name: 'Lyrics', exact: true }).click();
  await page.getByRole('heading', { name: 'Bring your lyrics', exact: true }).waitFor();
  await importLyrics('voices.ttml');
  assert.equal(await page.locator('.lyric-row').count(), 10);
  assert.equal(await page.locator('.lyrics-source-notes').count(), 0);
  phase = 'actual audio time and simultaneous highlights';
  await seek(8.5);
  await page.waitForFunction(() => document.querySelectorAll('.lyric-row[data-active]').length === 3);
  assert.ok(Math.abs(Number(await page.locator('.lyric-background .lyric-word').first().getAttribute('data-word-progress')) - .25) < .025);
  assert.equal(await page.locator('.lyric-secondary[data-active] .lyric-performer').textContent(), 'Voice B');
  const paused = await page.locator('.lyric-background .lyric-word').first().getAttribute('data-word-progress');
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 220)));
  assert.equal(await page.locator('.lyric-background .lyric-word').first().getAttribute('data-word-progress'), paused);
  await bar().getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(() => Number(document.querySelector('.lyric-background .lyric-word').dataset.wordProgress) > .32);
  await bar().getByRole('button', { name: 'Pause', exact: true }).click();
  await seek(1);
  await page.waitForFunction(() => document.querySelectorAll('.lyric-row[data-active]').length === 1 && document.querySelector('.lyric-row[data-active]').textContent.includes('First light'));
  assert.equal(await page.locator('.lyric-row[data-active] .lyric-word').count(), 0);
  await page.getByRole('button', { name: 'Seek to We carry the quiet into the morning', exact: true }).click();
  await page.waitForFunction(() => Math.abs(document.querySelector('audio').currentTime - 14) < .05);
  assert.equal(await page.evaluate(() => document.querySelector('audio').paused), true);
  checks.push('actual audio seeking, pause/resume and backwards seeking update real word progress; three overlapping lead/background/duet lines highlight together; line-only cues have no artificial word progress; lyric clicks seek without starting paused audio');

  phase = 'context layout and responsive lyrics';
  await seek(8.5);
  await page.getByRole('button', { name: 'Collapse library', exact: true }).click();
  await bar().getByRole('button', { name: 'File details', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#details[data-panel]').getBoundingClientRect().width > 250);
  await page.waitForFunction(() => Math.abs(document.querySelector('#left[data-panel]').getBoundingClientRect().width - 85) < 1);
  await page.screenshot({ path: 'test-results/lyrics-desktop.png' });
  for (const width of [1600, 1100, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
    assert.ok(await page.getByRole('region', { name: 'Synced lyrics', exact: true }).evaluate(element => element.scrollWidth <= element.clientWidth + 1));
    assert.equal(await page.locator('.lyric-text').evaluateAll(elements => elements.every(element => getComputedStyle(element).fontSize === '48px')), true, 'Lyrics retain the configured size at every viewport width');
    if (width === 390) await page.screenshot({ path: 'test-results/lyrics-mobile.png' });
  }
  await page.setViewportSize({ width: 1600, height: 1000 });
  await seek(18);
  await page.waitForFunction(() => document.querySelector('.lyrics-scroll').scrollTop > 150);
  const visible = await page.locator('.lyrics-scroll').evaluate(element => {
    const r = element.getBoundingClientRect();
    return [...element.querySelectorAll('.lyric-row')].filter(row => { const b = row.getBoundingClientRect(); return b.top < r.bottom && b.bottom > r.top; }).length;
  });
  assert.ok(visible >= 3, 'Multiple lines of context stay visible');
  checks.push('multiple context lines, responsive desktop/mobile layouts without horizontal overflow, smooth following in the central lyric region');
  checks.push('long and short lyric lines keep the configured 48px size at 1600/1100/390/320px; only line wrapping adapts to the available width');

  phase = 'resume easing, underline and past lyrics';
  const currentLine = page.getByRole('button', { name: 'Seek to Long shadows gather beyond the garden gate', exact: true });
  await currentLine.hover();
  assert.equal(await currentLine.locator('.lyric-text').evaluate(element => getComputedStyle(element).textDecorationLine), 'underline');
  assert.equal(await currentLine.evaluate(element => getComputedStyle(element).fontWeight), '700');
  assert.match(await currentLine.evaluate(element => getComputedStyle(element).fontFamily), /system-ui/);
  const pastColor = await page.locator('.lyric-row[data-past] .lyric-line-button').first().evaluate(element => getComputedStyle(element).color);
  const futureColor = await page.locator('.lyric-row:not([data-active]):not([data-past]) .lyric-line-button').last().evaluate(element => getComputedStyle(element).color);
  assert.notEqual(pastColor, futureColor);
  const reader = page.getByRole('region', { name: 'Synced lyrics', exact: true });
  const readerBox = await reader.boundingBox();
  await page.mouse.move(readerBox.x + 120, readerBox.y + 100); await page.mouse.wheel(0, 550);
  await page.getByRole('button', { name: 'Resume following', exact: true }).waitFor();
  await page.evaluate(() => {
    window.__scrollSamples = []; window.__sampleScroll = true;
    const sample = () => { window.__scrollSamples.push(document.querySelector('.lyrics-scroll').scrollTop); if (window.__sampleScroll) requestAnimationFrame(sample); };
    requestAnimationFrame(sample);
  });
  await page.getByRole('button', { name: 'Resume following', exact: true }).click();
  await page.waitForFunction(() => {
    const region = document.querySelector('.lyrics-scroll'), line = document.querySelector('.lyric-row[data-active]');
    return Math.abs(region.scrollTop - Math.max(0, line.offsetTop - region.clientHeight * .38)) < 1;
  });
  const scrollSamples = await page.evaluate(() => { window.__sampleScroll = false; return window.__scrollSamples; });
  assert.ok(new Set(scrollSamples.map(Math.round)).size > 5, 'Resume following moves through intermediate scroll positions');
  checks.push('resume following uses eased intermediate positions; hover underlining and bold system font fallback are applied; past lyrics are darker than future lyrics');

  phase = 'per-song lyric offset';
  await page.getByRole('button', { name: 'Lyrics timing', exact: true }).click();
  await page.getByLabel('Lyrics offset in seconds', { exact: true }).fill('2');
  await page.waitForFunction(() => document.querySelector('.lyric-row[data-active]')?.textContent.includes('We carry the quiet'));
  assert.ok(Math.abs(await page.evaluate(() => document.querySelector('audio').currentTime) - 18) < .05);
  await page.getByRole('button', { name: 'Lyrics timing', exact: true }).click();
  await page.getByRole('button', { name: 'Seek to We carry the quiet into the morning', exact: true }).click();
  await page.waitForFunction(() => Math.abs(document.querySelector('audio').currentTime - 16) < .05);
  assert.equal((await readStore('lyrics'))[0].offsetMs, 2000);
  await page.getByRole('button', { name: 'Lyrics timing', exact: true }).click();
  await page.getByRole('button', { name: 'Reset timing', exact: true }).click();
  await page.getByRole('button', { name: 'Lyrics timing', exact: true }).click();
  await seek(18);
  checks.push('per-song positive/negative offset controls save milliseconds locally, update lyrics without moving audio, and lyric clicks include the offset');

  phase = 'settings appearance and live timing';
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  await selectMenu(page, 'Lyric font', 'arial', settings);
  for (const [name, value] of [['Lyric font size', 44], ['Lyric line spacing', 24]]) {
    await settings.getByRole('slider', { name, exact: true }).evaluate((input, value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(value));
      input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
  }
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.lyrics-page')).getPropertyValue('--lyrics-font-max').trim() === '44px');
  await settings.getByLabel('Lyrics offset in seconds', { exact: true }).fill('2');
  await page.waitForFunction(() => document.querySelector('.lyric-row[data-active]')?.textContent.includes('We carry the quiet'));
  assert.match(await page.locator('.lyric-line-button').first().evaluate(element => getComputedStyle(element).fontFamily), /^Arial/);
  assert.equal(await page.locator('.lyric-text').evaluateAll(elements => elements.every(element => getComputedStyle(element).fontSize === '44px')), true, 'An explicit font-size setting applies equally to every lyric line');
  await settings.getByRole('button', { name: 'Reset timing', exact: true }).click();
  await settings.getByRole('button', { name: 'Close', exact: true }).click(); await settings.waitFor({ state: 'hidden' });
  const appearance = (await readStore('settings')).find(value => value?.font === 'arial');
  assert.deepEqual(appearance, { font: 'arial', fontSize: 44, lineGap: 24 });
  const progress = await page.getByRole('slider', { name: 'Playback progress', exact: true }).evaluate(element => {
    const style = getComputedStyle(element, '::-webkit-slider-runnable-track'); return { border: style.borderWidth, shadow: style.boxShadow };
  });
  assert.equal(progress.border, '0px'); assert.equal(progress.shadow, 'none');
  checks.push('Settings updates lyric font, size, spacing and per-song timing live, saves preferences, and the unplayed progress track has no border');

  phase = 'cover accent, fullscreen animation and floating player';
  const firstAccent = await page.locator('.lyrics-page').evaluate(element => getComputedStyle(element).getPropertyValue('--lyrics-background'));
  assert.notEqual(firstAccent.trim(), 'hsl(215 10% 19%)');
  await bar().getByRole('button', { name: 'Play', exact: true }).click();
  await page.evaluate(() => {
    window.__fullscreenSamples = []; window.__sampleFullscreen = true;
    const sample = () => { window.__fullscreenSamples.push(Number(getComputedStyle(document.querySelector('.lyrics-page')).opacity)); if (window.__sampleFullscreen) requestAnimationFrame(sample); };
    requestAnimationFrame(sample);
  });
  await page.getByRole('button', { name: 'Full screen lyrics', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.offline-app[data-lyrics-fullscreen]') && !document.querySelector('.offline-app[data-lyrics-motion]'));
  const opacitySamples = await page.evaluate(() => { window.__sampleFullscreen = false; return window.__fullscreenSamples; });
  assert.ok(opacitySamples.some(value => value > 0 && value < .9), 'Fullscreen entry has visible intermediate opacity');
  assert.equal(await bar().evaluate(element => getComputedStyle(element).position), 'absolute');
  assert.equal(await bar().evaluate(element => getComputedStyle(element).borderRadius), '22px');
  assert.equal(await page.locator('.lyrics-reader').evaluate(element => getComputedStyle(element, '::before').backdropFilter), 'blur(5px)');
  assert.equal(await page.locator('.lyrics-reader').evaluate(element => getComputedStyle(element, '::after').pointerEvents), 'none');
  assert.equal(await page.locator('.offline-navbar').isVisible(), false);
  await page.screenshot({ path: 'test-results/lyrics-fullscreen.png' });
  await dropLyricFile(page, resolve(root, 'lines.lrc')); await dialog().waitFor();
  await dialog().getByRole('button', { name: 'Close', exact: true }).click(); await dialog().waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Exit full screen', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.offline-app[data-lyrics-fullscreen], .offline-app[data-lyrics-motion]'));
  assert.equal(await page.locator('.offline-navbar').isVisible(), true);
  assert.equal(await page.evaluate(() => window.__audioCount), 1);
  assert.equal(await page.evaluate(() => document.querySelector('audio').paused), false);
  await bar().getByRole('button', { name: 'Pause', exact: true }).click();
  checks.push('local cover supplies the lyric accent; fullscreen entry/exit animate; the same rounded player floats above lyrics with blurred edges; dialogs remain usable and playback is uninterrupted');

  phase = 'unsupported import and save failure retain previous lyrics';
  const savedBefore = (await readStore('lyrics'))[0];
  await dropLyricFile(page, resolve(root, 'bad.ttml'));
  await dialog().getByLabel('Choose lyric file', { exact: true }).setInputFiles(resolve(root, 'bad.ttml'));
  await dialog().getByRole('alert').filter({ hasText: 'Sequential' }).waitFor();
  assert.equal(await dialog().getByRole('button', { name: 'Save lyrics', exact: true }).isDisabled(), true);
  assert.deepEqual((await readStore('lyrics'))[0], savedBefore);
  await dialog().getByLabel('Choose lyric file', { exact: true }).setInputFiles(resolve(root, 'lines.lrc'));
  await page.evaluate(() => {
    window.__put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(...args) { if (this.name === 'lyrics') throw new DOMException('Test full storage', 'QuotaExceededError'); return window.__put.apply(this, args); };
  });
  await dialog().getByRole('button', { name: 'Save lyrics', exact: true }).click();
  await dialog().getByRole('alert').filter({ hasText: 'Not enough browser storage' }).waitFor();
  assert.deepEqual((await readStore('lyrics'))[0], savedBefore);
  await page.evaluate(() => IDBObjectStore.prototype.put = window.__put);
  await dialog().getByRole('button', { name: 'Close', exact: true }).click(); await dialog().waitFor({ state: 'hidden' });
  checks.push('unsupported structures and simulated storage quota failure are visible and preserve the previous saved lyrics and original source');

  phase = 'track isolation, navigation and restoration';
  await bar().getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('heading', { name: 'Bring your lyrics', exact: true }).waitFor();
  await importLyrics('lines.lrc');
  await page.waitForFunction(previous => getComputedStyle(document.querySelector('.lyrics-page')).getPropertyValue('--lyrics-background') !== previous, firstAccent);
  await seek(8.5);
  await page.waitForFunction(() => document.querySelector('.lyric-row[data-active]')?.textContent.includes('Birds gather'));
  assert.equal(await page.locator('.lyric-word').count(), 0);
  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await bar().getByRole('button', { name: 'Lyrics', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.lyric-row[data-active]')?.textContent.includes('Birds gather'));
  assert.equal(await page.evaluate(() => window.__audioCount), 1);
  await page.reload();
  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await page.getByRole('button', { name: 'one.wav Local file', exact: true }).click();
  await bar().getByRole('button', { name: 'Lyrics', exact: true }).click();
  await page.getByRole('region', { name: 'Synced lyrics', exact: true }).waitFor();
  assert.equal(await page.locator('.lyric-row').count(), 10);
  assert.equal((await readStore('lyrics')).length, 2);
  assert.match(await page.locator('.lyric-line-button').first().evaluate(element => getComputedStyle(element).fontFamily), /^Arial/);
  assert.equal((await readStore('lyrics')).find(record => record.fileName === 'voices.ttml').source, ttml);
  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await page.getByRole('button', { name: 'Remove one.wav', exact: true }).click();
  await page.getByRole('button', { name: 'Remove one.wav', exact: true }).waitFor({ state: 'detached' });
  assert.equal((await readStore('lyrics')).length, 1);
  checks.push('each track restores its own local lyric file across navigation and refresh; the original TTML source is preserved, one audio instance remains, and removing a track also removes its lyric copy');

  phase = 'embedded LRC import and backfill';
  await page.getByRole('button', { name: 'Import music', exact: true }).first().click();
  await audioDialog.getByLabel('Choose audio files', { exact: true }).setInputFiles(['embedded.wav', 'legacy.wav', 'plain.wav'].map(name => resolve(root, name)));
  await audioDialog.getByRole('status').filter({ hasText: 'Added 3 files' }).waitFor();
  await audioDialog.getByRole('button', { name: 'Close', exact: true }).click(); await audioDialog.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'embedded.wav Local file', exact: true }).click();
  await bar().getByRole('button', { name: 'Lyrics', exact: true }).click();
  await page.getByRole('button', { name: 'Seek to A quiet beginning', exact: true }).waitFor();
  assert.equal((await readStore('lyrics')).filter(record => record.origin === 'embedded').length, 2);
  await importLyrics('voices.ttml');
  await page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('local-music-library');
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction(['tracks', 'lyrics'], 'readwrite'), request = tx.objectStore('tracks').openCursor();
      request.onsuccess = () => {
        const cursor = request.result; if (!cursor) return;
        const track = cursor.value;
        if (['embedded.wav', 'legacy.wav'].includes(track.fileName || track.name)) {
          delete track.embeddedLyricsChecked; cursor.update(track);
          if ((track.fileName || track.name) === 'legacy.wav') tx.objectStore('lyrics').delete(track.id);
        }
        cursor.continue();
      };
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => reject(tx.error);
    };
  }));
  await page.reload();
  const deadline = Date.now() + 15000;
  while ((await readStore('tracks')).some(track => !track.embeddedLyricsChecked) && Date.now() < deadline) await page.waitForTimeout(50);
  const embeddedSaved = await readStore('lyrics');
  assert.ok(embeddedSaved.some(record => record.fileName === 'voices.ttml' && record.origin === 'file'));
  assert.ok(embeddedSaved.some(record => record.fileName === 'legacy.wav.embedded.lrc' && record.source === lrc), JSON.stringify({ lyrics: embeddedSaved.map(record => ({ fileName: record.fileName, source: record.source })), tracks: (await readStore('tracks')).map(track => ({ name: track.name, fileName: track.fileName, checked: track.embeddedLyricsChecked, warning: track.lyricsWarning })) }));
  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await page.getByRole('button', { name: 'plain.wav Local file', exact: true }).click();
  await bar().getByRole('button', { name: 'Lyrics', exact: true }).click();
  await page.locator('.lyrics-empty').getByText(/Embedded lyrics were found, but they do not contain supported LRC timestamps/).waitFor();
  assert.equal(await page.locator('.lyric-row').count(), 0);
  checks.push('native embedded LRC imports automatically with the audio; old saved audio is backfilled without overwriting manually imported lyrics; untimed embedded text is explained without invented timing');
  assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(violations, []);
  const report = { result: 'passed', mode: development ? 'development' : 'production', checks, errors, external, violations };
  await writeFile(`test-results/lyrics-${report.mode}.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) { console.error(JSON.stringify({ phase, errors, external, violations })); throw error; }
finally { await browser?.close(); if (server) await new Promise(resolve => server.httpServer.close(resolve)); }
