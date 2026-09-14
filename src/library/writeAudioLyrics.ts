// Tag-only writers. Audio payloads stay as Blob slices; no decoding or re-encoding.
// FLAC: RFC 9639 §8.6. ID3: v2.3 / v2.4 USLT and frame/header structures.
const encoder = new TextEncoder();
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const MAX_TAG = 32 * 1024 * 1024;
function check(ok: unknown, message = 'Malformed audio tags. The audio copy was not changed.'): asserts ok {
  if (!ok) throw new Error(message);
}
const be = (b: Uint8Array, at = 0) => new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(at);
const le = (b: Uint8Array, at = 0) => new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(at, true);
function u32(value: number, little = false) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, value, little); return b; }
function syncRead(b: Uint8Array, at: number) {
  check(b.length >= at + 4 && b.slice(at, at + 4).every(v => v < 128));
  return b[at] * 2097152 + b[at + 1] * 16384 + b[at + 2] * 128 + b[at + 3];
}
const syncWrite = (n: number) => new Uint8Array([(n >>> 21) & 127, (n >>> 14) & 127, (n >>> 7) & 127, n & 127]);
async function bytes(blob: Blob, start: number, size: number) {
  check(size >= 0 && size <= MAX_TAG && start >= 0 && start + size <= blob.size);
  return new Uint8Array(await blob.slice(start, start + size).arrayBuffer());
}
function join(parts: Uint8Array[]) {
  const size = parts.reduce((sum, part) => sum + part.length, 0); check(size <= MAX_TAG);
  const result = new Uint8Array(size); let at = 0;
  for (const part of parts) { result.set(part, at); at += part.length; }
  return result;
}
function vorbisLyrics(body: Uint8Array | undefined, lyrics: string) {
  let vendor = encoder.encode('Lyric Player'), comments: Uint8Array[] = [];
  if (body) {
    let at = 0;
    const string = () => { check(at + 4 <= body.length); const length = le(body, at); at += 4; check(at + length <= body.length); const value = body.slice(at, at + length); at += length; return value; };
    vendor = string(); check(at + 4 <= body.length); const count = le(body, at); at += 4;
    check(count <= (body.length - at) / 4);
    for (let i = 0; i < count; i++) {
      const comment = string();
      if (!/^(LYRICS|UNSYNCEDLYRICS)=/i.test(text(comment))) comments.push(comment);
    }
    check(at === body.length);
  }
  comments.push(encoder.encode(`LYRICS=${lyrics}`));
  const result = join([u32(vendor.length, true), vendor, u32(comments.length, true), ...comments.flatMap(value => [u32(value.length, true), value])]);
  check(result.length < 0x1000000, 'The FLAC lyric tag exceeds the metadata block limit.');
  return result;
}
async function flac(blob: Blob, lyrics: string) {
  const blocks: { type: number; body: Blob | Uint8Array }[] = [];
  let at = 4, last = false, hasComment = false;
  while (!last) {
    check(blocks.length < 10000 && at <= MAX_TAG, 'FLAC metadata is too large or malformed.');
    const head = await bytes(blob, at, 4), type = head[0] & 127, size = head[1] * 65536 + head[2] * 256 + head[3];
    check(type < 127 && at + 4 + size <= blob.size);
    if (!blocks.length) check(type === 0 && size === 34);
    else check(type !== 0);
    last = !!(head[0] & 128); at += 4;
    let body: Blob | Uint8Array = blob.slice(at, at + size);
    if (type === 4) { check(!hasComment, 'Multiple FLAC comment blocks are not supported for writing.'); body = vorbisLyrics(await bytes(blob, at, size), lyrics); hasComment = true; }
    blocks.push({ type, body }); at += size;
  }
  check(at < blob.size, 'The FLAC file has no audio frames.');
  if (!hasComment) blocks.push({ type: 4, body: vorbisLyrics(undefined, lyrics) });
  const parts: BlobPart[] = [encoder.encode('fLaC')];
  blocks.forEach(({ type, body }, index) => {
    const size = body instanceof Blob ? body.size : body.length;
    parts.push(new Uint8Array([type | (index === blocks.length - 1 ? 128 : 0), size >>> 16, (size >>> 8) & 255, size & 255]), body as BlobPart);
  });
  return new Blob([...parts, blob.slice(at)], { type: blob.type || 'audio/flac' });
}
function id3String(body: Uint8Array) {
  const encoding = body[0]; check(encoding <= 3);
  return new TextDecoder(encoding === 0 ? 'windows-1252' : encoding === 1 ? (body[1] === 0xfe ? 'utf-16be' : 'utf-16le') : encoding === 2 ? 'utf-16be' : 'utf-8').decode(body.subarray(1)).replace(/^\uFEFF/, '');
}
function id3(old: Uint8Array | undefined, lyrics: string) {
  let version = 4; const frames: Uint8Array[] = [];
  if (old) {
    check(old.length >= 10 && text(old.slice(0, 3)) === 'ID3'); version = old[3];
    check((version === 3 || version === 4) && old[4] === 0 && old[5] === 0,
      'This ID3 version or tag flags are not supported for safe writing. Export LRC / TTML instead.');
    check(syncRead(old, 6) + 10 === old.length);
    let at = 10;
    while (at < old.length && old[at]) {
      check(at + 10 <= old.length); const name = text(old.slice(at, at + 4));
      check(/^[A-Z0-9]{4}$/.test(name));
      const length = version === 4 ? syncRead(old, at + 4) : be(old, at + 4);
      check(length > 0 && at + 10 + length <= old.length);
      check(!['CHAP', 'CTOC', 'SEEK', 'ASPI', 'SIGN'].includes(name), 'ID3 chapters, position indexes or signatures are not supported for safe writing. Export lyrics instead.');
      let lyric = name === 'USLT' || name === 'SYLT';
      if (name === 'TXXX') {
        check(old[at + 9] === 0, 'Encoded custom ID3 frames are not supported for writing.');
        lyric = /^(LYRICS|UNSYNCEDLYRICS)\0/i.test(id3String(old.slice(at + 10, at + 10 + length)));
      }
      if (!lyric) frames.push(old.slice(at, at + 10 + length));
      at += 10 + length;
    }
    check(old.slice(at).every(v => v === 0));
  }
  let body: Uint8Array;
  if (version === 3) {
    const utf16 = new Uint8Array(lyrics.length * 2 + 2); utf16.set([255, 254]);
    for (let i = 0; i < lyrics.length; i++) { utf16[i * 2 + 2] = lyrics.charCodeAt(i) & 255; utf16[i * 2 + 3] = lyrics.charCodeAt(i) >>> 8; }
    body = join([new Uint8Array([1, 101, 110, 103, 255, 254, 0, 0]), utf16]);
  } else body = join([new Uint8Array([3, 101, 110, 103, 0]), encoder.encode(lyrics)]);
  frames.push(join([encoder.encode('USLT'), version === 4 ? syncWrite(body.length) : u32(body.length), new Uint8Array(2), body]));
  const data = join(frames);
  return join([encoder.encode('ID3'), new Uint8Array([version, 0, 0]), syncWrite(data.length), data]);
}
async function mp3(blob: Blob, lyrics: string) {
  let at = 0, old: Uint8Array | undefined; const head = await bytes(blob, 0, 10);
  if (text(head.slice(0, 3)) === 'ID3') { at = syncRead(head, 6) + 10; old = await bytes(blob, 0, at); }
  const frame = await bytes(blob, at, 4);
  check(frame[0] === 255 && (frame[1] & 224) === 224 && (frame[1] & 6) !== 0, 'MPEG audio frames could not be located. The audio copy was not changed.');
  return new Blob([id3(old, lyrics) as BlobPart, blob.slice(at)], { type: blob.type || 'audio/mpeg' });
}
async function wave(blob: Blob, lyrics: string) {
  const head = await bytes(blob, 0, 12); check(text(head.slice(8)) === 'WAVE' && le(head, 4) + 8 === blob.size);
  const parts: BlobPart[] = []; let at = 12, old: Uint8Array | undefined, hasAudio = false;
  while (at < blob.size) {
    const chunk = await bytes(blob, at, 8), name = text(chunk.slice(0, 4)), size = le(chunk, 4), end = at + 8 + size + size % 2;
    check(end <= blob.size);
    if (name.toLowerCase() === 'id3 ') { check(!old, 'Multiple WAV ID3 chunks are not supported for writing.'); old = await bytes(blob, at + 8, size); }
    else parts.push(blob.slice(at, end));
    if (name === 'data' && size > 0) hasAudio = true;
    at = end;
  }
  check(hasAudio, 'The WAV file has no audio data.');
  const tag = id3(old, lyrics), body = new Blob([...parts, encoder.encode('id3 '), u32(tag.length, true) as BlobPart, tag as BlobPart, new Uint8Array(tag.length % 2)]);
  check(body.size + 4 <= 0xffffffff, 'The resulting WAV exceeds the RIFF size limit.');
  return new Blob([encoder.encode('RIFF'), u32(body.size + 4, true) as BlobPart, encoder.encode('WAVE'), body], { type: blob.type || 'audio/wav' });
}
export async function writeAudioLyrics(blob: Blob, fileName: string, lyrics: string): Promise<Blob> {
  check(encoder.encode(lyrics).length <= 2 * 1024 * 1024 && lyrics.trim(), 'Lyrics must be nonempty and smaller than 2 MB.');
  const magic = text(await bytes(blob, 0, 4));
  if (magic === 'fLaC') return flac(blob, lyrics);
  if (magic === 'RIFF') return wave(blob, lyrics);
  if (/\.mp3$/i.test(fileName)) return mp3(blob, lyrics);
  throw new Error('Writing lyrics supports native FLAC, MP3 (ID3v2.3 / v2.4) and WAV. Export LRC / TTML for this audio format.');
}
