import { extractFile } from '@electron/asar';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
const packaged = process.argv.includes('--packaged');
const read = file => packaged ? Promise.resolve(extractFile('release/win-unpacked/resources/app.asar', path.normalize(file))) : readFile(file);
const html = (await read('build/index.html')).toString();
const files = [...new Set([...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map(match => match[1]))];
const assets = await Promise.all(files.map(async file => ({ file, bytes: (await read('build' + file)).length })));
const report = { version: JSON.parse((await read(packaged ? 'package.json' : 'package.json')).toString()).version, assets,
  startupJavaScript: assets.filter(a => a.file.endsWith('.js')).reduce((sum, a) => sum + a.bytes, 0), startupCss: assets.filter(a => a.file.endsWith('.css')).reduce((sum, a) => sum + a.bytes, 0) };
await mkdir('test-results', { recursive: true });
await writeFile(path.resolve(`test-results/renderer-size-${report.version}${packaged ? '-packaged' : ''}.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
