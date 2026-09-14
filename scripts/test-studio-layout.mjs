import { chromium } from 'playwright';
import { preview } from 'vite';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const server = await preview({ preview: { host: '127.0.0.1', port: 4196, strictPort: true } });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:4196/studio');
  await page.getByLabel('Lyrics line 1', { exact: true }).waitFor();
  const measurements = [];
  for (const width of [1440, 900]) {
    await page.setViewportSize({ width, height: 940 });
    await page.getByRole('button', { name: 'TTML Studio', exact: true }).click();
    const result = await page.evaluate(() => {
      const head = document.querySelector('.studio-row-head'), row = document.querySelector('.studio-row');
      return { width: innerWidth, endDelta: Math.abs(head.children[3].getBoundingClientRect().x - row.children[3].getBoundingClientRect().x), overflow: document.documentElement.scrollWidth - innerWidth };
    });
    assert.ok(result.endDelta < 3, JSON.stringify(result));
    assert.ok(result.overflow <= 0);
    measurements.push(result);
  }
  await writeFile('test-results/studio-column-alignment.json', JSON.stringify(measurements, null, 2));
  console.log(measurements);
} finally { await browser.close(); await server.httpServer.close(); }
