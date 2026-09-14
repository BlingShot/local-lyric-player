import { selectMenu } from './select-menu.mjs';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { taggedWav, png } from './library-fixtures.mjs';

const port = 4179, origin = `http://127.0.0.1:${port}`;
const server = await preview({ preview: { host: '127.0.0.1', port, strictPort: true } });
const root = resolve('test-results/analysis'); await mkdir(root, { recursive: true });
const audioName = 'Embedded song.wav', audioPath = resolve(root, audioName);
const lyricText = '[00:00]A light in the dark\n[00:02]\n[00:15]We find our way\n[00:19]The final line';
const bytes = taggedWav({ TIT2: 'Same title', TPE1: 'Artist A', TALB: 'Local album' }, [{ type: 3, data: png(42, 110, 160) }], lyricText, 120);
await writeFile(audioPath, bytes);
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const errors = [], external = [], violations = [], checks = []; let phase = 'startup';
await context.route('**/*', route => {
  const url = new URL(route.request().url());
  if (url.origin !== origin) { external.push(url.href); return route.abort(); }
  if (url.pathname === '/__seed') return route.fulfill({ contentType: 'text/html', body: '<title>Isolated test seed</title>' });
  return route.continue();
});
await context.exposeBinding('recordAnalysisViolation', (_, value) => violations.push(value));
await context.addInitScript(() => {
  window.__audioCount = 0; const Audio = window.Audio;
  window.Audio = class extends Audio { constructor(...args) { super(...args); window.__audioCount++; } };
  document.addEventListener('securitypolicyviolation', event => window.recordAnalysisViolation(`${event.violatedDirective}: ${event.blockedURI}`));
});
const page = await context.newPage(); page.on('pageerror', error => errors.push(phase + ': ' + error.message));
const bar = () => page.getByRole('contentinfo', { name: 'Player', exact: true });
const readStore = name => page.evaluate(name => new Promise((resolve, reject) => {
  const request = indexedDB.open('local-music-library'); request.onerror = () => reject(request.error);
  request.onsuccess = () => { const db = request.result, tx = db.transaction(name), get = tx.objectStore(name).getAll(); tx.oncomplete = () => { resolve(get.result); db.close(); }; tx.onabort = () => reject(tx.error); };
}), name);
const updateStore = (name, key, value) => page.evaluate(({ name, key, value }) => new Promise((resolve, reject) => {
  const request = indexedDB.open('local-music-library'); request.onerror = () => reject(request.error);
  request.onsuccess = () => { const db = request.result, tx = db.transaction(name, 'readwrite'); tx.objectStore(name).put(value, key); tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => reject(tx.error); };
}), { name, key, value });
const refreshAnalysis = () => page.evaluate(() => window.dispatchEvent(new CustomEvent('local-analysis-updated', { detail: 'legacy-a' })));
const seek = async value => {
  await page.getByRole('slider', { name: 'Playback progress', exact: true }).evaluate((input, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  await page.waitForFunction(value => Math.abs(document.querySelector('audio').currentTime - value) < .2, value);
};
const draftSaved = () => page.locator('.studio-save-status').filter({ hasText: 'Draft saved' }).waitFor();
try {
  await page.goto(origin + '/__seed');
  await page.evaluate(({ audio, audioName }) => new Promise((resolve, reject) => {
    const request = indexedDB.open('local-music-library', 2);
    request.onupgradeneeded = () => ['tracks', 'audio', 'covers', 'settings', 'playlists', 'lyrics'].forEach(name => request.result.createObjectStore(name));
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction(['tracks', 'audio', 'settings', 'playlists'], 'readwrite');
      const blob = new Blob([Uint8Array.from(atob(audio), char => char.charCodeAt(0))], { type: 'audio/wav' });
      tx.objectStore('tracks').put({ id: 'legacy-a', name: 'Same title', artist: 'Artist A', album: 'Local album', fileName: audioName, size: blob.size, lastModified: 1, addedAt: 2 }, 'legacy-a');
      tx.objectStore('audio').put(blob, 'legacy-a');
      tx.objectStore('tracks').put({ id: 'legacy-b', name: 'Same title', artist: 'Artist B', fileName: 'other.wav', size: blob.size, lastModified: 1, addedAt: 3, duration: 120, durationChecked: true, embeddedLyricsChecked: true }, 'legacy-b');
      tx.objectStore('audio').put(blob, 'legacy-b');
      tx.objectStore('settings').put({ volume: .35, shuffle: false, repeat: 'off' }, 'playback');
      tx.objectStore('settings').put({ trackId: 'legacy-a', audioName, selectedId: 'blank', updatedAt: 1, lines: [{ id: 'blank', text: '', start: '', end: '' }] }, 'lyric-studio:legacy-a');
      tx.objectStore('playlists').put({ id: 'old-list', name: 'Preserved playlist', trackIds: ['legacy-a', 'legacy-b'] }, 'old-list');
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => reject(tx.error);
    };
  }), { audio: bytes.toString('base64'), audioName });
  await page.goto(origin); await page.locator('.offline-track-name').nth(1).waitFor();
  await page.waitForFunction(() => document.querySelector('.offline-track-name small')?.textContent === 'Artist A');
  const stores = await page.evaluate(() => new Promise(resolve => { const open = indexedDB.open('local-music-library'); open.onsuccess = () => { resolve({ version: open.result.version, names: [...open.result.objectStoreNames] }); open.result.close(); }; }));
  assert.equal(stores.version, 4); assert.ok(stores.names.includes('analysis') && stores.names.includes('analysis-edits') && stores.names.includes('analysis-tasks'));
  assert.equal((await readStore('playlists'))[0].name, 'Preserved playlist'); assert.equal((await readStore('tracks')).length, 2);
  checks.push('v2 upgrades to v4 without losing audio, song records, settings, playlists or the existing empty Studio draft');

  phase = 'scaffold and nonplaying song binding';
  await page.locator('.offline-track-name').first().click(); await bar().getByRole('button', { name: 'Pause', exact: true }).waitFor();
  await page.evaluate(() => { window.__firstAudio = document.querySelector('audio'); window.__originalSrc = window.__firstAudio.src; });
  await page.locator('.offline-track-name').nth(1).click({ button: 'right' }); await page.getByRole('menuitem', { name: 'Analyze', exact: true }).click();
  await page.getByRole('heading', { name: 'Lyrics Insights', exact: true }).waitFor(); assert.match(page.url(), /legacy-b$/);
  assert.equal(await page.locator('.analysis-header p').last().textContent(), 'Artist B');
  await page.getByText('No lyrics for this song.', { exact: false }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Run analysis', exact: true }).count(), 1);
  assert.equal(await page.getByRole('heading', { name: 'Metadata', exact: true }).count(), 0);
  for (const button of await page.getByRole('button', { name: 'Run analysis', exact: true }).all()) assert.equal(await button.isDisabled(), true);
  assert.equal((await readStore('analysis')).length, 0);
  assert.equal(await page.evaluate(() => document.querySelector('audio') === window.__firstAudio && !window.__firstAudio.paused && window.__firstAudio.src === window.__originalSrc), true);
  await page.screenshot({ path: resolve(root, 'empty-desktop.png') });
  checks.push('right-click Analyze binds the clicked stable ID even for identical titles; unimplemented modules remain disabled while audio analysis starts empty; entering does not select another song, run an analyzer or interrupt audio');

  phase = 'details entry and actual lyrics';
  await bar().getByRole('button', { name: 'File details', exact: true }).click();
  await page.getByRole('link', { name: 'Analyze', exact: true }).click();
  await page.getByLabel('Lyric source', { exact: true }).waitFor(); assert.match(page.url(), /legacy-a$/);
  await page.locator('.analysis-lyrics-source summary').click(); assert.equal(await page.locator('.analysis-lyrics-source li').first().textContent(), 'A light in the dark');
  await bar().getByRole('button', { name: 'File details', exact: true }).click();
  await bar().getByRole('button', { name: 'Pause', exact: true }).click();

  phase = 'embedded auto-import, new shortcuts and protected edits';
  await page.getByRole('link', { name: 'Open lyrics in Studio', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Lyrics line 1"]')?.value === 'A light in the dark'); await draftSaved();
  assert.equal(await page.getByLabel('Start time line 2', { exact: true }).inputValue(), '00:15.000');
  await seek(1); await page.locator('.studio-row[data-playing]').waitFor();
  assert.equal(await page.locator('.studio-row[data-playing] textarea').inputValue(), 'A light in the dark');
  await seek(5); await page.locator('.studio-interlude[data-playing]').waitFor(); assert.equal(await page.locator('.studio-row[data-playing]').count(), 0);
  await seek(15); await page.locator('.studio-row[data-playing]').waitFor(); assert.equal(await page.locator('.studio-interlude[data-playing]').count(), 0);
  await page.getByRole('button', { name: 'Select line 2', exact: true }).click(); await page.keyboard.press('ArrowUp');
  assert.equal(await page.getByRole('button', { name: 'Select line 1', exact: true }).getAttribute('aria-pressed'), 'true');
  await seek(1); await page.getByRole('button', { name: 'Select line 1', exact: true }).focus(); await page.keyboard.press('ArrowDown');
  assert.equal(await page.getByLabel('Start time line 1', { exact: true }).inputValue(), '00:01.000');
  assert.equal(await page.getByRole('button', { name: 'Select line 2', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.getByLabel('Lyrics line 2', { exact: true }).fill('My edited line'); await page.keyboard.press('ArrowDown');
  assert.equal(await page.getByLabel('Start time line 2', { exact: true }).inputValue(), '00:15.000'); await draftSaved();
  await page.reload(); await page.getByLabel('Lyrics line 2', { exact: true }).waitFor(); assert.equal(await page.getByLabel('Lyrics line 2', { exact: true }).inputValue(), 'My edited line');
  await draftSaved();
  checks.push('an empty migrated Studio draft automatically loads actual embedded LRC and its timestamps; ArrowDown marks actual time and ArrowUp goes back; typing is not hijacked, and edited drafts survive reload without being overwritten');
  checks.push('Studio frames the lyric at actual media time independently of the selected editing row; at its explicit end only the interlude frame becomes active, and the next start restores lyric framing');

  phase = 'day and night appearance';
  await page.getByRole('button', { name: 'Open app menu', exact: true }).click(); await page.getByRole('menuitem', { name: 'Day mode', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  await page.getByRole('menu').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.studio-main').evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(255, 255, 255)');
  await page.screenshot({ path: resolve(root, 'studio-day.png') });
  await page.reload(); await page.getByLabel('Lyrics line 2', { exact: true }).waitFor();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  await page.getByRole('link', { name: 'Back to player', exact: true }).click();
  assert.equal(await page.getByRole('heading', { name: 'Local library', exact: true }).evaluate(element => getComputedStyle(element).color), 'rgb(32, 33, 36)');
  assert.equal(await page.locator('.offline-search').evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(229, 232, 236)');
  await page.screenshot({ path: resolve(root, 'library-day.png') });
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
  await selectMenu(page, 'App theme', 'dark');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.getByRole('dialog', { name: 'Settings', exact: true }).getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('dialog', { name: 'Settings', exact: true }).waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Open app menu', exact: true }).click(); await page.getByRole('menuitem', { name: 'Lyric Studio', exact: true }).click();
  await page.getByLabel('Lyrics line 2', { exact: true }).waitFor();
  checks.push('Day/Night switches through the app menu and Settings, updates Studio and player surfaces, persists on refresh and keeps the same singleton audio');

  phase = 'lyrics Studio entry, SVG identity and interlude highlight';
  await page.getByRole('link', { name: 'Back to player', exact: true }).click(); await bar().getByRole('button', { name: 'Lyrics', exact: true }).click();
  await page.getByRole('link', { name: 'Lyric Studio', exact: true }).waitFor(); assert.equal(await page.getByRole('button', { name: 'Replace lyrics', exact: true }).count(), 0);
  assert.match(await page.locator('.offline-brand img').getAttribute('src'), /app-logo\.svg$/);
  assert.match(await page.locator('link[rel=icon]').getAttribute('href'), /app-logo\.svg$/);
  await seek(1); assert.equal(await page.locator('.lyric-interlude[data-active]').count(), 0);
  await seek(5); await page.locator('.lyric-interlude[data-active]').waitFor();
  assert.equal(await page.locator('.lyric-row[data-active]').count(), 0);
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.lyric-interlude[data-active]')).color === 'rgb(255, 255, 255)');
  await seek(16); assert.equal(await page.locator('.lyric-interlude[data-active]').count(), 0); assert.equal(await page.locator('.lyric-interlude[data-past]').count(), 1);
  await seek(6); await page.locator('.lyric-interlude[data-active]').waitFor();
  await page.getByRole('link', { name: 'Lyric Studio', exact: true }).click(); assert.match(page.url(), /trackId=legacy-a/);
  await page.getByLabel('Lyrics line 2', { exact: true }).waitFor(); assert.equal(await page.getByLabel('Lyrics line 2', { exact: true }).inputValue(), 'My edited line');
  await page.getByRole('button', { name: 'Open app menu', exact: true }).click(); await page.getByRole('menuitem', { name: 'Music player', exact: true }).click();
  checks.push('the lyrics header opens the bound Studio while the original app menu remains; the app and favicon share a local SVG; a >10s explicit break lights its note only during its real window and seeking backward restores it');

  phase = 'persistent results, evidence and stale versions';
  await page.locator('.offline-track-name').first().click({ button: 'right' }); await page.getByRole('menuitem', { name: 'Analyze', exact: true }).click();
  await page.getByLabel('Lyric source', { exact: true }).waitFor();
  const draft = (await readStore('settings')).find(item => item?.trackId === 'legacy-a' && item.lines);
  const lyricHash = createHash('sha256').update(JSON.stringify(draft.lines.map(line => line.text))).digest('hex');
  const track = (await readStore('tracks')).find(item => item.id === 'legacy-a');
  const revision = track.audioRevision || JSON.stringify([track.id, track.size, track.lastModified, track.addedAt]);
  const base = { schemaVersion: 1, trackId: track.id, analyzedAt: Date.now(), algorithm: { id: 'browser-fixture-only', name: 'Test output fixture', version: '1' }, settings: {} };
  const record = { ...base, kind: 'lyrics', input: { lyrics: { kind: 'studio', fingerprint: lyricHash } }, result: { interpretation: 'A possible interpretation supported by the supplied lyric.', themes: [{ name: 'Light', reason: 'The line contrasts light and dark.', evidence: [{ lineId: draft.lines[0].id, quote: 'light in the dark' }] }], moods: ['Reflective'], advisory: [], basis: 'lyrics-text-only', authorIntent: 'interpretation', advisorySource: 'ai' } };
  await updateStore('analysis', [track.id, 'lyrics'], record);
  await updateStore('analysis', [track.id, 'bpm-key'], { ...base, kind: 'bpm-key', input: { audio: { [track.id]: revision } }, result: { bpm: 123, tonic: 'C', mode: 'major' } });
  await updateStore('analysis-edits', track.id, { trackId: track.id, updatedAt: Date.now(), bpm: { value: 61.5, source: 'manual', sourceVersion: revision, updatedAt: Date.now() } });
  await refreshAnalysis(); await page.getByRole('button', { name: '“light in the dark”', exact: true }).click();
  await page.locator('.analysis-evidence-selected').waitFor(); assert.equal(await page.locator('.analysis-evidence-selected').textContent(), draft.lines[0].text);
  await page.reload(); await page.getByText('User correction', { exact: true }).waitFor();
  assert.match(await page.getByRole('region', { name: 'BPM analysis', exact: true }).textContent(), /61.5/); assert.equal((await readStore('analysis')).find(item => item.kind === 'bpm-key').result.bpm, 123);
  await page.getByRole('link', { name: 'Open lyrics in Studio', exact: true }).click();
  await page.getByLabel('Lyrics line 1', { exact: true }).fill('Changed lyric text'); await draftSaved();
  await page.getByRole('link', { name: 'Back to player', exact: true }).click();
  await page.locator('.offline-track-name').first().click({ button: 'right' }); await page.getByRole('menuitem', { name: 'Analyze', exact: true }).click();
  await page.getByText('The lyrics or selected lyric source changed.', { exact: false }).waitFor();
  await updateStore('tracks', track.id, { ...(await readStore('tracks')).find(item => item.id === track.id), audioRevision: 'replacement-version' });
  await page.reload(); await page.getByText('The audio or analysis parameters changed.', { exact: false }).waitFor();
  assert.equal((await readStore('analysis')).length, 2);
  checks.push('separate stable-ID result and correction stores survive refresh; evidence locates actual text; changing a Studio draft or audio revision marks only the relevant results stale without automatic reruns');

  phase = 'responsive and unavailable data';
  await page.getByRole('button', { name: 'Open app menu', exact: true }).click(); await page.getByRole('menuitem', { name: 'Day mode', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  await page.getByRole('menu').waitFor({ state: 'hidden' });
  for (const width of [1440, 850, 390, 320]) {
    await page.setViewportSize({ width, height: 950 });
    await page.waitForFunction(() => document.documentElement.scrollWidth <= window.innerWidth);
    assert.ok(await page.locator('.analysis-page').evaluate(element => element.scrollWidth <= element.clientWidth));
    await page.screenshot({ path: resolve(root, `analysis-${width}.png`) });
  }
  await page.goto(origin + '/analyze/missing-record'); await page.getByRole('heading', { name: 'Song unavailable', exact: true }).waitFor();
  assert.equal(createHash('sha256').update(await readFile(audioPath)).digest('hex'), createHash('sha256').update(bytes).digest('hex'));
  assert.equal(await page.evaluate(() => window.__audioCount), 1);
  assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(violations, []);
  checks.push('Analyze fits desktop/tablet/mobile with table-local overflow only; removed song IDs show a clear empty state; all pages remain local with one Audio per app and unchanged original audio');
  const report = { result: 'passed', checks, errors, external, violations };
  await writeFile(resolve(root, 'analysis.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} catch (error) { console.error(JSON.stringify({ phase, errors, external, violations })); await page.screenshot({ path: resolve(root, 'failure.png') }).catch(() => {}); throw error; }
finally { await context.close(); await browser.close(); await new Promise(resolve => server.httpServer.close(resolve)); }
