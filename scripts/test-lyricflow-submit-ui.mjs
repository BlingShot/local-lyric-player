import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const server = await createServer({ server: { host: '127.0.0.1', port: 3029, strictPort: true } });
let browser, page; const errors = [];
try {
  await server.listen(); browser = await chromium.launch({ channel: 'msedge', headless: true }); page = await browser.newPage({ locale: 'en-US', viewport: { width: 1100, height: 900 } });
  page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message));
  const html = await server.transformIndexHtml('/__submit_test', '<!doctype html><html><head></head><body><div id="root"></div></body></html>');
  await page.route('**/__submit_test', route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.route('https://**', route => route.abort());
  await page.goto('http://127.0.0.1:3029/__submit_test');
  await page.evaluate(async () => { window.fixture = await (await import('/tests/lyricflow-submit-ui.tsx')).mountSubmissionTest(); });
  await page.getByRole('button', { name: 'Open submission', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /Integration song/ }).click();
  await dialog.getByRole('checkbox', { name: 'This is the same recording' }).check();
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.evaluate(() => { window.fixture.project.lines[0].text = 'Later local edits'; });
  await dialog.getByRole('button', { name: 'Save private draft for review' }).click();
  await dialog.getByLabel('Source', { exact: true }).selectOption('unknown');
  await dialog.getByLabel('Source declaration').fill('Source not confirmed; line timing transcribed locally.');
  await dialog.getByRole('button', { name: 'Submit for review' }).click();
  await dialog.getByRole('button', { name: 'Recover submission result' }).waitFor();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Open submission', exact: true }).click();
  await dialog.getByText('Saved upload tasks', { exact: true }).click();
  await dialog.getByRole('button', { name: 'Resume saved snapshot' }).click();
  await dialog.getByRole('button', { name: 'Recover submission result' }).click();
  await dialog.getByRole('button', { name: 'Withdraw submission' }).waitFor();
  const result = await page.evaluate(() => ({ calls: window.fixture.calls, creates: window.fixture.creates.size, submissions: window.fixture.submissions.size }));
  assert.equal(result.creates, 1); assert.equal(result.submissions, 1);
  const submitted = result.calls.filter(call => call.operation === 'submit');
  assert.equal(submitted.length, 2); assert.deepEqual(submitted[0].input, submitted[1].input);
  assert.equal(result.calls.find(call => call.operation === 'saveDraft').input.content.text.lines[0].text, 'Frozen original words');
  await mkdir('test-results/lyricflow', { recursive: true });
  await page.screenshot({ path: 'test-results/lyricflow/submission.png' });
  await dialog.getByRole('button', { name: 'Withdraw submission' }).click();
  await dialog.getByRole('status').filter({ hasText: 'Withdrawn' }).waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS StrictMode UI, frozen snapshot, explicit source, saved-before-send, lost-response close/reopen recovery, one submission and withdrawal');
} catch (error) { if (page) { await mkdir('test-results/lyricflow', { recursive: true }); await page.screenshot({ path: 'test-results/lyricflow/submission-failure.png' }); console.error(await page.locator('body').innerText()); } throw error; }
finally { await browser?.close(); await server.close(); }
