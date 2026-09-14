import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('public/licenses', { recursive: true });
await copyFile('node_modules/essentia.js/LICENSE', 'public/licenses/essentia-0.1.3-LICENSE.txt');
await copyFile('node_modules/essentia.js/AUTHORS.md', 'public/licenses/essentia-0.1.3-AUTHORS.txt');
