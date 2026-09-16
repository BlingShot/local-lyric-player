import { diagnosticLog } from '../desktop/diagnostics';
import { lyricRevision } from '../lyrics/revision';
import { attachNativeAudio } from './nativeAudio';
import { readLyrics } from '../lyrics/repository';
import { store } from '../store/store';
import { libraryActions } from '../store/slices/library';
import { playerActions } from '../store/slices/player';
import { uiActions } from '../store/slices/offlineUi';
import { collectFiles, type LocalTrack } from '../library/importFiles';
import { deleteTrack, readLibrary, saveSettings, saveTrackColumns, saveTracks, patchExistingTracks, saveAudioLyricsCopy, storageError,
  type PlaybackSettings, type SavedTrack, type TrackPatch, type TrackMutation } from '../library/database';
import { readAudioTags, validateCover } from '../library/metadata';
import { LocalAudioPlayer } from './LocalAudioPlayer';
import { PlaybackMemory } from './playbackMemory';
import { bindListeningTime } from './listening';
import type { EmbeddedLyrics } from '../lyrics/embedded';
import type { SavedLyrics } from '../lyrics/types';
import { LYRICS_PARSER_VERSION } from '../lyrics/parse';
import { writeAudioLyrics } from '../library/writeAudioLyrics';
import { bindNormalization, selectNormalizationTrack, disposeNormalization } from './normalization';

let instance: LocalAudioPlayer | undefined;
let element: HTMLAudioElement | undefined;
let playbackMemory: PlaybackMemory | undefined;
let disposeListeningTime: (() => void) | undefined;
const audioCopies = new Map<string, Blob>();
const coverUrls = new Map<string, string>();
let boot: Promise<boolean> | undefined;
let operations: Promise<unknown> = Promise.resolve();
let restoring = true;
let settingsSignature = '';
let pendingSettings: PlaybackSettings | undefined;
let savingSettings = false;
let contextIds: string[] | undefined;
let stopped = false;
let lastPlayedId: string | null = null;

// Record updates share the mutation queue so a late duration/history write cannot undo an edit or removal.
function saveTrackPatch(id: string, patch: TrackPatch, lyrics?: SavedLyrics) {
  const result = operations.then(async () => {
    if (stopped) return;
    const track = store.getState().library.tracks.find(item => item.id === id);
    if (!track) return;
    const [updated] = await patchExistingTracks([{ id, patch, lyrics }]);
    if (!updated) { forgetRemovedTrack(id); return; }
    const latest = store.getState().library.tracks.find(item => item.id === id);
    if (latest) store.dispatch(libraryActions.updateTracks([{ ...latest, ...updated }]));
  }).catch(report);
  operations = result;
  return result;
}

function rememberDuration(id: string, duration: number) {
  const previous = store.getState().library.tracks.find(track => track.id === id)?.duration;
  store.dispatch(libraryActions.setDuration({ id, duration }));
  if (previous !== duration) void saveTrackPatch(id, { duration, durationChecked: true });
}

function embeddedRecord(id: string, name: string, lyrics?: EmbeddedLyrics): SavedLyrics | undefined {
  return lyrics ? { trackId: id, fileName: `${name}.embedded.${lyrics.document.format}`, source: lyrics.source, document: lyrics.document,
    parserVersion: LYRICS_PARSER_VERSION, savedAt: Date.now(), origin: 'embedded' } : undefined;
}

async function readSavedDuration(id: string, audio: Blob) {
  const track = store.getState().library.tracks.find(item => item.id === id);
  if (!track) return;
  const { tags, lyrics } = await readAudioTags(new File([audio], track.fileName || track.name, { type: audio.type }), true);
  if (stopped) return;
  // Actual media events may already have supplied a duration while the worker was reading.
  const latest = store.getState().library.tracks.find(item => item.id === id);
  if (!latest) return;
  await saveTrackPatch(id, { ...(!latest.duration ? { duration: tags.duration, durationChecked: true } : {}),
    analysisMetadata: tags.analysisMetadata, embeddedLyricsChecked: true,
    ...(!track.embeddedLyricsChecked ? { lyricsWarning: tags.lyricsWarning } : {}) },
    !track.embeddedLyricsChecked ? embeddedRecord(id, track.fileName || track.name, lyrics) : undefined);
}

