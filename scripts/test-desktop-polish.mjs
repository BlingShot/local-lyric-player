import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { sampleEntrance, assertEntrance } from './lyric-entrance-checks.mjs';
import { selectMenu } from './select-menu.mjs';

const root = path.resolve('test-results/desktop-polish');
await mkdir(root, { recursive: true });
const profile = await mkdtemp(path.join(root, 'profile-'));
const env = { ...process.env, DESKTOP_TEST_PROFILE: profile, DESKTOP_TEST_DOWNLOADS: root };
delete env.ELECTRON_RUN_AS_NODE; delete env.LOCAL_MUSIC_DEV_URL;
const packaged = process.argv.includes('--packaged');
const entry = path.join(root, packaged ? 'packaged-entry.mjs' : 'source-entry.mjs');
await writeFile(entry, (await readFile('scripts/desktop-smoke-entry.mjs', 'utf8'))
  .replace('../electron/app.mjs', pathToFileURL(path.resolve(packaged
    ? 'release/win-unpacked/resources/app.asar/electron/app.mjs' : 'electron/app.mjs')).href)
  .replace('show: false,', 'show: false, offscreen: true,'));
const fixtures = [];
for (const [rate, channels] of [[44100, 1], [48000, 2], [96000, 2]]) {
  const frames = rate * 8, wave = Buffer.alloc(44 + frames * channels * 3);
  wave.write('RIFF'); wave.writeUInt32LE(wave.length - 8, 4); wave.write('WAVEfmt ', 8); wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20); wave.writeUInt16LE(channels, 22); wave.writeUInt32LE(rate, 24);
  wave.writeUInt32LE(rate * channels * 3, 28); wave.writeUInt16LE(channels * 3, 32); wave.writeUInt16LE(24, 34);
  wave.write('data', 36); wave.writeUInt32LE(wave.length - 44, 40);
  for (let frame = 0; frame < frames; frame++) for (let ch = 0; ch < channels; ch++) {
    // Low-order bits intentionally vary: a silent 16-bit reduction must be detected.
    wave.writeIntLE(Math.round(Math.sin(frame / rate * Math.PI * 2 * (ch ? 330 : 220)) * 2097151) + frame % 127,
      44 + (frame * channels + ch) * 3, 3);
  }
  const wav = path.join(root, `precision-${rate}-${channels}.wav`);
  await writeFile(wav, wave);
  const flac = wav.replace('.wav', '.flac');
  execFileSync('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', wav, '-c:a', 'flac', flac], { windowsHide: true });
  fixtures.push({ file: flac, wav, rate, channels });
}
const mp3 = path.join(root, 'playback.mp3');
execFileSync('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', fixtures[0].wav, '-c:a', 'libmp3lame', '-b:a', '192k', mp3], { windowsHide: true });
fixtures.push({ file: mp3, rate: 44100, channels: 1 });
const errors = [], external = [], checks = [], decoders = [];
let app, page;
const click = locator => locator.evaluate(el => el.click());
const route = url => page.evaluate(url => { history.pushState(null, '', url); dispatchEvent(new PopStateEvent('popstate')); }, url);
const hidden = async () => assert.deepEqual(await app.evaluate(({ BrowserWindow }) => ({ events: globalThis.desktopWindowEvents,
  visible: BrowserWindow.getAllWindows().some(w => w.isVisible()), focused: BrowserWindow.getAllWindows().some(w => w.isFocused()) })),
{ events: [], visible: false, focused: false });
try {
  app = await electron.launch({ args: [entry], env, timeout: 30000 }); page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  page.on('pageerror', e => errors.push(e.message)); page.on('request', r => { if (/^https?:/.test(r.url())) external.push(r.url()); });
  await page.getByRole('heading', { name: 'Local library', exact: true }).waitFor();
  const versions = await app.evaluate(() => process.versions);
  const media = await page.context().newCDPSession(page), properties = new Map();
  media.on('Media.playerPropertiesChanged', ({ playerId, properties: props }) => {
    properties.set(playerId, { ...properties.get(playerId), ...Object.fromEntries(props.map(p => [p.name, p.value])) });
  });
  await media.send('Media.enable');
  for (const fixture of fixtures) {
    const oldPlayers = new Set(properties.keys());
    await click(page.getByRole('button', { name: 'Import music', exact: true }).first());
    await page.getByLabel('Choose audio files', { exact: true }).setInputFiles(fixture.file);
    await page.getByRole('status').filter({ hasText: 'Added 1 file' }).waitFor();
    await click(page.getByRole('button', { name: 'Close', exact: true }));
    await click(page.getByRole('button', { name: `Play saved track ${path.basename(fixture.file)}`, exact: true }));
    await page.waitForFunction(() => document.querySelector('audio').currentTime > .15 && !document.querySelector('audio').paused);
    await page.locator('audio').evaluate(a => { a.currentTime = 3; });
    await page.waitForFunction(() => document.querySelector('audio').currentTime > 3.1);
    await page.locator('audio').evaluate(a => a.pause());
    const until = Date.now() + 10000;
    const currentProperties = () => [...properties].find(([id, p]) => !oldPlayers.has(id) && p.kAudioDecoderName)?.[1];
    while (!currentProperties() && Date.now() < until) await page.waitForTimeout(100);
    decoders.push({ file: path.basename(fixture.file), media: currentProperties() });
    assert.equal(decoders.at(-1).media?.kAudioDecoderName, 'FFmpegAudioDecoder', JSON.stringify(decoders.at(-1)));
    if (fixture.wav) {
      const delta = await page.evaluate(async ({ rate, channels, expected, encoded }) => {
        const context = new OfflineAudioContext(channels, 1, rate);
        const buffer = await context.decodeAudioData(new Uint8Array(encoded).buffer);
        const view = new DataView(new Uint8Array(expected).buffer); let maxError = 0;
        for (let ch = 0; ch < channels; ch++) {
          const data = buffer.getChannelData(ch);
          for (let i = 0; i < data.length; i++) {
            const at = 44 + (i * channels + ch) * 3;
            let value = view.getUint8(at) | view.getUint8(at + 1) << 8 | view.getUint8(at + 2) << 16;
            if (value & 0x800000) value -= 0x1000000;
            maxError = Math.max(maxError, Math.abs(data[i] - value / 8388608));
          }
        }
        return { maxError, rate: buffer.sampleRate, frames: buffer.length, channels: buffer.numberOfChannels };
      }, { ...fixture, expected: [...await readFile(fixture.wav)], encoded: [...await readFile(fixture.file)] });
      assert.equal(delta.rate, fixture.rate); assert.equal(delta.channels, fixture.channels); assert.equal(delta.frames, fixture.rate * 8);
      assert.ok(delta.maxError < 1 / 8388608, JSON.stringify(delta));
      decoders.at(-1).pcm = delta;
    }
  }
  checks.push('Native playback and seeking of MP3 plus 24-bit FLAC at 44.1/48/96 kHz; decoded lossless PCM compared sample-by-sample, including low-order bits');
  assert.equal(await page.locator('audio').count(), 1);
  await hidden();
  await writeFile(path.join(root, 'decoder-results.json'), JSON.stringify({ versions, decoders }, null, 2));

  await click(page.getByRole('button', { name: 'Import music', exact: true }).first());
  await page.getByLabel('Choose audio files', { exact: true }).setInputFiles({ name: 'damaged.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('This is deliberately invalid audio.') });
  await page.getByRole('status').filter({ hasText: 'Added 1 file' }).waitFor();
  await click(page.getByRole('button', { name: 'Close', exact: true }));
  await click(page.getByRole('button', { name: 'Play saved track damaged.mp3', exact: true }));
  await page.locator('.offline-playback-error').filter({ hasText: /cannot be decoded/ }).waitFor();
  await click(page.getByRole('button', { name: 'Play saved track playback.mp3', exact: true }));
  await page.waitForFunction(() => !document.querySelector('audio').paused && document.querySelector('audio').currentTime > .1);
  await page.locator('audio').evaluate(a => a.pause());
  checks.push('A corrupt MP3 reports a decode error and a subsequent valid song plays without a stuck loading state');

  const titlebar = await page.locator('.offline-navbar').evaluate(nav => {
    const search = nav.querySelector('.offline-search-group').getBoundingClientRect(), actions = nav.querySelector('.offline-nav-actions').getBoundingClientRect();
    return { drag: getComputedStyle(nav).getPropertyValue('-webkit-app-region'),
      button: getComputedStyle(nav.querySelector('button')).getPropertyValue('-webkit-app-region'),
      height: nav.clientHeight, searchRight: search.right, actionsLeft: actions.left, right: actions.right, width: innerWidth,
      searchHeight: nav.querySelector('.offline-search').clientHeight,
      centers: [...nav.querySelectorAll('.offline-search, .offline-settings-button, .white-button')].map(el => {
        const rect = el.getBoundingClientRect(); return rect.top + rect.height / 2;
      }) };
  });
  assert.equal(titlebar.drag, 'drag'); assert.equal(titlebar.button, 'no-drag'); assert.equal(titlebar.height, 60);
  assert.equal(titlebar.searchHeight, 44); assert.ok(Math.max(...titlebar.centers) - Math.min(...titlebar.centers) < 1, JSON.stringify(titlebar));
  assert.ok(titlebar.searchRight < titlebar.actionsLeft); assert.ok(titlebar.right < titlebar.width - 130);
  await page.evaluate(() => window.localMusicDesktop.setWindowTheme('light'));
  await page.evaluate(() => window.localMusicDesktop.setWindowTheme('dark'));
  const rejected = await page.evaluate(() => window.localMusicDesktop.setWindowTheme('wrong').then(() => false, () => true));
  assert.ok(rejected);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 740));
  await page.waitForTimeout(200);
  const narrow = await page.locator('.offline-navbar').evaluate(nav => ({
    searchRight: nav.querySelector('.offline-search-group').getBoundingClientRect().right,
    actionsLeft: nav.querySelector('.offline-nav-actions').getBoundingClientRect().left,
  }));
  assert.ok(narrow.searchRight < narrow.actionsLeft, JSON.stringify(narrow));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 940));
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(root, 'titlebar.png'), animations: 'disabled' });
  checks.push('60 px draggable navigation with 44 px search; search/settings/import vertically aligned, no-drag regions, caption safe area and validated theme IPC');

  await route('/lyrics');
  await click(page.getByRole('button', { name: 'Import lyrics', exact: true }));
  const ttml = `<tt xmlns="http://www.w3.org/ns/ttml"><body><div>${Array.from({ length: 50 }, (_, i) =>
    `<p begin="${i * .15}s" end="${(i + 1) * .15}s">Line ${i + 1}: A deliberately long sentence that reflows when the sidebar changes width, with context kept around the currently singing line.</p>`).join('')}</div></body></tt>`;
  await page.getByLabel('Choose lyric file', { exact: true }).setInputFiles({ name: 'resize.ttml', mimeType: 'text/plain', buffer: Buffer.from(ttml) });
  await click(page.getByRole('button', { name: 'Save lyrics', exact: true }));
  await page.locator('audio').evaluate(a => { a.currentTime = 4; });
  await page.waitForTimeout(900);
  const entrances = [];
  for (const url of ['/', '/collection/albums', '/']) {
    await route(url); await page.waitForTimeout(240);
    const frames = await sampleEntrance(page, '.lyrics-page .lyrics-scroll', { route: '/lyrics' });
    entrances.push(assertEntrance(frames, 'Main lyrics entrance'));
    assert.equal(new Set(frames.map(f => f.width)).size, 1, 'Page entry must not change width while a scrollbar appears/disappears');
  }
  const colors = await page.locator('.lyrics-page').evaluate(root => {
    const color = query => getComputedStyle(root.querySelector(query)).color;
    return { past: color('[data-past] .lyric-line-button'), future: color('.lyric-row:not([data-past]):not([data-active]) .lyric-line-button'), active: color('[data-active] .lyric-line-button') };
  });
  assert.notEqual(colors.past, colors.future); assert.notEqual(colors.future, colors.active);
  const toggles = [];
  for (let i = 0; i < 6; i++) {
    // Sampling inside the hidden renderer avoids native focus and captures every animation frame.
    const samples = await page.evaluate(async () => {
      const region = document.querySelector('.lyrics-page .lyrics-scroll');
      const samples = [], end = performance.now() + 850;
      document.querySelector('button[aria-label="File details"]').click();
      await new Promise(resolve => {
        const sample = () => {
          const active = region.querySelector('.lyric-row[data-active]');
          samples.push({ y: active.getBoundingClientRect().top - region.getBoundingClientRect().top,
            desired: region.clientHeight * .38, scroll: region.scrollTop, width: region.clientWidth });
          if (performance.now() < end) requestAnimationFrame(() => setTimeout(sample, 0)); else resolve();
        }; requestAnimationFrame(() => setTimeout(sample, 0));
      }); return samples;
    });
    await writeFile(path.join(root, `resize-${i}.json`), JSON.stringify(samples));
    const settled = samples.slice(-8);
    assert.ok(settled.every(s => Math.abs(s.y - s.desired) < 2), JSON.stringify(settled));
    assert.ok(Math.max(...samples.map(s => Math.abs(s.y - s.desired))) < 100, 'The active cue must not fly out of its viewport during reflow');
    toggles.push({ frames: samples.length, maxDeviation: Math.max(...samples.map(s => Math.abs(s.y - s.desired))) });
  }
  assert.equal(await page.locator('.lyrics-page .lyric-line-button').first().evaluate(el => getComputedStyle(el).fontSize), '48px');
  await page.locator('.lyrics-page .lyrics-scroll').evaluate(el => el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 100 })));
  await page.getByRole('button', { name: 'Resume following', exact: true }).waitFor();
  await click(page.getByRole('button', { name: 'File details', exact: true }));
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Resume following', exact: true }).waitFor();
  await click(page.getByRole('button', { name: 'Resume following', exact: true }));
  await page.waitForTimeout(900); await hidden();
  checks.push('Six sidebar open/close transitions with wrapping lyrics keep the active cue anchored; manual browsing and Resume following remain intact, font size unchanged');
  await selectMenu(page, 'Right sidebar view', 'lyrics');
  await page.waitForTimeout(1100);
  for (let i = 0; i < 2; i++) {
    await click(page.getByRole('button', { name: 'File details', exact: true })); await page.waitForTimeout(550);
    const frames = await sampleEntrance(page, '.mini-lyrics .lyrics-scroll', { button: 'button[aria-label="File details"]' });
    await writeFile(path.join(root, `mini-entry-${i}.json`), JSON.stringify(frames));
    entrances.push(assertEntrance(frames, 'Reopened sidebar lyrics'));
  }
  await page.screenshot({ path: path.join(root, 'lyrics.png'), animations: 'disabled' });
  checks.push('Repeated main-page and sidebar lyric entrances move smoothly from nearby context; no outer scrollbar/gutter or route-width changes; past/future/active colors differ');
  await route('/studio'); await page.locator('.studio-header').waitFor();
  const studio = await page.locator('.studio-header-actions').boundingBox();
  assert.ok(studio.x + studio.width < await page.evaluate(() => innerWidth - 130));
  await page.screenshot({ path: path.join(root, 'studio.png'), animations: 'disabled' });
  await hidden(); assert.deepEqual(errors, []); assert.deepEqual(external, []);
  const result = { packaged, versions, checks, decoders, titlebar, toggles, entrances, colors, errors, external };
  await writeFile(path.join(root, packaged ? 'packaged-results.json' : 'results.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await app?.close(); }
