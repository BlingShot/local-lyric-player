import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

export function toneWav(rate, channels, duration, signal) {
  const frames = Math.round(rate * duration), bytes = Buffer.alloc(44 + frames * channels * 3);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(channels, 22); bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * channels * 3, 28);
  bytes.writeUInt16LE(channels * 3, 32); bytes.writeUInt16LE(24, 34); bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  for (let i = 0; i < frames; i++) for (let c = 0; c < channels; c++) bytes.writeIntLE(Math.round(Math.max(-1, Math.min(1, signal(i / rate, i, c))) * 8388607), 44 + (i * channels + c) * 3, 3);
  return bytes;
}
export function ffmpeg(args) {
  const process = spawnSync('ffmpeg', ['-nostdin', '-hide_banner', ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  if (process.status !== 0) throw new Error(process.stderr || process.error?.message);
  return process.stderr;
}
export function reference(file) {
  const log = ffmpeg(['-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-']);
  const summary = log.slice(log.lastIndexOf('Summary:'));
  return { integratedLufs: Number(summary.match(/I:\s*([\d.-]+)/)?.[1]), rangeLu: Number(summary.match(/LRA:\s*([\d.-]+)/)?.[1]),
    truePeakDbtp: Number(summary.match(/Peak:\s*([\d.-]+)/)?.[1]), summary };
}
export async function loudnessFixtures() {
  const root = resolve('test-results/loudness/fixtures'); await mkdir(root, { recursive: true });
  const names = [];
  const save = async (name, rate, channels, duration, fn) => { await writeFile(resolve(root, name), toneWav(rate, channels, duration, fn)); names.push(name); };
  for (const rate of [44100, 48000, 96000, 192000]) for (const channels of [1, 2]) await save(`tone-${rate}-${channels}.wav`, rate, channels, 12, (t, i, c) => .1 * Math.sin(2 * Math.PI * 997 * t) * (c ? -1 : 1));
  await save('dynamic.wav', 48000, 2, 40, t => (t < 20 ? .1 : .01) * Math.sin(2 * Math.PI * 997 * t));
  await save('intersample.wav', 48000, 1, 12, (t, i) => .9 * Math.sin(Math.PI * .5 * i + Math.PI / 4) * Math.min(1, t * 10, (12 - t) * 10));
  await save('crest.wav', 48000, 1, 12, t => .85 * Math.sin(2 * Math.PI * 997 * t) * (t % .5 < .025 ? 1 : .015));
  await save('silence.wav', 48000, 2, 4, () => 0);
  await save('short.wav', 44100, 1, .1, t => .1 * Math.sin(2 * Math.PI * 997 * t));
  await save('one-second.wav', 48000, 1, 1, t => .1 * Math.sin(2 * Math.PI * 997 * t));
  await save('long.wav', 48000, 2, 120, t => .03 * Math.sin(2 * Math.PI * 997 * t));
  for (const [name, codec, input] of [['album-a.flac', 'flac', 'tone-48000-2.wav'], ['album-b.mp3', 'libmp3lame', 'dynamic.wav']]) {
    ffmpeg(['-loglevel', 'error', '-y', '-i', resolve(root, input), '-c:a', codec, '-metadata', 'ALBUM=Measured album', '-metadata', `${codec === 'flac' ? 'ALBUMARTIST' : 'album_artist'}=Test artist`, '-metadata', `TITLE=${name}`,
      '-metadata', 'REPLAYGAIN_TRACK_GAIN=-4.2 dB', resolve(root, name)]); names.push(name);
  }
  await writeFile(resolve(root, 'corrupt.mp3'), 'broken audio'); names.push('corrupt.mp3');
  await save('unsupported-rate.wav', 22050, 1, 5, t => .1 * Math.sin(2 * Math.PI * 997 * t));
  ffmpeg(['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=96000:cl=stereo', '-t', '200', '-c:a', 'flac', resolve(root, 'oversized.flac')]); names.push('oversized.flac');
  const references = Object.fromEntries(names.filter(n => !['corrupt.mp3', 'silence.wav', 'short.wav', 'long.wav', 'unsupported-rate.wav', 'oversized.flac'].includes(n)).map(name => [name, reference(resolve(root, name))]));
  await writeFile(resolve(root, '../reference.json'), JSON.stringify(references, null, 2));
  return { root, names, references };
}
