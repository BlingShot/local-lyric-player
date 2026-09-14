import { chromium } from 'playwright';
import { preview } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { taggedWav, png } from './library-fixtures.mjs';

const origin = 'http://127.0.0.1:4175';
const profile = resolve(`test-results/reopen-profile-${Date.now()}`);
const fixture = resolve('test-results/fixtures/reopen.wav');
await mkdir('test-results/fixtures', { recursive: true });
await writeFile(fixture, taggedWav({ TIT2: 'Saved across browser restarts', TPE1: 'Local artist', TALB: 'Local album', TPE2: 'Local artist' }, [{ type: 3, data: png(0, 255, 0) }]));
const server = await preview({ preview: { host: '127.0.0.1', port: 4175, strictPort: true } });
let context;
const external = [], errors = [];
const launch = async () => {
  const ctx = await chromium.launchPersistentContext(profile, { headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' });
  await ctx.route('**/*', route => {
    if (new URL(route.request().url()).origin !== origin) { external.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  for (const page of ctx.pages()) page.on('pageerror', error => errors.push(error.message));
  return ctx;
};
try {
  context = await launch();
  let page = context.pages()[0];
  await page.goto(origin); await page.getByRole('heading', { name: 'Your library is empty' }).last().waitFor();
  await page.getByRole('button', { name: 'Import music', exact: true }).first().click();
  await page.getByLabel('Choose audio files', { exact: true }).setInputFiles(fixture);
  await page.getByRole('status').filter({ hasText: 'Added 1 files' }).waitFor();
  await context.close();
  context = await launch(); page = context.pages()[0];
  await page.goto(origin);
  const track = page.getByRole('button', { name: 'Saved across browser restarts Local artist', exact: true });
  await track.waitFor();
  assert.equal(await page.locator('tbody tr').count(), 1);
  assert.match(await track.locator('img').getAttribute('src'), /^blob:/);
  await track.click();
  await page.waitForFunction(() => { const audio = document.querySelector('audio'); return !audio.paused && audio.currentTime > .1; });
  assert.deepEqual(external, []); assert.deepEqual(errors, []);
  const report = { result: 'passed', check: 'A full browser process close and relaunch with the same profile restores the saved audio, tags and embedded cover; restored audio plays.', external, errors };
  await writeFile('test-results/library-reopen.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await context?.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
