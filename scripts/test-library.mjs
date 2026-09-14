import { selectMenu } from './select-menu.mjs';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { wav, png, taggedWav } from './library-fixtures.mjs';

const development = process.argv.includes('--dev');
const origin = development ? 'http://127.0.0.1:3000' : 'http://127.0.0.1:4174';
const server = development ? null : await preview({ preview: { host: '127.0.0.1', port: 4174, strictPort: true } });
let browser, phase = 'startup';
const errors = [], external = [], checks = [], violations = [];
const hash = data => createHash('sha256').update(data).digest('hex');
await mkdir('test-results/fixtures/library', { recursive: true });
const root = resolve('test-results/fixtures/library');
const common = { TALB: 'Shared record', TPE2: 'Ensemble', TDRC: '2024-02-03' };
const fixtures = [
  ['late.wav', taggedWav({ ...common, TIT2: 'Disc two', TPE1: 'Third singer', TRCK: '1/12', TPOS: '2/2' })],
  ['second.wav', taggedWav({ ...common, TIT2: 'Second song', TPE1: 'Second singer', TRCK: '2/12', TPOS: '1/2' }, [{ type: 4, data: png(255, 0, 0) }, { type: 3, data: png(0, 255, 0) }])],
  ['other.wav', taggedWav({ ...common, TPE2: 'Other ensemble', TIT2: 'Other artist record', TPE1: 'Other singer', TRCK: '1/10' })],
  ['first.wav', taggedWav({ ...common, TIT2: 'First song', TPE1: 'First singer', TRCK: '1/12', TPOS: '1/2' })],
  ['mix-one.wav', taggedWav({ TALB: 'Compilation', TIT2: 'Mix one', TPE1: 'Solo one', TCMP: '1', TRCK: '1/20' })],
  ['mix-two.wav', taggedWav({ TALB: 'Compilation', TIT2: 'Mix two', TPE1: 'Solo two', TCMP: '1', TRCK: '2/20' })],
  ['untagged.wav', wav()],
];
for (const [name, bytes] of fixtures) await writeFile(resolve(root, name), bytes);
await writeFile(resolve(root, 'cover.png'), png(0, 0, 255));