async function backfillDurations() {
  for (const [id, audio] of audioCopies) {
    if (stopped) return;
    const track = store.getState().library.tracks.find(item => item.id === id);
    if (track && ((!track.duration && !track.durationChecked) || !track.embeddedLyricsChecked || !track.analysisMetadata?.technicalVersion)) await readSavedDuration(id, audio);
  }
}

function report(error: unknown) { diagnosticLog('error', 'library', error); store.dispatch(libraryActions.setStorageError(storageError(error))); }
async function flushSettings() {
  if (savingSettings) return;
  savingSettings = true;
  try {
    while (pendingSettings) {
      const settings = pendingSettings; pendingSettings = undefined;
      await saveSettings(settings);
    }
  } catch (error) { report(error); }
  finally { savingSettings = false; }
}
function persistSettings() {
  if (restoring || !store.getState().library.ready) return;
  const { volume, shuffle, repeat } = getLocalPlayer().getState();
  const settings = { volume, shuffle, repeat };
  const signature = JSON.stringify(settings);
  if (settingsSignature === signature) return;
  settingsSignature = signature; pendingSettings = settings;
  void flushSettings();
}

// This module owns the only audio element. It outlives every route and React StrictMode mount.
export function getLocalPlayer() {
  if (!instance) {
    element = new Audio();
    element.id = 'local-audio'; element.preload = 'metadata'; element.hidden = true;
    // Native FFmpeg decoding in Electron; retain the media clock and streaming
    // source rather than allocating a full-song PCM buffer or transcoding files.
    element.preservesPitch = true;
    document.body.append(element);
    attachNativeAudio(element, () => { const id = store.getState().player.currentId; return id ? audioCopies.get(id) : undefined; });
    instance = new LocalAudioPlayer(element, {
      onChange: state => {
        store.dispatch(playerActions.update(state)); persistSettings();
        selectNormalizationTrack(state.currentId);
        playbackMemory?.observe(state);
        if (state.status === 'playing' && state.currentId && lastPlayedId !== state.currentId) {
          lastPlayedId = state.currentId;
          void saveTrackPatch(state.currentId, { lastPlayedAt: Date.now() });
        }
      },
      onDuration: rememberDuration,
      onFailure: (id, error) => store.dispatch(libraryActions.setError({ id, error })),
      onSelect: id => store.dispatch(libraryActions.selectTrack(id)),
      revokeUrl: url => URL.revokeObjectURL(url),
    });
    bindNormalization(element);
    disposeListeningTime = bindListeningTime(element);
    playbackMemory = new PlaybackMemory({ player: instance, audio: element, page: window, document,
      storage: { getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) },
      onError: message => store.dispatch(uiActions.setPlaybackMemoryError(message)),
      onNotice: message => store.dispatch(uiActions.setImportMessage(message)),
    });
  }
  return instance;
}

// A read-only connection for time-driven views; ownership stays in this module.
export function getLocalAudioElement(): HTMLAudioElement {
  getLocalPlayer();
  return element!;
}

export function setLocalPlaybackRate(rate: number) {
  if (Number.isFinite(rate) && rate >= .5 && rate <= 1.5) getLocalAudioElement().playbackRate = rate;
}

function setCover(id: string, cover?: Blob) {
  if (!cover) return undefined;
  const previous = coverUrls.get(id);
  const url = URL.createObjectURL(cover);
  coverUrls.set(id, url);
  if (previous) URL.revokeObjectURL(previous);
  return url;
}

