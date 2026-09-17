import { readdir, stat, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
async function files(root, prefix = '') {
  const result = [];
  for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
    const name = path.join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...await files(root, name));
    else if (entry.isFile()) result.push({ path: name.split(path.sep).join('/'), bytes: (await stat(path.join(root, name))).size });
  }
  return result;
}
const payload = await files('.cache/desktop-app'), bytes = payload.reduce((sum, file) => sum + file.bytes, 0);
assert.ok(bytes < 8 * 1024 * 1024, `Desktop app payload exceeded 8 MiB: ${bytes}`);
assert.ok(!payload.some(file => /(?:node_modules\/|test-results\/|\.map$|\.log$|\.(?:safetensors|ckpt|pt)$)/.test(file.path)), 'Development, model or diagnostic artifacts leaked into the package');
const wasm = payload.filter(file => file.path.endsWith('.wasm'));
assert.equal(wasm.length, 1, 'Ship exactly one local analysis WASM asset');
const pkg = JSON.parse(await readFile('.cache/desktop-app/package.json', 'utf8'));
assert.deepEqual(pkg.dependencies, {}, 'Renderer dependencies must not be duplicated in the app package');
const installers = (await readdir('release').catch(() => [])).filter(name => name.endsWith('.exe'));
const report = { version: pkg.version, appPayloadBytes: bytes, limitBytes: 8 * 1024 * 1024, largest: [...payload].sort((a, b) => b.bytes - a.bytes).slice(0, 12),
  nativeDecoderBytes: (await stat('desktop/native/mpv.exe')).size,
  installers: await Promise.all(installers.map(async name => ({ name, bytes: (await stat(path.join('release', name))).size }))) };
await mkdir('test-results', { recursive: true }); await writeFile('test-results/package-size.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
