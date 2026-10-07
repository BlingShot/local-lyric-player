import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { openLibraryDatabase, saveTracks, deleteTrack, patchExistingTracks } from '../src/library/database';
import { readLyrics, saveLyrics, saveLyricOffset, switchLyricFormat } from '../src/lyrics/repository';
import { parseLyrics, LYRICS_PARSER_VERSION } from '../src/lyrics/parse';
import { lyricRevision } from '../src/lyrics/revision';
import { resolveRemoteLyrics, applySource } from '../src/integrations/lyricflow/resolve';
import { readLink, savePreferences, saveImportedStudioProject } from '../src/integrations/lyricflow/repository';
import { lyricFlowTextFingerprint, revisionToStudioProject } from '../src/integrations/lyricflow/adapter';
import { validateResolve, publicRequest, normalizeApiOrigin } from '../src/integrations/lyricflow/client';
import { readStudioDraft, studioSourceBackups } from '../src/studio/repository';
import { mergeDuplicateRecords, undoDuplicateMerge } from '../src/library/duplicateCleanup';
import { exportTransfer } from '../src/transfer/export';
import { useResolvedLyrics } from '../src/lyrics/useResolvedLyrics';
import { resolveAmll } from '../src/lyrics/amll';
import { store } from '../src/store/store';
import { playerActions } from '../src/store/slices/player';
import { initialPlaybackState } from '../src/player/LocalAudioPlayer';
import type { LocalTrack } from '../src/library/importFiles';
import type { LyricFlowSourceV1 } from '../src/integrations/lyricflow/types';

