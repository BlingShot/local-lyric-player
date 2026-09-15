import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const finite = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

// Only local bytes and a small command whitelist cross the renderer boundary.
export class NativeAudio extends EventEmitter {
  constructor(binary, directory) {
    super(); this.binary = binary; this.directory = directory; this.requests = new Map(); this.files = new Set(); this.serial = Promise.resolve(); this.sequence = 0;
    this.state = { id: '', time: 0, duration: 0, paused: true, ended: false, ready: false, exclusive: false }; this.closed = false; this.meterEnabled = false;
  }
  update(patch) { this.state = { ...this.state, ...patch }; this.emit('state', { ...this.state }); }
  enqueue(fn) { const result = this.serial.then(fn); this.serial = result.catch(() => {}); return result; }
  async start() {
    if (this.closed) throw new Error('Native audio is closed.');
    if (this.socket) return;
    if (this.starting) return this.starting;
    this.starting = (async () => {
      const pipe = `\\\\.\\pipe\\lyric-player-${process.pid}-${randomUUID()}`;
      this.stderr = '';
      const child = spawn(this.binary, ['--no-config', '--load-scripts=no', '--ytdl=no', '--access-references=no', '--autoload-files=no', '--demuxer-lavf-o=protocol_whitelist=[file,pipe,data]', '--no-video', '--idle=yes', '--no-terminal', '--input-media-keys=no', '--input-default-bindings=no', '--ao=wasapi', '--audio-fallback-to-null=no', '--audio-exclusive=no', '--pause=yes', '--keep-open=yes', '--volume-max=1000', '--replaygain=no', `--input-ipc-server=${pipe}`], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      this.child = child; let failure;
      child.stderr.on('data', bytes => { this.stderr = (this.stderr + bytes.toString()).slice(-4000); });
      child.on('error', error => { failure = error; });
      child.on('exit', () => {
        if (this.child !== child) return;
        this.socket?.destroy(); this.socket = undefined; this.child = undefined; this.meterEnabled = false;
        for (const pending of this.requests.values()) pending.reject(new Error('Native audio process stopped.')); this.requests.clear();
        if (!this.closed) this.update({ ready: false, paused: true, error: 'Native audio stopped. Select the device again to retry.' });
      });
      let socket;
      for (let attempt = 0; attempt < 100 && !this.closed; attempt++) {
        if (failure || child.exitCode !== null) throw failure || new Error(this.stderr || 'Native audio could not start.');
        try { socket = await new Promise((resolve, reject) => { const candidate = connect(pipe); candidate.once('connect', () => { candidate.removeListener('error', reject); resolve(candidate); }); candidate.once('error', error => { candidate.destroy(); reject(error); }); }); break; } catch { await delay(40); }
      }
      if (!socket) { child.kill(); throw new Error('Native audio IPC did not start.'); }
      this.socket = socket; let buffer = '';
      socket.setEncoding('utf8');
      socket.on('error', error => { if (!this.closed) this.update({ error: error.message, paused: true }); });
      socket.on('data', text => {
        buffer += text;
        if (buffer.length > 1024 * 1024) { socket.destroy(); return; }
        let end;
        while ((end = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
          try { this.receive(JSON.parse(line)); } catch { /* Ignore malformed helper output, never evaluate it. */ }
        }
      });
      for (const [index, property] of ['time-pos', 'duration', 'pause', 'eof-reached'].entries()) await this.request(['observe_property', index + 1, property]);
    })();
    try { await this.starting; } finally { this.starting = undefined; }
  }
  receive(message) {
    if (message.request_id) {
      const pending = this.requests.get(message.request_id);
      if (pending) { this.requests.delete(message.request_id); message.error === 'success' ? pending.resolve(message.data) : pending.reject(new Error(`Native audio: ${message.error}`)); }
    }
    if (message.event === 'property-change' && this.state.id) {
      const map = { 'time-pos': 'time', duration: 'duration', pause: 'paused', 'eof-reached': 'ended' }, key = map[message.name];
      if (key && (typeof message.data === 'boolean' || finite(message.data, 0, 864000))) this.update({ [key]: message.data });
    }
    if (message.event === 'end-file' && message.reason === 'error') this.update({ ready: false, paused: true, error: `Audio device or file could not be opened: ${message.error || 'unsupported output'}. Exclusive mode never falls back to shared mode.` });
    this.emit('event', message);
  }
  request(command) {
    return new Promise((resolve, reject) => {
      if (!this.socket || this.socket.destroyed) { reject(new Error('Native audio is unavailable.')); return; }
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.requests.delete(id); reject(new Error('Native audio request timed out.')); }, 8000);
      this.requests.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
      this.socket.write(JSON.stringify({ command, request_id: id }) + '\n');
    });
  }
  async devices() {
    await this.start();
    const devices = await this.request(['get_property', 'audio-device-list']);
    return Array.isArray(devices) ? devices.filter(d => d.name === 'auto' || /^wasapi\//.test(d.name)).map(({ name, description }) => ({ name, description })) : [];
  }
  load(value) {
    if (!value || typeof value.id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(value.id) || !(value.bytes instanceof ArrayBuffer) || !value.bytes.byteLength || value.bytes.byteLength > 512 * 1024 * 1024 || typeof value.device !== 'string' || typeof value.exclusive !== 'boolean' || !finite(value.position, 0, 864000) || !finite(value.volume, 0, 1000) || !finite(value.speed, .5, 1.5)) return Promise.reject(new Error('Invalid native audio request.'));
    return this.enqueue(async () => {
      const devices = await this.devices(); if (!devices.some(d => d.name === value.device)) throw new Error('The selected playback device is unavailable.');
      await this.request(['stop']);
      await this.request(['set_property', 'pause', true]);
      await this.request(['set_property', 'audio-device', value.device]);
      await this.request(['set_property', 'audio-exclusive', value.exclusive]);
      await this.request(['set_property', 'volume', value.volume]);
      await this.request(['set_property', 'speed', value.speed]);
      await mkdir(this.directory, { recursive: true });
      const file = path.join(this.directory, `${randomUUID()}.audio`);
      await writeFile(file, new Uint8Array(value.bytes), { flag: 'wx' }); this.files.add(file);
      this.update({ id: value.id, time: value.position, duration: 0, paused: true, ended: false, ready: false, exclusive: value.exclusive, error: undefined });
      try {
        await new Promise((resolve, reject) => {
          const finish = error => { clearTimeout(timer); this.off('event', onEvent); error ? reject(error) : resolve(); };
          const onEvent = event => { if (event.event === 'file-loaded') finish(); if (event.event === 'end-file' && event.reason === 'error') finish(new Error(this.state.error || 'Native audio could not open this file.')); };
          const timer = setTimeout(() => finish(new Error('Native audio could not load the file.')), 15000);
          this.on('event', onEvent);
          void this.request(['loadfile', file, 'replace', -1, { start: String(value.position) }]).catch(finish);
        });
        const duration = await this.request(['get_property', 'duration']);
        const output = await this.request(['get_property', 'current-ao']);
        if (output !== 'wasapi') throw new Error('WASAPI output did not start.');
        this.update({ duration: Number(duration) || 0, ready: true, paused: true });
        for (const old of this.files) if (old !== file) { await unlink(old).catch(() => {}); this.files.delete(old); }
      } catch (error) { await this.request(['stop']).catch(() => {}); this.update({ ready: false, paused: true, error: error.message }); throw error; }
    });
  }
  setMeter(enabled) {
    if (typeof enabled !== 'boolean') return Promise.reject(new Error('Invalid audio meter request.'));
    return this.enqueue(async () => {
      if (!enabled && !this.socket) { this.meterEnabled = false; return; }
      await this.start();
      if (this.meterEnabled === enabled) return;
      if (enabled) await this.request(['af', 'add', '@lyric_pulse:lavfi=[astats=metadata=1:reset=1:measure_perchannel=none:measure_overall=RMS_level]']);
      else await this.request(['af', 'remove', '@lyric_pulse']);
      this.meterEnabled = enabled;
    });
  }
  energy() {
    if (!this.meterEnabled || !this.state.ready || this.state.paused || this.state.ended || this.closed) return Promise.resolve(0);
    if (this.energyRequest) return this.energyRequest;
    const id = this.state.id;
    // Read-only metadata, outside the transport queue and the lyric-clock events.
    this.energyRequest = this.request(['get_property', 'af-metadata/lyric_pulse']).then(metadata => {
      if (id !== this.state.id || !this.meterEnabled || !this.state.ready || this.state.paused) return 0;
      const db = Number(metadata?.['lavfi.astats.Overall.RMS_level']);
      return Number.isFinite(db) ? Math.min(1, 10 ** (db / 20)) : 0;
    }).catch(() => 0).finally(() => { this.energyRequest = undefined; });
    return this.energyRequest;
  }
  command(command, value) {
    if (!['play', 'pause', 'seek', 'volume', 'speed', 'stop'].includes(command)) return Promise.reject(new Error('Unknown native audio command.'));
    if (['seek', 'volume', 'speed'].includes(command) && !finite(value, command === 'speed' ? .5 : 0, command === 'seek' ? 864000 : command === 'speed' ? 1.5 : 1000)) return Promise.reject(new Error('Invalid audio value.'));
    return this.enqueue(async () => {
      if (command === 'stop' && !this.socket) return;
      await this.start();
      if (command === 'stop') { await this.request(['stop']); this.update({ id: '', time: 0, duration: 0, ready: false, paused: true, ended: false }); return; }
      if (command === 'seek') { await this.request(['seek', value, 'absolute+exact']); this.update({ time: value, ended: false }); return; }
      await this.request(['set_property', command === 'play' || command === 'pause' ? 'pause' : command, command === 'play' ? false : command === 'pause' ? true : value]);
    });
  }
  async dispose() {
    this.closed = true; this.socket?.destroy(); this.socket = undefined;
    const child = this.child;
    if (child && child.exitCode === null) { const exited = new Promise(resolve => child.once('exit', resolve)); child.kill(); await Promise.race([exited, delay(3000)]); }
    for (const file of this.files) await unlink(file).catch(() => {});
    this.files.clear(); this.removeAllListeners();
  }
}
