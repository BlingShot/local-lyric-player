import { readdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

async function walk(dir) {
  return (await Promise.all((await readdir(dir, { withFileTypes: true })).map(
    entry => entry.isDirectory() ? walk(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]
  ))).flat();
}
const files = [...await walk('src'), ...await walk('public'), 'index.html'];
const violations = [];
for (const file of files) {
  if (!/\.(tsx?|css|scss|html|json|svg)$/.test(file)) continue;
  const content = await readFile(file, 'utf8');
  // Exclude comments and SVG namespace declarations, which do not request resources.
  let text = content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[^]*?-->/g, '')
    .replace(/xmlns=['"]http[^'"]*['"]/g, '');
  // TTML namespace constants identify XML vocabularies, not remote resources.
  if (file === 'src/lyrics/parseTtml.ts') text = text.replace(/^const (?:TT|META|PARAM|STYLE|XML|APPLE) = 'http[^']+';$/gm, '');
  if (file === 'src/studio/projectExport.ts') text = text.replace(/^export const NS = \{[^\n]+\};$/gm, '');
  // User-requested attribution is navigation only, never a fetched application resource.
  if (file === 'src/analysis/audio/AudioAnalysis.tsx') text = text.replace("<a href='https://essentia.upf.edu/' target='_blank' rel='noopener noreferrer'>{t(\"Powered by Essentia\")}</a>", '');
  // The sole optional network feature: user-requested lyric text analysis.
  if (file === 'src/analysis/deepseek/client.ts') text = text
    .replace("const ENDPOINT = 'https://api.deepseek.com/chat/completions';", '')
    .replace('await fetch(ENDPOINT, {', 'await allowedDeepSeekRequest({');
  // Native folder streams use a validated, same-application protocol token.
  if (file === 'src/library/folderImport.ts') {
    assert.ok(content.includes("if (!/^localmusic:\\/\\/app\\/__folder\\/[\\da-f-]+\\/[\\da-f-]+$/.test(entry.url)) throw new Error('Invalid local import address.');"));
    text = text.replace('await fetch(entry.url)', 'await localFolderStream(entry.url)');
  }
  if (/https?:\/\//.test(text)) violations.push(`${file}: external URL`);
  if (file.endsWith('.ts') || file.endsWith('.tsx')) {
    if (/\b(fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(|sendBeacon\s*\(/.test(text))
      violations.push(`${file}: network API`);
    if (/access_token|refresh_token|spotify-web-playback-sdk|loginToSpotify/.test(text))
      violations.push(`${file}: online authentication or SDK`);
  }
}
assert.deepEqual(violations, []);
const html = await readFile('build/index.html', 'utf8');
assert.match(html.replaceAll('&#39;', "'"), /connect-src 'self' https:\/\/api\.deepseek\.com;/);
assert.doesNotMatch(html.replaceAll('https://api.deepseek.com', ''), /https?:\/\//);
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
assert.ok(!pkg.dependencies.axios);
assert.ok(!pkg.devDependencies['@types/spotify-web-playback-sdk']);
console.log(`Local resource audit passed (${files.length} files); only the explicit DeepSeek lyrics endpoint is allowed.`);
