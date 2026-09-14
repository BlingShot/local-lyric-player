import { chromium } from 'playwright';
import { preview } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { taggedWav } from './library-fixtures.mjs';
import { selectMenu } from './select-menu.mjs';
import { sampleEntrance, assertEntrance } from './lyric-entrance-checks.mjs';

const root = 'test-results/lyric-motion', origin = 'http://127.0.0.1:4192';
await mkdir(root, { recursive: true });
const server = await preview({ preview: { host: '127.0.0.1', port: 4192, strictPort: true } });
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const errors = [], external = [], checks = [];
await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : (external.push(route.request().url()), route.abort()));
await context.addInitScript(() => { const Audio = window.Audio; window.__audioCount = 0; window.Audio = class extends Audio { constructor(...args) { super(...args); window.__audioCount++; } }; });
const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
const seek = async time => {
  await page.getByRole('slider', { name: 'Playback progress', exact: true }).fill(String(time));
  await page.waitForFunction(time => Math.abs(document.querySelector('audio').currentTime - time) < .05, time);
};
const settle = () => page.waitForFunction(() => [...document.querySelectorAll('.lyrics-scroll')].every(region => {
  if (!region.clientWidth || !region.clientHeight) return true;
  const line = region.querySelector('.lyric-row[data-active]');
  return line && Math.abs(region.scrollTop - Math.max(0, Math.min(region.scrollHeight - region.clientHeight, line.offsetTop - region.clientHeight * .38))) < 1;
}));
try {
  await page.goto(origin); await page.getByRole('button', { name: 'Import music', exact: true }).first().click();
  await page.getByLabel('Choose audio files', { exact: true }).setInputFiles({ name: 'motion.wav', mimeType: 'audio/wav', buffer: taggedWav({}, [], undefined, 80) });
  await page.getByRole('status').filter({ hasText: 'Added 1 file' }).waitFor();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'motion.wav Local file', exact: true }).click();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  // A native pause event can arrive after the click promise. Sample the settled
  // media clock, not a frame from just before the final pause event.
  await page.waitForFunction(() => document.querySelector('audio').paused);
  await page.waitForTimeout(80);
  await page.getByRole('button', { name: 'Lyrics', exact: true }).click();
  await page.getByRole('button', { name: 'Import lyrics', exact: true }).click();
  const ttml = `<tt xmlns="http://www.w3.org/ns/ttml"><body><div>
    <p begin="0s" end="4s">First context</p><p begin="4s" end="8s">Second context</p>
    <p begin="8s" end="18s"><span begin="0s" end="4s">Smooth </span><span begin="4s" end="10s">timing</span></p>
    <p begin="9s" end="16s"><span begin="0s" end="7s">Overlapping voice</span></p>
    ${Array.from({length:500}, (_, i) => `<p begin="${(20+i*.1).toFixed(2)}s" end="${(20+(i+1)*.1).toFixed(2)}s">Context line ${i+1}</p>`).join('')}
    </div></body></tt>`;
  await page.getByLabel('Choose lyric file', { exact: true }).setInputFiles({ name: 'motion.ttml', mimeType: 'text/plain', buffer: Buffer.from(ttml) });
  await page.getByRole('button', { name: 'Save lyrics', exact: true }).click();
  await page.getByRole('button', { name: 'File details', exact: true }).click();
  await selectMenu(page, 'Right sidebar view', 'lyrics');
  await page.waitForFunction(() => document.querySelectorAll('.lyric-row').length === 1008);
  await seek(10); await settle();
  await page.evaluate(() => {
    window.__mutations = { active:0, inactive:0 }; window.__frameGaps = [];
    window.__observer = new MutationObserver(records => records.forEach(record => {
      if (record.target.closest('.lyric-row[data-active]')) window.__mutations.active++;
      else window.__mutations.inactive++;
    }));
    document.querySelectorAll('.lyrics-lines').forEach(el => window.__observer.observe(el, { subtree:true, attributes:true, characterData:true, childList:true }));
    window.__sampling = true; let previous = performance.now();
    const tick = now => { window.__frameGaps.push(now-previous); previous=now; if(window.__sampling) requestAnimationFrame(tick); }; requestAnimationFrame(tick);
  });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('audio').currentTime > 11);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('audio').paused);
  await page.waitForTimeout(80);
  const sample = await page.evaluate(() => {
    window.__sampling=false; window.__observer.disconnect();
    const progress = [...document.querySelectorAll('.lyric-row[data-active] .lyric-word')].map(el=>Number(el.dataset.wordProgress));
    return { mutations:window.__mutations, frameGaps:window.__frameGaps, progress, time:document.querySelector('audio').currentTime };
  });
  assert.equal(sample.mutations.inactive,0,'Inactive context rows must stay untouched during word playback');
  assert.ok(sample.mutations.active>20);
  assert.ok(Math.abs(sample.progress[0]-(sample.time-8)/4)<.005);
  assert.deepEqual(sample.progress.slice(0,3),sample.progress.slice(3));
  await page.waitForTimeout(220);
  assert.deepEqual(await page.locator('.lyric-row[data-active] .lyric-word').evaluateAll(els=>els.map(el=>Number(el.dataset.wordProgress))),sample.progress);
  checks.push('504 lines in each reader: only active words mutate during playback; both readers follow actual audio time and freeze at pause');

  await seek(21); await settle();
  await page.evaluate(() => { window.__positions=[]; window.__scrolling=true; const tick=()=>{window.__positions.push(document.querySelector('.lyrics-scroll').scrollTop);if(window.__scrolling)requestAnimationFrame(tick);};requestAnimationFrame(tick); });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('audio').currentTime>22.2);
  await page.getByRole('button', { name: 'Pause', exact: true }).click(); await settle();
  const positions = await page.evaluate(() => { window.__scrolling=false;return window.__positions; });
  assert.ok(new Set(positions.map(Math.round)).size>20);
  assert.ok(positions.every((y,i)=>!i||y>=positions[i-1]-.5),'Rapid cue retargeting must not bounce backwards');
  await seek(4.5); await settle();
  await page.setViewportSize({ width:1400, height:900 }); await settle();
  checks.push('100 ms consecutive cues retarget continuously without backward bounce; backward seeks and sidebar/layout resize settle on the current line');
  const fullscreenFrames = await sampleEntrance(page, '.lyrics-page .lyrics-scroll', { button: 'button[aria-label="Full screen lyrics"]' });
  const fullscreenEntrance = assertEntrance(fullscreenFrames, 'Fullscreen lyric entrance');
  await page.getByRole('button', { name: 'Exit full screen', exact: true }).click();
  await page.waitForTimeout(1100);
  checks.push('Fullscreen enters with nonlinear lyric scrolling, preserves current media time and settles without overshoot');
  await page.emulateMedia({ reducedMotion:'reduce' }); await seek(20.5); await settle();
  await page.getByRole('button', { name:'Full screen lyrics',exact:true }).click();
  await page.waitForFunction(()=>!!document.querySelector('[data-lyrics-fullscreen]')); await settle();
  assert.equal(await page.locator('.lyrics-page .lyric-line-button').first().evaluate(el=>getComputedStyle(el).fontSize),'48px');
  assert.equal(await page.evaluate(()=>window.__audioCount),1);
  await page.screenshot({path:root+'/fullscreen.png'});
  checks.push('Reduced-motion alignment, fullscreen layout and original 48 px typography remain intact; one audio element');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  const sorted=sample.frameGaps.slice(1).sort((a,b)=>a-b);
  const report={checks,fullscreenEntrance,activeWordMutations:sample.mutations.active,inactiveMutations:sample.mutations.inactive,
    observedFrameIntervalMs:{median:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)]},errors,external};
  await writeFile(root+'/verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
} catch(error) {await page.screenshot({path:root+'/failure.png'});throw error;}
finally {await browser.close();await new Promise(resolve=>server.httpServer.close(resolve));}
