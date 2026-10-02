import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { readdir } from 'node:fs/promises';

export default async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  // Remove copied Finder metadata from the generated bundle before codesigning.
  const bundle = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const nativeFiles = await readdir(path.join(bundle, 'Contents', 'Resources', 'native')).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  if (nativeFiles.length) throw new Error('Windows native audio resources must not be included in the macOS app.');
  await promisify(execFile)('/usr/bin/xattr', ['-cr', bundle]);
}
