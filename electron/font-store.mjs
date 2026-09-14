import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const limit = 32 * 1024 * 1024;
const slotName = slot => { if (!['app', 'lyrics'].includes(slot)) throw new Error('Invalid font target.'); return slot; };
const name = text => typeof text === 'string' && text.length > 0 && text.length <= 240 && !/[\x00-\x1f]/.test(text);
const fileName = value => typeof value === 'string' && /^[a-f0-9]{64}\.font$/.test(value);
export class DesktopFonts {
  constructor(config) { this.config = config; this.directory = path.join(path.dirname(config.file), 'fonts'); this.queue = Promise.resolve(); }
  async get(slot) {
    slotName(slot); await this.queue.catch(() => {});
    const saved = (await this.config.get('fonts'))?.[slot];
    if (!saved || saved.kind === 'system') return { kind: 'system' };
    if (saved.kind === 'installed' && name(saved.family)) return { kind: 'installed', family: saved.family };
    if (saved.kind !== 'file' || !fileName(saved.file) || !name(saved.name)) throw new Error('Invalid saved font. Choose it again.');
    const file = path.join(this.directory, saved.file);
    if ((await stat(file)).size > limit) throw new Error('Font file exceeds 32 MB.');
    const bytes = await readFile(file);
    return { kind: 'file', name: saved.name, bytes: new Uint8Array(bytes) };
  }
  set(slot, value) {
    slotName(slot);
    const task = this.queue.catch(() => {}).then(async () => {
      let saved;
      if (value?.kind === 'system') saved = { kind: 'system' };
      else if (value?.kind === 'installed' && name(value.family)) saved = { kind: 'installed', family: value.family };
      else if (value?.kind === 'file' && name(value.name) && value.bytes instanceof Uint8Array) {
        if (value.bytes.byteLength > limit) throw new Error('Font file exceeds 32 MB.');
        const bytes = Buffer.from(value.bytes);
        if (bytes.length < 12 || bytes.length > limit || !['00010000', '4f54544f', '74727565', '774f4646', '774f4632'].includes(bytes.subarray(0, 4).toString('hex'))) throw new Error('Choose a valid TTF, OTF, WOFF or WOFF2 font under 32 MB.');
        const file = `${createHash('sha256').update(bytes).digest('hex')}.font`;
        await mkdir(this.directory, { recursive: true });
        const target = path.join(this.directory, file), temporary = `${target}.tmp`;
        try { await writeFile(temporary, bytes, { flush: true }); await rename(temporary, target); }
        catch (error) { await unlink(temporary).catch(() => {}); throw error; }
        saved = { kind: 'file', name: value.name, file };
      } else throw new Error('Invalid font selection.');
      const previous = await this.config.get('fonts');
      const settings = { ...previous, [slot]: saved };
      try { await this.config.set('fonts', settings); }
      catch (error) {
        if (saved.kind === 'file' && !Object.values(previous || {}).some(v => v?.file === saved.file)) await unlink(path.join(this.directory, saved.file)).catch(() => {});
        throw error;
      }
      // Only the two active selections are retained. Never touch a user-chosen source file.
      const keep = new Set(Object.values(settings).filter(v => v?.kind === 'file').map(v => v.file));
      for (const file of await readdir(this.directory).catch(() => [])) if (fileName(file) && !keep.has(file)) await unlink(path.join(this.directory, file)).catch(() => {});
    });
    this.queue = task; return task;
  }
}