export function initializeLibrary(): Promise<boolean> {
  getLocalPlayer();
  if (boot) return boot;
  boot = (async () => {
    restoring = true;
    store.dispatch(libraryActions.setBusy('Restoring local library…'));
    try {
      const saved = await readLibrary();
      const tracks: LocalTrack[] = [];
      for (const record of saved.tracks.sort((a, b) => (a.addedAt ?? 0) - (b.addedAt ?? 0))) {
        const audio = saved.audio.get(record.id);
        let unavailable = false;
        try {
          if (!(audio instanceof Blob) || audio.size !== record.size || !audio.size) throw new Error('Missing audio copy');
          await audio.slice(0, 1).arrayBuffer(); await audio.slice(-1).arrayBuffer();
          audioCopies.set(record.id, audio);
        } catch { unavailable = true; }
        const cover = saved.covers.get(record.id);
        let coverUrl: string | undefined;
        try {
          if (cover instanceof Blob) {
            const bitmap = await createImageBitmap(cover); bitmap.close(); coverUrl = setCover(record.id, cover);
          }
        } catch { /* Keep metadata and audio when artwork cannot be restored. */ }
        tracks.push({ ...record, coverUrl, unavailable,
          artworkSource: coverUrl ? record.artworkSource : undefined,
          tagWarning: record.artworkSource && !coverUrl ? 'Saved artwork is unavailable. Choose a local cover image.' : record.tagWarning });
      }
      store.dispatch(libraryActions.restore({ tracks, playlists: saved.playlists }));
      store.dispatch(libraryActions.setColumns(saved.columns));
      store.dispatch(uiActions.setLyricsAppearance(saved.appearance));
      const player = getLocalPlayer();
      player.addTracks([...audioCopies].map(([id, audio]) => ({ id, url: URL.createObjectURL(audio) })));
      // Cueing calls audio.load(), which can discard queued media events. Restore the
      // source before volume so its volumechange event reaches the player and UI.
      playbackMemory?.restore(tracks);
      const settings = saved.settings;
      if (settings) {
        player.setVolume(Number.isFinite(settings.volume) ? settings.volume : 1);
        if (settings.shuffle === true && !player.getState().shuffle) player.toggleShuffle();
        if (['all', 'one'].includes(settings.repeat)) {
          while (player.getState().repeat !== settings.repeat) player.cycleRepeat();
        }
      }
      store.dispatch(libraryActions.setStorageError(''));
      void backfillDurations().catch(report);
      return true;
    } catch (error) { report(error); return false; }
    finally { restoring = false; store.dispatch(libraryActions.setBusy('')); }
  })();
  return boot;
}

export async function retryStorage() {
  if (!store.getState().library.ready) { boot = undefined; await initializeLibrary(); }
  else {
    try {
      const { volume, shuffle, repeat } = getLocalPlayer().getState();
      await saveSettings({ volume, shuffle, repeat });
      await saveTrackColumns(store.getState().library.columns);
      settingsSignature = JSON.stringify({ volume, shuffle, repeat });
      store.dispatch(libraryActions.setStorageError(''));
    } catch (error) { report(error); }
  }
}

export function retryPlaybackMemory() {
  if (getLocalPlayer().getState().currentId) playbackMemory?.flush();
  else playbackMemory?.restore(store.getState().library.tracks);
}

// Serialize imports, edits and removals. A failed batch never leaks into the visible library.
function operation(label: string, work: () => Promise<void>): Promise<boolean> {
  const result = operations.then(async () => {
    if (!await initializeLibrary()) return false;
    store.dispatch(libraryActions.setBusy(label));
    store.dispatch(libraryActions.setStorageError(''));
    store.dispatch(uiActions.setImportMessage(''));
    try { await work(); return true; }
    catch (error) { report(error); return false; }
    finally { store.dispatch(libraryActions.setBusy('')); }
  });
  operations = result;
  return result;
}

