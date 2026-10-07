import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const server = await createServer({ server: { host: '127.0.0.1', port: 3038, strictPort: true } });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const html = await server.transformIndexHtml('/__lyricflow_upload_test', '<!doctype html><html><head></head><body></body></html>');
  await page.route('**/__lyricflow_upload_test', route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.route('https://**', route => route.abort());
  await page.goto('http://127.0.0.1:3038/__lyricflow_upload_test');
  const checks = await page.evaluate(async () => (await import('/tests/lyricflow-upload-browser.ts')).runLyricFlowUploadBrowserTests());
  assert.deepEqual(errors, []); console.log(checks.map(check => 'PASS ' + check).join('\n'));
} finally { await browser?.close(); await server.close(); }
