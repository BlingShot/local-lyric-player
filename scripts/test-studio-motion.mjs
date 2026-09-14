import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { taggedWav } from './library-fixtures.mjs';

// Headless only: never raise a browser over the user's desktop.
const root = resolve('test-results/studio-motion'); await mkdir(root, { recursive: true });
const origin = 'http://127.0.0.1:4197';
const server = await createServer({ server: { host: '127.0.0.1', port: 4197, strictPort: true, watch: null } }); await server.listen();
let browser, page, phase = 'setup'; const errors = [], external = [], checks = [];
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1600, height: 1000 } });
  await context.route('**/*', route => { if (new URL(route.request().url()).origin !== origin) { external.push(route.request().url()); return route.abort(); } return route.continue(); });
  page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + '/studio'); await page.getByLabel('Lyrics line 1', { exact: true }).waitFor();
  const audioPath = resolve(root, 'Motion.wav'); await writeFile(audioPath, taggedWav({ TIT2: 'Motion fixture', TPE1: 'Local test' }, [], undefined, 100));
  await page.getByLabel('Choose studio audio', { exact: true }).setInputFiles(audioPath);
  await page.waitForFunction(() => document.querySelector('audio')?.duration === 100);
  const project = await page.evaluate(async () => {
    const m = await import('/src/studio/project.ts');
    const p = m.newProject('motion', 'Motion.wav');
    p.lines = Array.from({ length: 24 }, (_, i) => {
      const l = m.vocalLine(`Line ${i + 1} carries the melody`);
      l.id = `motion-${i}`; l.startMs = 1000 + i * 2500 + (i >= 12 ? 12000 : 0); l.endMs = l.startMs + 2100;
      l.units.filter(w => w.kind === 'word').forEach((w, n) => { w.startMs = l.startMs + n * 300; w.endMs = w.startMs + 250; }); return l;
    });
    const bg = m.vocalLine('Harmony', 'background', p.lines[8].id); bg.id = 'harmony'; bg.startMs = p.lines[8].startMs; bg.endMs = p.lines[8].endMs; bg.units[0].startMs = bg.startMs; bg.units[0].endMs = bg.endMs;
    p.lines.splice(9, 0, bg); p.selectedId = p.lines[0].id; p.settings.mode = 'word'; return p;
  });
  const projectPath = resolve(root, 'Motion.lyric-studio.json'); await writeFile(projectPath, JSON.stringify(project));
  await page.getByLabel('Choose studio project', { exact: true }).setInputFiles(projectPath);
  await page.getByRole('button', { name: 'Use imported project', exact: true }).click();
  await page.getByRole('dialog', { name: 'Import into Lyric Studio', exact: true }).waitFor({ state: 'hidden' });
  await page.locator('.studio-live-preview').waitFor(); await page.waitForTimeout(900);
  const seek = async time => { await page.evaluate(time => { const a = document.querySelector('audio'); a.pause(); a.currentTime = time; }, time); };
  const resumeEditor = async () => { const b = page.getByRole('button', { name: 'Follow playback', exact: true }); if (await b.isVisible()) await b.click(); };
  await resumeEditor();
  phase = 'smooth seek';
  const samples = await page.evaluate(async () => {
    const audio = document.querySelector('audio'), editor = document.querySelector('.studio-rows'), preview = document.querySelector('.studio-live-preview');
    audio.pause(); audio.currentTime = 22;
    const samples = [], start = performance.now();
    await new Promise(resolve => { const frame = () => { samples.push([performance.now() - start, editor.scrollTop, preview.scrollTop]); if (performance.now() - start < 1100) requestAnimationFrame(frame); else resolve(); }; requestAnimationFrame(frame); });
    return samples;
  });
  for (const [index, label] of [[1, 'editor'], [2, 'preview']]) {
    const values = samples.map(s => s[index]), end = values.at(-1);
    assert.ok(end > 50, `${label} reached later cue`);
    assert.ok(new Set(values.map(Math.round)).size > 8, `${label} has intermediate animation frames`);
    assert.ok(values.slice(0, -1).some(v => v > 10 && v < end - 10), `${label} does not snap`);
  }
  assert.equal(await page.locator('.studio-preview-line[data-active]').count(), 2, 'overlapping voices stay active');
  assert.equal(await page.locator('.studio-row[data-selected]').getAttribute('data-line-id'), 'motion-0', 'following does not replace editing selection');
  checks.push('Both scrolling regions animate on media seek; lead/background stay simultaneously active; editor selection stays unchanged');
  phase = 'word progress';
  await seek(21.125);
  await page.waitForFunction(() => document.querySelector('[data-preview-line="motion-8"] [data-preview-word]').dataset.progress === '50.00');
  const word = await page.locator('[data-preview-line="motion-8"] [data-preview-word]').first().evaluate(node => ({ fill: node.style.getPropertyValue('--studio-word-progress'), clip: getComputedStyle(node).backgroundClip }));
  assert.equal(word.fill, '50.00%'); assert.equal(word.clip, 'text');
  await seek(21.0625); await page.waitForFunction(() => Number(document.querySelector('[data-preview-line="motion-8"] [data-preview-word]').dataset.progress) < 26);
  checks.push('Word fill uses recorded millisecond bounds (50% at midpoint), updates while paused and seeking backwards');
  phase = 'playback crossing';
  await seek(23.35); await page.waitForTimeout(900);
  const crossing = await page.evaluate(async () => {
    const a = document.querySelector('audio'), el = document.querySelector('.studio-rows'); const before = el.scrollTop;
    await a.play(); await new Promise(resolve => setTimeout(resolve, 900)); a.pause(); return [before, el.scrollTop];
  });
  assert.ok(crossing[1] > crossing[0] + 5, 'editor follows naturally crossed cue');
  checks.push('Normal playback advances editor scroll without clicks');
  phase = 'editing and manual browsing';
  await page.getByLabel('Lyrics line 2', { exact: true }).focus();
  const selection = await page.locator('.studio-row[data-selected]').getAttribute('data-line-id');
  await page.waitForTimeout(300);
  const editTop = await page.locator('.studio-rows').evaluate(n => n.scrollTop);
  await seek(61); await page.waitForTimeout(900);
  assert.equal(await page.locator('.studio-rows').evaluate(n => n.scrollTop), editTop, 'typing focus stops following');
  assert.equal(await page.locator('.studio-row[data-selected]').getAttribute('data-line-id'), selection);
  await page.getByRole('button', { name: 'Follow playback', exact: true }).click(); await page.waitForTimeout(900);
  assert.ok(await page.locator('.studio-rows').evaluate(n => n.scrollTop) > editTop + 100);
  await page.locator('.studio-live-preview').hover(); await page.mouse.wheel(0, -320); await page.waitForTimeout(400);
  const manualTop = await page.locator('.studio-live-preview').evaluate(n => n.scrollTop);
  await seek(68); await page.waitForTimeout(900);
  assert.equal(await page.locator('.studio-live-preview').evaluate(n => n.scrollTop), manualTop);
  await page.getByRole('button', { name: 'Resume preview', exact: true }).click(); await page.waitForTimeout(900);
  assert.notEqual(await page.locator('.studio-live-preview').evaluate(n => n.scrollTop), manualTop);
  const beforeArrow = await page.locator('.studio-row[data-selected]').getAttribute('data-line-id');
  await page.locator('.studio-live-preview').focus(); await page.keyboard.press('ArrowUp');
  assert.equal(await page.locator('.studio-row[data-selected]').getAttribute('data-line-id'), beforeArrow, 'preview navigation cannot trigger recording shortcuts');
  await page.getByRole('button', { name: 'Resume preview', exact: true }).click();
  checks.push('Editing and manual scrolling pause following; explicit resume restores it smoothly');
  phase = 'gaps and accessibility';
  await seek(35); await page.waitForTimeout(850);
  assert.equal(await page.locator('.studio-preview-line[data-active]').count(), 0);
  assert.equal(await page.locator('.studio-preview-interlude[data-active]').count(), 1);
  assert.equal(await page.locator('.studio-interlude[data-playing]').count(), 1);
  await page.getByRole('button', { name: 'Seek preview: Line 13 carries the melody', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('audio').currentTime === 43);
  assert.equal(await page.locator('audio').evaluate(a => a.paused), true, 'preview seek preserves paused state');
  await page.emulateMedia({ reducedMotion: 'reduce' }); await seek(58.5); await page.waitForTimeout(100);
  assert.ok(await page.locator('.studio-rows').evaluate(n => n.scrollTop) > 700);
  await page.setViewportSize({ width: 900, height: 1000 }); await page.waitForTimeout(350);
  assert.ok(await page.locator('.studio-rows').evaluate(n => n.clientHeight) > 180);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: resolve(root, 'studio-motion-900.png') });
  await page.setViewportSize({ width: 1600, height: 1000 }); await page.waitForTimeout(350);
  await page.screenshot({ path: resolve(root, 'studio-motion-1600.png') });
  assert.equal(await page.locator('audio').count(), 1);
  assert.equal(await page.evaluate(() => scrollY), 0);
  checks.push('Interlude takes over after line end, click-to-seek preserves pause; reduced motion, narrow layout and single audio instance verified');
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  await writeFile(resolve(root, 'report.json'), JSON.stringify({ result: 'passed', checks, samples, errors, external }, null, 2)); console.log(JSON.stringify({ result: 'passed', checks }));
} catch (error) { await page?.screenshot({ path: resolve(root, 'failure.png') }).catch(() => {}); await writeFile(resolve(root, 'failure.json'), JSON.stringify({ phase, error: String(error), errors, external }, null, 2)); console.error({ phase, errors, external }); throw error; }
finally { await browser?.close(); await server.close(); }
