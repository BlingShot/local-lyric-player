import type { LocalTrack } from '../../library/importFiles';
import { validateRevision } from './adapter';
import type { LyricFlowCandidate, LyricFlowResolve } from './types';

export function normalizeApiOrigin(value: string) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Use an HTTPS origin or a local development origin for LyricFlow.');
  return url.origin;
}
type PublicOperation = 'resolve' | 'revision' | 'track' | 'contract';
export async function publicRequest(apiOrigin: string, operation: PublicOperation, input: Record<string, string>, signal: AbortSignal): Promise<any> {
  const origin = normalizeApiOrigin(apiOrigin); signal.throwIfAborted();
  const bridge = window.localMusicDesktop;
  if (bridge?.lyricflowRead) {
    const value = await bridge.lyricflowRead(operation, { apiOrigin: origin, ...input }); signal.throwIfAborted(); return value;
  }
  const path = operation === 'resolve' ? '/lyrics/resolve?' + new URLSearchParams(input) : operation === 'revision' ? '/revisions/' + encodeURIComponent(input.id) : operation === 'track' ? '/tracks/' + encodeURIComponent(input.id) : '/contract';
  const response = await fetch(origin + '/api/v1' + path, { signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]), credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store' });
  const limit = 2 * 1024 * 1024;
  if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw new Error('LyricFlow response is too large.'); }
  const reader = response.body?.getReader(); if (!reader) throw new Error('LyricFlow returned an empty response.');
  const chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > limit) { await reader.cancel(); throw new Error('LyricFlow response is too large.'); } chunks.push(value); } } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let payload: any; try { payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw new Error('LyricFlow returned invalid JSON.'); }
  if (!response.ok) throw new Error(`LyricFlow request failed (HTTP ${response.status}${typeof payload?.error?.code === 'string' ? ', ' + payload.error.code : ''}). Local lyrics are unchanged.`);
  signal.throwIfAborted(); return payload;
}
const string = (value: unknown): value is string => typeof value === 'string' && value.length <= 1000;
const identifier = (value: unknown): value is string => string(value) && !!value.length && value.length <= 120;
const nullableId = (value: unknown) => value === null || identifier(value);
const strings = (value: unknown) => Array.isArray(value) && value.length <= 100 && value.every(string);
export function validateResolve(value: any): LyricFlowResolve {
  if (!value || !['matched', 'candidates', 'not_found'].includes(value.status) || !nullableId(value.selectedTrackId) || !strings(value.reasonCodes) || typeof value.hasMore !== 'boolean' || !Array.isArray(value.candidates) || value.candidates.length > 10) throw new Error('LyricFlow returned invalid recording matches.');
  const ids = new Set<string>();
  for (const candidate of value.candidates) {
    if (!candidate || !identifier(candidate.trackId) || ids.has(candidate.trackId) || !string(candidate.title) || !strings(candidate.artists) || !(candidate.album === null || string(candidate.album)) || !(candidate.durationMs === null || Number.isSafeInteger(candidate.durationMs) && candidate.durationMs > 0 && candidate.durationMs <= 86400000) || !['studio', 'live', 'rerecording', 'instrumental', 'edit', 'unknown'].includes(candidate.recordingKind) || !strings(candidate.matchedBy) || !candidate.matchedBy.every((value: string) => ['isrc', 'spotifyId', 'metadata'].includes(value)) || !nullableId(candidate.documentId) || !nullableId(candidate.revisionId) || !['missing', 'text_only', 'line_partial', 'line_complete'].includes(candidate.lyricsState)) throw new Error('LyricFlow returned an invalid recording candidate.');
    ids.add(candidate.trackId);
  }
  if (value.status === 'matched' ? value.hasMore || !ids.has(value.selectedTrackId) || value.reasonCodes.some((code: string) => ['MULTIPLE_RECORDINGS', 'IDENTIFIER_CONFLICT', 'VERSION_CONFLICT', 'METADATA_CONFLICT', 'DURATION_CONFLICT', 'CANDIDATE_LIMIT'].includes(code)) : value.selectedTrackId !== null) throw new Error('LyricFlow returned an ambiguous selection.');
  if (value.status === 'not_found' && value.candidates.length) throw new Error('LyricFlow returned invalid recording matches.');
  return value;
}
export function resolveQuery(track: LocalTrack) {
  const query: Record<string, string> = {};
  if (track.isrc && /^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/.test(track.isrc.toUpperCase())) query.isrc = track.isrc.toUpperCase();
  if (track.spotifyId && /^[A-Za-z0-9]{22}$/.test(track.spotifyId)) query.spotifyId = track.spotifyId;
  for (const [key, value] of [['title', track.name], ['artist', track.artist], ['album', track.album]]) if (value?.trim()) { if (value.trim().length > 300) throw new Error('Song metadata exceeds the LyricFlow search limit. Shorten the tags before searching.'); query[key!] = value.trim(); }
  if (track.duration && Number.isFinite(track.duration) && track.duration > 0 && track.duration <= 86400) query.durationMs = String(Math.round(track.duration * 1000));
  return query;
}
export async function resolveRecording(apiOrigin: string, track: LocalTrack, signal: AbortSignal) { return validateResolve(await publicRequest(apiOrigin, 'resolve', resolveQuery(track), signal)); }
export async function readRevision(apiOrigin: string, candidate: Pick<LyricFlowCandidate, 'revisionId' | 'documentId' | 'trackId'>, signal: AbortSignal) {
  if (!candidate.revisionId || !candidate.documentId) throw new Error('This LyricFlow recording has no published lyrics.');
  const revision = validateRevision(await publicRequest(apiOrigin, 'revision', { id: candidate.revisionId }, signal), candidate.revisionId, candidate.documentId);
  if (revision.content.sync && revision.content.sync.reference.trackId !== candidate.trackId) throw new Error('LyricFlow returned timing for another recording.');
  return revision;
}
export async function readLinkedRecording(apiOrigin: string, trackId: string, signal: AbortSignal): Promise<Pick<LyricFlowCandidate, 'trackId' | 'documentId' | 'revisionId'>> {
  const result = await publicRequest(apiOrigin, 'track', { id: trackId }, signal);
  if (result?.song?.id !== trackId || !result.metadata || !nullableId(result.metadata.documentId) || !nullableId(result.metadata.revisionId)) throw new Error('LyricFlow returned a mismatched recording.');
  return { trackId, documentId: result.metadata.documentId, revisionId: result.metadata.revisionId };
}
