import { mkdir, appendFile, rename, unlink, stat, open } from 'node:fs/promises';
import path from 'node:path';
import { sanitizeLogEntry } from './log-redaction.mjs';

export class DesktopLogger {
  constructor(dataPath, { maxBytes = 2 * 1024 * 1024, maxFiles = 3, maxQueued = 128 } = {}) {
    this.directory = path.join(dataPath, 'logs'); this.file = path.join(this.directory, 'player.log');
    this.maxBytes = Math.max(256, Math.floor(maxBytes)); this.maxFiles = Math.max(1, Math.min(10, Math.floor(maxFiles)));
    this.maxQueued = maxQueued; this.debug = false; this.pending = 0; this.dropped = 0; this.queue = Promise.resolve(); this.recent = []; this.recentBytes = 0;
  }
  setDebug(value) { if (typeof value !== 'boolean') throw new Error('Invalid debug mode.'); this.debug = value; }
  enqueue(action) { const task = this.queue.catch(() => {}).then(action); this.queue = task.catch(() => {}); return task; }
  write(value) {
    if (value?.level === 'debug' && !this.debug) return Promise.resolve();
    if (this.pending >= this.maxQueued + (['warn', 'error'].includes(value?.level) ? 16 : 0)) { this.dropped++; return Promise.resolve(); }
    let entry;
    try { entry = sanitizeLogEntry(value); } catch (error) { return Promise.reject(error); }
    this.pending++;
    return this.enqueue(async () => {
      if (entry.level === 'debug' && !this.debug) return;
      await mkdir(this.directory, { recursive: true });
      let line = JSON.stringify(entry) + '\n';
      const limit = Math.min(this.maxBytes, 48 * 1024);
      if (Buffer.byteLength(line) > limit) {
        entry.data = { truncated: true }; entry.message = entry.message.slice(0, Math.max(16, Math.floor((limit - 160) / 6)));
        line = JSON.stringify(entry) + '\n';
      }
      const size = await stat(this.file).then(info => info.size).catch(error => { if (error.code === 'ENOENT') return 0; throw error; });
      if (size + Buffer.byteLength(line) > this.maxBytes) {
        for (let i = this.maxFiles - 1; i >= 1; i--) {
          const target = `${this.file}.${i}`, source = i === 1 ? this.file : `${this.file}.${i - 1}`;
          await unlink(target).catch(error => { if (error.code !== 'ENOENT') throw error; });
          await rename(source, target).catch(error => { if (error.code !== 'ENOENT') throw error; });
        }
        if (this.maxFiles === 1) await unlink(this.file).catch(error => { if (error.code !== 'ENOENT') throw error; });
      }
      await appendFile(this.file, line, { mode: 0o600 });
      const bytes = Buffer.byteLength(line);
      while (this.recent.length && (this.recent.length >= 100 || this.recentBytes + bytes > 256 * 1024)) this.recentBytes -= this.recent.shift().bytes;
      this.recent.push({ entry, bytes }); this.recentBytes += bytes;
    }).finally(() => { this.pending--; });
  }
  read(maxBytes = 512 * 1024) {
    return this.enqueue(async () => {
      const parts = []; let remaining = Math.max(0, Math.min(1024 * 1024, maxBytes));
      for (let i = 0; i < this.maxFiles && remaining > 0; i++) {
        let handle;
        try {
          handle = await open(i ? `${this.file}.${i}` : this.file, 'r');
          const { size } = await handle.stat(), start = Math.max(0, size - remaining), buffer = Buffer.alloc(Math.min(size, remaining));
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
          let text = buffer.subarray(0, bytesRead).toString('utf8');
          if (start > 0) text = text.slice(text.indexOf('\n') + 1);
          parts.unshift(text); remaining -= bytesRead;
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
        finally { await handle?.close(); }
      }
      return parts.join('');
    });
  }
  clear() {
    return this.enqueue(async () => {
      // Exact logger-owned filenames only; never remove a user-selected folder.
      for (let i = 0; i < 10; i++) await unlink(i ? `${this.file}.${i}` : this.file).catch(error => { if (error.code !== 'ENOENT') throw error; });
      this.dropped = 0; this.recent = []; this.recentBytes = 0;
    });
  }
  async info() {
    await this.queue;
    const sizes = await Promise.all(Array.from({ length: this.maxFiles }, (_, i) => stat(i ? `${this.file}.${i}` : this.file).then(s => s.size).catch(() => 0)));
    return { bytes: sizes.reduce((a, b) => a + b, 0), maxBytes: this.maxBytes, maxFiles: this.maxFiles, pending: this.pending, dropped: this.dropped, recent: this.recent.slice(-30).map(item => item.entry) };
  }
}
