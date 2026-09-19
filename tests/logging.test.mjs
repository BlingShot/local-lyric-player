import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DesktopLogger } from '../electron/logging.mjs';
import { redactLogText, sanitizeLogEntry } from '../electron/log-redaction.mjs';
import { allowedRequest } from '../electron/policy.mjs';
import { DesktopConfig } from '../electron/config.mjs';

test('logs redact bearer tokens, named secrets, API keys and URL queries', () => {
  const value = redactLogText('Bearer abc123 api_key=privateKey refreshToken="secret123" sk-123456789abc https://example.com/?token=hidden');
  for (const secret of ['abc123', 'privateKey', 'secret123', 'sk-123456789abc', 'token=hidden']) assert.equal(value.includes(secret), false);
  assert.throws(() => sanitizeLogEntry({ level: 'debug', scope: '../bad', message: 'x' }));
});
test('debug defaults off, rotates to at most three log files and preserves errors', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lyric-logs-'));
  try {
    const logger = new DesktopLogger(root, { maxBytes: 1024 });
    await logger.write({ level: 'debug', scope: 'test', message: 'hidden-debug' });
    assert.equal(await logger.read(), '');
    logger.setDebug(true);
    assert.equal(logger.level, 'info');
    await logger.write({ level: 'debug', scope: 'test', message: 'below-info-threshold' });
    assert.equal(await logger.read(), '', 'Debug mode does not override the selected recording level');
    logger.setLevel('debug');
    for (let i = 0; i < 50; i++) await logger.write({ level: 'debug', scope: 'test', message: `${i}: ${'x'.repeat(200)}` });
    await logger.write({ level: 'error', scope: 'test', message: 'last-error' });
    assert.equal((await readdir(logger.directory)).length, 3);
    const text = await logger.read(); assert.ok(text.includes('last-error')); assert.ok(text.length < 4096);
    logger.setDebug(false); await logger.write({ level: 'debug', scope: 'test', message: 'hidden-again' }); assert.ok(!(await logger.read()).includes('hidden-again'));
    const config = new DesktopConfig(root); await assert.rejects(config.set('diagnostics', { debug: 'true' }));
    await config.set('diagnostics', { debug: true });
    assert.deepEqual(await config.get('diagnostics'), { debug: true, level: 'info' });
    for (const level of ['debug', 'info', 'warn', 'error', 'fatal']) {
      await config.set('diagnostics', { debug: false, level });
      assert.deepEqual(await new DesktopConfig(root).get('diagnostics'), { debug: false, level });
    }
    await assert.rejects(config.set('diagnostics', { debug: true, level: 'invalid' }));
    assert.deepEqual(await config.get('diagnostics'), { debug: false, level: 'fatal' });
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('repository fallback grants access only to the exact official index and safe TTML paths', () => {
  const base = 'https://raw.githubusercontent.com/amll-dev/amll-ttml-db/main/';
  assert.equal(allowedRequest(base + 'metadata/raw-lyrics-index.jsonl'), true);
  assert.equal(allowedRequest(base + 'raw-lyrics/1768754400682-123-abc.ttml'), true);
  for (const value of [base + 'README.md', base + 'raw-lyrics/other.json', base + 'raw-lyrics/a.ttml?token=x', base.replace('amll-dev', 'attacker') + 'raw-lyrics/a.ttml']) assert.equal(allowedRequest(value), false);
});
