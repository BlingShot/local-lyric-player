import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DesktopConfig } from '../electron/config.mjs';
import { DesktopFonts } from '../electron/font-store.mjs';

test('Desktop fonts keep independent selections, reuse identical bytes and remove unused copies', async () => {
  await mkdir('test-results', { recursive: true });
  const folder = await mkdtemp(path.resolve('test-results/font-store-'));
  const config = new DesktopConfig(folder), fonts = new DesktopFonts(config);
  const bytes = new Uint8Array(await readFile('tests/fixtures/fonts/DMSans-Variable.woff2'));
  await Promise.all([fonts.set('app', { kind: 'file', name: 'DM Sans.woff2', bytes }), fonts.set('lyrics', { kind: 'file', name: 'Lyrics.woff2', bytes })]);
  assert.equal((await readdir(fonts.directory)).length, 1);
  assert.deepEqual((await fonts.get('lyrics')).bytes, bytes);
  const saved = JSON.parse(await readFile(config.file, 'utf8')).settings.fonts;
  assert.equal(saved.app.file, saved.lyrics.file);
  assert.ok(!JSON.stringify(saved).includes('bytes'));
  await fonts.set('app', { kind: 'installed', family: 'Arial' });
  assert.equal((await readdir(fonts.directory)).length, 1);
  assert.equal((await new DesktopFonts(new DesktopConfig(folder)).get('app')).family, 'Arial');
  await fonts.set('lyrics', { kind: 'system' });
  assert.equal((await readdir(fonts.directory)).length, 0);
});

test('Invalid fonts and failed config writes preserve the previous selection without orphan copies', async () => {
  const folder = await mkdtemp(path.resolve('test-results/font-store-'));
  const config = new DesktopConfig(folder), fonts = new DesktopFonts(config);
  await fonts.set('app', { kind: 'installed', family: 'Arial' });
  assert.throws(() => fonts.set('../outside', { kind: 'system' }), /Invalid font target/);
  await assert.rejects(fonts.set('app', { kind: 'file', name: 'bad.ttf', bytes: new Uint8Array(16) }), /valid TTF/);
  assert.equal((await fonts.get('app')).family, 'Arial');
  const originalSet = config.set.bind(config); config.set = () => Promise.reject(new Error('Simulated write failure'));
  await assert.rejects(fonts.set('app', { kind: 'file', name: 'test.woff2', bytes: new Uint8Array(await readFile('tests/fixtures/fonts/DMSans-Variable.woff2')) }), /Simulated/);
  assert.equal((await readdir(fonts.directory)).length, 0);
  config.set = originalSet; assert.equal((await fonts.get('app')).family, 'Arial');
  await config.set('fonts', { app: { kind: 'file', file: '../../outside', name: 'bad' } });
  await assert.rejects(fonts.get('app'), /Invalid saved font/);
  const oversized = 'a'.repeat(64) + '.font'; await writeFile(path.join(fonts.directory, oversized), Buffer.alloc(32 * 1024 * 1024 + 1));
  await config.set('fonts', { app: { kind: 'file', file: oversized, name: 'big.ttf' } });
  await assert.rejects(fonts.get('app'), /exceeds 32 MB/);
});
