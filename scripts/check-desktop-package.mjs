import assert from 'node:assert/strict';
import { readFile, readdir, stat, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extractFile, listPackage } from '@electron/asar';
import path from 'node:path';

const archive = path.resolve('release/win-unpacked/resources/app.asar');
const staged = path.resolve('.cache/desktop-app');
const entries = listPackage(archive).map(name => name.replaceAll('\\', '/').replace(/^\//, ''));
assert.ok(!entries.some(name => /(^|\/)(node_modules|models|test-results|\.env)(\/|$)/.test(name)));
let checkedFiles = 0;
async function check(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await check(file);
    else {
      const name = path.relative(staged, file).split(path.sep).join('/');
      const contents = extractFile(archive, path.relative(staged, file));
      assert.ok(contents.equals(await readFile(file)), `Archive differs: ${name}`);
      if (/\.(js|css|html|json)$/.test(name)) for (const match of contents.toString().matchAll(/\/(?:fonts|images)\/[a-zA-Z0-9_.-]+/g)) {
        assert.ok(entries.includes(`build${match[0]}`), `Missing local resource: ${match[0]} in ${name}`);
      }
      checkedFiles++;
    }
  }
}
await check(staged);
for (const name of ['LICENSE',
  'build/licenses/DM-Sans-OFL.txt', 'build/licenses/essentia-0.1.3-LICENSE.txt']) assert.ok(entries.includes(name));
assert.ok(!entries.includes('build/images/artist.png'));
assert.ok(!entries.some(name => /\.(?:ttf|otf|woff2?|ttc)$/i.test(name)), 'No bundled fonts');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(hash(await readFile('release/win-unpacked/ffmpeg.dll')), hash(await readFile('node_modules/electron/dist/ffmpeg.dll')));
for (const name of ['LICENSE.electron.txt', 'LICENSES.chromium.html', 'icudtl.dat', 'dxcompiler.dll', 'vk_swiftshader.dll']) {
  assert.ok((await stat(path.join('release/win-unpacked', name))).size > 0);
}
assert.deepEqual((await readdir('release/win-unpacked/locales')).sort(), ['en-US.pak', 'zh-CN.pak']);
const version = JSON.parse(extractFile(archive, 'package.json').toString()).version;
assert.equal(version, JSON.parse(await readFile('package.json', 'utf8')).version);
const exe = `release/Lyric-Player-${version}-Windows-x64.exe`, bytes = await readFile(exe);
const previousBytes = await stat('release/Local-Music-2.0.21-Windows-x64.exe').then(info => info.size).catch(error => {
  if (error.code === 'ENOENT') return null;
  throw error;
});
const report = { version, checkedFiles, archiveEntries: entries.length, bytes: bytes.length,
  previousBytes, savedBytes: previousBytes === null ? null : previousBytes - bytes.length, sha256: hash(bytes) };
await writeFile(`${exe}.sha256`, `${report.sha256}  ${path.basename(exe)}\n`);
await mkdir('test-results/desktop-package', { recursive: true });
await writeFile('test-results/desktop-package/verification.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
