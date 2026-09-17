import { mkdir, readFile, writeFile, cp, rm } from 'node:fs/promises';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const png = new Resvg(await readFile('public/images/app-logo.svg', 'utf8'), { fitTo: { mode: 'width', value: 256 } }).render().asPng();
// ICO supports a lossless PNG image entry; reuse the project's vector logo.
const header = Buffer.alloc(22);
header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12);
header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18);
await mkdir('desktop', { recursive: true });
await writeFile('desktop/app.ico', Buffer.concat([header, png]));
await writeFile('build/images/app-icon.png', png);
const stage = path.resolve('.cache/desktop-app');
if (path.dirname(stage) !== path.resolve('.cache')) throw new Error('Invalid desktop staging path.');
await rm(stage, { recursive: true, force: true });
await mkdir('.cache/desktop-app', { recursive: true });
await mkdir('.cache/desktop-app/node_modules', { recursive: true });
// Retired online UI artwork and old favicons are no longer referenced by the
// renderer. Keep the originals in the repository, but not in the desktop bundle.
const retiredAssets = new Set([
  'images/artist.png', 'images/no-episodes.png', 'images/liked-songs.png',
  'images/equaliser-animated.gif', 'images/forward.svg',
  'images/next_song.svg', 'images/next_song_hover.svg',
  'images/previous_song.svg', 'images/previous_song_hover.svg',
  'favicon.ico', 'favicon16.png', 'favicon32.png', '404.html',
]);
await cp('build', '.cache/desktop-app/build', { recursive: true,
  filter: source => !/\.(?:map|log)$/.test(source) && !retiredAssets.has(path.relative(path.resolve('build'), path.resolve(source)).split(path.sep).join('/')),
});
await cp('electron', '.cache/desktop-app/electron', { recursive: true });
await cp('LICENSE', '.cache/desktop-app/LICENSE');
// Renderer dependencies are already bundled by Vite. Do not ship development tools or models.
await writeFile('.cache/desktop-app/package.json', JSON.stringify({ name: 'lyric-player-desktop',
  version: pkg.version, description: 'Lyric Player — offline music player and Lyric Studio', author: 'Lyric Player',
  type: 'module', main: 'electron/main.mjs', private: true, dependencies: {} }, null, 2));
console.log('Desktop application and icon prepared.');
