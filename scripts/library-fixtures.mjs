import { deflateSync } from 'node:zlib';

export function wav(seconds = 8, rate = 8000) {
  const samples = rate * seconds, data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) data.writeInt16LE(Math.round(Math.sin(i * 220 * 2 * Math.PI / rate) * 1000), 44 + i * 2);
  return data;
}
function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ -1) >>> 0;
}
export function png(red, green, blue) {
  const chunk = (name, data) => {
    const type = Buffer.from(name), length = Buffer.alloc(4), crc = Buffer.alloc(4);
    length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([type, data])));
    return Buffer.concat([length, type, data, crc]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(2, 0); header.writeUInt32BE(2, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from([0, red, green, blue, red, green, blue, 0, red, green, blue, red, green, blue]))), chunk('IEND', Buffer.alloc(0))]);
}
const syncSize = value => Buffer.from([(value >>> 21) & 127, (value >>> 14) & 127, (value >>> 7) & 127, value & 127]);
export function taggedWav(tags, pictures = [], lyrics, seconds = 8, rate = 8000) {
  const frame = (name, data) => Buffer.concat([Buffer.from(name), syncSize(data.length), Buffer.alloc(2), data]);
  const frames = Object.entries(tags).map(([name, value]) => frame(name, Buffer.concat([Buffer.from([3]), Buffer.from(value)])));
  for (const { type, data } of pictures) frames.push(frame('APIC', Buffer.concat([Buffer.from([3]), Buffer.from('image/png\0'), Buffer.from([type, 0]), data])));
  if (lyrics !== undefined) frames.push(frame('USLT', Buffer.concat([Buffer.from([3]), Buffer.from('eng\0'), Buffer.from(lyrics)])));
  const body = Buffer.concat(frames), id3 = Buffer.concat([Buffer.from('ID3'), Buffer.from([4, 0, 0]), syncSize(body.length), body]);
  const riff = wav(seconds, rate), chunkHeader = Buffer.alloc(8); chunkHeader.write('id3 '); chunkHeader.writeUInt32LE(id3.length, 4);
  const result = Buffer.concat([riff, chunkHeader, id3, Buffer.alloc(id3.length % 2)]);
  result.writeUInt32LE(result.length - 8, 4);
  return result;
}