export function importAudioFiles(files: readonly File[], onResolved?: (ids: readonly (string | undefined)[]) => void) {
  return operation('Reading tags and saving audio copies…', async () => {
    const result = await collectFiles(files, store.getState().library.tracks, track => audioCopies.get(track.id));
    const originals = result.originals;
    const saved: SavedTrack[] = [];
    const addedAt = Date.now();
    for (const [index, track] of result.tracks.entries()) {
      store.dispatch(libraryActions.setBusy(`Reading and saving ${index + 1} of ${result.tracks.length}…`));
      const file = originals.get(track.id)!;
      await file.slice(0, 1).arrayBuffer(); await file.slice(-1).arrayBuffer();
      const { tags, cover, lyrics } = await readAudioTags(file);
      saved.push({ track: { ...track, ...tags, id: track.id, addedAt: addedAt + index, audioRevision: crypto.randomUUID() }, audio: file, cover,
        lyrics: embeddedRecord(track.id, file.name, lyrics) });
    }
    if (saved.length) await saveTracks(saved);
    const tracks = saved.map(item => {
      audioCopies.set(item.track.id, item.audio!);
      return { ...item.track, coverUrl: setCover(item.track.id, item.cover) };
    });
    store.dispatch(libraryActions.addTracks(tracks));
    // An explicit album queue stays scoped to that album while importing elsewhere.
    if (!contextIds) getLocalPlayer().addTracks(saved.map(item => ({ id: item.track.id, url: URL.createObjectURL(item.audio!) })));
    onResolved?.(result.resolvedIds);
    const warnings = tracks.filter(track => track.tagWarning || track.lyricsWarning).length;
    store.dispatch(uiActions.setImportMessage(`Added ${tracks.length} files. Saved on this device. ${result.duplicates ? `Skipped ${result.duplicates} duplicate files. ` : ''}${result.rejected ? `Skipped ${result.rejected} empty or unsupported files. ` : ''}${warnings ? `${warnings} files have unreadable tags or artwork; see Edit details.` : ''}`));
  });
}

/** Select the actual created/matched identity rather than deriving it from file metadata. */
export async function importStudioAudio(file: File): Promise<string | undefined> {
  let id: string | undefined;
  const success = await importAudioFiles([file], ids => { id = ids[0]; });
  return success ? id : undefined;
}

function forgetRemovedTrack(id: string) {
  if (instance?.getState().currentId === id) instance.pause();
  instance?.removeTrack(id);
  audioCopies.delete(id);
  if (coverUrls.has(id)) URL.revokeObjectURL(coverUrls.get(id)!);
  coverUrls.delete(id);
  if (contextIds) contextIds = contextIds.filter(item => item !== id);
  store.dispatch(libraryActions.removeTrack(id));
}

export function removeAudioFile(id: string) {
  return operation('Removing local copy…', async () => {
    await deleteTrack(id);
    getLocalPlayer().removeTrack(id);
    audioCopies.delete(id);
    if (coverUrls.has(id)) URL.revokeObjectURL(coverUrls.get(id)!);
    coverUrls.delete(id);
    if (contextIds) contextIds = contextIds.filter(item => item !== id);
    store.dispatch(libraryActions.removeTrack(id));
  });
}

export async function writeLocalLyricsCopy(id: string, source: string, expected?: string | null): Promise<Blob> {
  let saved: Blob | undefined;
  const success = await operation('Writing lyrics to the saved audio copy…', async () => {
    const track = store.getState().library.tracks.find(item => item.id === id), original = audioCopies.get(id);
    if (!track || !original || track.unavailable) throw new Error('This audio copy is unavailable. Restore it before writing lyrics.');
    const before = await readLyrics(id);
    if (expected !== undefined && lyricRevision(before) !== expected) throw new Error('Lyrics changed during translation. No audio was overwritten.');
    const result = await writeAudioLyrics(original, track.fileName || track.name, source);
    // Re-read the actual new tag with the same reader used by the player before committing.
    const verified = await readAudioTags(new File([result], track.fileName || track.name, { type: result.type }), true);
    if (verified.lyrics?.source.trim() !== source.trim()) throw new Error('The written lyrics could not be verified. The saved audio copy is unchanged.');
    const record = embeddedRecord(id, track.fileName || track.name, verified.lyrics)!;
    const current = await readLyrics(id);
    if (lyricRevision(current) !== lyricRevision(before)) throw new Error('Lyrics changed during translation. No audio was overwritten.');
    if (before?.offsetMs !== undefined) record.offsetMs = before.offsetMs;
    const updated = await saveAudioLyricsCopy(track, result, record, lyricRevision(before));
    audioCopies.set(id, result);
    store.dispatch(libraryActions.updateTracks([{ ...track, ...updated }]));
    window.dispatchEvent(new CustomEvent('local-lyrics-updated', { detail: id }));
    // The compressed audio payload is identical. Keep the live source, time and analysis version.
    saved = result;
  });
  if (!success || !saved) throw new Error(store.getState().library.storageError || 'The audio copy could not be saved.');
  return saved;
}

