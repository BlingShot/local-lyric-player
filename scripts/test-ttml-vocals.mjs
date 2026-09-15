import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const project = process.env.TTML_PROJECT || resolve(dirname(fileURLToPath(import.meta.url)), '..');
const overlay = process.env.TTML_OVERLAY;
const require = createRequire(resolve(project, 'package.json'));
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href);
const { default: react } = await import(pathToFileURL(require.resolve('@vitejs/plugin-react')).href);
const { chromium } = require('playwright');
const overrides = new Map();
if (overlay) {
  const manifest = JSON.parse(await readFile(resolve(overlay, 'manifest.json'), 'utf8'));
  for (const item of manifest) overrides.set(resolve(project, item.path).replaceAll('\\', '/'), await readFile(resolve(overlay, 'staged', item.path), 'utf8'));
}
const samplePath = process.argv[2];
const sample = samplePath ? await readFile(samplePath, 'utf8') : null;
const english = process.argv[3] ? await readFile(process.argv[3], 'utf8') : null;
const harnessId = resolve(project, '__ttml_harness.tsx').replaceAll('\\', '/');
const harness = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { store } from './src/store/store';
import { LyricsView } from './src/components/Lyrics/LyricsView';
import { getLocalAudioElement } from './src/player/runtime';
import './src/styles/lyrics.scss';
const audio = getLocalAudioElement();
let time = 0;
Object.defineProperty(audio, 'currentTime', { configurable: true, get: () => time, set: value => { time = value; } });
Object.defineProperty(audio, 'duration', { configurable: true, get: () => 300 });
const root = createRoot(document.getElementById('fixture'));
let revision = 0;
export function mount(document, at) {
  time = at;
  root.render(React.createElement(Provider, { store }, React.createElement('div', { className: 'offline-app', 'data-lyrics-fullscreen': true, style: { height: '100vh' } },
    React.createElement('section', { className: 'lyrics-page', style: { height: '100vh', boxSizing: 'border-box', '--lyrics-font-max': '48px' } },
      React.createElement(LyricsView, { key: ++revision, document, trackId: 'regression' })))));
}
export function seek(at) { time = at; audio.dispatchEvent(new Event('seeking')); }
`;
const server = await createServer({
  root: project, configFile: false,
  cacheDir: overlay ? resolve(overlay, 'vite-cache') : resolve(project, 'node_modules/.vite-ttml-vocals'),
  plugins: [{
    name: 'ttml-regression-fixture', enforce: 'pre',
    resolveId(id) { if (id === '/__ttml_harness.tsx') return harnessId; },
    load(id) { return id === harnessId ? harness : overrides.get(id.split('?')[0]); },
    configureServer(instance) {
      instance.middlewares.use('/__ttml_regression', async (_request, response, next) => {
        try {
          const html = await instance.transformIndexHtml('/__ttml_regression', '<!doctype html><html><head></head><body style="margin:0"><div id="fixture"></div></body></html>');
          response.setHeader('Content-Type', 'text/html'); response.end(html);
        } catch (error) { next(error); }
      });
    },
  }, react()],
  server: { host: '127.0.0.1', port: 0, strictPort: false },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__ttml_regression`);
  const results = await page.evaluate(async ({ sampleSource, englishSource }) => {
    const { parseLyrics } = await import('/src/lyrics/parse.ts');
    const { importProjectTtml, parseTtmlMillis } = await import('/src/studio/projectImport.ts');
    const { lyricFrame, partProgress } = await import('/src/lyrics/timeline.ts');
    const fixture = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" itunes:timing="Word"><body><div><p begin="220s" end="228s" ttm:agent="v1"><span begin="220s" end="228s">Lead</span><span ttm:role="x-bg" ttm:agent="v2" begin="221s" end="227s"><span begin="221s" end="224s">in a tempest </span><span begin="224s" end="227s" xml:id="phrase">filled <span>with </span>light</span></span><span ttm:role="x-bg" ttm:agent="v3" begin="221s" end="227s"><span dur="2s">Harmony</span></span></p></div></body></tt>`;
    const project = importProjectTtml(fixture, 'regression', 'fixture.ttml');
    const document = parseLyrics(fixture, 'fixture.ttml');
    const bg = document.lines.find(line => line.agent === 'v2');
    const delayed = bg.parts.filter(part => /filled|with|light/.test(part.text));
    const harmony = document.lines.find(line => line.agent === 'v3').parts[0];
    const lineOnly = parseLyrics('<tt xmlns="http://www.w3.org/ns/ttml"><body><p begin="1s" end="4s">Line only</p></body></tt>', 'line.ttml');
    const ids = project.lines.flatMap(line => line.units.map(word => word.id));
    const relative = parseLyrics('<tt xmlns="http://www.w3.org/ns/ttml"><body begin="2s"><div begin="3s"><p begin="1s" dur="4s"><span begin="500ms" dur="2s">Start <span>nested</span> tail</span></p></div></body></tt>', 'relative.ttml');
    const evidence = sampleSource ? (() => {
      const xml = new DOMParser().parseFromString(sampleSource, 'application/xml');
      const parsed = parseLyrics(sampleSource, 'sample.ttml');
      const sourceRows = [...xml.getElementsByTagName('p')];
      const preserved = sourceRows.every(row => parsed.lines.some(line => Math.round(line.start * 1000) === parseTtmlMillis(row.getAttribute('begin')) && Math.round(line.end * 1000) === parseTtmlMillis(row.getAttribute('end')) && line.agent === row.getAttributeNS('http://www.w3.org/ns/ttml#metadata', 'agent') && line.parts.map(part => part.text).join('') === row.textContent));
      const at = time => parsed.lines.filter(line => lyricFrame(parsed, time, 190).activeIds.has(line.id)).map(line => ({ agent: line.agent, text: line.parts.map(part => part.text).join('') }));
      return { count: parsed.lines.length, sourceCount: sourceRows.length, preserved, at150: at(150), at151: at(151), at615: at(61.5), at1832: at(183.2), lastEnd: Math.max(...parsed.lines.map(line => line.end)) };
    })() : null;
    window.__ttmlDocument = document;
    window.__ttmlSample = sampleSource ? parseLyrics(sampleSource, 'sample.ttml') : document;
    window.__ttmlEnglish = englishSource ? parseLyrics(englishSource, 'english.ttml') : document;
    const actualBg = englishSource ? window.__ttmlEnglish.lines.find(line => line.role === 'background' && line.parts.some(part => part.text.includes('filled')) && line.start > 220) : null;
    const actual = actualBg ? { start: actualBg.start, end: actualBg.end, words: actualBg.parts.filter(part => /filled|with|light/.test(part.text)).map(part => [part.text, part.start, part.end, partProgress(part, 221.85)]), stillActive: lyricFrame(window.__ttmlEnglish, 224.5, 300).activeIds.has(actualBg.id) } : null;
    const wrap = content => `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" itunes:timing="Word"><body begin="10s" end="20s"><div><p begin="12s" end="15s"><span begin="12s" end="15s">Lead</span>${content}</p></div></body></tt>`;
    const outside = parseLyrics(wrap('<span ttm:role="x-bg" begin="9s" end="22s"><span begin="9s" end="22s">Backing</span></span>'), 'bounds.ttml').lines.find(line => line.role === 'background');
    const inherited = parseLyrics(wrap('<span ttm:role="x-bg"><span begin="12s" end="15s">Backing</span></span>'), 'inherited.ttml').lines.find(line => line.role === 'background');
    return { delayed: delayed.map(part => [part.text, part.start, part.end, partProgress(part, 221), partProgress(part, 225.5)]), harmony: [harmony.start, harmony.end], uniqueIds: new Set(ids).size === ids.length, active: lyricFrame(document, 222, 240).activeIds.size, lineOnly: lineOnly.timing, relative: relative.lines[0].parts.map(part => [part.start, part.end]), outerBounds: [outside.start, outside.end], inheritedBounds: [inherited.start, inherited.end], evidence, actual };
  }, { sampleSource: sample, englishSource: english });
  assert.deepEqual(results.delayed, [['filled ', 224, 227, 0, .5], ['with ', 224, 227, 0, .5], ['light', 224, 227, 0, .5]]);
  assert.deepEqual(results.harmony, [221, 223]);
  assert.ok(results.uniqueIds);
  assert.equal(results.active, 3);
  assert.equal(results.lineOnly, 'line');
  assert.deepEqual(results.relative, [[6.5, 8.5], [6.5, 8.5], [6.5, 8.5]]);
  assert.deepEqual(results.outerBounds, [10, 20]);
  assert.deepEqual(results.inheritedBounds, [12, 15]);
  if (results.evidence) {
    assert.equal(results.evidence.count, results.evidence.sourceCount);
    assert.ok(results.evidence.preserved);
    assert.deepEqual(results.evidence.at150.map(line => line.agent), ['v1']);
    assert.deepEqual(results.evidence.at151.map(line => line.agent), ['v1']);
    assert.deepEqual(results.evidence.at615.map(line => line.agent).sort(), ['v1', 'v2']);
    assert.deepEqual(results.evidence.at1832.map(line => line.agent).sort(), ['v1', 'v2']);
  }
  if (english) {
    assert.equal(results.actual.start, 221.839);
    assert.equal(results.actual.end, 224.615);
    assert.deepEqual(results.actual.words, [['filled ', 223.048, 223.223, 0], ['with ', 223.223, 223.432, 0], ['light)', 223.432, 224.615, 0]]);
    assert.ok(results.actual.stillActive);
  }
  await page.evaluate(async () => { window.__ttmlHarness = await import('/__ttml_harness.tsx'); window.__ttmlHarness.mount(window.__ttmlDocument, 222); });
  await page.waitForFunction(() => document.querySelectorAll('.lyric-row[data-active]').length === 3);
  const measureEdges = () => page.evaluate(() => [...document.querySelectorAll('.lyric-row[data-active] .lyric-text')].map(element => {
    const range = document.createRange(); const text = element.firstElementChild.firstChild;
    range.setStart(text, 0); range.setEnd(text, 1); return range.getBoundingClientRect().left;
  }));
  const desktopEdges = await measureEdges();
  assert.ok(Math.max(...desktopEdges) - Math.min(...desktopEdges) < 1, `Desktop lyric edges differ: ${desktopEdges}`);
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileEdges = await measureEdges();
  assert.ok(Math.max(...mobileEdges) - Math.min(...mobileEdges) < 1, `Mobile lyric edges differ: ${mobileEdges}`);
  await page.setViewportSize({ width: 1440, height: 1000 });
  if (english) {
    await page.evaluate(() => window.__ttmlHarness.mount(window.__ttmlEnglish, 221.85));
    await page.waitForFunction(() => [...document.querySelectorAll('.lyric-background[data-active] .lyric-word')].some(word => word.textContent.trim() === 'filled' && Number(word.dataset.wordProgress) === 0));
    await page.evaluate(() => window.__ttmlHarness.seek(224.5));
    await page.waitForFunction(() => [...document.querySelectorAll('.lyric-background[data-active] .lyric-word')].some(word => word.textContent === 'light)' && Number(word.dataset.wordProgress) > .8 && Number(word.dataset.wordProgress) < 1));
    await page.evaluate(() => window.__ttmlHarness.seek(221.85));
    await page.waitForFunction(() => [...document.querySelectorAll('.lyric-background[data-active] .lyric-word')].some(word => word.textContent.trim() === 'filled' && Number(word.dataset.wordProgress) === 0));
  }
  if (sample) {
    for (const time of [61.5, 183.2]) {
      await page.evaluate(time => window.__ttmlHarness.mount(window.__ttmlSample, time), time);
      await page.waitForFunction(() => document.querySelectorAll('.lyric-row[data-active]').length === 2 && document.querySelectorAll('.lyric-row[data-active].lyric-secondary').length === 1);
    }
    await page.evaluate(() => document.querySelector('.offline-app').removeAttribute('data-lyrics-fullscreen'));
    assert.equal(await page.locator('.lyric-secondary[data-active] .lyric-line-button').evaluate(element => getComputedStyle(element).textAlign), 'end');
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, desktopEdges, mobileEdges, ...results }, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
