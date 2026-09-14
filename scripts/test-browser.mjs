import { chromium } from 'playwright';
import { preview, createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const development = process.argv.includes('--dev');
const existing = process.argv.includes('--existing');
const port = development ? 3000 : 4173;
const origin = `http://127.0.0.1:${port}`;
const server = existing ? null : development
  ? await createServer({ server: { host: '127.0.0.1', port, strictPort: true } })
  : await preview({ preview: { host: '127.0.0.1', port, strictPort: true } });
if (development && server) await server.listen();
let browser;
const external = [], errors = [], failedResponses = [], policyViolations = [];
const checks = [];
let requestCount = 0, phase = 'startup';

function wav(seconds, frequency = 220) {
  const rate = 8000, samples = Math.floor(rate * seconds), data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) data.writeInt16LE(Math.round(Math.sin(i * frequency * 2 * Math.PI / rate) * 1000), 44 + i * 2);
  return data;
}

try {
  const channel = process.env.BROWSER_CHANNEL ?? 'msedge';
  browser = await chromium.launch({ headless: true, ...(channel === 'chromium' ? {} : { channel }) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.exposeBinding('reportBrowserError', (_source, message) => errors.push(phase + ': ' + message));
  await context.route('**/*', route => {
    requestCount++;
    const url = new URL(route.request().url());
    if (url.origin !== origin) { external.push(url.href); return route.abort(); }
    return route.continue();
  });
  await context.addInitScript(() => {
    window.addEventListener('error', event => window.reportBrowserError(event.message));
    window.addEventListener('unhandledrejection', event => window.reportBrowserError(String(event.reason)));
    if (location.protocol !== 'http:') return;
    localStorage.setItem('access_token', '{"value":"expired-test-token","expiry":0}');
    window.__policyViolations = [];
    window.__audioCount = 0;
    const NativeAudio = window.Audio;
    window.Audio = class extends NativeAudio {
      constructor(...args) { super(...args); window.__audioCount++; }
    };
    document.addEventListener('securitypolicyviolation', event => {
      window.__policyViolations.push(`${event.violatedDirective}: ${event.blockedURI}`);
    });
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', msg => { if (msg.type() === 'error' || msg.type() === 'warning') errors.push(msg.text()); });
  page.on('response', response => { if (response.status() >= 400) failedResponses.push(response.url()); });
  page.on('websocket', socket => {
    const url = new URL(socket.url());
    if (url.hostname !== '127.0.0.1' || url.port !== String(port)) external.push(url.href);
  });
  const bar = page.getByRole('contentinfo', { name: 'Player', exact: true });
  const waitPlaying = async name => {
    await bar.getByText(name, { exact: true }).waitFor();
    await page.waitForFunction(() => {
      const audio = document.querySelector('audio');
      return audio && !audio.paused && audio.readyState >= 2 && audio.currentTime > .05;
    });
    await bar.getByText('Playing', { exact: true }).waitFor();
  };
  const setRange = async (label, value) => {
    await page.getByRole('slider', { name: label, exact: true }).evaluate((element, next) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, String(next));
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
  };
  const drop = async files => {
    const transfer = await page.evaluateHandle(items => {
      const data = new DataTransfer();
      for (const item of items) data.items.add(new File([Uint8Array.from(atob(item.base64), c => c.charCodeAt(0))],
        item.name, { type: 'audio/wav', lastModified: 1234 }));
      return data;
    }, files);
    await page.locator('.offline-file-drop-zone').dispatchEvent('dragenter', { dataTransfer: transfer });
    await page.getByText('Drop to import music', { exact: true }).waitFor();
    await page.locator('.offline-file-drop-zone').dispatchEvent('drop', { dataTransfer: transfer });
    await transfer.dispose();
  };

  await page.goto(origin);
  await page.getByRole('heading', { name: 'Your library is empty' }).last().waitFor();
  assert.equal(await page.locator('tbody tr').count(), 0);
  assert.equal(await bar.getByRole('button', { name: 'Play', exact: true }).isDisabled(), true);
  assert.equal(await page.locator('audio').count(), 1);
  assert.equal(await page.evaluate(() => window.__audioCount), 1);
  assert.equal(await page.evaluate(async () => (await document.fonts.load('700 16px "Spotify Mix"')).length), 1);
  await page.evaluate(() => {
    window.__firstAudio = document.querySelector('audio');
    window.__endedCount = 0;
    window.__firstAudio.addEventListener('ended', () => window.__endedCount++);
  });
  await mkdir('test-results/fixtures', { recursive: true });
  await page.screenshot({ path: 'test-results/playback-empty.png' });

  phase = 'file picker';
  const fixtureA = resolve('test-results/fixtures/Track A.wav');
  const fixtureB = resolve('test-results/fixtures/Track B.wav');
  const broken = resolve('test-results/fixtures/Broken.wav');
  await writeFile(fixtureA, wav(12)); await writeFile(fixtureB, wav(8, 330));
  await writeFile(broken, 'This is not a decodable audio file.');
  await page.getByRole('button', { name: 'Import music', exact: true }).first().click();
  const input = page.getByLabel('Choose audio files', { exact: true });
  await input.setInputFiles([fixtureA, fixtureB, broken]);
  await page.getByRole('dialog').getByRole('status').filter({ hasText: 'Added 3 files' }).waitFor();
  await input.setInputFiles(fixtureA);
  await page.getByRole('dialog').getByRole('status').filter({ hasText: 'Skipped 1 duplicate' }).waitFor();
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await drop([{ name: 'Track C.wav', base64: wav(6, 440).toString('base64') }]);
  await page.getByRole('button', { name: 'Track C.wav Local file', exact: true }).waitFor();
  assert.equal(await page.locator('tbody tr').count(), 4);
  phase = 'import notification timeout';
  await page.locator('.offline-import-feedback').waitFor({ state: 'visible' });
  await page.locator('.offline-import-feedback').waitFor({ state: 'hidden', timeout: 5000 });
  const duplicateDrop = [{ name: 'Track C.wav', base64: wav(6, 440).toString('base64') }];
  await drop(duplicateDrop);
  await page.waitForTimeout(2200);
  await drop(duplicateDrop);
  await page.waitForTimeout(2200);
  assert.equal(await page.locator('.offline-import-feedback').isVisible(), true);
  await page.locator('.offline-import-feedback').waitFor({ state: 'hidden', timeout: 2500 });
  checks.push('import notification hides after four seconds and repeated messages restart its timer');
  checks.push('multi-file picker, duplicate filtering and drag import');

  phase = 'play and pause';
  await page.getByRole('button', { name: 'Track A.wav Local file', exact: true }).click();
  await waitPlaying('Track A.wav');
  assert.equal(await page.evaluate(() => document.querySelector('audio').duration), 12);
  await bar.getByRole('button', { name: 'Pause', exact: true }).click();
  const pausedAt = await page.evaluate(() => document.querySelector('audio').currentTime);
  await page.waitForTimeout(250);
  assert.ok(Math.abs(await page.evaluate(() => document.querySelector('audio').currentTime) - pausedAt) < .05);
  await bar.getByRole('button', { name: 'Play', exact: true }).click();
  await waitPlaying('Track A.wav');
  checks.push('real decoding, duration, play, pause and resume');

  phase = 'navigation during playback';
  const before = await page.evaluate(() => document.querySelector('audio').currentTime);
  await page.getByRole('link', { name: /Local tracks/ }).click();
  await page.getByRole('textbox', { name: 'Search local music' }).fill('Track B');
  await page.getByRole('heading', { name: 'Search local music', exact: true }).waitFor();
  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await page.waitForFunction(time => document.querySelector('audio').currentTime > time + .1, before);
  assert.equal(await page.evaluate(() => document.querySelector('audio') === window.__firstAudio && window.__audioCount === 1), true);
  checks.push('SPA navigation retains the same playing audio instance and position');

  phase = 'seek and volume';
  await bar.getByRole('button', { name: 'Pause', exact: true }).click();
  const seekBox = await page.getByRole('slider', { name: 'Playback progress', exact: true }).boundingBox();
  await page.mouse.move(seekBox.x + 8, seekBox.y + seekBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(seekBox.x + seekBox.width * .55, seekBox.y + seekBox.height / 2, { steps: 6 });
  await page.mouse.up();
  assert.ok(Math.abs(await page.evaluate(() => document.querySelector('audio').currentTime) - 6.6) < .5);
  await setRange('Volume', .35);
  await page.waitForFunction(() => Math.abs(document.querySelector('audio').volume - .35) < .001);
  await bar.getByRole('button', { name: 'Play', exact: true }).click();
  await waitPlaying('Track A.wav');
  checks.push('pointer seeking and audio volume events');

  phase = 'next and previous';
  await bar.getByRole('button', { name: 'Next', exact: true }).click(); await waitPlaying('Track B.wav');
  await bar.getByRole('button', { name: 'Previous', exact: true }).click(); await waitPlaying('Track A.wav');
  await setRange('Playback progress', 11.8);
  await waitPlaying('Track B.wav');
  checks.push('previous, next and automatic continuation on the actual ended event');

  phase = 'repeat all and one';
  await page.getByRole('button', { name: 'Track C.wav Local file', exact: true }).click();
  await waitPlaying('Track C.wav');
  await bar.getByRole('button', { name: 'Repeat: Off', exact: true }).click();
  await setRange('Playback progress', 5.8); await waitPlaying('Track A.wav');
  await bar.getByRole('button', { name: 'Repeat: All', exact: true }).click();
  const endedBefore = await page.evaluate(() => window.__endedCount);
  await setRange('Playback progress', 11.8);
  await page.waitForFunction(count => window.__endedCount > count && document.querySelector('audio').currentTime < 2, endedBefore);
  await waitPlaying('Track A.wav');
  await bar.getByRole('button', { name: 'Next', exact: true }).click(); await waitPlaying('Track B.wav');
  checks.push('repeat all, repeat one and manual skip');

  phase = 'shuffle and queue';
  await bar.getByRole('button', { name: 'Shuffle', exact: true }).click();
  await bar.getByRole('button', { name: 'Playback queue', exact: true }).click();
  const queue = page.getByRole('dialog', { name: 'Playback queue', exact: true });
  assert.equal(await queue.locator('li').count(), 4);
  assert.match(await queue.locator('li').first().innerText(), /Track B/);
  const queueNames = await queue.locator('li button > span').allTextContents();
  assert.equal(new Set(queueNames).size, 4);
  await queue.getByRole('button', { name: 'Track C.wav Local file', exact: true }).click();
  await waitPlaying('Track C.wav');
  await page.screenshot({ path: 'test-results/playback-queue.png' });
  await queue.getByRole('button', { name: 'Close', exact: true }).click();
  await bar.getByRole('button', { name: 'Shuffle', exact: true }).click();
  await bar.getByRole('button', { name: 'Repeat: One', exact: true }).click();
  checks.push('shuffle is a unique queue permutation; queue selection controls the singleton');

  phase = 'decode failure and recovery';
  await page.getByRole('button', { name: 'Broken.wav Local file', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: /cannot be decoded/ }).waitFor();
  await waitPlaying('Track C.wav');
  await page.screenshot({ path: 'test-results/playback-error.png' });
  await page.getByRole('button', { name: 'Dismiss playback error', exact: true }).click();
  await setRange('Playback progress', 5.8);
  await bar.getByText('Playback ended', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.querySelector('audio').paused), true);
  await page.getByRole('button', { name: 'Track C.wav Local file', exact: true }).click();
  await waitPlaying('Track C.wav');
  await page.getByRole('button', { name: 'Remove Track C.wav', exact: true }).click();
  await waitPlaying('Track B.wav');
  for (const name of ['Track A.wav', 'Track B.wav', 'Broken.wav']) {
    await page.getByRole('button', { name: 'Remove ' + name, exact: true }).click();
  }
  assert.equal(await page.evaluate(() => document.querySelector('audio').hasAttribute('src')), false);
  await drop([
    { name: 'Bad one.wav', base64: Buffer.from('broken one').toString('base64') },
    { name: 'Bad two.wav', base64: Buffer.from('broken two').toString('base64') },
  ]);
  await page.getByRole('button', { name: 'Bad one.wav Local file', exact: true }).click();
  await bar.getByText('Unable to play this file', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.querySelector('audio').paused), true);
  assert.equal(await page.evaluate(() => window.__audioCount), 1);
  checks.push('broken audio shows a message and skips; all-broken queue stops; removal detaches sources');

  for (const name of ['Bad one.wav', 'Bad two.wav']) {
    await page.getByRole('button', { name: 'Remove ' + name, exact: true }).click();
    await page.getByRole('button', { name: 'Remove ' + name, exact: true }).waitFor({ state: 'detached' });
  }

  for (const path of ['/', '/collection/tracks', '/search?q=test', '/users/old-user', '/playlist/old', '/?code=old']) {
    phase = path;
    policyViolations.push(...await page.evaluate(() => window.__policyViolations));
    await page.goto(origin + path);
    await page.getByRole('heading', { name: 'Your library is empty' }).last().waitFor();
    assert.equal(await page.locator('tbody tr').count(), 0);
    assert.equal(await page.evaluate(() => window.__audioCount), 1);
  }
  for (const width of [900, 768, 390, 320]) {
    phase = 'resize to ' + width;
    await page.setViewportSize({ width, height: 844 });
    await page.getByRole('heading', { name: 'Your library is empty' }).last().waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `Overflow at ${width}px`);
    if (width === 390) {
      await page.screenshot({ path: 'test-results/playback-mobile.png' });
      await page.getByRole('button', { name: 'Open library', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Import music', exact: true }).first().click();
      await page.getByRole('dialog', { name: 'Import local music', exact: true }).getByRole('button', { name: 'Close', exact: true }).click();
    }
  }
  await page.waitForTimeout(500);
  policyViolations.push(...await page.evaluate(() => window.__policyViolations));
  assert.deepEqual(external, [], 'External requests attempted');
  assert.deepEqual(errors, [], 'Browser runtime errors or warnings');
  assert.deepEqual(failedResponses, [], 'HTTP failures');
  assert.deepEqual(policyViolations, [], 'CSP violations');
  checks.push('removed files stay removed on refresh; legacy routes recover; responsive English UI and local font');
  const report = { mode: development ? 'development' : 'production', requestCount, checks, external, errors, failedResponses, policyViolations, result: 'passed' };
  await writeFile(`test-results/playback-${report.mode}.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(JSON.stringify({ phase, errors, external, failedResponses, policyViolations }, null, 2));
  throw error;
} finally {
  await browser?.close();
  if (server) {
    if (development) await server.close();
    else await new Promise(resolve => server.httpServer.close(resolve));
  }
}