export type TrackEdits = Pick<LocalTrack, 'name' | 'artist' | 'album' | 'albumArtist' | 'trackNumber' | 'discNumber' | 'releaseDate' | 'compilation' | 'albumGroup'>;
export function editAudioTracks(ids: readonly string[], edits: Partial<TrackEdits>, image?: File, expectedTracks?: readonly LocalTrack[]) {
  // Capture the editor's version before any queued work or asynchronous image read.
  const snapshots = (expectedTracks ?? store.getState().library.tracks).filter(track => ids.includes(track.id));
  return operation('Saving details…', async () => {
    const cover = image ? await validateCover(image) : undefined;
    const mutations: TrackMutation[] = snapshots.map(track => {
      const patch: TrackPatch = { ...edits };
      if (edits.name !== undefined) patch.name = edits.name.trim() || track.fileName || track.name;
      const artwork = track.artworkSource !== 'embedded' ? cover : undefined;
      if (artwork) patch.artworkSource = 'custom';
      return { id: track.id, patch, cover: artwork, expected: { metadataRevision: track.metadataRevision } };
    });
    const saved = await patchExistingTracks(mutations);
    store.dispatch(libraryActions.updateTracks(saved.flatMap((track, index) => track ? [{ ...snapshots[index], ...track,
      coverUrl: mutations[index].cover ? setCover(track.id, mutations[index].cover!) : snapshots[index].coverUrl }] : [])));
  });
}

export function restoreAudioFile(id: string, file: File) {
  return operation('Restoring audio copy…', async () => {
    const track = store.getState().library.tracks.find(item => item.id === id);
    if (!track) throw new Error('This track was removed.');
    if (file.name !== (track.fileName || track.name) || file.size !== (track.originalSize ?? track.size)) {
      throw new Error(`Choose the original file “${track.fileName || track.name}” (${track.originalSize ?? track.size} bytes), or import the different file as a new track.`);
    }
    await file.slice(0, 1).arrayBuffer(); await file.slice(-1).arrayBuffer();
    const [record] = await patchExistingTracks([{ id, patch: { size: file.size, audioRevision: crypto.randomUUID() }, audio: file,
      expected: { audioRevision: track.audioRevision, lyricsWrittenAt: track.lyricsWrittenAt, size: track.size } }]);
    if (!record) throw new Error('This track was removed.');
    const restored = { ...track, ...record };
    audioCopies.set(id, file);
    getLocalPlayer().removeTrack(id);
    if (!contextIds || contextIds.includes(id)) getLocalPlayer().addTracks([{ id, url: URL.createObjectURL(file) }]);
    store.dispatch(libraryActions.updateTracks([{ ...restored, unavailable: false, error: undefined }]));
    store.dispatch(uiActions.setImportMessage('Audio copy restored and saved on this device.'));
    if (!track.duration || !track.embeddedLyricsChecked) void readSavedDuration(id, file).catch(report);
  });
}

export function playLocalTrack(id: string, orderedIds?: readonly string[]) {
  const track = store.getState().library.tracks.find(item => item.id === id);
  if (!track || !audioCopies.has(id)) {
    store.dispatch(libraryActions.setStorageError('This audio copy is unavailable. Use Choose original file beside the track to restore it.'));
    return;
  }
  const player = getLocalPlayer();
  const ids = [...(orderedIds ?? store.getState().library.tracks.map(item => item.id))].filter(item => audioCopies.has(item));
  const sameContext = orderedIds ? JSON.stringify(contextIds) === JSON.stringify(ids) : !contextIds;
  if (!sameContext) {
    // Only an explicit play action changes context, through the stable source lifecycle.
    player.pause();
    const current = player.getState().currentId;
    for (const old of [...player.getState().queue]) if (old !== current) player.removeTrack(old);
    if (current) player.removeTrack(current);
    player.addTracks(ids.map(item => ({ id: item, url: URL.createObjectURL(audioCopies.get(item)!) })));
    contextIds = orderedIds ? ids : undefined;
  }
  player.play(id);
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    stopped = true;
    disposeNormalization();
    disposeListeningTime?.();
    playbackMemory?.dispose(); playbackMemory = undefined;
    instance?.dispose(); element?.remove();
    for (const url of coverUrls.values()) URL.revokeObjectURL(url);
    instance = undefined; element = undefined;
    store.dispatch(libraryActions.clear());
  });
}
