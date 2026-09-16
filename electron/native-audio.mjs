import { PlaybackFault, faultInfo, mpvFault } from './playback-errors.mjs';
import { NativeCommandGuard, cancelled } from './native-command-guard.mjs';
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { AudioTempFiles } from './audio-temp-files.mjs';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const finite = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

// Only local bytes and a small command whitelist cross the renderer boundary.
export class NativeAudio extends EventEmitter {
  constructor(binary, directory, { loadTimeoutMs = 15000 } = {}) {
    super(); this.loadTimeoutMs = loadTimeoutMs; this.binary = binary; this.directory = directory; this.requests = new Map(); this.temp = new AudioTempFiles(directory); this.files = this.temp.files; this.serial = Promise.resolve(); this.sequence = 0;
    this.state = { id: '', time: 0, duration: 0, paused: true, ended: false, ready: false, exclusive: false }; this.closed = false; this.meterEnabled = false; this.guard = new NativeCommandGuard();
  }
  update(patch) { this.state = { ...this.state, ...patch }; this.emit('state', { ...this.state }); }
  assertOpen() { if (this.closed) throw new PlaybackFault('cancelled', 'Native audio is closed.'); }
  enqueue(fn) { const result = this.serial.then(() => { this.assertOpen(); return fn(); }); this.serial = result.catch(() => {}); return result; }
  async start() {
    if (this.closed) throw new PlaybackFault('cancelled', 'Native audio is closed.');
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
        for (const pending of this.requests.values()) pending.reject(new PlaybackFault('backend-stopped', 'Native audio process stopped.')); this.requests.clear();
        if (!this.closed) this.update({ ready: false, paused: true, error: { kind: 'backend-stopped', message: 'Native audio stopped. Select the device again to retry.' } });
      });
      let socket;
      for (let attempt = 0; attempt < 100 && !this.closed; attempt++) {
        if (failure || child.exitCode !== null) throw failure || new Error(this.stderr || 'Native audio could not start.');
        try { socket = await new Promise((resolve, reject) => { const candidate = connect(pipe); candidate.once('connect', () => { candidate.removeListener('error', reject); resolve(candidate); }); candidate.once('error', error => { candidate.destroy(); reject(error); }); }); break; } catch { await delay(40); }
      }
      if (!socket) { child.kill(); throw new Error('Native audio IPC did not start.'); }
      if (this.closed) { socket.destroy(); child.kill(); throw new PlaybackFault('cancelled', 'Native audio is closed.'); }
      this.socket = socket; let buffer = '';
      socket.setEncoding('utf8');
      socket.on('error', error => { if (!this.closed) this.update({ error: faultInfo(error), paused: true, ready: false }); });
      socket.on('data', text => {
        buffer += text;
        if (buffer.length > 1024 * 1024) { socket.destroy(); return; }
        let end;
        while ((end = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
          try { this.receive(JSON.parse(line)); } catch { /* Ignore malformed helper output, never evaluate it. */ }
        }
      });
      for (const [index, property] of ['time-pos', 'duration', 'pause', 'eof-reached', 'current-ao'].entries()) await this.request(['observe_property', index + 1, property]);
    })();
    try { await this.starting; } finally { this.starting = undefined; }
  }
  receive(message) {
    if (message.request_id) {
      const pending = this.requests.get(message.request_id);
      if (pending) { this.requests.delete(message.request_id); message.error === 'success' ? pending.resolve(message.data) : pending.reject(new Error(`Native audio: ${message.error}`)); }
    }
    if (message.event === 'property-change' && this.state.id) {
      if (message.name === 'current-ao' && this.state.ready && !this.state.ended && message.data !== 'wasapi')
        this.update({ ready: false, paused: true, error: { kind: 'device-unavailable', message: 'The audio output was lost. Reconnect or select an output, then retry this song.' } });
      const map = { 'time-pos': 'time', duration: 'duration', pause: 'paused', 'eof-reached': 'ended' }, key = map[message.name];
      if (key && (typeof message.data === 'boolean' || finite(message.data, 0, 864000))) this.update({ [key]: message.data });
    }
    if (message.event === 'end-file' && message.reason === 'error') this.update({ ready: false, paused: true, error: faultInfo(mpvFault(message.file_error || message.error, this.state.exclusive)) });
    this.emit('event', message);
  }
  request(command) {
    return new Promise((resolve, reject) => {
      if (this.closed || !this.socket || this.socket.destroyed) { reject(new PlaybackFault('backend-stopped', 'Native audio is unavailable.')); return; }
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.requests.delete(id); reject(new PlaybackFault('timeout', 'The native audio backend did not respond. Check the output and retry.')); }, 8000);
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
    let token; const guard = this.guard;
    try { if (value.context) { token = guard.accept(value.context); if (token.id !== value.id) throw cancelled(); this.emit('intent-changed'); } }
    catch (error) { return Promise.reject(error); }
    const current = () => { this.assertOpen(); if (token) { if (guard !== this.guard) throw cancelled(); guard.check(token, 'load'); } };
    return this.enqueue(async () => {
      current();
      const devices = await this.devices(); current(); if (!devices.some(d => d.name === value.device)) throw new PlaybackFault('device-unavailable', 'The selected playback device is unavailable.');
      this.update({ ready: false, paused: true });
      await this.request(['stop']);
      await this.temp.cleanup();
      current();
      await this.request(['set_property', 'pause', true]);
      await this.request(['set_property', 'audio-device', value.device]);
      await this.request(['set_property', 'audio-exclusive', value.exclusive]);
      await this.request(['set_property', 'volume', value.volume]);
      await this.request(['set_property', 'speed', value.speed]);
      current();
      const file = await this.temp.create(new Uint8Array(value.bytes));
      try { current(); } catch (error) { await this.temp.cleanup(); throw error; }
      this.update({ id: value.id, time: value.position, duration: 0, paused: true, ended: false, ready: false, exclusive: value.exclusive, error: undefined });
      try {
        await new Promise((resolve, reject) => {
          const finish = error => { clearTimeout(timer); this.off('event', onEvent); this.off('closing', onClosing); this.off('intent-changed', onIntent); error ? reject(error) : resolve(); };
          const onClosing = () => finish(new PlaybackFault('cancelled', 'Native audio is closed.'));
          const onIntent = () => { try { current(); } catch (error) { finish(error); } };
          const onEvent = event => { if (event.event === 'file-loaded') finish(); if (event.event === 'end-file' && event.reason === 'error') finish(new PlaybackFault(this.state.error?.kind || 'backend-stopped', this.state.error?.message || 'Native audio could not open this file.')); };
          const timer = setTimeout(() => finish(new PlaybackFault('timeout', 'Native audio could not load the file.')), this.loadTimeoutMs);
          this.on('event', onEvent); this.once('closing', onClosing); this.on('intent-changed', onIntent);
          void this.request(['loadfile', file, 'replace', -1, { start: String(value.position) }]).catch(finish);
        });
        current();
        const duration = await this.request(['get_property', 'duration']);
        const output = await this.request(['get_property', 'current-ao']);
        current();
        if (output !== 'wasapi') throw new PlaybackFault('device-unavailable', 'WASAPI output did not start. Check the selected device; no shared-mode fallback was applied.');
        this.update({ duration: Number(duration) || 0, ready: true, paused: true });
        await this.temp.cleanup(file);
      } catch (error) {
        // Delete only after the helper acknowledges release. If stop fails, retain
        // ownership until the next successful stop or process shutdown.
        const released = await this.request(['stop']).then(() => true, () => false);
        if (released) await this.temp.cleanup();
        if (error.kind !== 'cancelled') this.update({ ready: false, paused: true, error: faultInfo(error) }); throw error;
      }
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
  command(command, value, context) {
    if (!['play', 'pause', 'seek', 'volume', 'speed', 'stop'].includes(command)) return Promise.reject(new Error('Unknown native audio command.'));
    if (['seek', 'volume', 'speed'].includes(command) && !finite(value, command === 'speed' ? .5 : 0, command === 'seek' ? 864000 : command === 'speed' ? 1.5 : 1000)) return Promise.reject(new Error('Invalid audio value.'));
    let token; const guard = this.guard;
    try { if (context) { token = guard.accept(context); this.emit('intent-changed'); } } catch (error) { return Promise.reject(error); }
    const current = () => { if (token) { if (guard !== this.guard) throw cancelled(); guard.check(token, command); } };
    return this.enqueue(async () => {
      current();
      if (['pause', 'stop'].includes(command) && !this.socket) return;
      await this.start(); current();
      if (command === 'stop') { this.update({ ready: false, paused: true }); await this.request(['stop']); this.update({ id: '', time: 0, duration: 0, ready: false, paused: true, ended: false }); return; }
      if (command === 'seek') { await this.request(['seek', value, 'absolute+exact']); current(); this.update({ time: value, ended: false }); return; }
      await this.request(['set_property', command === 'play' || command === 'pause' ? 'pause' : command, command === 'play' ? false : command === 'pause' ? true : value]);
    });
  }
  resetCommands() { this.guard = new NativeCommandGuard(); this.emit('intent-changed'); }

  dispose() {
    if (this.disposing) return this.disposing;
    this.closed = true;
    this.emit('closing');
    for (const pending of this.requests.values()) pending.reject(new PlaybackFault('cancelled', 'Native audio is closed.'));
    this.requests.clear(); this.socket?.destroy(); this.socket = undefined;
    this.disposing = (async () => {
      // A pending write/start must settle before the final sweep; otherwise it
      // could recreate files after cleanup. All queued commands are now rejected.
      await this.serial;
      await this.starting?.catch(() => {});
      const child = this.child;
      if (child && child.exitCode === null) {
        let onExit;
        const exited = new Promise(resolve => { onExit = resolve; child.once('exit', onExit); });
        child.kill();
        await Promise.race([exited, delay(3000)]);
        child.off('exit', onExit);
        if (child.exitCode === null && child.signalCode === null) {
          console.warn('Native audio helper has not exited; retaining owned temporary files.');
          return;
        }
      }
      await this.temp.finish();
      this.removeAllListeners();
    })();
    return this.disposing;
  }
}
