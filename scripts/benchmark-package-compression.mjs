import { getPath7za } from 'app-builder-lib/out/toolsets/7zip.js';
import { compute7zCompressArgs } from 'app-builder-lib/out/targets/archive.js';
import { spawn } from 'node:child_process';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const dir = resolve('test-results/package-compression');
await mkdir(dir, { recursive: true });
const seven = await getPath7za();
const run = args => new Promise((ok, fail) => {
  const child = spawn(seven, args, { cwd: resolve('release/win-unpacked'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', x => output += x); child.stderr.on('data', x => output += x);
  child.on('error', fail); child.on('exit', code => code === 0 ? ok(output) : fail(new Error(output)));
});
const results = [];
for (const filter of ['default', 'BCJ2']) {
  if (filter === 'default') delete process.env.ELECTRON_BUILDER_7Z_FILTER;
  else process.env.ELECTRON_BUILDER_7Z_FILTER = filter;
  const file = resolve(dir, `${filter}-${Date.now()}.7z`);
  const started = Date.now();
  await run([...compute7zCompressArgs('7z', { compression: 'maximum' }), file, '.']);
  const check = await run(['t', '-bd', file]);
  results.push({ filter, file, bytes: (await stat(file)).size, elapsedMs: Date.now() - started, verified: check.includes('Everything is Ok') });
  console.log(JSON.stringify(results.at(-1)));
}
await writeFile(resolve(dir, 'comparison.json'), JSON.stringify(results, null, 2));
