import { selectMenu } from './select-menu.mjs';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createAudioAnalysisFixtures } from './audio-analysis-fixtures.mjs';

const root = await createAudioAnalysisFixtures(), port = 4183, origin = `http://127.0.0.1:${port}`;
const server = await preview({ preview: { host: '127.0.0.1', port, strictPort: true } });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const errors = [], external = [], checks = [], measurements = []; let phase = 'import';
await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : (external.push(route.request().url()), route.abort()));
await context.addInitScript(() => {
  window.__audioCount = 0; const Audio = window.Audio; window.Audio = class extends Audio { constructor(...args) { super(...args); window.__audioCount++; } };
  window.__analysisWorkers = { started: 0, active: 0, max: 0 }; const Worker = window.Worker;
  window.Worker = class extends Worker {
    constructor(url, options) { super(url, options); this.analysis = String(url).includes('analysis.worker');
      if (this.analysis) { const stats = window.__analysisWorkers; stats.started++; stats.active++; stats.max = Math.max(stats.max, stats.active); } }
    terminate() { if (this.analysis) { window.__analysisWorkers.active--; this.analysis = false; } return super.terminate(); }
  };
});
const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
page.setDefaultTimeout(30000);
const read = name => page.evaluate(name => new Promise((resolve, reject) => {
  const request = indexedDB.open('local-music-library'); request.onerror = () => reject(request.error);
  request.onsuccess = () => { const db = request.result, tx = db.transaction(name), data = tx.objectStore(name).getAll(); tx.oncomplete = () => { db.close(); resolve(data.result); }; };
}), name);
const put = (name, key, value) => page.evaluate(({ name, key, value }) => new Promise((resolve, reject) => {
  const request = indexedDB.open('local-music-library'); request.onerror = () => reject(request.error);
  request.onsuccess = () => { const db = request.result, tx = db.transaction(name, 'readwrite'); tx.objectStore(name).put(value, key);
    tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => reject(tx.error); };
}), { name, key, value });
const open = async id => { await page.goto(`${origin}/analyze/${encodeURIComponent(id)}`); await page.getByRole('button', { name: 'Analyze BPM & Key', exact: true }).waitFor(); await page.waitForFunction(() => !document.querySelector('.analysis-page')?.textContent.includes('Reading local inputs')); };
const waitDone = async (id, kinds = ['bpm', 'key'], previous = {}) => {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const tasks = (await read('analysis-tasks')).filter(task => task.trackId === id && kinds.includes(task.kind));
    if (tasks.length === kinds.length && tasks.every(task => task.id !== previous[task.kind] && ['complete', 'failed', 'cancelled'].includes(task.status))) return tasks;
    await page.waitForTimeout(100);
  }
  throw new Error('Audio analysis timed out in the test.');
};
try {
  await page.goto(origin); await page.getByRole('button', { name: 'Import music', exact: true }).first().click();
  const files = ['beat-441-mono.wav', 'beat-441-stereo.wav', 'beat-480-mono.wav', 'beat-480-stereo.wav', 'beat-480.flac', 'beat-441.mp3', 'minor-480.wav', 'silence.wav', 'short.wav', 'corrupt.mp3'];
  await page.getByLabel('Choose audio files', { exact: true }).setInputFiles([...files, 'long-480.wav'].map(name => resolve(root, name)));
  await page.getByRole('status').filter({ hasText: 'Added 11 files' }).waitFor();
  const tracks = await read('tracks');
  for (const name of files) {
    phase = name; const track = tracks.find(track => track.fileName === name); await open(track.id);
    await page.getByRole('button', { name: 'Analyze BPM & Key', exact: true }).click();
    const tasks = await waitDone(track.id), records = (await read('analysis')).filter(record => record.trackId === track.id);
    if (name === 'corrupt.mp3') { assert.ok(tasks.every(task => task.status === 'failed')); continue; }
    assert.ok(tasks.every(task => task.status === 'complete'), JSON.stringify(tasks));
    assert.equal(records.length, 2); const bpm = records.find(r => r.kind === 'bpm'), key = records.find(r => r.kind === 'key');
    assert.equal(bpm.result.range.analysisSampleRate, 44100);
    assert.ok(Math.abs(bpm.result.range.analysisFrames / 44100 - bpm.result.range.end) < .0001);
    if (name === 'silence.wav' || name === 'short.wav') { assert.ok(records.every(record => record.result.outcome === 'unreliable' && record.result.raw === null)); }
    else {
      assert.equal(bpm.result.outcome, 'estimated'); assert.ok(Math.abs(bpm.result.raw.bpm - 120) < 2, `Tempo drift: ${bpm.result.raw.bpm}`);
      const ticks = bpm.result.raw.ticks; assert.ok(ticks.length > 40); assert.ok(ticks.at(-1) > 29 && ticks.at(-1) < 32.1);
      assert.ok(ticks.slice(1).every((tick, i) => Math.abs(tick - ticks[i] - .5) < .06));
      assert.equal(key.result.outcome, 'estimated'); assert.ok(Number.isFinite(key.result.raw.strength));
      assert.deepEqual([key.result.raw.tonic, key.result.raw.mode], name === 'minor-480.wav' ? ['A', 'minor'] : ['C', 'major'], 'Match the known major/minor progression, not only a nonempty key name.');
      if (name.endsWith('.mp3') || name.endsWith('.flac')) { assert.equal(bpm.result.sourceMetadata.tags.bpm, 123); assert.equal(bpm.result.sourceMetadata.tags.key, 'F#m'); }
    }
    measurements.push({ file: name, inputRate: bpm.result.range.decodedSampleRate, channels: bpm.result.range.sourceChannels, bpm: bpm.result.raw?.bpm,
      beats: bpm.result.raw?.ticks.length, beatConfidence: bpm.result.raw?.confidence, key: key.result.raw, outcome: key.result.outcome,
      range: bpm.result.range, engineVersion: bpm.result.engineVersion });
  }
  checks.push('44.1/48 kHz mono/stereo WAV, FLAC and MP3 full scans preserve the 120 BPM test time base and retain beat positions; silence and very short audio have no fabricated estimate; corrupt MP3 fails clearly');
  phase = 'corrections and cache';
  const selected = tracks.find(track => track.fileName === 'beat-480-stereo.wav'); await open(selected.id);
  const card = kind => page.getByRole('region', { name: `${kind} analysis`, exact: true });
  const recordFor = async (id, kind) => (await read('analysis')).find(record => record.trackId === id && record.kind === kind);
  const previousTask = async (id, kind) => (await read('analysis-tasks')).find(task => task.trackId === id && task.kind === kind)?.id;
  const original = await recordFor(selected.id, 'bpm');
  await card('BPM').getByRole('button', { name: '÷2', exact: true }).click();
  await card('BPM').getByText('60.0', { exact: true }).waitFor();
  await card('BPM').getByRole('button', { name: '×2', exact: true }).click();
  await card('BPM').getByText('120.0', { exact: true }).waitFor();
  await card('BPM').getByRole('button', { name: 'Edit BPM', exact: true }).click();
  await page.getByLabel('Manual BPM', { exact: true }).fill('117.3'); await page.getByRole('button', { name: 'Save correction', exact: true }).click();
  await card('BPM').getByText('117.3', { exact: true }).waitFor();
  await card('Key').getByRole('button', { name: 'Edit Key', exact: true }).click();
  await selectMenu(page, 'Manual tonic', 'F#'); await selectMenu(page, 'Manual mode', 'minor');
  await page.getByRole('button', { name: 'Save correction', exact: true }).click(); await card('Key').getByText('F♯ minor', { exact: true }).waitFor();
  assert.deepEqual((await recordFor(selected.id, 'bpm')).result.raw, original.result.raw);
  await page.reload(); await card('BPM').getByText('117.3', { exact: true }).waitFor(); await card('Key').getByText('F♯ minor', { exact: true }).waitFor();
  const cachedId = await previousTask(selected.id, 'bpm');
  await card('BPM').getByRole('button', { name: 'Analyze BPM', exact: true }).click(); await waitDone(selected.id, ['bpm'], { bpm: cachedId });
  assert.equal((await recordFor(selected.id, 'bpm')).analyzedAt, original.analyzedAt);
  assert.equal(await page.evaluate(() => window.__analysisWorkers.started), 0, 'Cache reuse does not instantiate WASM.');
  await card('BPM').getByRole('button', { name: 'Reset to original', exact: true }).click(); await card('BPM').getByText('120.0', { exact: true }).waitFor();
  await card('Key').getByRole('button', { name: 'Reset to original', exact: true }).click(); await card('Key').getByText('C major', { exact: true }).waitFor();
  checks.push('Half/double tempo, manual BPM and structured tonic/mode corrections save separately, survive reload, and reset to the unchanged algorithm original; matching cache starts no worker');

  phase = 'playback, cancellation and serial queue';
  await page.getByRole('link', { name: 'Back to library', exact: true }).click();
  await page.locator('.offline-track-name').first().click();
  await page.waitForFunction(() => !document.querySelector('audio').paused);
  await page.evaluate(() => { window.__playingAudio = document.querySelector('audio'); window.__frames = 0; const tick = () => { window.__frames++; requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
  await page.locator('.offline-track-name').filter({ hasText: 'beat-480-stereo.wav' }).click({ button: 'right' }); await page.getByRole('menuitem', { name: 'Analyze', exact: true }).click();
  const cancelledId = await previousTask(selected.id, 'bpm');
  const queuedKeyId = await previousTask(selected.id, 'key');
  await card('BPM').getByRole('button', { name: 'Force reanalyze', exact: true }).click();
  await page.waitForFunction(() => window.__analysisWorkers.active === 1);
  await card('Key').getByRole('button', { name: 'Force reanalyze', exact: true }).click();
  await card('Key').getByText('Waiting', { exact: true }).waitFor();
  await card('BPM').getByRole('button', { name: 'Cancel', exact: true }).click();
  const cancelled = await waitDone(selected.id, ['bpm'], { bpm: cancelledId }); assert.equal(cancelled[0].status, 'cancelled');
  const player = page.getByRole('contentinfo', { name: 'Player', exact: true });
  await player.getByRole('button', { name: 'Next', exact: true }).click();
  // Analyze now follows the playing song; the old track's queued work continues.
  await page.waitForURL(url => !url.pathname.endsWith(encodeURIComponent(selected.id)));
  await page.getByRole('slider', { name: 'Playback progress', exact: true }).evaluate(input => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '6.25'); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await waitDone(selected.id, ['key'], { key: queuedKeyId });
  assert.equal((await recordFor(selected.id, 'bpm')).analyzedAt, original.analyzedAt, 'Cancellation keeps the old result.');
  assert.equal(await page.evaluate(() => document.querySelector('audio') === window.__playingAudio && !window.__playingAudio.paused && window.__audioCount === 1), true);
  assert.ok(await page.evaluate(() => window.__frames > 10)); assert.equal(await page.evaluate(() => window.__analysisWorkers.max), 1);
  await page.getByRole('button', { name: `Play saved track ${selected.name}`, exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Analyze', exact: true }).click();
  await page.waitForURL(`${origin}/analyze/${encodeURIComponent(selected.id)}`);
  const rerunId = await previousTask(selected.id, 'bpm');
  await card('BPM').getByRole('button', { name: 'Force reanalyze', exact: true }).click(); await waitDone(selected.id, ['bpm'], { bpm: rerunId });
  assert.ok((await recordFor(selected.id, 'bpm')).analyzedAt > original.analyzedAt);
  assert.equal(await page.evaluate(() => window.__analysisWorkers.active), 0);
  checks.push('Analysis keeps the same playing audio and animation frames; seeking and changing songs still work; jobs queue serially, cancellation terminates the worker and preserves the prior result, then a forced rerun succeeds');
  await page.screenshot({ path: 'test-results/audio-analysis/results.png' });

  phase = 'different songs queued across routes';
  const navigate = async track => {
    await page.getByRole('button', { name: `Play saved track ${track.name}`, exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Analyze', exact: true }).click();
    await page.getByRole('button', { name: 'Analyze BPM & Key', exact: true }).waitFor();
  };
  const long = tracks.find(track => track.fileName === 'long-480.wav'); await navigate(long);
  await page.getByRole('button', { name: 'Analyze BPM & Key', exact: true }).click();
  await page.waitForFunction(() => window.__analysisWorkers.active === 1);
  await navigate(selected);
  const serialId = await previousTask(selected.id, 'bpm'), cancelledKeyId = await previousTask(selected.id, 'key');
  await card('BPM').getByRole('button', { name: 'Force reanalyze', exact: true }).click();
  await card('BPM').getByText('Waiting', { exact: true }).waitFor();
  await card('Key').getByRole('button', { name: 'Force reanalyze', exact: true }).click();
  await card('Key').getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal((await waitDone(selected.id, ['key'], { key: cancelledKeyId }))[0].status, 'cancelled');
  const workersBeforeStudio = await page.evaluate(() => window.__analysisWorkers.started);
  await page.getByRole('link', { name: 'Import or edit lyrics', exact: true }).click();
  await writeFile(resolve(root, 'cache-test.ttml'), '<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="1s" end="4s">First test line</p><p begin="6s" end="12s">Second test line</p></div></body></tt>');
  await page.getByLabel('Choose studio lyrics', { exact: true }).setInputFiles(resolve(root, 'cache-test.ttml'));
  const importPreview = page.getByRole('dialog', { name: 'Import into Lyric Studio', exact: true });
  await importPreview.getByRole('button', { name: 'Use line timings', exact: true }).click(); await importPreview.waitFor({ state: 'hidden' });
  await page.getByLabel('Lyrics line 1', { exact: true }).fill('Edited test lyric text');
  await page.locator('.studio-save-status').filter({ hasText: 'Draft saved' }).waitFor();
  assert.ok((await waitDone(long.id)).every(task => task.status === 'complete'));
  assert.equal((await waitDone(selected.id, ['bpm'], { bpm: serialId }))[0].status, 'complete');
  assert.ok(await page.evaluate(() => window.__analysisWorkers.started) >= workersBeforeStudio);
  assert.equal(await page.evaluate(() => window.__analysisWorkers.max), 1);
  await page.getByRole('link', { name: 'Back to player', exact: true }).click(); await navigate(selected);
  const lyricCached = await recordFor(selected.id, 'bpm'), lyricCacheId = await previousTask(selected.id, 'bpm');
  const beforeLyricCache = await page.evaluate(() => window.__analysisWorkers.started);
  await card('BPM').getByRole('button', { name: 'Analyze BPM', exact: true }).click(); await waitDone(selected.id, ['bpm'], { bpm: lyricCacheId });
  assert.equal((await recordFor(selected.id, 'bpm')).analyzedAt, lyricCached.analyzedAt);
  assert.equal(await page.evaluate(() => window.__analysisWorkers.started), beforeLyricCache);
  checks.push('Different songs queue without parallel workers; a waiting task can be cancelled; tasks complete while editing imported TTML in Studio; lyric text edits leave BPM cache valid');

  phase = 'source change and stale result guard';
  await navigate(long); const beforeReplacement = await recordFor(long.id, 'bpm'), replacementTask = await previousTask(long.id, 'bpm');
  await card('BPM').getByRole('button', { name: 'Force reanalyze', exact: true }).click(); await page.waitForFunction(() => window.__analysisWorkers.active === 1);
  await put('tracks', long.id, { ...(await read('tracks')).find(track => track.id === long.id), audioRevision: 'test-replacement-audio' });
  const invalidated = await waitDone(long.id, ['bpm'], { bpm: replacementTask }); assert.equal(invalidated[0].status, 'failed'); assert.match(invalidated[0].message, /audio changed/);
  assert.equal((await recordFor(long.id, 'bpm')).analyzedAt, beforeReplacement.analyzedAt);
  await page.reload(); await card('BPM').getByText('The audio or analysis parameters changed.', { exact: false }).waitFor();
  const refreshId = await previousTask(long.id, 'bpm');
  await card('BPM').getByRole('button', { name: 'Analyze BPM', exact: true }).click(); assert.equal((await waitDone(long.id, ['bpm'], { bpm: refreshId }))[0].status, 'complete');
  const refreshed = await recordFor(long.id, 'bpm'); assert.equal(refreshed.input.audio[long.id], 'test-replacement-audio'); assert.ok(refreshed.analyzedAt > beforeReplacement.analyzedAt);
  assert.equal(await page.evaluate(() => window.__analysisWorkers.active), 0);
  checks.push('Replacing the stored audio revision while a real worker runs rejects its stale result; reload marks the cache stale and an ordinary run computes and saves the new source version');

  phase = 'failed result save';
  await navigate(selected); const beforeFailure = await recordFor(selected.id, 'key'), failureId = await previousTask(selected.id, 'key');
  await page.evaluate(() => {
    window.__failAudioSave = true; const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(...args) {
      if (this.name === 'analysis' && window.__failAudioSave) throw new DOMException('Test storage quota exceeded', 'QuotaExceededError');
      return original.apply(this, args);
    };
  });
  await card('Key').getByRole('button', { name: 'Force reanalyze', exact: true }).click();
  const failedSave = await waitDone(selected.id, ['key'], { key: failureId }); assert.equal(failedSave[0].status, 'failed');
  assert.equal((await recordFor(selected.id, 'key')).analyzedAt, beforeFailure.analyzedAt);
  await card('Key').getByRole('alert').waitFor();
  await page.evaluate(() => { window.__failAudioSave = false; });
  await card('Key').getByRole('button', { name: 'Force reanalyze', exact: true }).click();
  assert.equal((await waitDone(selected.id, ['key'], { key: failedSave[0].id }))[0].status, 'complete');
  assert.equal(await page.evaluate(() => window.__analysisWorkers.active), 0);
  checks.push('An injected IndexedDB quota error reports failed saving, retains the committed original, and permits a successful retry after storage recovers');

  phase = 'parameter cache identity';
  const beforeParameters = await recordFor(selected.id, 'key');
  await put('analysis', [selected.id, 'key'], { ...beforeParameters, settings: { ...beforeParameters.settings, profileType: 'different-test-profile' } });
  await page.reload(); await card('Key').getByText('The audio or analysis parameters changed.', { exact: false }).waitFor();
  const parameterId = await previousTask(selected.id, 'key');
  await card('Key').getByRole('button', { name: 'Analyze Key', exact: true }).click(); await waitDone(selected.id, ['key'], { key: parameterId });
  assert.equal((await recordFor(selected.id, 'key')).settings.profileType, 'bgate');
  assert.ok((await recordFor(selected.id, 'key')).analyzedAt > beforeParameters.analyzedAt);
  assert.equal(await page.evaluate(() => window.__analysisWorkers.started), 1);
  checks.push('A saved record with different algorithm parameters is visibly stale and cannot be reused as a matching cache entry');
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  const report = { result: 'passed', checks, measurements, errors, external };
  await writeFile('test-results/audio-analysis/report.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} catch (error) { console.error(JSON.stringify({ phase, tasks: await read('analysis-tasks').catch(() => []), errors, external })); await page.screenshot({ path: 'test-results/audio-analysis/failure.png' }); throw error; }
finally { await context.close(); await browser.close(); await new Promise(resolve => server.httpServer.close(resolve)); }
