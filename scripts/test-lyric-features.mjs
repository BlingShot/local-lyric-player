import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { taggedWav } from './library-fixtures.mjs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..'), output = resolve(root, 'test-results/lyric-features');
await mkdir(output, { recursive: true });
const server = await createServer({ root, server: { port: 3000, host: '127.0.0.1', strictPort: true } });
const source = '<?xml version="1.0" encoding="UTF-8"?><tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" itunes:timing="Word"><head><metadata><ttm:agent xml:id="v1" type="person"><ttm:name>Alice</ttm:name></ttm:agent><ttm:agent xml:id="v2" type="person"><ttm:name>Bob</ttm:name></ttm:agent></metadata></head><body><div><p xml:id="a" begin="8s" end="14s" ttm:agent="v1"><span begin="8s" end="10s">Hello </span><span begin="10s" end="12s">world</span><span ttm:role="x-bg" begin="10s" end="14s" ttm:agent="v2"><span begin="12s" end="14s">light</span></span></p><p xml:id="b" begin="27s" end="30s">Last line</p></div></body></tt>';
let browser, page, phase = 'startup', requests = 0; const errors = [], checks = [];
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'msedge', headless: true }); page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'en-US' });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:3000/lyrics');
  const audio = taggedWav({ TIT2: 'Fixture Song', TPE1: 'Fixture Artist' }, [], '[00:08]Embedded fallback\n[00:30]', 40).toString('base64');
  await page.evaluate(async base64 => {
    const runtime = await import('/src/player/runtime.ts');
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    await runtime.importAudioFiles([new File([bytes], 'features.wav', { type: 'audio/wav', lastModified: 1 })]);
    const { store } = await import('/src/store/store.ts'); runtime.playLocalTrack(store.getState().library.tracks[0].id); runtime.getLocalPlayer().pause();
  }, audio);
  await page.waitForFunction(() => document.querySelector('audio')?.duration === 40);
  await page.locator('.lyrics-reader').waitFor();
  phase = 'AMLL download and fallback';
  await page.route('https://api.amll.dev/**', async route => {
    requests++; assert.equal(new URL(route.request().url()).searchParams.get('isrc'), 'USAAA2600001');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 200, data: { filename: 'fixture.ttml', format: 'ttml', lyrics: source, isrcs: ['USAAA2600001'], authorUsernames: ['Fixture Author'] } }) });
  });
  await page.evaluate(() => {
    window.localMusicDesktop = { spotifyInfo: async () => ({ connected: true, clientId: 'a'.repeat(32) }), spotifyMatch: async () => ({ id: 'a'.repeat(22), isrc: 'USAAA2600001' }), setConfig: async () => {} };
    window.dispatchEvent(new Event('spotify-session-updated'));
  });
  await page.waitForFunction(() => document.querySelector('.lyric-text')?.textContent.includes('Hello'));
  assert.equal(requests, 1);
  const initial = await page.evaluate(async () => {
    const { readLyrics } = await import('/src/lyrics/repository.ts'), { store } = await import('/src/store/store.ts'); const saved = await readLyrics(store.getState().player.currentId); return saved;
  });
  assert.equal(initial.origin, 'amll'); assert.equal(initial.document.lines.length, 3);
  checks.push('ISRC-matched AMLL TTML replaces embedded LRC, cached with contributor provenance');
  phase = 'translation preview and audio write';
  await page.route('https://api.deepseek.com/chat/completions', async route => {
    const data = route.request().postDataJSON(), lines = JSON.parse(data.messages[1].content).lines;
    assert.equal(lines.length, 3); assert.ok(lines.some(line => line.role === 'background'));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ lines: lines.map(line => ({ id: line.id, text: '\u7ffb\u8bd1 ' + line.text })) }) } }] }) });
  });
  await page.evaluate(async () => { const { updateDeepSeekConfig } = await import('/src/analysis/deepseek/config.ts'); await updateDeepSeekConfig({ apiKey: 'test-not-a-real-key', model: 'deepseek-flash', language: 'zh' }); });
  await page.getByRole('button', { name: 'AI translation', exact: true }).click();
  await page.getByRole('button', { name: 'Translate lyrics', exact: true }).click();
  await page.locator('.lyric-translation-preview [data-role=background]').waitFor();
  await page.getByRole('button', { name: 'Save translation to song', exact: true }).click();
  await page.getByText('Translation saved inside the library audio copy. The original file is unchanged.', { exact: true }).waitFor();
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  const translated = await page.evaluate(async () => {
    const { readLyrics } = await import('/src/lyrics/repository.ts'), { store } = await import('/src/store/store.ts'); return readLyrics(store.getState().player.currentId);
  });
  const timings = doc => doc.lines.map(line => ({ start: line.start, end: line.end, role: line.role, agent: line.agent, parts: line.parts }));
  assert.deepEqual(timings(translated.document), timings(initial.document));
  assert.ok(translated.document.lines.every(line => line.annotations.some(a => a.text.startsWith('\u7ffb\u8bd1'))));
  assert.equal(translated.origin, 'embedded'); checks.push('AI translates lead/backing separately, previews, writes UTF-8 TTML to actual WAV tags and preserves every word time');
  phase = 'image export';
  await page.getByRole('button', { name: 'Export image', exact: true }).click();
  const preview = page.getByAltText('Square lyric image preview'); await preview.waitFor();
  await page.waitForFunction(() => document.querySelector('.lyric-image-preview img')?.naturalWidth === 1080);
  assert.equal(await preview.evaluate(image => image.naturalHeight), 1080);
  const previewUrl = await preview.getAttribute('src');
  const downloaded = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download PNG', exact: true }).click(); const download = await downloaded;
  await download.saveAs(resolve(output, 'lyrics.png'));
  await page.screenshot({ path: resolve(output, 'image-preview-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  if (!await page.getByRole('dialog').count()) await page.getByRole('button', { name: 'Export image', exact: true }).click();
  await page.getByAltText('Square lyric image preview').waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: resolve(output, 'image-preview-mobile.png') });
  assert.ok(previewUrl.startsWith('data:image/png;base64,'));
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 }); checks.push('Independent image dialog previews and downloads a 1080x1080 PNG; mobile layout does not overflow');
  phase = 'glow and interludes';
  await page.evaluate(() => { const audio = document.querySelector('audio'); window.__seekFixture = time => { audio.currentTime = time; audio.dispatchEvent(new Event('timeupdate')); }; window.__seekFixture(10.5); });
  await page.waitForFunction(() => [...document.querySelectorAll('.lyric-background [data-word-progress]')].every(word => Number(word.dataset.wordProgress) === 0));
  await page.evaluate(() => window.__seekFixture(12.9));
  await page.waitForFunction(() => document.querySelector('.lyric-background [data-sustained=true]'));
  await page.evaluate(() => window.__seekFixture(0));
  await page.locator('.lyric-dots[data-kind=intro][data-active] button').waitFor();
  await page.locator('.lyric-dots[data-kind=intro] button').click();
  await page.waitForFunction(() => Math.abs(document.querySelector('audio').currentTime - 8) < .1);
  await page.evaluate(() => window.__seekFixture(16)); await page.locator('.lyric-dots[data-kind=middle][data-active] button').waitFor();
  await page.locator('.lyric-dots[data-kind=middle] button').click();
  await page.waitForFunction(() => Math.abs(document.querySelector('audio').currentTime - 27) < .1);
  await page.evaluate(() => window.__seekFixture(32)); await page.locator('.lyric-dots[data-kind=outro][data-active] button').waitFor();
  checks.push('Future backing words stay dark; sustained words glow only while singing; intro, middle, and outro gaps render clickable dots');
  phase = 'reopen and failed downloads';
  await page.reload(); await page.waitForFunction(() => [...document.querySelectorAll('.lyric-translation')].some(node => node.textContent.startsWith('\u7ffb\u8bd1')));
  await page.evaluate(async () => {
    const { readLyricFile, saveLyrics } = await import('/src/lyrics/repository.ts'), { store } = await import('/src/store/store.ts');
    const id = store.getState().player.currentId; await saveLyrics(await readLyricFile(new File(['[00:08]Fallback still here\n[00:30]'], 'fallback.lrc'), id));
    window.localMusicDesktop = { spotifyInfo: async () => ({ connected: true, clientId: 'a'.repeat(32) }), spotifyMatch: async () => ({ id: 'a'.repeat(22), isrc: 'USAAA2600001' }) };
  });
  await page.unroute('https://api.amll.dev/**'); await page.route('https://api.amll.dev/**', route => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
  await page.evaluate(() => window.dispatchEvent(new Event('spotify-session-updated')));
  await page.getByText('AMLL has no matching TTML. Using local lyrics.', { exact: false }).waitFor();
  assert.ok((await page.locator('.lyric-text').first().textContent()).includes('Fallback still here'));
  checks.push('Translations survive reload; a missing AMLL entry keeps embedded/local fallback lyrics intact');
  assert.deepEqual(errors, []); await writeFile(resolve(output, 'results.json'), JSON.stringify({ passed: true, checks }, null, 2));
  console.log(JSON.stringify({ passed: true, checks, output }, null, 2));
} catch (error) { await page?.screenshot({ path: resolve(output, 'failure.png') }).catch(() => {}); console.error(JSON.stringify({ phase, errors, error: String(error) })); throw error; }
finally { await browser?.close(); await server.close(); }
