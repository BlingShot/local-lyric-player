import { NativeAudio } from '../electron/native-audio.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const directory = await mkdtemp(join(tmpdir(), 'lyric-native-test-'));
const engine = new NativeAudio(resolve(import.meta.dirname, '../desktop/native/mpv.exe'), directory);
const rate = 48000, seconds = 4, bytes = new ArrayBuffer(44 + rate * seconds * 4), data = new DataView(bytes);
const word = (offset, text) => [...text].forEach((c, i) => data.setUint8(offset + i, c.charCodeAt(0)));
word(0, 'RIFF'); data.setUint32(4, bytes.byteLength - 8, true); word(8, 'WAVE'); word(12, 'fmt '); data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, 2, true); data.setUint32(24, rate, true); data.setUint32(28, rate * 4, true); data.setUint16(32, 4, true); data.setUint16(34, 16, true); word(36, 'data'); data.setUint32(40, bytes.byteLength - 44, true);
try {
  console.log('Devices:', await engine.devices());
  await assert.rejects(engine.command('run', 'bad'), /Unknown/);
  for (const exclusive of [false, true]) {
    await engine.load({ id: `test-${exclusive}`, bytes, device: 'auto', exclusive, position: 0, volume: 0, speed: 1 });
    assert.equal(engine.state.ready, true); assert.equal(engine.state.duration, seconds); assert.equal(engine.state.exclusive, exclusive);
    await engine.command('play'); await new Promise(resolve => setTimeout(resolve, 400));
    assert.ok(engine.state.time > 0); await engine.command('pause'); await engine.command('seek', 2); assert.equal(engine.state.time, 2);
    await engine.command('speed', 1.25); await engine.command('volume', 0); await engine.command('stop');
    console.log(`PASS real WASAPI ${exclusive ? 'exclusive' : 'shared'}: silent playback, pause, seek, volume, speed.`);
  }
} finally { await engine.dispose(); if (!directory.startsWith(join(tmpdir(), 'lyric-native-test-'))) throw Error('Unsafe cleanup'); await rm(directory, { recursive: true, force: true }); }
