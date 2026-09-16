import { diagnosticLog } from '../desktop/diagnostics';
import { lyricRevision } from './revision';
import { parseLyrics, LYRICS_PARSER_VERSION } from './parse';
import { readLyrics, saveLyrics } from './repository';
import { exactMetadata, selectAmllRevision, artistNames, parseAmllIndex, type AmllEntry } from './amllMatch';
import type { LocalTrack } from '../library/importFiles';

const REPOSITORY = 'https://raw.githubusercontent.com/amll-dev/amll-ttml-db/main/';
async function remoteText(url: string, signal: AbortSignal, limit = 4 * 1024 * 1024) {
  const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]), credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' });
  if (response.status === 404) { await response.body?.cancel(); return undefined; }
  if (!response.ok) { await response.body?.cancel(); throw new Error(`AMLL request failed (HTTP ${response.status}). Local lyrics are unchanged.`); }
  if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw new Error('AMLL response is too large.'); }
  const reader = response.body?.getReader(); if (!reader) throw new Error('AMLL returned no lyrics.');
  const chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > limit) { await reader.cancel(); throw new Error('AMLL response is too large.'); } chunks.push(value); } } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let position = 0; for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.length; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
async function request(path: 'get' | 'search', query: Record<string, string>, signal: AbortSignal) {
  const source = await remoteText(`https://api.amll.dev/v1/lyrics/${path}?${new URLSearchParams(query)}`, signal);
  if (source === undefined) return undefined;
  const payload = JSON.parse(source);
  if (payload?.status === 404) return undefined;
  if (payload?.status !== 200 || !payload.data || typeof payload.data !== 'object') throw new Error('AMLL returned an invalid response. Local lyrics are unchanged.');
  return payload.data;
}
let indexCache: { until: number; items: AmllEntry[] } | undefined;
async function repositoryIndex(signal: AbortSignal) {
  signal.throwIfAborted();
  if (indexCache && indexCache.until > Date.now()) return indexCache.items;
  const source = await remoteText(REPOSITORY + 'metadata/raw-lyrics-index.jsonl', signal, 16 * 1024 * 1024);
  if (source === undefined) throw new Error('AMLL repository index is unavailable. Local lyrics are unchanged.');
  const items = parseAmllIndex(source); signal.throwIfAborted();
  indexCache = { items, until: Date.now() + 3600000 }; return items;
}
const hasId = (ids: unknown, id: string) => Array.isArray(ids) && ids.some(v => typeof v === 'string' && v.toUpperCase() === id.toUpperCase());
export async function resolveAmll(track: LocalTrack, signal: AbortSignal, onStatus: (text: string) => void) {
  const status = (text: string) => { if (text) diagnosticLog('debug', 'amll', text); onStatus(text); };
  const before = await readLyrics(track.id);
  if (before?.document.format === 'ttml') return;
  let match: { id: string; isrc: string } | null = null;
  const desktop = window.localMusicDesktop;
  let spotifyError = false;
  try {
    if (desktop && (await desktop.spotifyInfo()).connected) {
      signal.throwIfAborted(); status('Searching Spotify ISRC...');
      match = await desktop.spotifyMatch({ name: track.name, artist: track.artist, duration: track.duration });
    }
  } catch { signal.throwIfAborted(); spotifyError = true; }
  signal.throwIfAborted(); status('Searching AMLL TTML...');
  let data: AmllEntry | undefined, unavailable = false;
  const attempt = async (path: 'get' | 'search', query: Record<string, string>) => {
    try { return await request(path, query, signal); }
    catch { signal.throwIfAborted(); unavailable = true; return undefined; }
  };
  if (match?.isrc) {
    data = await attempt('get', { isrc: match.isrc, format: 'ttml' });
    if (data && !hasId(data.isrcs, match.isrc)) throw new Error('AMLL returned a mismatched ISRC. Local lyrics are unchanged.');
  }
  if (!data && match?.id) {
    data = await attempt('get', { spotifyId: match.id, format: 'ttml' });
    if (data && !hasId(data.spotifyIds, match.id)) throw new Error('AMLL returned a mismatched Spotify recording. Local lyrics are unchanged.');
  }
  if (!data && track.name?.trim() && track.artist?.trim()) {
    status('Searching AMLL by title and artist...');
    const queries: Record<string, string>[] = [{ musicName: track.name.trim(), artistName: artistNames(track.artist)[0] || track.artist.trim() }, { musicName: track.name.trim() }];
    for (const query of queries) {
      const items: AmllEntry[] = []; let complete = false;
      for (let page = 1; page <= 5; page++) {
        const result = await attempt('search', { ...query, pageSize: '100', page: String(page) });
        if (!result) break;
        if (!Array.isArray(result.items) || result.items.some((item: unknown) => !item || typeof item !== 'object')) { unavailable = true; break; }
        items.push(...result.items);
        if (result.pagination?.hasMore === false || result.pagination?.totalPages <= page || !result.items.length) { complete = true; break; }
      }
      const candidate = complete ? selectAmllRevision(items, track) : undefined;
      if (candidate) {
        status('Downloading AMLL TTML...');
        data = await attempt('get', { id: String(candidate.id), format: 'ttml' });
        if (data && (String(data.id) !== String(candidate.id) || !exactMetadata(data, track.name, track.artist))) throw new Error('AMLL returned a mismatched recording. Local lyrics are unchanged.');
        if (data) break;
      } else if (complete && items.some(entry => exactMetadata(entry, track.name, track.artist || ''))) {
        status('AMLL has multiple recording matches. Using local lyrics.'); return;
      }
      if (unavailable) break; // Do not repeat requests to an unavailable API.
    }
    if (!data) {
      status('Searching the AMLL repository index...');
      const items = await repositoryIndex(signal);
      const identified = match?.isrc ? items.filter(item => hasId(item.isrcs, match!.isrc)) : [];
      const byId = identified.length ? identified : match?.id ? items.filter(item => hasId(item.spotifyIds, match!.id)) : [];
      const candidates = byId.length ? byId : items;
      const candidate = selectAmllRevision(candidates, track);
      if (candidate?.filename) {
        const source = await remoteText(REPOSITORY + 'raw-lyrics/' + encodeURIComponent(candidate.filename), signal);
        if (source !== undefined) data = { ...candidate, format: 'ttml', lyrics: source };
      } else if (candidates.some(entry => exactMetadata(entry, track.name, track.artist || ''))) {
        status('AMLL has multiple recording matches. Using local lyrics.'); return;
      }
    }
  }
  if (!data) { status(unavailable ? 'AMLL API is unavailable and its repository has no exact match. Using local lyrics.' : spotifyError ? 'Spotify lookup failed and AMLL title search found no match. Using local lyrics.' : 'AMLL has no matching TTML. Using local lyrics.'); return; }
  status('Downloading AMLL TTML...');
  if (data.format !== 'ttml' || typeof data.lyrics !== 'string') throw new Error('AMLL returned invalid lyrics. Local lyrics are unchanged.');
  const source = data.lyrics, fileName = typeof data.filename === 'string' && /^[\w.-]+\.ttml$/.test(data.filename) ? data.filename : 'amll.ttml';
  const document = parseLyrics(source, fileName); if (!document.lines.length) throw new Error('AMLL returned empty lyrics.');
  signal.throwIfAborted();
  await saveLyrics({ trackId: track.id, fileName, source, document, origin: 'amll', parserVersion: LYRICS_PARSER_VERSION, savedAt: Date.now(), offsetMs: before?.offsetMs,
    remote: { isrc: match?.isrc || '', spotifyId: match?.id || '', authors: Array.isArray(data.authorUsernames) ? data.authorUsernames.filter(name => typeof name === 'string').slice(0, 50) : [] } }, lyricRevision(before));
  status('');
}
