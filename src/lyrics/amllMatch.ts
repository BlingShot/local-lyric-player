export interface AmllEntry {
  id: number | string; filename?: string; musicNames?: string[]; artistNames?: string[]; albumNames?: string[];
  isrcs?: string[]; spotifyIds?: string[]; ncmMusicIds?: string[]; qqMusicIds?: string[]; appleMusicIds?: string[];
  authorUsernames?: string[]; format?: string; lyrics?: string;
}
const normalize = (text: string) => text.normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}]+/gu, '');
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((s): s is string => typeof s === 'string') : [];
export function artistNames(text: string): string[] {
  return text.split(/\s*(?:;|；|,|，|、|\/|&|＆|\bfeat\.?\s+|\bft\.?\s+)\s*/i).map(value => value.trim()).filter(Boolean);
}
export function exactMetadata(entry: AmllEntry, name: string, artist: string) {
  if (!normalize(name) || !normalize(artist)) return false;
  return strings(entry.musicNames).some(n => normalize(n) === normalize(name)) &&
    (strings(entry.artistNames).some(a => normalize(a) === normalize(artist)) || normalize(strings(entry.artistNames).join(' ')) === normalize(artist) ||
      (artistNames(artist).length > 1 && artistNames(artist).every(a => strings(entry.artistNames).some(b => normalize(a) === normalize(b))) && artistNames(artist).length === strings(entry.artistNames).length));
}
function recordingKeys(entry: AmllEntry) {
  return ['isrcs', 'spotifyIds', 'ncmMusicIds', 'qqMusicIds', 'appleMusicIds'].flatMap(key => strings(entry[key as keyof AmllEntry]).map(id => `${key}:${id.toUpperCase()}`));
}
export function selectAmllRevision(items: AmllEntry[], track: { name: string; artist?: string; album?: string }) {
  let exact = items.filter(entry => exactMetadata(entry, track.name, track.artist || ''));
  const album = normalize(track.album || '');
  if (album) { const sameAlbum = exact.filter(entry => strings(entry.albumNames).some(a => normalize(a) === album)); if (sameAlbum.length) exact = sameAlbum; }
  if (!exact.length) return undefined;
  // Multiple revisions are safe only when connected by a shared recording identifier.
  const connected = new Set([exact[0]]), keys = new Set(recordingKeys(exact[0]));
  let changed = true;
  while (changed) { changed = false; for (const entry of exact) if (!connected.has(entry) && recordingKeys(entry).some(id => keys.has(id))) { connected.add(entry); recordingKeys(entry).forEach(id => keys.add(id)); changed = true; } }
  if (connected.size !== exact.length) return undefined;
  return exact.sort((a, b) => Number(b.filename?.match(/^\d{13}/)?.[0] || 0) - Number(a.filename?.match(/^\d{13}/)?.[0] || 0))[0];
}

/** Official metadata/raw-lyrics-index.jsonl: rawLyricFile plus [key, values][] metadata. */
export function parseAmllIndex(source: string): AmllEntry[] {
  if (source.length > 16 * 1024 * 1024) throw new Error('AMLL index is too large.');
  const rows = source.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim());
  if (rows.length > 100000) throw new Error('AMLL index is too large.');
  return rows.map(row => {
    const item = JSON.parse(row);
    if (!item || typeof item.rawLyricFile !== 'string' || !/^[\w-]+\.ttml$/.test(item.rawLyricFile) || !Array.isArray(item.metadata)) throw new Error('AMLL returned an invalid repository index.');
    const fields: Record<string, string[]> = Object.create(null);
    for (const field of item.metadata) {
      if (!Array.isArray(field) || field.length !== 2 || typeof field[0] !== 'string' || !Array.isArray(field[1]) || field[1].some((v: unknown) => typeof v !== 'string')) throw new Error('AMLL returned an invalid repository index.');
      fields[field[0]] = [...(fields[field[0]] || []), ...field[1]];
    }
    return { id: item.rawLyricFile, filename: item.rawLyricFile, musicNames: fields.musicName, artistNames: fields.artists, albumNames: fields.album,
      isrcs: fields.isrc, spotifyIds: fields.spotifyId, ncmMusicIds: fields.ncmMusicId, qqMusicIds: fields.qqMusicId, appleMusicIds: fields.appleMusicId, authorUsernames: fields.ttmlAuthorGithubLogin };
  });
}
