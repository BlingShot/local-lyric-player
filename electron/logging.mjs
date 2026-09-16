import { mkdir, appendFile, rename, unlink, stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { sanitizeLogEntry } from './log-redaction.mjs';

export class DesktopLogger {
  constructor(dataPath, { maxBytes = 2 * 1024 * 1024 } = {}) {
    this.directory = path.join(dataPath, 'logs'); this.file = path.join(this.directory, 'player.log');
    this.maxBytes = maxBytes; this.debug = false; this.pending = 0; this.queue = Promise.resolve();
  }
  setDebug(value) { if (typeof value !== 'boolean') throw new Error('Invalid debug mode.'); this.debug = value; }
  write(value) {
    const entry = sanitizeLogEntry(value);
    if (entry.level === 'debug' && !this.debug || this.pending >= 128) return Promise.resolve();
    this.pending++;
    const task = this.queue.catch(() => {}).then(async () => {
      await mkdir(this.directory, { recursive: true });
      const line = JSON.stringify(entry) + '\n';
      const size = await stat(this.file).then(info => info.size).catch(error => { if (error.code === 'ENOENT') return 0; throw error; });
      if (size + Buffer.byteLength(line) > this.maxBytes) {
        await unlink(this.file + '.2').catch(error => { if (error.code !== 'ENOENT') throw error; });
        await rename(this.file + '.1', this.file + '.2').catch(error => { if (error.code !== 'ENOENT') throw error; });
        await rename(this.file, this.file + '.1').catch(error => { if (error.code !== 'ENOENT') throw error; });
      }
      await appendFile(this.file, line, { mode: 0o600 });
    }).finally(() => { this.pending--; });
    this.queue = task; return task;
  }
  async read() {
    await this.queue;
    const parts = [];
    for (const suffix of ['.2', '.1', '']) {
      const file = this.file + suffix;
      try { const info = await stat(file); if (info.size > this.maxBytes + 65536) throw new Error('Log exceeds the export limit.'); parts.push(await readFile(file, 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return parts.join('');
  }
}
