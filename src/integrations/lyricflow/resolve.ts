import type { LocalTrack } from '../../library/importFiles';
import { readLyrics } from '../../lyrics/repository';
import { lyricRevision } from '../../lyrics/revision';
import { LYRICS_PARSER_VERSION } from '../../lyrics/parse';
import { resolveAmll } from '../../lyrics/amll';
import { normalizeApiOrigin, readLinkedRecording, readRevision, resolveRecording } from './client';
import { parseLyricFlowSource, revisionToPlayerDocument } from './adapter';
import { metadataFingerprint, readLink, readPreferences, saveImportedLyrics } from './repository';
import type { LyricFlowCandidate, LyricFlowSourceV1 } from './types';
import type { SavedLyrics } from '../../lyrics/types';

export async function downloadSource(apiOrigin: string, candidate: Pick<LyricFlowCandidate, 'trackId' | 'documentId' | 'revisionId'>, signal: AbortSignal): Promise<LyricFlowSourceV1> {
  const origin = normalizeApiOrigin(apiOrigin), snapshot = await readRevision(origin, candidate, signal);
  return { formatVersion: 1, provider: 'lyricflow', apiOrigin: origin, trackId: candidate.trackId, documentId: snapshot.documentId, revisionId: snapshot.id, fetchedAt: Date.now(), snapshot };
}
export async function applySource(source: LyricFlowSourceV1, track: LocalTrack, matchedBy: string[], userConfirmed: boolean, before: SavedLyrics | undefined, signal: AbortSignal, expectedLink = readLink(source.apiOrigin, track.id)) {
  if (!track.duration || !Number.isFinite(track.duration)) throw new Error('Measure the audio duration before applying LyricFlow lyrics.');
  const serialized = JSON.stringify(source); parseLyricFlowSource(serialized);
  const linkBefore = await expectedLink, document = revisionToPlayerDocument(source.snapshot, Math.round(track.duration * 1000));
  const variants = before ? [{ format: before.document.format, fileName: before.fileName, source: before.source, document: before.document, origin: before.origin, offsetMs: before.offsetMs }, ...(before.alternates ?? [])] : [];
  const sourceKey = (format: string, text: string) => { if (format !== 'lyricflow-json') return format + ':' + text; const data = parseLyricFlowSource(text); return JSON.stringify([data.apiOrigin, data.trackId, data.documentId, data.revisionId]); };
  const selectedKey = sourceKey(document.format, serialized), seen = new Set([selectedKey]);
  const alternates = variants.filter(variant => { const key = sourceKey(variant.format, variant.source); if (seen.has(key)) return false; seen.add(key); return true; });
  const offsetMs = before && sourceKey(before.document.format, before.source) === selectedKey ? before.offsetMs ?? 0 : 0;
  const record: SavedLyrics = { trackId: track.id, fileName: `${source.revisionId}.lyricflow.json`, source: serialized, document, parserVersion: LYRICS_PARSER_VERSION, savedAt: Date.now(), origin: 'lyricflow', offsetMs,
    alternates };
  await saveImportedLyrics(record, { apiOrigin: source.apiOrigin, localTrackId: track.id, trackId: source.trackId, documentId: source.documentId, revisionId: source.revisionId, matchedBy, userConfirmed,
    audioRevision: track.audioRevision, metadataRevision: track.metadataRevision, metadataFingerprint: metadataFingerprint(track), baseSnapshot: source.snapshot, lineMap: Object.fromEntries(source.snapshot.content.text.lines.map(line => [line.lineId, line.lineId])) }, track, lyricRevision(before), linkBefore, signal);
}
/** One source decision per shared job. An existing selected source always wins. */
export async function resolveRemoteLyrics(track: LocalTrack, signal: AbortSignal, status: (text: string) => void) {
  const before = await readLyrics(track.id); signal.throwIfAborted(); if (before) return;
  const preferences = await readPreferences(); signal.throwIfAborted();
  if (!preferences.enabled || !preferences.apiOrigin) return resolveAmll(track, signal, status);
  status('Searching LyricFlow…');
  const link = await readLink(preferences.apiOrigin, track.id); signal.throwIfAborted();
  let candidate: Pick<LyricFlowCandidate, 'trackId' | 'documentId' | 'revisionId'> | undefined, matchedBy: string[] = [], confirmed = false;
  if (link?.userConfirmed && link.audioRevision === track.audioRevision && link.metadataRevision === track.metadataRevision && link.metadataFingerprint === metadataFingerprint(track)) {
    candidate = await readLinkedRecording(preferences.apiOrigin, link.trackId, signal); matchedBy = ['USER_LINK']; confirmed = true;
  } else {
    const result = await resolveRecording(preferences.apiOrigin, track, signal);
    if (result.status === 'not_found') return resolveAmll(track, signal, status);
    if (result.status !== 'matched') { status('LyricFlow found multiple recordings. Choose one in Online services settings.'); return; }
    candidate = result.candidates.find(item => item.trackId === result.selectedTrackId); matchedBy = candidate && 'matchedBy' in candidate ? candidate.matchedBy as string[] : [];
  }
  if (!candidate?.revisionId || !candidate.documentId) { status('This LyricFlow recording has no published lyrics.'); return; }
  status('Downloading LyricFlow lyrics…');
  const source = await downloadSource(preferences.apiOrigin, candidate, signal); signal.throwIfAborted();
  await applySource(source, track, matchedBy, confirmed, before, signal, Promise.resolve(link)); status('LyricFlow lyrics saved for offline playback.');
}
