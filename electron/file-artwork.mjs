import { open } from 'node:fs/promises';
import path from 'node:path';

const limit = 20 * 1024 * 1024;
const pngMagic = Buffer.from('89504e470d0a1a0a', 'hex');
/** Extract PNG representations from a bounded macOS custom-icon resource fork. */
export function customIconPng(bytes) {
  const b = Buffer.from(bytes);
  if (b.length < 16 || b.length > limit) return;
  const start = b.readUInt32BE(0), length = b.readUInt32BE(8), end = start + length;
  if (start < 16 || end > b.length) return;
  let best, area = 0;
  for (let resource = start; resource + 4 <= end;) {
    const size = b.readUInt32BE(resource); resource += 4;
    const stop = resource + size;
    if (size < 8 || stop > end) return;
    if (b.toString('ascii', resource, resource + 4) === 'icns' && b.readUInt32BE(resource + 4) === size) {
      for (let at = resource + 8; at + 8 <= stop;) {
        const chunk = b.readUInt32BE(at + 4);
        if (chunk < 8 || at + chunk > stop) return;
        const image = b.subarray(at + 8, at + chunk);
        if (image.length >= 24 && image.subarray(0, 8).equals(pngMagic) && image.toString('ascii', 12, 16) === 'IHDR') {
          const width = image.readUInt32BE(16), height = image.readUInt32BE(20);
          if (width && height && width <= 4096 && height <= 4096 && width * height > area) {
            best = image; area = width * height;
          }
        }
        at += chunk;
      }
    }
    resource = stop;
  }
  return best;
}

export async function readFileArtwork(filePath) {
  if (process.platform !== 'darwin' || typeof filePath !== 'string' || !path.isAbsolute(filePath) ||
      !/\.(mp3|wav|flac|m4a|aac|ogg|oga|opus|aiff|aif|webm)$/i.test(filePath)) return;
  let file;
  try {
    file = await open(filePath + '/..namedfork/rsrc', 'r');
    const { size } = await file.stat();
    if (!size || size > limit) return;
    return customIconPng(await file.readFile());
  } catch { /* Ordinary files do not have custom-icon artwork. */ }
  finally { await file?.close(); }
}
