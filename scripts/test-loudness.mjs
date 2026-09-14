import { chromium } from 'playwright';
import { preview } from 'vite';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { loudnessFixtures } from './loudness-fixtures.mjs';

const { root, names, references } = await loudnessFixtures();
const origin = 'http://127.0.0.1:4186', server = await preview({ preview: { host: '127.0.0.1', port: 4186, strictPort: true } });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
const errors = [], external = [], checks = [], measurements = []; let phase = 'import';
await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : (external.push(route.request().url()), route.abort()));
await context.addInitScript(() => {
  window.__audioCount = 0; const Audio = window.Audio; window.Audio = class extends Audio { constructor(...args) { super(...args); window.__audioCount++; } };
  window.__workers = { active: 0, started: 0, max: 0 }; const Worker = window.Worker;
  window.Worker = class extends Worker {
    constructor(url, options) { super(url, options); this.measured = /(?:analysis|loudness|aggregate)\.worker/.test(String(url)); if (this.measured) { const s = window.__workers; s.started++; s.active++; s.max = Math.max(s.max, s.active); } }
    terminate() { if (this.measured) { window.__workers.active--; this.measured = false; } super.terminate(); }
  };
  window.__contexts = []; window.__gains = []; window.__sources = 0;
  const Context = window.AudioContext;
  window.AudioContext = class extends Context {
    constructor(...args) { super(...args); window.__contexts.push(this); }
    createMediaElementSource(audio) { window.__sources++; return super.createMediaElementSource(audio); }
    createGain() { const gain = super.createGain(); window.__gains.push(gain); return gain; }
  };
});
const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(30000);
const read = name => page.evaluate(name => new Promise((resolve, reject) => {
  const r = indexedDB.open('local-music-library'); r.onerror = () => reject(r.error); r.onsuccess = () => {
    const db = r.result, tx = db.transaction(name), data = tx.objectStore(name).getAll(); tx.oncomplete = () => { db.close(); resolve(data.result); };
  };
}), name);
const record = async (id, kind = 'loudness') => (await read('analysis')).find(r => r.trackId === id && r.kind === kind);
const put = (name, key, value) => page.evaluate(({ name, key, value }) => new Promise((resolve, reject) => {
  const r = indexedDB.open('local-music-library'); r.onsuccess = () => { const db = r.result, tx = db.transaction(name, 'readwrite'); tx.objectStore(name).put(value, key);
    tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => reject(tx.error); };
}), { name, key, value });
const taskId = async (id, kind = 'loudness') => (await read('analysis-tasks')).find(t => t.trackId === id && t.kind === kind)?.id;
const done = async (id, previous, kind = 'loudness') => {
  const end = Date.now() + 120000;
  while (Date.now() < end) {
    const task = (await read('analysis-tasks')).find(t => t.trackId === id && t.kind === kind);
    if (task && task.id !== previous && ['complete', 'failed', 'cancelled'].includes(task.status)) return task;
    await page.waitForTimeout(100);
  }
  throw new Error(`Task timeout: ${id}/${kind}`);
};
const open = async id => { await page.goto(`${origin}/analyze/${encodeURIComponent(id)}`); await page.getByRole('button', { name: 'Analyze track loudness', exact: true }).waitFor(); await page.waitForFunction(() => !document.querySelector('.analysis-page')?.textContent.includes('Reading local inputs')); };
const scan = async (track, force = false) => {
  const previous = await taskId(track.id);
  await page.getByRole('button', { name: force ? 'Force reanalyze track loudness' : 'Analyze track loudness', exact: true }).click();
  return done(track.id, previous);
};
try {
  await page.goto(origin);
  await page.getByRole('button', { name: 'Import music', exact: true }).first().click();
  await page.getByLabel('Choose audio files', { exact: true }).setInputFiles(names.map(name => resolve(root, name)));
  await page.getByRole('status').filter({ hasText: `Added ${names.length} files` }).waitFor();
  const tracks = await read('tracks'), find = name => tracks.find(t => t.fileName === name);
  for (const name of names.filter(n => n !== 'long.wav')) {
    phase = name; const track = find(name); await open(track.id); const task = await scan(track);
    if (['corrupt.mp3', 'unsupported-rate.wav', 'oversized.flac'].includes(name)) {
      assert.equal(task.status, 'failed');
      if (name === 'oversized.flac') assert.match(task.message, /128 MiB/);
      continue;
    }
    assert.equal(task.status, 'complete', task.message);
    const saved = await record(track.id), r = saved.result;
    assert.equal(r.ranges[0].range.mix, 'original-channels'); assert.equal(r.ranges[0].range.resampler, 'none');
    assert.equal(r.ranges[0].range.sampleRate, track.analysisMetadata.sampleRate);
    if (['silence.wav', 'short.wav'].includes(name)) { assert.equal(r.integratedLufs, null); assert.equal(r.replayGain, null); }
    else {
      const ref = references[name];
      assert.ok(Math.abs(r.integratedLufs - ref.integratedLufs) <= .2, `${name}: LUFS ${r.integratedLufs} vs ${ref.integratedLufs}`);
      if (name !== 'one-second.wav') assert.ok(Math.abs(r.rangeLu - ref.rangeLu) <= .3, `${name}: LRA ${r.rangeLu} vs ${ref.rangeLu}`);
      else assert.equal(r.rangeLu, null);
      assert.ok(Math.abs(r.truePeakDbtp - ref.truePeakDbtp) <= .35, `${name}: dBTP ${r.truePeakDbtp} vs ${ref.truePeakDbtp}`);
      assert.ok(Math.abs(r.replayGain.gainDb - (-18 - r.integratedLufs)) < 1e-9);
    }
    if (name === 'intersample.wav') assert.ok(r.truePeak > r.samplePeak * 1.3);
    measurements.push({ file: name, measured: { integratedLufs: r.integratedLufs, rangeLu: r.rangeLu, samplePeak: r.samplePeak, truePeakDbtp: r.truePeakDbtp, gainDb: r.replayGain?.gainDb }, reference: references[name] });
    assert.equal(await page.evaluate(() => window.__contexts.length), 0, 'Analysis alone never creates a playback gain graph');
  }
  checks.push('Real worker scans: 44.1/48/96/192 kHz mono and anti-phase stereo, WAV/FLAC/MP3, silence, 100 ms/1 s audio; corrupt/unsupported/over-budget files fail; numerical comparisons with FFmpeg ebur128 LUFS/LRA/true peak; inter-sample peaks exceed sample peaks');
  phase = 'empty units and button alignment';
  await open(find('long.wav').id);
  assert.deepEqual(await page.locator('.loudness-metrics strong').allTextContents(), ['— LUFS', '— LU', '— dBTP', '— dB']);
  const buttons = await Promise.all(['Analyze BPM & Key', 'Analyze track loudness'].map(name => page.getByRole('button', { name, exact: true }).boundingBox()));
  assert.ok(Math.abs(buttons[0].height - buttons[1].height) < 1);
  assert.ok(Math.abs(buttons[0].x + buttons[0].width - buttons[1].x - buttons[1].width) < 1);
  checks.push('Empty values retain all four units; BPM/Key and track loudness buttons share size and right alignment');
  phase = 'track cache';
  const a = find('album-a.flac'), b = find('album-b.mp3'); await open(a.id);
  const original = await record(a.id), before = await page.evaluate(() => window.__workers.started);
  assert.equal((await scan(a)).status, 'complete'); assert.equal((await record(a.id)).analyzedAt, original.analyzedAt);
  assert.equal(await page.evaluate(() => window.__workers.started), before);
  await page.reload(); await page.getByRole('button', { name: 'Analyze track loudness', exact: true }).waitFor();
  assert.equal((await record(a.id)).analyzedAt, original.analyzedAt);
  assert.equal(await page.getByRole('button', { name: 'Analyze album loudness' }).count(), 0);
  checks.push('Single-track cache starts no Worker; results survive reload; album loudness controls are absent');
  await page.locator('.analysis-loudness').scrollIntoViewIfNeeded(); await page.screenshot({ path: resolve(root, '../analysis.png') });

  phase = 'playback normalization';
  await page.getByRole('link', { name: 'Back to library', exact: true }).click();
  await page.locator('.offline-track-name').filter({ hasText: 'tone-48000-1.wav' }).click();
  await page.waitForFunction(() => !document.querySelector('audio').paused);
  await page.evaluate(() => { window.__playing = document.querySelector('audio'); });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const toggle = page.getByRole('checkbox', { name: 'Use measured ReplayGain', exact: true });
  await toggle.click(); await page.waitForFunction(() => document.querySelector('[aria-label="Use measured ReplayGain"]').checked && !document.querySelector('[aria-label="Use measured ReplayGain"]').disabled); await page.waitForFunction(() => window.__gains.length === 1 && window.__gains[0].gain.value > 1.5);
  assert.equal(await page.evaluate(() => document.querySelector('audio').volume), 1);
  assert.equal(await page.evaluate(() => window.__sources), 1);
  const rms = () => page.evaluate(async () => {
    const ctx = window.__contexts[0], gain = window.__gains[0], analyzer = ctx.createAnalyser(); analyzer.fftSize = 4096; gain.connect(analyzer);
    await new Promise(resolve => setTimeout(resolve, 150)); const data = new Float32Array(analyzer.fftSize); analyzer.getFloatTimeDomainData(data); gain.disconnect(analyzer);
    return Math.sqrt(data.reduce((sum, n) => sum + n * n, 0) / data.length);
  });
  const normalizedRms = await rms();
  await toggle.click(); await page.waitForFunction(() => !document.querySelector('[aria-label="Use measured ReplayGain"]').checked && !document.querySelector('[aria-label="Use measured ReplayGain"]').disabled); await page.waitForFunction(() => Math.abs(window.__gains[0].gain.value - 1) < .001);
  const unityRms = await rms();
  assert.ok(Math.abs(normalizedRms / unityRms - 10 ** (5.01 / 20)) < .08, `${normalizedRms}/${unityRms}`);
  await toggle.click(); await page.waitForFunction(() => document.querySelector('[aria-label="Use measured ReplayGain"]').checked && !document.querySelector('[aria-label="Use measured ReplayGain"]').disabled); await page.waitForFunction(() => window.__gains[0].gain.value > 1.5);
  assert.equal(await page.getByRole('combobox', { name: 'Normalization mode' }).count(), 0);
  await page.getByRole('slider', { name: 'Normalization preamp', exact: true }).fill('12');
  await page.waitForFunction(() => !document.querySelector('.normalization-settings input[type=range]').disabled);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('.offline-track-name').filter({ hasText: 'crest.wav' }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const rb = (await record(find('crest.wav').id)).result;
  assert.ok(rb.replayGain.gainDb + 12 > -1 - 20 * Math.log10(rb.truePeak), 'Clipping cap must actually bind');
  await page.waitForFunction(peak => Math.abs(20 * Math.log10(window.__gains[0].gain.value * peak) + 1) < .02, rb.truePeak);
  assert.equal(await page.evaluate(() => window.__playing === document.querySelector('audio') && window.__sources === 1 && window.__audioCount === 1), true);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload(); await page.getByRole('button', { name: 'Settings', exact: true }).click(); await toggle.waitFor();
  assert.equal(await toggle.isChecked(), true); assert.equal(await page.getByRole('slider', { name: 'Normalization preamp', exact: true }).inputValue(), '12');
  await toggle.click(); await page.waitForFunction(() => !document.querySelector('[aria-label="Use measured ReplayGain"]').checked && !document.querySelector('[aria-label="Use measured ReplayGain"]').disabled); await page.getByRole('button', { name: 'Close', exact: true }).click();
  checks.push('Optional gain is off by default; measured live output RMS follows gain, disabled uses unity; volume slider stays independent; true-peak cap, persisted preferences, one audio element/source');

  phase = 'cancel, serial jobs and route operations';
  const long = find('long.wav'); await open(long.id);
  await page.getByRole('button', { name: 'Analyze track loudness', exact: true }).click();
  await page.waitForFunction(() => window.__workers.active === 1);
  await page.getByRole('button', { name: 'Analyze BPM', exact: true }).click();
  await page.getByRole('region', { name: 'BPM analysis', exact: true }).getByText('Waiting', { exact: true }).waitFor();
  await page.getByRole('region', { name: 'ReplayGain and loudness analysis', exact: true }).getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal((await done(long.id)).status, 'cancelled'); assert.equal(await record(long.id), undefined);
  await page.getByRole('region', { name: 'BPM analysis', exact: true }).getByRole('button', { name: 'Cancel', exact: true }).click();
  await done(long.id, undefined, 'bpm');
  const previous = await taskId(long.id); await page.getByRole('button', { name: 'Analyze track loudness', exact: true }).click();
  await page.waitForFunction(() => window.__workers.active === 1);
  await page.evaluate(() => { window.__frames = 0; const tick = () => { window.__frames++; requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
  await page.getByRole('link', { name: 'Back to library', exact: true }).click();
  await page.locator('.offline-track-name').filter({ hasText: 'album-b.mp3' }).click();
  await page.getByRole('slider', { name: 'Playback progress', exact: true }).fill('5');
  assert.equal((await done(long.id, previous)).status, 'complete');
  assert.ok(await page.evaluate(() => window.__frames > 5));
  assert.equal(await page.evaluate(() => window.__workers.max), 1);
  assert.equal(await page.evaluate(() => window.__workers.active), 0);
  assert.equal(await page.evaluate(() => !document.querySelector('audio').paused && window.__audioCount === 1), true);
  checks.push('Loudness and BPM share one serial queue; active cancellation actually terminates the Worker; cancelled results are not saved; rerun succeeds while playback, seeking and route navigation continue');

  phase = 'save failure and stale guards';
  await open(long.id); const oldLong = await record(long.id), oldTask = await taskId(long.id);
  await page.getByRole('button', { name: 'Force reanalyze track loudness', exact: true }).click();
  await page.waitForFunction(() => window.__workers.active === 1);
  await put('tracks', long.id, { ...long, audioRevision: 'changed-during-scan' });
  assert.equal((await done(long.id, oldTask)).status, 'failed');
  assert.equal((await record(long.id)).analyzedAt, oldLong.analyzedAt);
  await open(a.id); const previousA = await record(a.id);
  await page.evaluate(() => {
    window.__put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(...args) { if (this.name === 'analysis') throw new DOMException('Test quota exceeded', 'QuotaExceededError'); return window.__put.apply(this, args); };
  });
  assert.equal((await scan(a, true)).status, 'failed'); assert.equal((await record(a.id)).analyzedAt, previousA.analyzedAt);
  await page.evaluate(() => { IDBObjectStore.prototype.put = window.__put; });
  await put('tracks', a.id, { ...a, audioRevision: 'changed-file' });
  await open(a.id); await page.getByText('Audio or analysis settings changed.', { exact: false }).waitFor();
  assert.equal((await record(a.id)).analyzedAt, previousA.analyzedAt, 'Staleness does not auto-run a scan');
  await page.getByRole('link', { name: 'Back to library', exact: true }).click();
  await page.locator('.offline-track-name').filter({ hasText: 'album-a.flac' }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Use measured ReplayGain', exact: true }).click();
  await page.waitForFunction(() => window.__gains.length === 1 && window.__gains[0].gain.value === 1);
  await page.getByText('Saved measurement is stale or unmeasurable.', { exact: false }).waitFor();
  await page.evaluate(() => {
    window.__put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(...args) { if (this.name === 'settings') throw new DOMException('Test quota exceeded', 'QuotaExceededError'); return window.__put.apply(this, args); };
  });
  await page.getByRole('checkbox', { name: 'Use measured ReplayGain', exact: true }).click();
  await page.getByText('Normalization settings were not saved.', { exact: false }).waitFor();
  assert.equal(await page.getByRole('checkbox', { name: 'Use measured ReplayGain', exact: true }).isChecked(), true);
  await page.evaluate(() => { IDBObjectStore.prototype.put = window.__put; });
  checks.push('Source replacement during scan rejects stale completion; quota failure preserves previous results; changed audio invalidates track gain without automatic work; stale normalization falls back to unity and settings save failure retains prior preferences');
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  await writeFile(resolve(root, '../verification.json'), JSON.stringify({ checks, measurements, errors, external }, null, 2));
  console.log(JSON.stringify({ checks, measurements, errors, external }, null, 2));
} catch (error) {
  console.error('Phase:', phase); await page.screenshot({ path: resolve(root, '../failure.png'), fullPage: true }); console.error('Browser:', errors); throw error;
} finally { await browser.close(); await new Promise(resolve => server.httpServer.close(resolve)); }
