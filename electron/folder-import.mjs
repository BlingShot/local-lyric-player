import { opendir, realpath, stat, open } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';

const audio = /\.(mp3|wav|flac|ogg|oga|opus|m4a|aac|aiff|aif|webm)$/i;
const within = (root, file) => { const relative = path.relative(root, file); return relative && !relative.startsWith('..') && !path.isAbsolute(relative); };

export class FolderImporter {
  constructor(config) { this.config = config; this.scan = undefined; this.streams = new Set(); }
  async info() { return await this.config.get('import-folder') || null; }
  async choose(folderPath) {
    const root = await realpath(folderPath);
    if (!(await stat(root)).isDirectory()) throw new Error('Choose a music folder.');
    const value = { path: root, name: path.basename(root) || root };
    await this.config.set('import-folder', value);
    await this.end();
    return value;
  }
  async disconnect() { await this.config.set('import-folder', null); await this.end(); }
  async *walk(root, directory = root, depth = 0) {
    if (depth > 64) throw new Error('Folder nesting exceeds 64 levels. Choose a smaller music folder.');
    const dir = await opendir(directory);
    for await (const entry of dir) {
      // Never follow symlinks or junctions outside the selected directory.
      if (entry.isSymbolicLink()) continue;
      const file = path.join(directory, entry.name), resolved = await realpath(file);
      if (!within(root, resolved)) continue;
      if (entry.isDirectory()) yield* this.walk(root, resolved, depth + 1);
      else if (entry.isFile() && audio.test(entry.name)) {
        const details = await stat(resolved);
        yield { path: resolved, name: entry.name, size: details.size, lastModified: Math.trunc(details.mtimeMs) };
      }
    }
  }
  async start() {
    await this.end();
    const folder = await this.info();
    if (!folder) throw new Error('Choose a music folder first.');
    try {
      const root = await realpath(folder.path);
      if (root !== folder.path || !(await stat(root)).isDirectory()) throw new Error('Folder changed.');
      this.scan = { id: randomUUID(), root, iterator: this.walk(root), tokens: new Map(), count: 0 };
      return this.scan.id;
    } catch { throw new Error('The music folder is unavailable. Reconnect the drive or choose the folder again.'); }
  }
  async next(id) {
    const scan = this.scan;
    if (!scan || id !== scan.id) throw new Error('Folder scan was cancelled.');
    scan.tokens.clear();
    const files = [];
    for (let i = 0; i < 20; i++) {
      const next = await scan.iterator.next();
      if (this.scan !== scan) throw new Error('Folder scan was cancelled.');
      if (next.done) return { files, done: true };
      if (++scan.count > 100000) throw new Error('More than 100,000 audio files. Choose a smaller folder.');
      const token = randomUUID(); scan.tokens.set(token, next.value);
      const { path: _path, ...metadata } = next.value;
      files.push({ ...metadata, relativePath: path.relative(scan.root, next.value.path).split(path.sep).join('/'), url: `localmusic://app/__folder/${id}/${token}` });
    }
    return { files, done: false };
  }
  async response(request) {
    if (request.method !== 'GET') return new Response(null, { status: 405 });
    const [, , id, token] = new URL(request.url).pathname.split('/'), scan = this.scan;
    const file = scan?.id === id && scan.tokens.get(token);
    if (!file) return new Response('Scan expired. Scan the folder again.', { status: 410 });
    let handle;
    try {
      const resolved = await realpath(file.path);
      if (!within(scan.root, resolved)) throw new Error('File moved outside the music folder.');
      handle = await open(resolved, 'r');
      const actual = await handle.stat();
      if (actual.size !== file.size || Math.trunc(actual.mtimeMs) !== file.lastModified || this.scan !== scan) throw new Error('File changed during import. Scan again.');
      if (!actual.size) throw new Error('The audio file is empty.');
      // A single streamed file at a time; no base64/IPC copies of large audio buffers.
      const stream = handle.createReadStream(); this.streams.add(stream);
      stream.once('close', () => this.streams.delete(stream));
      return new Response(Readable.toWeb(stream), { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(actual.size), 'Cache-Control': 'no-store' } });
    } catch { await handle?.close().catch(() => {}); return new Response(`Cannot read “${file.name}”. Check the file and scan again.`, { status: 409 }); }
  }
  async end(id) {
    if (id && this.scan?.id !== id) return;
    const scan = this.scan; this.scan = undefined;
    for (const stream of this.streams) stream.destroy(); this.streams.clear();
    await scan?.iterator.return();
  }
}
