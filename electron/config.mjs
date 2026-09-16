import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

const sections = new Set(['deepseek', 'theme', 'surface', 'language', 'playback', 'lyrics-appearance', 'track-columns', 'normalization', 'import-folder', 'fonts', 'spotify', 'typography', 'audio-output', 'diagnostics']);

// Small preferences only. Music, scan history and per-song projects stay in IndexedDB.
export class DesktopConfig {
  constructor(dataPath, crypto) { this.file = path.join(dataPath, 'config.json'); this.crypto = crypto; this.queue = Promise.resolve(); }
  async load() {
    try {
      const text = await readFile(this.file, 'utf8');
      if (text.length > 128 * 1024) throw new Error('Config is too large.');
      const value = JSON.parse(text);
      if (value.version !== 1 || !value.settings || typeof value.settings !== 'object' || Array.isArray(value.settings)) throw new Error('Unsupported config format.');
      return value;
    } catch (error) {
      if (error.code === 'ENOENT') return { version: 1, settings: {} };
      throw new Error(`Cannot read config.json. Restore or repair the file in the data folder. ${error.code || 'Invalid JSON or format.'}`);
    }
  }
  async get(section) {
    if (!sections.has(section)) throw new Error('Unknown setting.');
    await this.queue.catch(() => {});
    const value = (await this.load()).settings[section];
    if (section === 'spotify' && value?.encryptedSession) {
      try { return JSON.parse(this.crypto.decryptString(Buffer.from(value.encryptedSession, 'base64'))); }
      catch { throw new Error('Spotify credentials could not be unlocked. Sign in again.'); }
    }
    if (section !== 'deepseek' || !value) return value;
    let apiKey = '';
    if (value.encryptedKey) {
      try { apiKey = this.crypto.decryptString(Buffer.from(value.encryptedKey, 'base64')); }
      catch { throw new Error('The saved API key cannot be unlocked by this Windows account. Clear it or save a new key.'); }
    }
    return { model: value.model, language: value.language, apiKey };
  }
  set(section, value) {
    if (!sections.has(section)) return Promise.reject(new Error('Unknown setting.'));
    // Serialize concurrent controls; a failed write never changes the saved value.
    const task = this.queue.catch(() => {}).then(async () => {
      const data = await this.load();
      let saved = value;
      if (section === 'diagnostics' && (!value || typeof value.debug !== 'boolean' || Object.keys(value).some(key => key !== 'debug'))) throw new Error('Invalid debug settings.');
      if (section === 'spotify') {
        if (!value || JSON.stringify(value).length > 16000) throw new Error('Invalid Spotify session.');
        if (value.refreshToken && !this.crypto.isEncryptionAvailable()) throw new Error('Windows credential encryption is unavailable.');
        saved = value.refreshToken ? { encryptedSession: this.crypto.encryptString(JSON.stringify(value)).toString('base64') } : { clientId: value.clientId || '' };
      }
      if (section === 'deepseek') {
        if (!value || !['deepseek-flash', 'deepseek-v4-pro'].includes(value.model) || !['auto', 'en', 'zh'].includes(value.language) ||
            typeof value.apiKey !== 'string' || value.apiKey.length > 512 || value.apiKey && !/^[\x21-\x7e]+$/.test(value.apiKey)) throw new Error('Invalid DeepSeek settings.');
        if (value.apiKey && !this.crypto.isEncryptionAvailable()) throw new Error('Windows key encryption is unavailable. The API key was not saved.');
        saved = { model: value.model, language: value.language, encryptedKey: value.apiKey ? this.crypto.encryptString(value.apiKey).toString('base64') : '' };
      }
      if (JSON.stringify(data.settings[section]) === JSON.stringify(saved)) return;
      data.settings[section] = saved;
      const json = JSON.stringify(data, null, 2);
      if (json.length > 128 * 1024) throw new Error('Settings exceed the config size limit.');
      const temporary = `${this.file}.tmp`;
      try { await writeFile(temporary, json, { mode: 0o600, flush: true }); await rename(temporary, this.file); }
      catch (error) { await unlink(temporary).catch(() => {}); throw new Error(`Settings were not saved to config.json (${error.code || 'write failed'}). Check disk space and folder access.`); }
    });
    this.queue = task;
    return task;
  }
}