const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const waitFor = async (condition: () => boolean | Promise<boolean>) => { const until = Date.now() + 5000; while (!await condition()) { if (Date.now() > until) throw new Error('Timed out waiting for a LyricFlow test condition.'); await new Promise(resolve => setTimeout(resolve, 10)); } };
const rejected = async (promise: Promise<unknown>, pattern: RegExp) => { try { await promise; throw new Error('Expected rejection'); } catch (error) { assert(pattern.test(String(error)), `Wrong failure: ${error}`); } };
const apiOrigin = 'https://lyrics.example';
const candidate = { trackId: 'remote', title: 'Song', artists: ['Artist'], album: 'Album', durationMs: 10000, recordingKind: 'unknown', matchedBy: ['spotifyId'], documentId: 'doc', revisionId: 'rev', lyricsState: 'line_complete' };
const matched = { status: 'matched', selectedTrackId: 'remote', reasonCodes: ['EXACT_RECORDING_ID'], hasMore: false, candidates: [candidate] };
function fixture(): LyricFlowSourceV1 {
  const source: LyricFlowSourceV1 = { formatVersion: 1, provider: 'lyricflow', apiOrigin, trackId: 'remote', documentId: 'doc', revisionId: 'rev', fetchedAt: Date.now(), snapshot: { id: 'rev', documentId: 'doc', publishedAt: '2026-10-07T00:00:00Z', components: { text: { contentState: 'complete', verificationState: 'unverified' }, sync: { contentState: 'complete', verificationState: 'unverified' } }, provenance: null,
    content: { schemaVersion: 1, text: { lines: [{ lineId: 'line', order: 0, text: '  Keep text 😀 ', kind: 'vocal' }] }, sync: { textFingerprint: '', reference: { trackId: 'remote', source: 'client', externalId: null, durationMs: 10000, offsetMs: 250 }, timings: [{ lineId: 'line', startMs: 1000, endMs: 9000, endSource: 'manual' }] }, structure: [], performers: { participants: [], assignments: [] }, source: null } } };
  source.snapshot.content.sync!.textFingerprint = lyricFlowTextFingerprint(source.snapshot.content); return source;
}
export async function runLyricFlowBrowserTests() {
  const checks: string[] = [], requests: { operation: string; input: Record<string, unknown> }[] = [];
  let release: (() => void) | undefined, revisionStarted = false, delayed = false;
  window.localMusicDesktop = { lyricflowRead: async (operation: string, input: Record<string, unknown>) => {
    requests.push({ operation, input });
    if (operation === 'resolve') return matched;
    if (operation === 'revision') { revisionStarted = true; if (delayed) await new Promise<void>(resolve => { release = resolve; }); return fixture().snapshot; }
    if (operation === 'track') return { song: { id: 'remote' }, metadata: { documentId: 'doc', revisionId: 'rev' } };
    throw new Error('Unexpected operation');
  } } as unknown as NonNullable<Window['localMusicDesktop']>;
  await savePreferences({ enabled: true, apiOrigin, siteOrigin: apiOrigin });
  let number = 0;
  const add = async () => { const track: LocalTrack = { id: `local-${++number}`, name: 'Song', fileName: 'song.wav', artist: 'Artist', album: 'Album', size: 5, lastModified: 1, duration: 10, embeddedLyricsChecked: true, audioRevision: 'audio-1', metadataRevision: 'metadata-1', spotifyId: 'A'.repeat(22) }; await saveTracks([{ track, audio: new Blob(['audio']) }]); return track; };
  const local = async (track: LocalTrack) => { const source = '[00:01]My local words'; await saveLyrics({ trackId: track.id, fileName: 'local.lrc', source, document: parseLyrics(source, 'local.lrc'), parserVersion: LYRICS_PARSER_VERSION, origin: 'file', savedAt: Date.now(), offsetMs: 321 }); };
  const retained = await add(); await local(retained); const count = requests.length;
  await resolveRemoteLyrics(retained, new AbortController().signal, () => {}); await resolveAmll(retained, new AbortController().signal, () => {});
  assert(requests.length === count && (await readLyrics(retained.id))?.fileName === 'local.lrc', 'Selected local source was replaced or requested remotely.'); checks.push('existing local LRC wins over both remote sources');

  for (const change of ['metadata', 'audio', 'delete', 'lyrics', 'cancel'] as const) {
    const track = await add(), controller = new AbortController(); delayed = true; revisionStarted = false;
    const lookup = resolveRemoteLyrics(track, controller.signal, () => {}), outcome = lookup.then(() => '', error => String(error));
    await waitFor(() => revisionStarted);
    if (change === 'metadata') await patchExistingTracks([{ id: track.id, patch: { name: 'Different recording' } }]);
    if (change === 'audio') await patchExistingTracks([{ id: track.id, patch: { audioRevision: 'audio-2', size: 7 }, audio: new Blob(['changed']) }]);
    if (change === 'delete') await deleteTrack(track.id);
    if (change === 'lyrics') await local(track);
    if (change === 'cancel') controller.abort();
    release!(); const error = await outcome; assert(!!error, `${change} did not reject stale import.`);
    const saved = await readLyrics(track.id); assert(change === 'lyrics' ? saved?.fileName === 'local.lrc' : !saved, `${change} let stale lyrics through.`);
    assert(!await readLink(apiOrigin, track.id), `${change} left a stale link.`); checks.push(`atomic import rejects concurrent ${change}`);
  }
  delayed = false;
  const normal = await add(); await resolveRemoteLyrics(normal, new AbortController().signal, () => {});
  const saved = await readLyrics(normal.id), link = await readLink(apiOrigin, normal.id);
  assert(saved?.document.format === 'lyricflow-json' && saved.document.lines[0].start === 1.25 && saved.offsetMs === 0 && link?.revisionId === 'rev', 'Normal import did not persist coherent source/link.');
  assert(requests.every(({ input }) => !('localTrackId' in input) && !('fileName' in input) && !('path' in input)), 'Local identity escaped request whitelist.');
  assert(parseLyrics(saved!.source, saved!.fileName).lines[0].start === 1.25, 'Offline parser reapplied offset incorrectly.'); checks.push('offline JSON retains provenance, stable identity and one offset');
  const replace = await add(); await local(replace); const before = await readLyrics(replace.id);
  await applySource(fixture(), replace, ['user'], true, before, new AbortController().signal);
  const applied = await readLyrics(replace.id); assert(applied?.offsetMs === 0 && applied.alternates?.[0].offsetMs === 321 && applied.alternates[0].source === before?.source, 'Manual source switch lost local version or copied offset.'); checks.push('manual switch retains original source with independent offset');
  await saveLyricOffset(replace.id, 456); const firstRevision = await readLyrics(replace.id), nextRevision = fixture(); nextRevision.revisionId = 'rev-two'; nextRevision.snapshot.id = 'rev-two';
  await applySource(nextRevision, replace, ['user'], true, firstRevision, new AbortController().signal);
  const upgraded = await readLyrics(replace.id);
  assert(upgraded?.offsetMs === 0 && upgraded.alternates?.some(variant => variant.source === firstRevision!.source && variant.offsetMs === 456), 'LF update discarded previous revision or offset.');
  await switchLyricFormat(replace.id, 'lyricflow-json', firstRevision!.source);
  assert((await readLyrics(replace.id))?.source === firstRevision!.source && (await readLyrics(replace.id))?.offsetMs === 456, 'Previous LF revision cannot be selected with its own offset.'); checks.push('LF revision update retains and switches back to prior JSON and offset');
  const studioTrack = await add(), project = revisionToStudioProject(fixture(), studioTrack.id, studioTrack.name);
  await saveImportedStudioProject(project, studioTrack, undefined, new AbortController().signal); const previousProject = await readStudioDraft(studioTrack.id);
  const secondProject = revisionToStudioProject(nextRevision, studioTrack.id, studioTrack.name);
  await saveImportedStudioProject(secondProject, studioTrack, previousProject, new AbortController().signal);
  assert((await studioSourceBackups(studioTrack.id)).some(item => item.project.lyricflow?.revisionId === 'rev'), 'Studio source replacement lost old project.');
  const currentProject = await readStudioDraft(studioTrack.id); await patchExistingTracks([{ id: studioTrack.id, patch: { name: 'Different studio recording' } }]);
  await rejected(saveImportedStudioProject(project, studioTrack, currentProject, new AbortController().signal), /song changed/);
  assert((await readStudioDraft(studioTrack.id))?.lyricflow?.revisionId === 'rev-two', 'Stale recording overwrote Studio project.'); checks.push('Studio import atomically checks recording identity and backs up the prior project');
  const quota = await add(); await local(quota); const quotaBefore = await readLyrics(quota.id), originalPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) { if (this.name === 'lyricflow-links') throw new DOMException('Simulated quota failure', 'QuotaExceededError'); return originalPut.apply(this, args); };
  try { await rejected(applySource(fixture(), quota, ['user'], true, quotaBefore, new AbortController().signal), /QuotaExceededError/); } finally { IDBObjectStore.prototype.put = originalPut; }
  assert(lyricRevision(await readLyrics(quota.id)) === lyricRevision(quotaBefore) && !await readLink(apiOrigin, quota.id), 'Failed link write committed partial lyric data.'); checks.push('storage failure rolls back source and link together');

  const hookTrack = await add(), other = await add(), host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  function Surface() { useResolvedLyrics(hookTrack); return null; }
  store.dispatch(playerActions.update({ ...initialPlaybackState, currentId: hookTrack.id }));
  delayed = true; revisionStarted = false; const hookCount = requests.length;
  root.render(<Provider store={store}><Surface /><Surface /></Provider>); await waitFor(() => revisionStarted);
  assert(requests.length - hookCount === 2, 'Multiple views created duplicate network work.');
  store.dispatch(playerActions.update({ ...initialPlaybackState, currentId: other.id })); await new Promise(resolve => setTimeout(resolve, 30)); release!();
  await new Promise(resolve => setTimeout(resolve, 40)); assert(!await readLyrics(hookTrack.id), 'Switching current track allowed late response to persist.'); root.unmount(); checks.push('shared surfaces resolve once and current-track change cancels application');

  const db = await openLibraryDatabase(), tx = db.transaction('lyricflow-uploads', 'readwrite'); tx.objectStore('lyricflow-uploads').put({ localTrackId: normal.id, taskId: 'task' }, 'task'); await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
  await deleteTrack(normal.id); assert(!await readLink(apiOrigin, normal.id), 'Delete left source link.');
  const upload = await new Promise(resolve => { const request = db.transaction('lyricflow-uploads').objectStore('lyricflow-uploads').get('task'); request.onsuccess = () => resolve(request.result); }); assert(!upload, 'Delete left upload task.'); checks.push('deleting a song removes links and local upload tasks');
  const keeper = await add(), duplicate = await add(), otherSource = fixture(); otherSource.trackId = 'remote-other'; otherSource.snapshot.content.sync!.reference.trackId = 'remote-other';
  await applySource(fixture(), keeper, ['user'], true, undefined, new AbortController().signal);
  await applySource(otherSource, duplicate, ['user'], true, undefined, new AbortController().signal);
  await new Promise<void>((resolve, reject) => { const tx = db.transaction('lyricflow-uploads', 'readwrite'); tx.objectStore('lyricflow-uploads').put({ localTrackId: duplicate.id, taskId: 'duplicate-task', paused: false }, 'duplicate-task'); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
  await mergeDuplicateRecords([keeper, duplicate], keeper.id, () => true);
  assert((await readLink(apiOrigin, keeper.id))?.trackId === 'remote' && (await readLink(apiOrigin, duplicate.id))?.trackId === 'remote-other', 'Duplicate merge mixed remote recordings.');
  const paused = await new Promise<any>(resolve => { const request = db.transaction('lyricflow-uploads').objectStore('lyricflow-uploads').get('duplicate-task'); request.onsuccess = () => resolve(request.result); }); assert(paused?.paused === true, 'Merged-away upload was not paused.');
  await undoDuplicateMerge(); assert((await readLink(apiOrigin, duplicate.id))?.trackId === 'remote-other', 'Undo lost remote association.'); checks.push('duplicate merge and undo preserve distinct recording links and pause tasks');
  const files = new Map<string, Blob>();
  const directory = (prefix = ''): FileSystemDirectoryHandle => ({ getDirectoryHandle: async (name: string) => directory(prefix + name + '/'), removeEntry: async () => {}, getFileHandle: async (name: string) => ({ createWritable: async () => { const chunks: BlobPart[] = []; return { write: async (data: BlobPart) => { chunks.push(data); }, close: async () => { files.set(prefix + name, new Blob(chunks)); }, abort: async () => {} }; } }) }) as unknown as FileSystemDirectoryHandle;
  await exportTransfer(directory(), new AbortController().signal, () => {});
  const [manifestPath, manifestBlob] = [...files].find(([name]) => name.endsWith('/manifest.json'))!, manifest = JSON.parse(await manifestBlob.text()), folder = manifestPath.slice(0, -'manifest.json'.length);
  const row = manifest.tracks.find((item: any) => item.id === keeper.id), original = JSON.parse(await files.get(folder + row.lyricflowSource)!.text()), portable = JSON.parse(await files.get(folder + row.lyrics)!.text());
  assert(original.snapshot.id === 'rev' && original.snapshot.content.text.lines[0].lineId === 'line' && portable.fileName.endsWith('.ttml') && portable.source.startsWith('<?xml'), 'Transfer lost LF baseline or sent internal JSON to legacy parser.');
  assert(manifest.omitted.some((text: string) => text.includes('LyricFlow playback converted')) && manifest.omitted.some((text: string) => text.includes('upload tasks remain')), 'Transfer did not disclose conversion or task limits.'); checks.push('iOS transfer preserves full LF JSON and exports compatible TTML with a loss report');
  await rejected(Promise.resolve().then(() => validateResolve({ ...matched, hasMore: true })), /ambiguous/);
  await rejected(Promise.resolve().then(() => validateResolve({ ...matched, selectedTrackId: 'another' })), /ambiguous/);
  assert(normalizeApiOrigin('http://127.0.0.1:3000') === 'http://127.0.0.1:3000' && normalizeApiOrigin('http://[::1]:3000') === 'http://[::1]:3000', 'Literal loopback origins were rejected.');
  await rejected(Promise.resolve().then(() => normalizeApiOrigin('http://localhost:3000')), /HTTPS origin/);
  const desktop = window.localMusicDesktop; delete window.localMusicDesktop;
  const nativeFetch = window.fetch; let options: RequestInit | undefined;
  window.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => { options = init; return new Response(JSON.stringify(matched), { headers: { 'Content-Type': 'application/json' } }); }) as typeof fetch;
  try { await publicRequest(apiOrigin, 'resolve', { title: 'Song', artist: 'Artist' }, new AbortController().signal); assert(options?.credentials === 'omit' && options.redirect === 'error' && options.referrerPolicy === 'no-referrer', 'Public fetch leaked authenticated state.'); } finally { window.fetch = nativeFetch; window.localMusicDesktop = desktop; }
  checks.push('ambiguous matches are rejected and public fetch omits credentials');
  return checks;
}