try {
  browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin !== origin) { external.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  await context.exposeBinding('recordViolation', (_, text) => violations.push(phase + ': ' + text));
  await context.addInitScript(() => {
    window.__audioCount = 0;
    const Audio = window.Audio;
    window.Audio = class extends Audio { constructor(...args) { super(...args); window.__audioCount++; } };
    document.addEventListener('securitypolicyviolation', event => window.recordViolation(event.violatedDirective + ': ' + event.blockedURI));
  });
  context.on('page', page => {
    page.on('pageerror', error => errors.push(phase + ': ' + error.message));
    page.on('console', message => { if (['error', 'warning'].includes(message.type())) errors.push(phase + ': ' + message.text()); });
  });
  let page = await context.newPage();
  const bar = () => page.getByRole('contentinfo', { name: 'Player', exact: true });
  const libraryReady = () => page.waitForFunction(() => !document.querySelector('.offline-storage-busy'));
  const readStore = name => page.evaluate(name => new Promise((resolve, reject) => {
    const open = indexedDB.open('local-music-library');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction(name), request = tx.objectStore(name).getAll();
      request.onsuccess = () => resolve(request.result); tx.oncomplete = () => db.close();
    };
  }), name);
  const mutate = change => page.evaluate(change => new Promise((resolve, reject) => {
    const open = indexedDB.open('local-music-library');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction(change.store, 'readwrite'), store = tx.objectStore(change.store);
      if (change.remove) store.delete(change.key); else store.put(change.value, change.key);
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => reject(tx.error);
    };
  }), change);
  const setRange = (label, value) => page.getByRole('slider', { name: label, exact: true }).evaluate((element, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, String(value));
    element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  const waitPlaying = async name => {
    await bar().getByText(name, { exact: true }).waitFor();
    await page.waitForFunction(() => { const audio = document.querySelector('audio'); return !audio.paused && audio.currentTime > .05 && audio.readyState >= 2; });
  };
  const importFiles = async names => {
    await page.getByRole('button', { name: 'Import music', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Import local music', exact: true });
    await dialog.getByLabel('Choose audio files', { exact: true }).setInputFiles(names.map(name => resolve(root, name)));
    await dialog.getByRole('status').filter({ hasText: `Added ${names.length} files` }).waitFor();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
  };
  await page.goto(origin);
  await page.getByRole('heading', { name: 'Your library is empty' }).last().waitFor();
  phase = 'embedded tags';
  await importFiles(fixtures.map(([name]) => name));
  assert.equal(await page.locator('tbody tr').count(), 7);
  assert.deepEqual(await page.locator('tbody td.offline-duration').allTextContents(), Array(7).fill('0:08'), 'Durations are read during import, before playback');
  await page.getByRole('button', { name: 'Edit Second song', exact: true }).click();
  const editor = () => page.getByRole('dialog', { name: 'Edit details', exact: true });
  for (const [label, value] of [['Title', 'Second song'], ['Track artist', 'Second singer'], ['Album', 'Shared record'], ['Album artist', 'Ensemble'], ['Track number', '2'], ['Disc number', '1'], ['Release date', '2024-02-03']]) {
    assert.equal(await editor().getByLabel(label, { exact: true }).inputValue(), value);
  }
  assert.equal(await editor().getByLabel('Local cover image', { exact: true }).isDisabled(), true);
  await editor().getByRole('button', { name: 'Close', exact: true }).click();
  const pixel = await page.getByRole('button', { name: 'Second song Second singer', exact: true }).locator('img').evaluate(async image => {
    await image.decode(); const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data];
  });
  assert.deepEqual(pixel, [0, 255, 0, 255], 'Front cover must win over the earlier back cover');
  checks.push('embedded title, track/album artist, album, date, disc/track numbers and front-cover priority');

  phase = 'Excel-style column resizing';
  const header = page.locator('th[data-column=title]');
  const originalWidth = (await header.boundingBox()).width;
  const separator = page.getByRole('separator', { name: 'Resize Title column', exact: true });
  await separator.hover();
  assert.deepEqual(await separator.evaluate(element => ({ background: getComputedStyle(element).backgroundColor, outline: getComputedStyle(element).outlineStyle })),
    { background: 'rgba(0, 0, 0, 0)', outline: 'none' });
  const bounds = await separator.boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width / 2 + 180, bounds.y + bounds.height / 2, { steps: 8 }); await page.mouse.up();
  assert.ok(Math.abs((await header.boundingBox()).width - originalWidth - 180) < 3);
  assert.ok(await page.getByRole('region', { name: 'Scrollable tracks', exact: true }).evaluate(element => element.scrollWidth > element.clientWidth));
  await separator.focus(); await page.keyboard.press('ArrowRight');
  assert.ok(Math.abs((await header.boundingBox()).width - originalWidth - 200) < 3);
  await separator.dblclick();
  const fittedLayout = await page.getByRole('table', { name: 'Tracks', exact: true }).evaluate(table => ({
    columns: [...table.rows[0].cells].map(cell => cell.getBoundingClientRect().width), width: table.getBoundingClientRect().width,
    container: table.parentElement.clientWidth, style: table.getAttribute('style'),
  }));
  assert.ok((await header.boundingBox()).width < originalWidth, JSON.stringify({ originalWidth, fittedLayout }));
  assert.ok(Math.abs(fittedLayout.width - fittedLayout.container) < 2, 'Double-click fitting keeps the table full width');
  assert.equal(fittedLayout.columns[0], 42, 'Row numbers do not stretch');
  assert.equal(fittedLayout.columns.at(-1), 76, 'Action buttons stay at their fixed width');
  await page.screenshot({ path: 'test-results/library-fitted-columns.png' });
  await page.getByRole('button', { name: 'Reset column widths', exact: true }).click();
  assert.ok(Math.abs((await header.boundingBox()).width - originalWidth) < 3);
  await separator.focus(); await page.keyboard.press('ArrowRight');
  await page.reload(); await page.getByRole('button', { name: 'Second song Second singer', exact: true }).waitFor();
  assert.ok(Math.abs((await header.boundingBox()).width - originalWidth - 20) < 3, 'Column width survives reload');
  await page.getByRole('button', { name: 'Reset column widths', exact: true }).click();
  checks.push('Excel-style header dragging, horizontal scrolling, keyboard resizing, double-click fit, reset and persisted column widths');

  phase = 'local search';
  const search = page.getByRole('textbox', { name: 'Search local music', exact: true });
  for (const [query, count] of [['Ensemble', 4], ['second singer', 1], ['Shared record', 4], ['second.wav', 1], ['missing query', 0]]) {
    await search.fill(query);
    await page.waitForFunction(count => document.querySelectorAll('tbody tr').length === count, count);
  }
  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await page.getByRole('link', { name: 'Albums', exact: true }).click();
  await page.locator('.offline-album-card').first().waitFor();
  assert.equal(await page.locator('.offline-album-card').count(), 4);
  await page.screenshot({ path: 'test-results/library-albums.png' });
  await page.getByRole('link', { name: 'Open album Shared record by Ensemble', exact: true }).click();
  assert.deepEqual(await page.locator('tbody .offline-track-name strong').allTextContents(), ['First song', 'Second song', 'Disc two']);
  await page.getByText('3 imported tracks', { exact: true }).waitFor();
  assert.equal(await page.getByText('12 imported tracks', { exact: true }).count(), 0);
  checks.push('local multi-field search; same-title albums remain separate, compilation performers stay together, imported counts and disc ordering');

  phase = 'album playback';
  await page.getByRole('button', { name: 'Play album', exact: true }).click(); await waitPlaying('First song');
  await page.evaluate(() => window.__firstAudio = document.querySelector('audio'));
  await bar().getByRole('button', { name: 'Next', exact: true }).click(); await waitPlaying('Second song');
  await setRange('Playback progress', 7.8); await waitPlaying('Disc two');
  await setRange('Playback progress', 7.8); await bar().getByText('Playback ended', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'First song First singer', exact: true }).click(); await waitPlaying('First song');
  await page.getByRole('link', { name: 'Albums', exact: true }).click();
  assert.equal(await page.evaluate(() => document.querySelector('audio') === window.__firstAudio && window.__audioCount === 1 && !window.__firstAudio.paused), true);
  await bar().getByRole('button', { name: 'Playback queue', exact: true }).click();
  const queue = page.getByRole('dialog', { name: 'Playback queue', exact: true });
  assert.equal(await queue.locator('li').count(), 3);
  await queue.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await page.getByRole('button', { name: 'Mix one Solo one', exact: true }).click(); await waitPlaying('Mix one');
  await bar().getByRole('button', { name: 'Playback queue', exact: true }).click();
  assert.equal(await queue.locator('li').count(), 7);
  await queue.getByRole('button', { name: 'Close', exact: true }).click();
  await bar().getByRole('button', { name: 'Pause', exact: true }).click();
  await setRange('Volume', .42);
  await page.waitForFunction(() => document.querySelector('audio')?.volume === .42);
  await bar().getByRole('button', { name: 'Shuffle', exact: true }).click();
  await bar().getByRole('button', { name: 'Repeat: Off', exact: true }).click();
  await page.waitForFunction(() => new Promise(resolve => {
    const request = indexedDB.open('local-music-library'); request.onsuccess = () => {
      const db = request.result, tx = db.transaction('settings'), read = tx.objectStore('settings').get('playback');
      read.onsuccess = () => resolve(read.result?.volume === .42 && read.result?.shuffle && read.result?.repeat === 'all'); tx.oncomplete = () => db.close();
    };
  }));
  checks.push('album-only continuous playback and single-track selection; route changes keep one audio; library play restores the complete queue');

  phase = 'durable copies and settings';
  const records = await readStore('tracks');
  assert.equal(records.some(track => 'coverUrl' in track), false);
  const storedHashes = await page.evaluate(async () => {
    const db = await new Promise(resolve => { const open = indexedDB.open('local-music-library'); open.onsuccess = () => resolve(open.result); });
    const blobs = await new Promise(resolve => { const read = db.transaction('audio').objectStore('audio').getAll(); read.onsuccess = () => resolve(read.result); });
    db.close();
    return Promise.all(blobs.map(async blob => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), b => b.toString(16).padStart(2, '0')).join('')));
  });
  assert.deepEqual(storedHashes.sort(), fixtures.map(([, bytes]) => hash(bytes)).sort());
  const firstRecord = records.find(track => track.name === 'First song');
  assert.equal(firstRecord.duration, 8);
  const playlist = { id: 'saved-list', name: 'Existing local playlist', trackIds: [firstRecord.id, records.find(track => track.name === 'Second song').id] };
  await mutate({ store: 'playlists', key: playlist.id, value: playlist });
  assert.equal((await readStore('settings')).find(value => value && typeof value.volume === 'number')?.volume, .42, 'Volume is committed before reload.');
  await page.reload(); await page.getByRole('button', { name: 'First song First singer', exact: true }).waitFor(); await libraryReady();
  assert.equal(await page.locator('tbody tr').count(), 7);
  // Native volumechange arrives after library records render; wait for the restored media state.
  await page.waitForFunction(() => document.querySelector('audio')?.volume === .42 && document.querySelector('input[aria-label="Volume"]')?.value === '0.42');
  assert.equal((await readStore('settings')).find(value => value && typeof value.volume === 'number')?.volume, .42, 'Restoring a song does not overwrite the saved volume.');
  assert.equal(await page.getByRole('slider', { name: 'Volume', exact: true }).inputValue(), '0.42');
  assert.equal(await bar().getByRole('button', { name: 'Shuffle', exact: true }).getAttribute('aria-pressed'), 'true');
  await bar().getByRole('button', { name: 'Repeat: All', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.querySelector('audio').paused), true);
  assert.deepEqual(await readStore('playlists'), [playlist]);
  // Upgrade a pre-duration record without asking the user to re-import or overwriting edited tags.
  const oldRecord = { ...firstRecord, name: 'Preserved manual title' };
  delete oldRecord.duration; delete oldRecord.durationChecked;
  await mutate({ store: 'tracks', key: firstRecord.id, value: oldRecord });
  await page.reload();
  await page.getByRole('button', { name: 'Preserved manual title First singer', exact: true }).waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('tbody tr')].some(row => row.textContent.includes('Preserved manual title') && row.querySelector('.offline-duration').textContent === '0:08'));
  assert.equal((await readStore('tracks')).find(track => track.id === firstRecord.id).duration, 8);
  await mutate({ store: 'tracks', key: firstRecord.id, value: firstRecord });
  await page.close(); page = await context.newPage(); await page.goto(origin);
  await page.getByRole('button', { name: 'First song First singer', exact: true }).waitFor();
  await page.getByRole('button', { name: 'First song First singer', exact: true }).click(); await waitPlaying('First song');
  await bar().getByRole('button', { name: 'Pause', exact: true }).click();
  checks.push('audio bytes saved intact in IndexedDB; metadata, artwork, volume/shuffle/repeat and existing playlist records survive refresh and tab reopening without autoplay');
  checks.push('import-time durations persist, and older saved tracks receive missing durations without changing manual tags or creating another audio element');

  phase = 'manual tags and local cover';
  await page.getByRole('button', { name: 'Edit untagged.wav', exact: true }).click();
  await editor().getByLabel('Title', { exact: true }).fill('Renamed locally');
  await editor().getByLabel('Album', { exact: true }).fill('Shared record');
  await editor().getByLabel('Album artist', { exact: true }).fill('Ensemble');
  await editor().getByLabel('Release date', { exact: true }).fill('2024');
  await editor().getByLabel('Track number', { exact: true }).fill('3');
  await editor().getByLabel('Local cover image', { exact: true }).setInputFiles(resolve(root, 'cover.png'));
  await editor().getByRole('button', { name: 'Save details', exact: true }).click();
  await editor().waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Renamed locally Local file', exact: true }).waitFor();
  await page.reload(); await page.getByRole('button', { name: 'Renamed locally Local file', exact: true }).waitFor();
  assert.match(await page.getByRole('button', { name: 'Renamed locally Local file', exact: true }).locator('img').getAttribute('src'), /^blob:/);
  await page.getByRole('link', { name: 'Albums', exact: true }).click();
  await page.getByRole('link', { name: 'Open album Shared record by Ensemble', exact: true }).click();
  await page.getByText('4 imported tracks', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Edit album', exact: true }).click();
  const albumEditor = page.getByRole('dialog', { name: 'Edit album', exact: true });
  await albumEditor.getByLabel('Album', { exact: true }).fill('Locally edited album');
  await albumEditor.getByRole('button', { name: 'Save details', exact: true }).click();
  await albumEditor.waitFor({ state: 'hidden' });
  await page.getByRole('heading', { name: 'Locally edited album', exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/library-album-detail.png' });
  await page.reload(); await page.getByRole('heading', { name: 'Locally edited album', exact: true }).waitFor();
  await page.getByRole('link', { name: 'Home', exact: true }).click();
  checks.push('manual title/album grouping, batch album edits and local cover selection persist; existing embedded covers are retained');

  phase = 'missing audio and re-selection';
  await mutate({ store: 'audio', key: firstRecord.id, remove: true });
  await page.reload();
  await page.getByLabel('Restore First song', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'First song Audio copy unavailable', exact: true }).isDisabled(), true);
  await page.getByLabel('Restore First song', { exact: true }).setInputFiles(resolve(root, 'other.wav'));
  await page.locator('.offline-storage-error').filter({ hasText: 'Choose the original file' }).waitFor();
  assert.equal((await readStore('tracks')).length, 7);
  await page.getByLabel('Restore First song', { exact: true }).setInputFiles(resolve(root, 'first.wav'));
  await page.getByRole('button', { name: 'First song First singer', exact: true }).waitFor();
  await page.getByRole('button', { name: 'First song First singer', exact: true }).click(); await waitPlaying('First song');
  await bar().getByRole('button', { name: 'Pause', exact: true }).click();
  checks.push('missing saved audio keeps its record, disables playback and asks for its original file; wrong selection fails visibly and correct selection restores playback');

  phase = 'quota failure rollback';
  await page.evaluate(() => {
    window.__put = IDBObjectStore.prototype.put;
    let audioPuts = 0;
    IDBObjectStore.prototype.put = function(...args) {
      if (this.name === 'audio' && ++audioPuts === 2) throw new DOMException('Test quota exhausted', 'QuotaExceededError');
      return window.__put.apply(this, args);
    };
  });
  await writeFile(resolve(root, 'failed-one.wav'), wav(1)); await writeFile(resolve(root, 'failed-two.wav'), wav(2));
  await page.getByRole('button', { name: 'Import music', exact: true }).first().click();
  const importDialog = page.getByRole('dialog', { name: 'Import local music', exact: true });
  await importDialog.getByLabel('Choose audio files', { exact: true }).setInputFiles([resolve(root, 'failed-one.wav'), resolve(root, 'failed-two.wav')]);
  await importDialog.getByRole('alert').filter({ hasText: 'Not enough browser storage' }).waitFor();
  assert.equal((await readStore('tracks')).length, 7);
  assert.equal((await readStore('audio')).length, 7);
  assert.equal(await importDialog.getByRole('status').filter({ hasText: /Added/ }).count(), 0);
  await importDialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.evaluate(() => IDBObjectStore.prototype.put = window.__put);
  await page.getByRole('button', { name: 'Dismiss storage error', exact: true }).click();
  await importFiles(['failed-one.wav', 'failed-two.wav']);
  assert.equal((await readStore('tracks')).length, 9);
  checks.push('simulated quota failure on the second file rolls back the whole batch with no success message; retry succeeds');

  phase = 'remove copies and preserve originals/playlists';
  await page.getByRole('button', { name: 'Remove First song', exact: true }).click();
  await page.getByRole('button', { name: 'Remove First song', exact: true }).waitFor({ state: 'detached' });
  await page.reload(); await libraryReady();
  assert.equal((await readStore('tracks')).some(track => track.id === firstRecord.id), false);
  assert.deepEqual(await readStore('playlists'), [{ ...playlist, trackIds: playlist.trackIds.slice(1) }]);
  for (const [name, bytes] of fixtures) assert.equal(hash(await readFile(resolve(root, name))), hash(bytes));
  assert.ok(await page.evaluate(() => Object.values(localStorage).every(value => value.length < 1024)), 'No audio in localStorage');
  checks.push('removal persists, deletes only app copies, cleans playlist membership atomically, and original audio checksums remain unchanged');

  for (const width of [900, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.getByRole('link', { name: 'Albums', exact: true }).click();
    await page.locator('.offline-album-card').first().waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Album grid overflow at ${width}px`);
    await page.locator('.offline-album-card a').first().click();
    await page.locator('.offline-album-header').waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Album detail overflow at ${width}px`);
    if (width === 390) await page.screenshot({ path: 'test-results/library-album-mobile.png' });
  }

  phase = 'fixed headers, responsive panels and saved sidebar';
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('link', { name: 'Home', exact: true }).click();
  const scrollNames = Array.from({ length: 20 }, (_, index) => `Scroll track ${index + 1}.wav`);
  for (const name of scrollNames) await writeFile(resolve(root, name), wav(1));
  await importFiles(scrollNames);
  const region = page.getByRole('region', { name: 'Scrollable tracks', exact: true });
  const heading = page.getByRole('heading', { name: 'Local library', exact: true });
  const headingY = (await heading.boundingBox()).y;
  const tableHeaderY = (await page.locator('thead').boundingBox()).y;
  const regionBounds = await region.boundingBox();
  await page.mouse.move(regionBounds.x + 140, regionBounds.y + 130);
  await page.mouse.wheel(0, 650);
  await page.waitForFunction(() => document.querySelector('.offline-table-scroll').scrollTop > 100);
  assert.ok(Math.abs((await heading.boundingBox()).y - headingY) < 1);
  assert.ok(Math.abs((await page.locator('thead').boundingBox()).y - tableHeaderY) < 1);
  assert.equal(await page.locator('.Main-section').evaluate(element => element.scrollTop), 0);
  assert.equal(await region.evaluate(element => getComputedStyle(element).scrollbarWidth), 'none');
  assert.equal(await region.evaluate(element => getComputedStyle(element, '::-webkit-scrollbar').display), 'none');
  await region.evaluate(element => element.scrollTo(0, 0));
  await page.getByRole('button', { name: 'Reset column widths', exact: true }).click();
  await page.getByRole('separator', { name: 'Resize Title column', exact: true }).focus();
  for (let index = 0; index < 8; index++) await page.keyboard.press('ArrowRight');
  const expandedWidth = (await region.boundingBox()).width;
  phase = 'responsive details panel';
  await bar().getByRole('button', { name: 'File details', exact: true }).click();
  await page.getByRole('complementary', { name: 'File details panel', exact: true }).waitFor();
  await page.waitForFunction(previous => document.querySelector('.offline-table-scroll').clientWidth < previous - 50, expandedWidth);
  await page.waitForFunction(() => { const table = document.querySelector('.offline-table-scroll'); return table.scrollWidth <= table.clientWidth + 2; });
  for (const width of [1440, 1200, 1000]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForFunction(() => { const region = document.querySelector('.offline-table-scroll'); return region.scrollWidth <= region.clientWidth + 2; });
    const container = await region.boundingBox();
    const actions = await page.locator('tbody .offline-track-actions').first().boundingBox();
    assert.ok(actions.x + actions.width <= container.x + container.width + 2, 'Actions remain visible when the center panel narrows');
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  phase = 'sidebar easing and collapsed covers';
  await page.evaluate(() => {
    window.__panelWidths = []; window.__capturePanel = true;
    const sample = () => {
      window.__panelWidths.push(document.querySelector('#left[data-panel]').getBoundingClientRect().width);
      if (window.__capturePanel) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.getByRole('button', { name: 'Collapse library', exact: true }).click();
  await page.waitForFunction(() => Math.abs(document.querySelector('#left[data-panel]').getBoundingClientRect().width - 85) < 1);
  const animation = await page.evaluate(() => {
    window.__capturePanel = false;
    return { widths: window.__panelWidths, timing: getComputedStyle(document.querySelector('#left[data-panel]')).transitionTimingFunction };
  });
  assert.ok(new Set(animation.widths.map(width => Math.round(width))).size > 5, 'Collapse has intermediate widths instead of jumping');
  assert.equal(animation.timing, 'cubic-bezier(0.22, 1, 0.36, 1)');
  const covers = page.getByLabel('Saved library covers', { exact: true });
  await covers.waitFor();
  assert.equal(await covers.locator('img').count(), 28);
  assert.match(await covers.getByRole('button', { name: 'Play saved track Second song', exact: true }).locator('img').getAttribute('src'), /^blob:/);
  await covers.getByRole('button', { name: 'Play saved track Second song', exact: true }).click(); await waitPlaying('Second song');
  await covers.getByRole('button', { name: 'Play saved track Mix one', exact: true }).click(); await waitPlaying('Mix one');
  assert.equal(await page.evaluate(() => window.__audioCount), 1);
  await page.screenshot({ path: 'test-results/library-collapsed-covers.png' });
  phase = 'details close animation';
  await page.evaluate(() => {
    window.__detailsWidths = []; window.__captureDetails = true;
    const sample = () => {
      window.__detailsWidths.push({
        details: document.querySelector('#details[data-panel]').getBoundingClientRect().width,
        center: document.querySelector('#center[data-panel]').getBoundingClientRect().width,
      });
      if (window.__captureDetails) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await bar().getByRole('button', { name: 'File details', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#details[data-panel]').getBoundingClientRect().width < 0.1);
  const detailsAnimation = await page.evaluate(() => { window.__captureDetails = false; return window.__detailsWidths; });
  assert.ok(new Set(detailsAnimation.map(size => Math.round(size.details))).size > 5, 'Details retract through intermediate widths');
  assert.ok(new Set(detailsAnimation.map(size => Math.round(size.center))).size > 5, 'Center expands continuously as details retract');
  assert.equal(await page.getByRole('complementary', { name: 'File details panel', exact: true }).count(), 0);
  assert.equal(await page.getByRole('separator', { name: 'Resize details', exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => window.__audioCount), 1);
  assert.equal(await page.evaluate(() => document.querySelector('audio').paused), false);
  // Reverse an in-progress transition and ensure the final state is fully closed.
  await bar().getByRole('button', { name: 'File details', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#details[data-panel]').getBoundingClientRect().width > 30);
  await bar().getByRole('button', { name: 'File details', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#details[data-panel]').getBoundingClientRect().width < 0.1);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await bar().getByRole('button', { name: 'File details', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#details[data-panel]').getBoundingClientRect().width > 200);
  assert.equal(await page.locator('#details[data-panel]').evaluate(element => getComputedStyle(element).transitionDuration), '0s');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByRole('button', { name: 'Expand library', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#left[data-panel]').getBoundingClientRect().width > 280);
  await selectMenu(page, 'Library view', 'history');
  await page.waitForFunction(() => document.querySelector('.offline-saved-tracks strong')?.textContent === 'Mix one');
  await page.screenshot({ path: 'test-results/library-responsive-details.png' });
  await page.reload(); await page.getByRole('button', { name: 'Mix one Solo one', exact: true }).waitFor();
  await selectMenu(page, 'Library view', 'history');
  await page.waitForFunction(() => document.querySelector('.offline-saved-tracks strong')?.textContent === 'Mix one');
  assert.ok(await page.getByRole('list', { name: 'Recently played tracks', exact: true }).locator('li').count() >= 2);
  checks.push('only track rows scroll with hidden scrollbars; page/table headers stay fixed; details-panel changes adapt columns and retain visible actions');
  checks.push('saved sidebar songs and recently played history restore; collapsed sidebar retains embedded covers that control the same audio instance');
  checks.push('sidebar uses nonlinear easing with intermediate panel widths while the center responds continuously');
  checks.push('details retract smoothly, the center expands continuously, rapid toggles settle correctly, reduced-motion preferences are respected, and playback continues with one audio instance');
  assert.deepEqual(external, [], 'External services attempted');
  assert.deepEqual(errors, [], 'Browser errors/warnings');
  assert.deepEqual(violations, [], 'CSP violations');
  const report = { mode: development ? 'development' : 'production', result: 'passed', checks, external, errors, violations };
  await writeFile(`test-results/library-${report.mode}.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(JSON.stringify({ phase, errors, external, violations }, null, 2)); throw error;
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.httpServer.close(resolve));
}

