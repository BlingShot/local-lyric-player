import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readdir, cp, stat, rename, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

if (process.platform !== 'darwin') throw new Error('Build the macOS application on a Mac.');
// iCloud-managed Documents can add FinderInfo while signing. Build outside synced
// folders, then copy the sealed installation archives into the project's release/.
const output = await mkdtemp(path.join(os.tmpdir(), 'lyric-player-mac-'));
const args = ['node_modules/electron-builder/cli.js', '--config', 'electron-builder.mac.yml',
  '--mac', '--arm64', '--publish', 'never', `--config.directories.output=${output}`];
if (process.argv.includes('--dir')) args.push('--dir');
const child = execFile(process.execPath, args, { maxBuffer: 16 * 1024 * 1024 });
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('close', code => code === 0 ? resolve() : reject(new Error(`macOS build failed (${code}).`)));
});
await mkdir('release', { recursive: true });
for (const name of await readdir(output)) {
  if (name.endsWith('.dmg')) {
    // ULMO uses LZMA and is supported by our macOS 13+ minimum.
    // electron-builder's schema does not expose this hdiutil format.
    const source = path.join(output, name);
    const compact = path.join(output, `compact-${name}`);
    await new Promise((resolve, reject) => {
      execFile('/usr/bin/hdiutil', ['convert', source, '-format', 'ULMO', '-o', compact],
        error => error ? reject(error) : resolve());
    });
    await rename(compact, source);
    // A blockmap created before recompression no longer describes this image.
    await rm(`${source}.blockmap`, { force: true });
    const bytes = (await stat(path.join(output, name))).size;
    if (bytes >= 100_000_000) throw new Error(`macOS installer exceeds the 100 MB budget: ${bytes} bytes`);
    console.log(`macOS installer size: ${(bytes / 1_000_000).toFixed(2)} MB`);
  }
  if (name.endsWith('.dmg')) await cp(path.join(output, name), path.join('release', name));
}
console.log(`macOS app: ${path.join(output, 'mac-arm64', 'Lyric Player.app')}`);
console.log(`Installation archives: ${path.resolve('release')}`);
