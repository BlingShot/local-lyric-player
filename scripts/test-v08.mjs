import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { taggedWav } from './library-fixtures.mjs';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
const root = resolve(import.meta.dirname, '..'), output = `${root}/test-results/v08`;
await mkdir(output, { recursive: true });
const server = await createServer({ root, optimizeDeps: { include: ['music-metadata'] }, server: { port: 3018, host: '127.0.0.1', strictPort: true } });
let browser, page, phase = 'startup'; const errors = [], checks = [];
const fixture = "<tt xmlns=\"http://www.w3.org/ns/ttml\" xmlns:ttm=\"http://www.w3.org/ns/ttml#metadata\" xmlns:itunes=\"http://music.apple.com/lyric-ttml-internal\" itunes:timing=\"Word\"><head><metadata><ttm:agent xml:id=\"v1\"><ttm:name>A</ttm:name></ttm:agent><ttm:agent xml:id=\"v2\"><ttm:name>B</ttm:name></ttm:agent></metadata></head><body><div><p begin=\"30s\" end=\"40s\" ttm:agent=\"v1\"><span begin=\"30s\" end=\"30.06s\">First </span><span begin=\"30.06s\" end=\"40s\">voice stays inside its own column even with a very long lyric phrase</span><span ttm:role=\"x-translation\" xml:lang=\"zh-CN\">主歌词翻译</span><span ttm:role=\"x-bg\" begin=\"31s\" end=\"39s\" ttm:agent=\"v2\"><span begin=\"31s\" end=\"35s\">Backing </span><span begin=\"35s\" end=\"39s\">voice</span><span ttm:role=\"x-translation\" xml:lang=\"zh-CN\">子歌词翻译</span></span></p><p begin=\"30s\" end=\"40s\" ttm:agent=\"v2\"><span begin=\"30s\" end=\"35s\">Second </span><span begin=\"35s\" end=\"40s\">voice</span><span ttm:role=\"x-translation\">Second translation</span><span ttm:role=\"x-bg\" begin=\"31s\" end=\"39s\" ttm:agent=\"v1\"><span begin=\"31s\" end=\"39s\">Second backing</span><span ttm:role=\"x-translation\">Second backing translation</span></span></p><p begin=\"50s\" end=\"55s\" ttm:agent=\"v2\">Another singer</p></div></body></tt>";
const entry = { id: 2271785968561682, filename: '1715570295326-165106362-a7c22f4b.ttml', musicNames: ['瞬'], artistNames: ['郑润泽'], albumNames: ['瞬'], ncmMusicIds: ['2063864551'], isrcs: [], spotifyIds: [] };
try {
  await server.listen(); browser = await chromium.launch({ channel: 'msedge', headless: true }); page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'en-US' });
  page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('local-music-language', 'en');
    const values = {}, listeners = new Set(); window.__nativeCommands = [];
    let state = { id: '', time: 0, duration: 60, paused: true, ended: false, ready: false };
    const send = () => listeners.forEach(fn => fn({ ...state }));
    window.__advanceNative = time => { state.time = time; send(); };
    window.localMusicDesktop = {
      getConfig: async key => values[key], setConfig: async (key, value) => { values[key] = value; }, setWindowTheme: async () => {},
      getFont: async () => ({ kind: 'system' }), setFont: async () => {}, folderInfo: async () => ({}), configPath: async () => 'test',
      storageInfo: async () => ({ path: 'isolated-test', location: 'default', portable: false, canMove: false }),
      spotifyInfo: async () => ({ connected: true, clientId: 'a'.repeat(32) }), spotifyMatch: async () => ({ id: '6rh39M79viLf2jvH46f1GB', isrc: 'CNTEST230001' }),
      nativeAudioDevices: async () => [{ name: 'auto', description: 'System' }],
      nativeAudioLoad: async value => { if (window.__failNative) throw new Error('Device unavailable'); window.__nativeCommands.push(['load', value.bytes.byteLength, value.exclusive]); state = { id: value.id, time: 0, duration: 0, ready: false, paused: true, ended: false }; send(); await new Promise(resolve => setTimeout(resolve, 80)); state = { id: value.id, time: value.position, duration: 60, ready: true, paused: true, ended: false, exclusive: value.exclusive }; send(); },
      nativeAudioCommand: async (name, value) => { window.__nativeCommands.push([name, value]); if (name === 'seek') state.time = value; if (name === 'pause' || name === 'play') state.paused = name === 'pause'; if (name === 'stop') state = { ...state, id: '', ready: false, paused: true }; send(); },
      onNativeAudioState: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    };
  });
  let mode = 'missing'; const urls = [];
  await page.route('https://api.amll.dev/**', async route => {
    const url = new URL(route.request().url()); urls.push(url.href);
    if (mode === 'missing' || url.searchParams.has('isrc') || url.searchParams.has('spotifyId')) return route.fulfill({ status: 404, body: '{}' });
    if (url.pathname.endsWith('/search')) return route.fulfill({ json: { status: 200, data: { items: [entry, { ...entry, id: 8685727149514673, filename: '1711500730636-165106362-ac54097b.ttml' }], pagination: { hasMore: false } } } });
    assert.equal(url.searchParams.get('id'), String(entry.id));
    return route.fulfill({ json: { status: 200, data: { ...entry, format: 'ttml', lyrics: fixture } } });
  });
  await page.goto('http://127.0.0.1:3018/lyrics');
  const audio = taggedWav({ TIT2: '瞬', TPE1: '郑润泽', TALB: '瞬' }, [], '[00:30]Local fallback\n[00:55]', 60).toString('base64');
  await page.evaluate(async base64 => {
    const runtime = await import('/src/player/runtime.ts'); const { store } = await import('/src/store/store.ts');
    await runtime.importAudioFiles([new File([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], 'fixture.wav', { type: 'audio/wav', lastModified: 1 })]);
    runtime.getLocalPlayer().setVolume(0); runtime.playLocalTrack(store.getState().library.tracks[0].id); await runtime.getLocalAudioElement().play(); runtime.getLocalPlayer().pause();
  }, audio);
  await page.waitForFunction(() => document.querySelector('audio')?.duration === 60);
  phase = 'three-second status';
  await page.evaluate(() => window.dispatchEvent(new Event('spotify-session-updated')));
  const notice = page.getByText('AMLL has no matching TTML. Using local lyrics.', { exact: false });
  await notice.waitFor(); await page.waitForTimeout(1000); assert.ok(await notice.count());
  await notice.waitFor({ state: 'hidden', timeout: 4000 }); assert.ok(await page.getByText('Local fallback', { exact: true }).count());
  checks.push('Missing AMLL notice disappears after 3 seconds; local lyrics remain.');
  phase = 'metadata fallback'; mode = 'found';
  console.log('Parsed fixture', await page.evaluate(async source => { const { parseLyrics } = await import('/src/lyrics/parse.ts'); return parseLyrics(source, 'fixture.ttml').lines.length; }, fixture));
  if (process.env.AMLL_LIVE_TEST === '1') {
    const response = await fetch('https://api.amll.dev/v1/lyrics/get?id=2271785968561682&format=ttml', { signal: AbortSignal.timeout(20000) });
    assert.equal(response.status, 200); const real = (await response.json()).data;
    const realLines = await page.evaluate(async source => { const { parseLyrics } = await import('/src/lyrics/parse.ts'); return parseLyrics(source, 'real-amll.ttml').lines.length; }, real.lyrics);
    assert.ok(realLines > 10); checks.push('The real AMLL TTML for the supplied Spotify song parses successfully.');
  }
  await page.evaluate(() => window.dispatchEvent(new Event('spotify-session-updated')));
  await page.waitForFunction(() => document.querySelector('.lyric-text')?.textContent.includes('First'));
  assert.ok(urls.some(url => url.includes('spotifyId='))); assert.ok(urls.some(url => url.includes('/search?')));
  checks.push('ISRC -> Spotify ID -> exact title/artist selects the newest revision of the same recording.');

  phase = 'main-sidebar-fullscreen duet geometry';
  const setTime = async time => {
    await page.evaluate(time => { const audio = document.querySelector('audio'); audio.currentTime = time; audio.dispatchEvent(new Event('timeupdate')); }, time);
    await page.waitForTimeout(700);
  };
  const checkLanes = async (selector, label) => {
    const result = await page.locator(selector).evaluate(root => {
      const ol = root.querySelector('.lyrics-lines'), bounds = ol.getBoundingClientRect(), style = getComputedStyle(ol);
      const left = bounds.left + parseFloat(style.paddingLeft), right = bounds.right - parseFloat(style.paddingRight), middle = (left + right) / 2;
      const rows = [...root.querySelectorAll('.lyric-row[data-active]')].map(row => {
        const text = row.querySelector('.lyric-text'), annotation = row.querySelector('.lyric-annotation'), box = text.getBoundingClientRect(), ab = annotation?.getBoundingClientRect();
        const range = document.createRange(); range.selectNodeContents(text);
        return { group: row.dataset.vocalGroup, side: row.dataset.vocalSide, background: row.classList.contains('lyric-background'), left: box.left, right: box.right, annotationLeft: ab?.left, annotationRight: ab?.right, rects: [...range.getClientRects()].map(rect => ({ left: rect.left, right: rect.right })) };
      });
      return { left, right, middle, rows };
    });
    assert.equal(result.rows.filter(row => !row.background).length, 2, label + ': both singers remain active');
    for (const row of result.rows) {
      assert.ok(row.side === 'left' ? row.right <= result.middle - 5 : row.left >= result.middle + 5, label + ': lyric crossed the middle gutter');
      assert.ok(row.rects.every(rect => rect.left >= row.left - 1 && rect.right <= row.right + 1), label + ': long text overflowed its lane ' + JSON.stringify(row));
      if (row.annotationLeft !== undefined) {
        assert.ok(Math.abs(row.left - row.annotationLeft) < 1 && Math.abs(row.right - row.annotationRight) < 1, label + ': translation alignment');
      }
      if (row.background) {
        const parent = result.rows.find(other => !other.background && other.group === row.group);
        assert.equal(row.side, parent.side, label + ': background detached from parent');
        assert.ok(row.side === 'left' ? row.left > parent.left : row.right < parent.right, label + ': missing background indent');
      }
    }
  };
  await setTime(32); await checkLanes('.lyrics-page .lyrics-reader', 'main');
  await page.screenshot({ path: `${output}/duet-main.png` });
  await page.evaluate(async () => { const { store } = await import('/src/store/store.ts'); const { uiActions } = await import('/src/store/slices/offlineUi.ts'); store.dispatch(uiActions.setDetailsMode('lyrics')); if (!store.getState().ui.detailsOpen) store.dispatch(uiActions.toggleDetails()); });
  await page.waitForFunction(() => document.querySelectorAll('.lyrics-reader').length === 2); await setTime(32);
  await checkLanes('.mini-lyrics .lyrics-reader', 'sidebar'); await checkLanes('.lyrics-page .lyrics-reader', 'main with sidebar');
  await page.screenshot({ path: `${output}/duet-sidebar.png` });
  await setTime(52);
  assert.ok(await page.locator('.lyric-row[data-active]').evaluateAll(rows => rows.length === 2 && rows.every(row => row.dataset.vocalSide === 'left' && !row.hasAttribute('data-duet'))));
  await page.evaluate(async () => { const { store } = await import('/src/store/store.ts'); const { uiActions } = await import('/src/store/slices/offlineUi.ts'); store.dispatch(uiActions.toggleDetails()); });
  await page.locator('.lyrics-fullscreen-button').click(); await page.waitForFunction(() => document.querySelector('.offline-app[data-lyrics-fullscreen]'));
  await setTime(32); await checkLanes('.lyrics-page .lyrics-reader', 'fullscreen');
  const centered = await page.locator('.lyrics-page .lyrics-lines').evaluate(el => { const box = el.getBoundingClientRect(); return Math.abs((box.left + box.right) / 2 - innerWidth / 2) < 3; });
  assert.ok(centered, 'Fullscreen lanes are not centered in the viewport');
  await page.screenshot({ path: `${output}/duet-fullscreen.png` });
  await setTime(52);
  assert.equal(await page.locator('.lyrics-page .lyric-row[data-active]').getAttribute('data-vocal-side'), 'left');
  await page.locator('.lyrics-fullscreen-button').click(); await page.waitForFunction(() => !document.querySelector('.offline-app[data-lyrics-fullscreen]'));
  checks.push('Main, sidebar and fullscreen: simultaneous singers stay in bounded lanes, backing/translation geometry matches, and solo singer B returns left.');

  phase = 'settings and menus';
  await page.evaluate(async () => { const { store } = await import('/src/store/store.ts'); const { uiActions } = await import('/src/store/slices/offlineUi.ts'); store.dispatch(uiActions.setSettingsOpen(true)); });
  const dialog = page.getByRole('dialog'); await dialog.waitFor();
  await page.evaluate(async () => { const { setGlassSurface } = await import('/src/theme/surface.ts'); await setGlassSurface(true); });
  await dialog.getByRole('button', { name: 'Close', exact: true }).hover();
  const surface = await dialog.evaluate(root => {
    const close = root.querySelector('.ant-modal-close'), content = root.querySelector('.ant-modal-content');
    return { children: [...close.querySelectorAll('span')].map(el => ({ background: getComputedStyle(el).backgroundColor, shadow: getComputedStyle(el).boxShadow })), shadow: content && getComputedStyle(content).boxShadow, radius: content && getComputedStyle(content).borderRadius, nav: getComputedStyle(root.querySelector('.settings-navigation')).flexDirection };
  });
  assert.ok(surface.children.every(child => child.background === 'rgba(0, 0, 0, 0)' && child.shadow === 'none'));
  assert.equal(surface.nav, 'row'); assert.ok(!surface.shadow?.includes('inset'));
  await page.screenshot({ path: `${output}/settings-single-surface.png` });
  checks.push('Spotify-style settings use flat sections and horizontal chips; close hover and modal frame paint once.');
  assert.equal(await page.locator('select').count(), 0);
  await dialog.getByRole('combobox', { name: 'App theme', exact: true }).click();
  assert.ok(await page.locator('.app-menu [role=listbox]').count()); await page.keyboard.press('Escape');
  assert.ok(await dialog.isVisible());
  await dialog.locator('.settings-navigation').getByRole('button', { name: 'Lyrics', exact: true }).click();
  console.log('Lyric settings controls:', await dialog.locator('label:visible').allTextContents());
  await page.screenshot({ path: `${output}/settings-lyrics.png` });
  await dialog.getByLabel('Word-by-word highlighting', { exact: true }).uncheck();
  await dialog.getByLabel('Align lyrics by performer', { exact: true }).uncheck();
  await dialog.getByRole('slider', { name: 'Translation font size', exact: true }).focus(); await page.keyboard.press('Home');
  for (let i = 0; i < 16; i++) await page.keyboard.press('ArrowRight');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.evaluate(() => { const audio = document.querySelector('audio'); audio.currentTime = 32; audio.dispatchEvent(new Event('timeupdate')); });
  await page.waitForFunction(() => document.querySelector('.lyric-translation') && getComputedStyle(document.querySelector('.lyric-translation')).fontSize === '28px');
  assert.equal(await page.locator('.lyric-word').count(), 0);
  assert.ok(await page.locator('.lyric-line-button').evaluateAll(nodes => nodes.every(el => ['left', 'start'].includes(getComputedStyle(el).textAlign))));
  checks.push('Centered settings; unified dropdowns; font size and lyric toggles update main and background lyrics.');
  await page.evaluate(async () => { const { store } = await import('/src/store/store.ts'); const { uiActions } = await import('/src/store/slices/offlineUi.ts'); store.dispatch(uiActions.setDetailsMode('lyrics')); if (!store.getState().ui.detailsOpen) store.dispatch(uiActions.toggleDetails()); });
  await page.waitForFunction(() => document.querySelectorAll('.lyrics-reader').length === 2);
  assert.ok(await page.locator('.lyric-translation').evaluateAll(nodes => nodes.every(node => getComputedStyle(node).fontSize === '28px')));
  await page.evaluate(async () => { const { store } = await import('/src/store/store.ts'); const { uiActions } = await import('/src/store/slices/offlineUi.ts'); store.dispatch(uiActions.toggleDetails()); });
  phase = 'interlude progress';
  for (const [time, expected] of [[5, [0, 0, 0]], [10, [1, 0, 0]], [15, [1, 0, 0]], [20, [1, 1, 0]], [25, [1, 1, 0]], [30, [1, 1, 1]]]) {
    await page.evaluate(time => { const audio = document.querySelector('audio'); audio.currentTime = time; audio.dispatchEvent(new Event('timeupdate')); }, time);
    await page.waitForTimeout(100);
    const values = await page.locator('.lyric-dots[data-kind=intro]').first().locator('.lyric-dot').evaluateAll(nodes => nodes.map(node => Number(node.dataset.progress)));
    assert.deepEqual(values, expected);
  }
  assert.ok(await page.locator('.lyric-dot').first().evaluate(node => node.getBoundingClientRect().width) >= 20);
  checks.push('30-second intro lights three enlarged dots only at 10/20/30 seconds, including paused seeks.');
  phase = 'native renderer clock';
  await page.evaluate(() => { const audio = document.querySelector('audio'); audio.currentTime = 33; audio.dispatchEvent(new Event('timeupdate')); });
  await page.waitForTimeout(700);
  const scrollBeforeSwitch = await page.locator('.lyrics-page .lyrics-scroll').evaluate(node => node.scrollTop);
  await page.evaluate(async () => {
    window.__clockSamples = [];
    const { subscribeAudioClock } = await import('/src/lyrics/audioClock.ts');
    window.__stopClockCapture = subscribeAudioClock(clock => window.__clockSamples.push({ time: clock.time, duration: clock.duration }));
  });
  await page.evaluate(async () => { const { updateAudioOutput } = await import('/src/player/audioOutput.ts'); await updateAudioOutput({ device: 'auto', exclusive: true }); });
  assert.ok((await page.evaluate(() => window.__nativeCommands)).some(command => command[0] === 'load' && command[2] === true));
  await page.evaluate(async () => { const runtime = await import('/src/player/runtime.ts'); runtime.getLocalPlayer().seek(33); });
  await page.waitForFunction(() => Math.abs(document.querySelector('audio').currentTime - 33) < .1);
  assert.equal(await page.evaluate(() => document.querySelector('audio').duration), 60);
  await page.evaluate(async () => { const { updateAudioOutput } = await import('/src/player/audioOutput.ts'); await updateAudioOutput({ device: 'browser', exclusive: false }); });
  await page.waitForFunction(() => Math.abs(document.querySelector('audio').currentTime - 33) < .1);
  checks.push('Native bridge retains the shared lyric/Studio media clock and position when switching back to browser audio.');
  phase = 'failed device switch rollback';
  await page.evaluate(async () => { window.__failNative = true; const { updateAudioOutput } = await import('/src/player/audioOutput.ts'); await updateAudioOutput({ device: 'auto', exclusive: true }); window.__failNative = false; });
  assert.ok(await page.evaluate(() => Math.abs(document.querySelector('audio').currentTime - 33) < .1), 'Failed device switch lost the playback position');
  checks.push('A failed exclusive-device switch preserves the song and playback position.');
  await page.waitForTimeout(700);
  const samples = await page.evaluate(() => { window.__stopClockCapture(); return window.__clockSamples; });
  assert.ok(samples.length && samples.every(sample => sample.time >= 32.95 && sample.duration === 60), 'Output switching leaked a zero-time/zero-duration clock');
  assert.ok(Math.abs(await page.locator('.lyrics-page .lyrics-scroll').evaluate(node => node.scrollTop) - scrollBeforeSwitch) < 2, 'Output switching moved the lyrics');
  checks.push('Exclusive on/off and failed-device rollback never publish zero time and leave lyric scroll unchanged.');
  phase = 'recent library';
  await page.goto('http://127.0.0.1:3018/collection/recent');
  await page.locator('.offline-played-at time').waitFor();
  assert.ok((await page.locator('.offline-played-at time').first().getAttribute('datetime')).includes('T'));
  await page.screenshot({ path: `${output}/recently-played.png` }); checks.push('Recently played reuses the library table with a persisted sortable timestamp.');
  phase = 'return to playing track';
  const playingId = await page.evaluate(async () => { const { store } = await import('/src/store/store.ts'); const { libraryActions } = await import('/src/store/slices/library.ts'); const track = store.getState().library.tracks[0]; store.dispatch(libraryActions.addTracks(Array.from({ length: 90 }, (_, i) => ({ ...track, id: `placeholder-${i}`, name: `Older song ${i}`, addedAt: i, lastPlayedAt: 0 })))); return store.getState().player.currentId; });
  await page.locator('.offline-library-body a[href="/collection/tracks"]').first().click();
  await page.waitForTimeout(300);
  const playingBounds = await page.evaluate(id => { const box = document.querySelector(`[data-track-id="${CSS.escape(id)}"]`).getBoundingClientRect(); return { top: box.top, bottom: box.bottom, height: innerHeight }; }, playingId);
  assert.ok(playingBounds.top >= 0 && playingBounds.bottom < playingBounds.height - 50, `Playing track was not revealed: ${JSON.stringify(playingBounds)}`);
  checks.push('Returning to a long library automatically reveals the playing track.');
  phase = 'Studio';
  await page.goto('http://127.0.0.1:3018/studio');
  await page.getByRole('slider', { name: 'Studio volume', exact: true }).waitFor();
  const studio = await page.evaluate(async source => {
    const { importProjectTtml } = await import('/src/studio/projectImport.ts'); const { store } = await import('/src/store/store.ts'); const { uiActions } = await import('/src/store/slices/offlineUi.ts');
    store.dispatch(uiActions.setLyricsAppearance({ ...store.getState().ui.lyricsAppearance, translationSize: 28, wordByWord: false, performerAlignment: false }));
    const project = importProjectTtml(source, store.getState().player.currentId, 'fixture.ttml'); project.settings.preview = true; return project;
  }, fixture);
  await page.getByLabel('Choose studio project', { exact: true }).setInputFiles({ name: 'fixture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(studio)) });
  await page.getByRole('button', { name: 'Use imported project', exact: true }).click();
  await page.locator('.studio-preview-annotation[data-kind=translation]').first().waitFor({ state: 'attached' });
  assert.ok(await page.locator('.studio-preview-annotation[data-kind=translation]').evaluateAll(nodes => nodes.length >= 2 && nodes.every(node => getComputedStyle(node).fontSize === '28px')));
  assert.ok(await page.locator('.studio-preview-line[data-preview-line]').evaluateAll(nodes => nodes.every(node => ['left', 'start'].includes(getComputedStyle(node).textAlign))));
  checks.push('Main, sidebar and Studio preview all apply the same translation size to lead and backing vocals.');

  phase = 'parallel Studio word cursors';
  const parallel = await page.evaluate(async () => {
    const { newProject, vocalLine } = await import('/src/studio/project.ts'), { store } = await import('/src/store/store.ts'), { uiActions } = await import('/src/store/slices/offlineUi.ts');
    store.dispatch(uiActions.setLyricsAppearance({ ...store.getState().ui.lyricsAppearance, wordByWord: true, performerAlignment: true }));
    const project = newProject(store.getState().player.currentId, 'fixture.wav');
    const a = vocalLine('Alpha one'), b = vocalLine('Beta two'), bg = vocalLine('Echo ah', 'background', a.id), an = vocalLine('Alpha next'), bn = vocalLine('Beta next'), bgn = vocalLine('Echo next', 'background', an.id);
    for (const line of [a, an, bg, bgn]) line.performerId = 'A'; for (const line of [b,bn]) line.performerId = 'B';
    project.lines = [a, b, bg, an, bn, bgn]; project.selectedId = a.id; project.selectedUnitId = a.units.find(w => w.kind === 'word').id;
    project.performers = [{ id:'A',name:'Singer A',type:'person',color:'#fff',align:'auto' },{ id:'B',name:'Singer B',type:'person',color:'#fff',align:'auto' }];
    project.settings.preview = true; project.settings.mode = 'word'; return project;
  });
  await page.getByLabel('Choose studio project', { exact: true }).setInputFiles({ name:'parallel.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(parallel)) });
  await page.getByRole('button', { name: 'Use imported project', exact: true }).click();
  await page.getByRole('button', { name: 'TTML Studio', exact: true }).click();
  await page.locator('[data-voice-key="3"]').waitFor();
  await page.evaluate(async () => {
    const { updateAudioOutput } = await import('/src/player/audioOutput.ts'), runtime = await import('/src/player/runtime.ts');
    await updateAudioOutput({ device:'auto',exclusive:false }); window.__advanceNative(10); runtime.getLocalPlayer().play();
  });
  await page.waitForFunction(() => !document.querySelector('audio').paused);
  await page.locator('.studio-sync-context').click();
  for (let word = 0; word < 2; word++) {
    await page.evaluate(time => window.__advanceNative(time), 10 + word);
    for (const key of ['1','2','3']) await page.keyboard.down(key);
    assert.equal(await page.locator('.studio-voice-recorders button[aria-pressed=true]').count(),3);
    await page.evaluate(time => window.__advanceNative(time),10.6 + word);
    for (const key of ['1','2','3']) await page.keyboard.up(key);
  }
  assert.deepEqual(await page.locator('[data-voice-next]').allTextContents(), ['Alpha','Beta','Echo']);
  assert.equal(await page.locator('.studio-editor-lines .studio-word-panel').count(),0);
  assert.equal(await page.locator('.studio-editor-panel > .studio-word-panel[open]').count(),1);
  assert.equal(await page.locator('.studio-sync-row[data-sync-current]').getAttribute('data-line-id'),parallel.lines[3].id);
  await page.waitForFunction(() => document.querySelector('.studio-save-status')?.textContent === 'Draft saved');
  const recorded = await page.evaluate(async id => (await import('/src/studio/repository.ts')).readStudioDraft(id), parallel.trackId);
  assert.ok(recorded.lines.slice(0,3).every(line => line.units.filter(w => w.kind === 'word').every(w => w.startMs !== null && w.endMs > w.startMs)));
  assert.ok(await page.locator('.studio-line-text').first().evaluate(node => getComputedStyle(node).userSelect === 'text'));
  assert.ok(await page.locator('.studio-voice-name').first().evaluate(node => getComputedStyle(node).userSelect === 'none'));
  await page.screenshot({ path: `${output}/studio-independent-cursors.png` });
  checks.push('Studio records both leads and backing in one pass, advances each voice to its own next line, and retains a stable word editor. Text selection is disabled outside editors.');

  await page.getByRole('button', { name: 'Settings', exact: true }).click(); await dialog.waitFor();
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(200);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: `${output}/settings-mobile.png` });
  checks.push('Studio exposes shared volume and settings; settings fit a mobile viewport.');
  assert.deepEqual(errors, []); await writeFile(`${output}/results.json`, JSON.stringify({ passed: true, checks }, null, 2)); console.log(JSON.stringify({ passed: true, checks }, null, 2));
} catch (error) { await page?.screenshot({ path: `${output}/failure.png` }).catch(() => {}); console.error({ phase, errors, error: String(error), body: (await page?.locator('body').innerText().catch(() => '') || '').slice(0, 1800) }); throw error; }
finally { await browser?.close(); await server.close(); }
