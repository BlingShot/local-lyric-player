import { mkdir, open, lstat, readFile, readdir, unlink, rmdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const MARKER = '.lyric-player-audio.json';
const OWNER = 'com.localmusic.player/audio-temp/v1';
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const sessionName = new RegExp(`^lyric-player-audio-${uuid}$`);
const audioName = new RegExp(`^${uuid}\\.audio$`);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Only successful deletes (including ENOENT) lose their retry record. */
export class AudioTempFiles {
  constructor(directory, { remove = unlink, retryDelays = [25, 75, 200], warn = console.warn } = {}) {
    this.directory = directory; this.files = new Set();
    this.remove = remove; this.retryDelays = retryDelays; this.warn = warn;
  }
  async initialize() {
    if (!this.initializing) this.initializing = (async () => {
      await mkdir(this.directory, { recursive: true });
      const info = await lstat(this.directory);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Invalid audio session directory.');
      // Never adopt an existing directory containing another session's files.
      if ((await readdir(this.directory)).length) throw new Error('Audio session directory is not empty.');
      const handle = await open(path.join(this.directory, MARKER), 'wx', 0o600);
      this.owned = true;
      try { await handle.writeFile(JSON.stringify({ owner: OWNER, pid: process.pid, createdAt: Date.now() })); }
      finally { await handle.close(); }
    })();
    return this.initializing;
  }
  async create(bytes) {
    await this.initialize();
    // A permanently locked copy must not lead to unlimited new complete copies.
    if (this.files.size >= 2) throw new Error('Temporary audio files are still in use. Stop playback and retry.');
    const file = path.join(this.directory, `${randomUUID()}.audio`);
    const handle = await open(file, 'wx', 0o600);
    this.files.add(file); // Includes partial writes; ownership starts only after exclusive creation.
    try { await handle.writeFile(bytes); }
    catch (error) { await handle.close(); await this.cleanup(); throw error; }
    await handle.close();
    return file;
  }
  async cleanup(keep) {
    for (const file of [...this.files]) {
      if (file === keep) continue;
      let failure;
      for (let attempt = 0; attempt <= this.retryDelays.length; attempt++) {
        try { await this.remove(file); this.files.delete(file); failure = undefined; break; }
        catch (error) {
          if (error.code === 'ENOENT') { this.files.delete(file); failure = undefined; break; }
          failure = error;
          if (!['EBUSY', 'EPERM', 'EACCES'].includes(error.code) || attempt === this.retryDelays.length) break;
          await delay(this.retryDelays[attempt]);
        }
      }
      if (failure) this.warn('Temporary audio cleanup deferred:', path.basename(file), failure.code || failure.message);
    }
    return this.files.size === (keep && this.files.has(keep) ? 1 : 0);
  }
  async finish() {
    if (!this.initializing) return;
    await this.initializing.catch(() => {});
    if (!this.owned) return;
    await this.cleanup();
    if (this.files.size) return; // Leave ownership marker for a later safe sweep.
    const entries = await readdir(this.directory).catch(() => []);
    if (entries.length === 1 && entries[0] === MARKER) {
      await unlink(path.join(this.directory, MARKER));
      await rmdir(this.directory);
    }
  }
}

/** Conservative crash recovery: exact app-owned directory, valid marker, dead PID,
 * regular UUID.audio files only. Never recurse, follow links or touch originals.
 * Legacy unmarked directories are intentionally NOT adopted/deleted.
 */
export async function cleanupStaleAudioSessions(root, { isAlive = pid => {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}, warn = console.warn } = {}) {
  const entries = await readdir(root, { withFileTypes: true });
  let checked = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || !sessionName.test(entry.name) || ++checked > 64) continue;
    const directory = path.join(root, entry.name), marker = path.join(directory, MARKER);
    try {
      const info = await lstat(marker);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 1024) continue;
      const owner = JSON.parse(await readFile(marker, 'utf8'));
      if (owner.owner !== OWNER || !Number.isSafeInteger(owner.pid) || owner.pid <= 0 || isAlive(owner.pid)) continue;
      const files = await readdir(directory, { withFileTypes: true });
      // Unknown files or links make ownership ambiguous: leave the entire session alone.
      if (files.some(file => !file.isFile() || file.name !== MARKER && !audioName.test(file.name))) continue;
      const pool = new AudioTempFiles(directory, { warn });
      for (const file of files) if (audioName.test(file.name)) pool.files.add(path.join(directory, file.name));
      if (await pool.cleanup()) { await unlink(marker); await rmdir(directory); }
    } catch (error) {
      if (error.code !== 'ENOENT') warn('Audio session sweep deferred:', entry.name, error.code || error.message);
    }
  }
}
