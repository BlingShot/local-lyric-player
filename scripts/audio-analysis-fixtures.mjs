import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

export function rhythmWav(rate = 44100, channels = 1, duration = 32, silent = false, minor = false) {
  const frames = Math.round(rate * duration), bytes = Buffer.alloc(44 + frames * channels * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(channels, 22); bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * channels * 2, 28);
  bytes.writeUInt16LE(channels * 2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  const chords = minor ? [[57, 60, 64], [62, 65, 69], [64, 68, 71], [57, 60, 64]] : [[60, 64, 67], [65, 69, 72], [67, 71, 74], [60, 64, 67]];
  for (let frame = 0; frame < frames; frame++) {
    const time = frame / rate, beatTime = time % .5;
    let value = 0;
    if (!silent) {
      value = .65 * Math.exp(-beatTime * 80) * (Math.sin(2 * Math.PI * 1100 * time) + .3 * Math.sin(2 * Math.PI * 90 * time));
      for (const note of chords[Math.floor(time / 2) % 4]) {
        const frequency = 440 * 2 ** ((note - 69) / 12);
        value += .035 * (Math.sin(2 * Math.PI * frequency * time) + .4 * Math.sin(4 * Math.PI * frequency * time));
      }
    }
    for (let channel = 0; channel < channels; channel++) bytes.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value * (channel ? .9 : 1))) * 32767), 44 + (frame * channels + channel) * 2);
  }
  return bytes;
}
export async function createAudioAnalysisFixtures() {
  const root = resolve('test-results/audio-analysis/fixtures'); await mkdir(root, { recursive: true });
  for (const [name, rate, channels, duration, silent] of [
    ['beat-441-mono.wav', 44100, 1, 32, false], ['beat-441-stereo.wav', 44100, 2, 32, false],
    ['beat-480-mono.wav', 48000, 1, 32, false], ['beat-480-stereo.wav', 48000, 2, 32, false],
    ['silence.wav', 48000, 2, 8, true], ['short.wav', 44100, 1, .12, false],
  ]) await writeFile(resolve(root, name), rhythmWav(rate, channels, duration, silent));
  await writeFile(resolve(root, 'minor-480.wav'), rhythmWav(48000, 2, 32, false, true));
  await writeFile(resolve(root, 'long-480.wav'), rhythmWav(48000, 2, 128));
  await writeFile(resolve(root, 'corrupt.mp3'), 'This file is intentionally not an MP3.');
  const encode = (input, output, args) => execFileSync('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', resolve(root, input),
    ...args, '-metadata', 'title=Tagged analysis fixture', '-metadata', output.endsWith('.flac') ? 'BPM=123' : 'TBPM=123', '-metadata', output.endsWith('.flac') ? 'KEY=F#m' : 'TKEY=F#m',
    '-metadata', 'REPLAYGAIN_TRACK_GAIN=-4.2 dB', resolve(root, output)], { windowsHide: true });
  encode('beat-480-stereo.wav', 'beat-480.flac', ['-c:a', 'flac']);
  encode('beat-441-mono.wav', 'beat-441.mp3', ['-c:a', 'libmp3lame', '-b:a', '192k']);
  return root;
}
