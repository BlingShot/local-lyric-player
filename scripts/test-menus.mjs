import { chromium } from 'playwright';
import { preview } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const origin = 'http://127.0.0.1:4191', root = 'test-results/menus';
await mkdir(root, { recursive: true });
const server = await preview({ preview: { host: '127.0.0.1', port: 4191, strictPort: true } });
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1200 } });
const errors = [], external = [], checks = [];
await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : (external.push(route.request().url()), route.abort()));
const page = await context.newPage();
page.on('pageerror', error => errors.push(error.message));
const closed = async trigger => {
  await page.waitForFunction(() => ![...document.querySelectorAll('.app-menu')].some(el => getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width));
  assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
};
try {
  await page.goto(origin);
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  for (const label of ['App theme', 'True-peak ceiling', 'Lyric font']) {
    const trigger = settings.getByRole('combobox', { name: label, exact: true });
    await trigger.scrollIntoViewIfNeeded();
    const field = trigger.locator('..'), box = await field.boundingBox(), button = await trigger.boundingBox();
    const blank = { x: button.x - 14, y: box.y + box.height / 2 };
    const value = await trigger.textContent();
    // Clicking the field's padding/gap must never forward a click to its button.
    await page.mouse.click(blank.x, blank.y);
    assert.equal(await trigger.getAttribute('aria-expanded'), 'false', label + ' opened from whitespace');
    assert.equal(await trigger.textContent(), value);
    await trigger.click();
    const menu = page.getByRole('listbox', { name: label, exact: true });
    await menu.waitFor();
    // Sample the measured positioning box during its actual entrance animation.
    const frames = await menu.evaluate(el => new Promise(resolve => {
      const popup = el.closest('.app-menu'), samples = [], started = performance.now();
      const sample = () => {
        const r = popup.getBoundingClientRect(), style = getComputedStyle(popup);
        if (Number(style.opacity) > .01) samples.push({ x: r.x, y: r.y, width: r.width, height: r.height });
        if (performance.now() - started < 280) requestAnimationFrame(sample); else resolve(samples);
      }; requestAnimationFrame(sample);
    }));
    assert.ok(frames.length >= 3);
    for (const frame of frames) for (const axis of ['x', 'y', 'width', 'height'])
      assert.ok(Math.abs(frame[axis] - frames.at(-1)[axis]) < 1, `${label} placement jumped on ${axis}`);
    // The menu's own padding must not choose an option or reopen the trigger.
    await menu.click({ position: { x: 2, y: 2 } });
    assert.equal(await trigger.textContent(), value);
    assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
    await page.mouse.click(blank.x, blank.y);
    await closed(trigger);
    for (let i = 0; i < 3; i++) { await trigger.click(); await menu.waitFor(); await trigger.click(); await closed(trigger); }
    await trigger.click(); await menu.waitFor();
    const option = menu.getByRole('option').nth(1), chosen = await option.textContent();
    await option.click(); await closed(trigger);
    assert.equal(await trigger.textContent(), chosen);
    await trigger.focus(); await page.keyboard.press('ArrowDown'); await menu.waitFor();
    await page.keyboard.press('Escape'); await closed(trigger);
    checks.push(`${label}: blank field/popup clicks are inert; outside clicks, repeated toggles, selection and keyboard dismissal close once; popup placement stays within 1 px during animation`);
  }
  await settings.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Open app menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Music player', exact: true }).waitFor();
  const location = page.url();
  await page.mouse.click(850, 400);
  await page.getByRole('menuitem', { name: 'Music player', exact: true }).waitFor({ state: 'hidden' });
  assert.equal(page.url(), location);
  checks.push('Logo menu outside click dismisses without navigation');
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  await writeFile(root + '/verification.json', JSON.stringify({ checks, errors, external }, null, 2));
  console.log(JSON.stringify({ checks, errors, external }, null, 2));
} catch (error) { await page.screenshot({ path: root + '/failure.png' }); throw error; }
finally { await browser.close(); await new Promise(resolve => server.httpServer.close(resolve)); }
