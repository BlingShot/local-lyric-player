import { diagnosticMetric, registerDebugSource } from '../desktop/diagnostics';
import { diagnosticTrace, type DiagnosticTrace } from '../desktop/trace';
import { lyricRevision } from './revision';
import { parseLyrics, LYRICS_PARSER_VERSION } from './parse';
import { readLyrics, saveLyrics } from './repository';
import { exactMetadata, selectAmllRevision, artistNames, parseAmllIndex, type AmllEntry } from './amllMatch';
import type { LocalTrack } from '../library/importFiles';

const REPOSITORY = 'https://raw.githubusercontent.com/amll-dev/amll-ttml-db/main/';
async function remoteText(url: string, signal: AbortSignal, trace: DiagnosticTrace, limit = 4 * 1024 * 1024) {
  const started = performance.now(); trace.step('Download', 'request', { url });
  try {
    const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]), credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' });
    trace.step('Download', 'response', { url, httpStatus: response.status, elapsedMs: performance.now() - started });
    if (response.status === 404) { await response.body?.cancel(); return undefined; }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`AMLL request failed (HTTP ${response.status}). Local lyrics are unchanged.`); }
    if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw new Error('AMLL response is too large.'); }
    const reader = response.body?.getReader(); if (!reader) throw new Error('AMLL returned no lyrics.');
    const chunks: Uint8Array[] = []; let size = 0;
    try { for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > limit) { await reader.cancel(); throw new Error('AMLL response is too large.'); } chunks.push(value); } } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let position = 0; for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.length; }
    trace.step('Download', 'complete', { bytes: size, elapsedMs: performance.now() - started });
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) { trace.step('Download', signal.aborted ? 'cancelled' : 'failed', { url, error }); throw error; }
}
async function request(path: 'get' | 'search', query: Record<string, string>, signal: AbortSignal, trace: DiagnosticTrace) {
  trace.step('Search', path, query); // Only whitelisted lyric identifiers, never credentials/headers.
  const source = await remoteText(`https://api.amll.dev/v1/lyrics/${path}?${new URLSearchParams(query)}`, signal, trace);
  if (source === undefined) return undefined;
  const payload = JSON.parse(source);
  trace.step('Search', 'payload', { apiStatus: payload?.status, candidateCount: payload?.data?.items?.length, pagination: payload?.data?.pagination });
  if (payload?.status === 404) return undefined;
  if (payload?.status !== 200 || !payload.data || typeof payload.data !== 'object') throw new Error('AMLL returned an invalid response. Local lyrics are unchanged.');
  return payload.data;
}
let indexCache: { until: number; items: AmllEntry[]; bytes: number } | undefined;
let expiry: ReturnType<typeof setTimeout> | undefined;
let cacheEpoch = 0;
export function clearAmllCache() { cacheEpoch++; indexCache = undefined; clearTimeout(expiry); expiry = undefined; }
export function amllCacheInfo() { return { indexBytes: indexCache?.bytes || 0, indexEntries: indexCache?.items.length || 0, expiresAt: indexCache?.until, maxSourceBytes: 16 * 1024 * 1024 }; }
registerDebugSource('performance', amllCacheInfo);
window.addEventListener('local-cache-cleared', clearAmllCache);
async function repositoryIndex(signal: AbortSignal, trace: DiagnosticTrace) {
  signal.throwIfAborted();
  if (indexCache && indexCache.until > Date.now()) { trace.step('Cache', 'index-hit', amllCacheInfo()); return indexCache.items; }
  if (indexCache) clearAmllCache(); const epoch = cacheEpoch; trace.step('Cache', 'index-miss');
  const source = await remoteText(REPOSITORY + 'metadata/raw-lyrics-index.jsonl', signal, trace, 16 * 1024 * 1024);
  if (source === undefined) throw new Error('AMLL repository index is unavailable. Local lyrics are unchanged.');
  const started = performance.now(), items = parseAmllIndex(source); signal.throwIfAborted();
  trace.step('Parse', 'index-complete', { candidates: items.length, elapsedMs: performance.now() - started });
  // Drop expired indexes even when there are no more searches; do not retain lyric bodies.
  if (epoch !== cacheEpoch) { trace.step('Cache', 'index-invalidated-during-download'); return items; }
  clearTimeout(expiry);
  indexCache = { items, until: Date.now() + 30 * 60000, bytes: new TextEncoder().encode(source).byteLength };
  expiry = setTimeout(clearAmllCache, 30 * 60000); return items;
}
const hasId = (ids: unknown, id: string) => Array.isArray(ids) && ids.some(v => typeof v === 'string' && v.toUpperCase() === id.toUpperCase());
export async function resolveAmll(track: LocalTrack, signal: AbortSignal, onStatus: (text: string) => void) {
  const trace = diagnosticTrace('amll', { trackId: track.id, title: track.name, artist: track.artist });
  const status = (text: string) => onStatus(text);
  let fallback = 'none';
  const finishFallback = (reason: string, text: string) => { trace.step('Fallback', reason, { selectedSource: fallback }); trace.finish('fallback', { reason, selectedSource: fallback }); status(text); };
  try {
    const before = await readLyrics(track.id); fallback = before?.origin === 'embedded' ? 'Embedded' : before?.document.format || 'none';
    trace.step('Cache', before ? 'saved-lyrics-hit' : 'saved-lyrics-miss', { format: before?.document.format, origin: before?.origin });
    if (before?.document.format === 'ttml') { trace.step('Apply', 'keep-existing-ttml', { origin: before.origin }); trace.finish('cached'); return; }
    let match: { id: string; isrc: string } | null = null;
    const desktop = window.localMusicDesktop; let spotifyError = false;
    trace.step('ISRC', 'start');
    try {
      if (desktop && (await desktop.spotifyInfo()).connected) {
        signal.throwIfAborted(); status('Searching Spotify ISRC...');
        match = await desktop.spotifyMatch({ name: track.name, artist: track.artist, duration: track.duration });
      }
      trace.step('ISRC', match ? 'matched' : 'unavailable', { isrc: match?.isrc, spotifyId: match?.id, reason: match ? undefined : 'No connected Spotify match; title/artist search remains available.' });
    } catch (error) { signal.throwIfAborted(); spotifyError = true; trace.step('ISRC', 'failed', { error }); }
    signal.throwIfAborted(); status('Searching AMLL TTML...');
    let data: AmllEntry | undefined, unavailable = false;
    const attempt = async (path: 'get' | 'search', query: Record<string, string>) => {
      try { return await request(path, query, signal, trace); }
      catch (error) { signal.throwIfAborted(); unavailable = true; trace.step('Search', 'api-failed', { path, query, error }); return undefined; }
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
          if (!Array.isArray(result.items) || result.items.some((item: unknown) => !item || typeof item !== 'object')) { unavailable = true; trace.step('Search', 'invalid-items'); break; }
          items.push(...result.items);
          if (result.pagination?.hasMore === false || result.pagination?.totalPages <= page || !result.items.length) { complete = true; break; }
        }
        const candidate = complete ? selectAmllRevision(items, track) : undefined;
        trace.step('Match', candidate ? 'selected' : 'no-selection', { complete, candidateCount: items.length, selectedId: candidate?.id, candidates: items.slice(0, 20).map(item => ({ id: item.id, filename: item.filename, exact: exactMetadata(item, track.name, track.artist || '') })) });
        if (candidate) {
          status('Downloading AMLL TTML...'); data = await attempt('get', { id: String(candidate.id), format: 'ttml' });
          if (data && (String(data.id) !== String(candidate.id) || !exactMetadata(data, track.name, track.artist))) throw new Error('AMLL returned a mismatched recording. Local lyrics are unchanged.');
          if (data) break;
        } else if (complete && items.some(entry => exactMetadata(entry, track.name, track.artist || ''))) {
          finishFallback('ambiguous-recording', 'AMLL has multiple recording matches. Using local lyrics.'); return;
        }
        if (unavailable) break;
      }
      if (!data) {
        status('Searching the AMLL repository index...');
        const items = await repositoryIndex(signal, trace);
        const identified = match?.isrc ? items.filter(item => hasId(item.isrcs, match!.isrc)) : [];
        const byId = identified.length ? identified : match?.id ? items.filter(item => hasId(item.spotifyIds, match!.id)) : [];
        const candidates = byId.length ? byId : items, candidate = selectAmllRevision(candidates, track);
        trace.step('Match', 'repository', { candidateCount: candidates.length, exactCount: candidates.filter(item => exactMetadata(item, track.name, track.artist || '')).length, selectedId: candidate?.id, filename: candidate?.filename });
        if (candidate?.filename) {
          const source = await remoteText(REPOSITORY + 'raw-lyrics/' + encodeURIComponent(candidate.filename), signal, trace);
          if (source !== undefined) data = { ...candidate, format: 'ttml', lyrics: source };
        } else if (candidates.some(entry => exactMetadata(entry, track.name, track.artist || ''))) {
          finishFallback('ambiguous-repository-recording', 'AMLL has multiple recording matches. Using local lyrics.'); return;
        }
      }
    }
    if (!data) { finishFallback(!track.artist ? 'missing-artist' : unavailable ? 'api-unavailable-no-exact-repository-match' : spotifyError ? 'isrc-failed-no-title-match' : 'no-exact-match', unavailable ? 'AMLL API is unavailable and its repository has no exact match. Using local lyrics.' : spotifyError ? 'Spotify lookup failed and AMLL title search found no match. Using local lyrics.' : 'AMLL has no matching TTML. Using local lyrics.'); return; }
    status('Downloading AMLL TTML...');
    if (data.format !== 'ttml' || typeof data.lyrics !== 'string') throw new Error('AMLL returned invalid lyrics. Local lyrics are unchanged.');
    trace.step('Match', 'validated', { id: data.id, isrc: match?.isrc });
    const source = data.lyrics, fileName = typeof data.filename === 'string' && /^[\w.-]+\.ttml$/.test(data.filename) ? data.filename : 'amll.ttml';
    const started = performance.now(); trace.step('Parse', 'start', { fileName, characters: source.length, parserVersion: LYRICS_PARSER_VERSION });
    let document: ReturnType<typeof parseLyrics>;
    try { document = parseLyrics(source, fileName); if (!document.lines.length) throw new Error('AMLL returned empty lyrics.'); }
    catch (error) { trace.step('Parse', 'failed', { fileName, parserVersion: LYRICS_PARSER_VERSION, error }, 'error'); throw error; }
    diagnosticMetric('ttmlParseMs', performance.now() - started); trace.step('Parse', 'complete', { lines: document.lines.length, timing: document.timing, notices: document.notices });
    signal.throwIfAborted(); trace.step('Cache', 'save-start');
    await saveLyrics({ trackId: track.id, fileName, source, document, origin: 'amll', parserVersion: LYRICS_PARSER_VERSION, savedAt: Date.now(), offsetMs: before?.offsetMs,
      remote: { isrc: match?.isrc || '', spotifyId: match?.id || '', authors: Array.isArray(data.authorUsernames) ? data.authorUsernames.filter(name => typeof name === 'string').slice(0, 50) : [] } }, lyricRevision(before));
    trace.step('Cache', 'saved'); trace.step('Apply', 'ttml', { fileName }); trace.step('Fallback', 'not-needed'); trace.finish('applied'); status('');
  } catch (error) {
    trace.step('Fallback', signal.aborted ? 'cancelled' : 'failed', { error, selectedSource: fallback });
    trace.finish(signal.aborted ? 'cancelled' : 'failed', { error, selectedSource: fallback }); throw error;
  }
}
