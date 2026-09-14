import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const marker = '.local-music-storage.json';
export const cacheDirectories = ['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'ShaderCache', 'GrShaderCache'];
const transient = new Set([...cacheDirectories, marker, 'SingletonLock', 'SingletonCookie', 'SingletonSocket', 'DevToolsActivePort']);
const comparable = value => path.resolve(value).toLowerCase();
export const samePath = (a, b) => comparable(a) === comparable(b);
const inside = (parent, child) => samePath(parent, child) || comparable(child).startsWith(comparable(parent) + path.sep);
export function separatePaths(data, cache) {
  if (![data, cache].every(value => typeof value === 'string' && path.isAbsolute(value))) throw new Error('Storage locations must be absolute paths.');
  if (inside(data, cache) || inside(cache, data)) throw new Error('Data and cache must use separate folders, outside one another.');
}
function writeJson(file, value) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}
function ownDirectory(directory, kind) {
  fs.mkdirSync(directory, { recursive: true });
  if (fs.lstatSync(directory).isSymbolicLink()) throw new Error('Choose a real storage directory, not a linked folder.');
  const file = path.join(directory, marker);
  if (fs.existsSync(file)) {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (value.app !== 'local-music' || value.kind !== kind) throw new Error('This folder belongs to another storage location.');
  } else writeJson(file, { app: 'local-music', kind });
}
function checksum(file) {
  const hash = createHash('sha256'), chunk = Buffer.allocUnsafe(1024 * 1024), fd = fs.openSync(file, 'r');
  try { let length; while ((length = fs.readSync(fd, chunk))) hash.update(chunk.subarray(0, length)); }
  finally { fs.closeSync(fd); }
  return hash.digest('hex');
}
export function copyDatabase(source, destination) {
  if (inside(source, destination) || inside(destination, source)) throw new Error('The new data folder must be separate from the old folder.');
  if (!fs.existsSync(source)) throw new Error('The current data folder is unavailable. Reconnect its drive before moving data.');
  if (fs.existsSync(destination) && fs.readdirSync(destination).length) throw new Error('The new data folder must be empty. Existing files will not be overwritten.');
  ownDirectory(destination, 'data');
  const copy = (from, to, top = false) => {
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      if (top && transient.has(entry.name)) continue;
      const input = path.join(from, entry.name), output = path.join(to, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Cannot migrate linked data: ${entry.name}`);
      if (entry.isDirectory()) { fs.mkdirSync(output); copy(input, output); }
      else if (entry.isFile()) {
        fs.copyFileSync(input, output, fs.constants.COPYFILE_EXCL);
        if (fs.statSync(input).size !== fs.statSync(output).size || checksum(input) !== checksum(output)) throw new Error(`Copy verification failed: ${entry.name}`);
      } else throw new Error(`Unsupported data entry: ${entry.name}`);
    }
  };
  copy(source, destination, true);
}

export async function directoryBytes(directory) {
  let bytes = 0;
  for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    // Cache junctions are counted in the cache total, never as database/audio data.
    if (entry.isSymbolicLink()) continue;
    try {
      if (entry.isDirectory()) bytes += await directoryBytes(file);
      else if (entry.isFile()) bytes += (await fsp.stat(file)).size;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return bytes;
}

export class DesktopStorage {
  constructor({ controlRoot, defaultData, defaultCache }) {
    fs.mkdirSync(controlRoot, { recursive: true });
    this.file = path.join(controlRoot, 'storage.json');
    this.controlRoot = controlRoot;
    this.config = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8'))
      : { version: 1, dataPath: defaultData, cachePath: defaultCache };
    if (this.config.version !== 1) throw new Error('Unsupported storage configuration. Your existing files have not been changed.');
    separatePaths(this.config.dataPath, this.config.cachePath);
    this.pending = undefined;
  }
  startup() {
    const before = this.config;
    if (before.pending) {
      try {
        const next = before.pending;
        separatePaths(next.dataPath, next.cachePath);
        if (!samePath(next.dataPath, before.dataPath)) copyDatabase(before.dataPath, next.dataPath);
        ownDirectory(next.cachePath, 'cache');
        this.config = { version: 1, ...next,
          backups: [...(before.backups || []),
            ...(!samePath(next.dataPath, before.dataPath) ? [{ kind: 'data', path: before.dataPath }] : []),
            ...(!samePath(next.cachePath, before.cachePath) ? [{ kind: 'cache', path: before.cachePath }] : [])],
          previousDataPath: !samePath(next.dataPath, before.dataPath) ? before.dataPath : before.previousDataPath };
        writeJson(this.file, this.config);
      } catch (error) {
        // A partial destination is never selected as the live database.
        this.config = { ...before, pending: undefined, error: `Storage change failed: ${error.message} The previous data location is still in use.` };
        writeJson(this.file, this.config);
      }
    }
    // A missing configured data location must not silently become an empty library.
    if (fs.existsSync(this.file) && !fs.existsSync(this.config.dataPath)) throw new Error(`Data location is unavailable: ${this.config.dataPath}. Reconnect the drive and reopen Lyric Player.`);
    ownDirectory(this.config.dataPath, 'data');
    ownDirectory(this.config.cachePath, 'cache');
    this.linkCaches();
    writeJson(this.file, this.config);
    return this.config;
  }
  linkCaches() {
    const { dataPath, cachePath } = this.config;
    separatePaths(dataPath, cachePath);
    for (const name of cacheDirectories) {
      const link = path.resolve(dataPath, name), target = path.resolve(cachePath, name);
      // Resolve and check each exact regenerable cache path before removing it.
      if (path.dirname(link) !== path.resolve(dataPath) || !cacheDirectories.includes(path.basename(link))) throw new Error('Invalid cache location.');
      fs.mkdirSync(target, { recursive: true });
      let info;
      try { info = fs.lstatSync(link); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (info?.isSymbolicLink()) {
        if (samePath(fs.realpathSync(link), fs.realpathSync(target))) continue;
        fs.unlinkSync(link); // Remove the junction itself, never its target.
      } else if (info) {
        if (!info.isDirectory()) throw new Error(`Expected a cache directory at ${link}`);
        fs.rmSync(link, { recursive: true }); // Only the allowlisted cache; never IndexedDB or Local Storage.
      }
      fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
    }
  }
  async stage(kind, parent) {
    if (!['data', 'cache'].includes(kind) || !path.isAbsolute(parent)) throw new Error('Invalid storage selection.');
    const realParent = await fsp.realpath(parent);
    const target = path.join(realParent, kind === 'data' ? 'Local Music Data' : 'Local Music Cache');
    const current = this.pending || this.config;
    const proposed = { dataPath: current.dataPath, cachePath: current.cachePath, [`${kind}Path`]: target };
    separatePaths(proposed.dataPath, proposed.cachePath);
    if (kind === 'data' && !samePath(target, this.config.dataPath) && (inside(target, this.config.dataPath) || inside(this.config.dataPath, target))) throw new Error('Choose a new data folder outside the current data directory.');
    if (inside(target, this.controlRoot) || inside(this.controlRoot, target)) throw new Error('Choose a location outside the application settings folder.');
    if (!samePath(target, this.config[`${kind}Path`])) {
      try { if ((await fsp.readdir(target)).length) throw new Error('Choose a folder without an existing Local Music data/cache subfolder. Existing files will not be overwritten.'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    this.pending = proposed;
    return proposed;
  }
  async schedule() {
    if (!this.pending) throw new Error('Choose a new location first.');
    const next = this.pending;
    if (!samePath(next.dataPath, this.config.dataPath)) {
      const needed = await directoryBytes(this.config.dataPath);
      const available = await fsp.statfs(path.dirname(next.dataPath));
      if (available.bavail * available.bsize < needed + 64 * 1024 * 1024) throw new Error('Not enough free space to safely copy and verify the library.');
    }
    writeJson(this.file, { ...this.config, pending: next, error: undefined });
  }
}
