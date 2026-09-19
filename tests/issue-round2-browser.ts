// Isolated origin/pages; all bytes and drafts are synthetic regression fixtures.
import { openLibraryDatabase, readLibrary, saveTracks, saveAudioLyricsCopy, deleteTrack } from '../src/library/database';
import { readLyrics, saveLyrics, saveLyricOffset } from '../src/lyrics/repository';
import { lyricRevision } from '../src/lyrics/revision';
import { readLyricFile } from '../src/lyrics/repository';
import { readStudioDraft, saveStudioDraft, studioRecoveries } from '../src/studio/repository';
import { newProject, editText } from '../src/studio/project';
import { collectFiles, sameFileBytes } from '../src/library/importFiles';
import { attachNativeAudio, configureNativeOutput } from '../src/player/nativeAudio';
import { LocalAudioPlayer } from '../src/player/LocalAudioPlayer';
export { deleteTrack, saveLyricOffset, readStudioDraft };
const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const waitFor = async (condition: () => boolean, message: string, timeoutMs = 1500) => {
  const deadline = performance.now() + timeoutMs;
  while (!condition()) {
    if (performance.now() >= deadline) throw new Error(message);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
};
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
const get = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
export async function seedTrack(id: string, source = '[00:01]Original\n[00:04]End') {
  const lyrics = await readLyricFile(new File([source], 'fixture.lrc'), id);
  await saveTracks([{ track: { id, name: id, size: 8, lastModified: 1, audioRevision: 'audio-1' }, audio: new Blob(['original']), lyrics }]);
  return snapshot(id);
}
export async function snapshot(id: string) {
  const library = await readLibrary(), lyrics = await readLyrics(id);
  return { track: library.tracks.find(t => t.id === id), audio: await library.audio.get(id)?.text(), lyrics, token: lyricRevision(lyrics) };
}
export async function replaceLyrics(id: string) {
  const lyrics = await readLyricFile(new File(['[00:01]Newer\n[00:04]End'], 'new.lrc'), id);
  await saveLyrics(lyrics); return snapshot(id);
}
export async function writeCopy(before: Awaited<ReturnType<typeof snapshot>>) {
  check(before.track && before.lyrics, 'Missing test state.');
  return saveAudioLyricsCopy(before.track!, new Blob(['modified-copy']), before.lyrics!, before.token);
}
export async function collisionImportAndMigration() {
  const db = await openLibraryDatabase(), library = await readLibrary();
  const oldId = JSON.stringify(['same.wav', 4, 123]), old = library.tracks.find(t => t.id === oldId)!;
  check(db.version === 6 && old?.dedupeFingerprint === oldId, 'v4 to v6 fingerprint migration failed');
  const hashIndex = db.transaction('tracks').objectStore('tracks').index('importHash');
  check(hashIndex.unique && hashIndex.keyPath === 'importHash', 'Migration did not create the content-deduplication index');
  const tx = db.transaction(['covers', 'lyrics', 'playlists', 'analysis', 'analysis-edits', 'analysis-tasks', 'settings']);
  const values = await Promise.all([
    get(tx.objectStore('covers').get(oldId)), get(tx.objectStore('lyrics').get(oldId)),
    get(tx.objectStore('playlists').get('p')), get(tx.objectStore('analysis').get([oldId, 'a'])),
    get(tx.objectStore('analysis-edits').get(oldId)), get(tx.objectStore('analysis-tasks').get([oldId, 'a'])),
    get(tx.objectStore('settings').get('lyric-studio:' + oldId)),
  ]);
  check(await library.audio.get(oldId)!.text() === 'AAAA' && await values[0].text() === 'cover', 'Migration changed audio/artwork');
  check(values[1].source === '[00:01]Legacy' && values[2].trackIds[0] === oldId, 'Migration lost lyric/playlist links');
  check(values.slice(3).every(value => value.trackId === oldId), 'Migration lost analysis, task or Studio links');
  const duplicate = new File(['AAAA'], 'same.wav', { lastModified: 123 });
  const collision = new File(['BBBB'], 'same.wav', { lastModified: 123 });
  const result = await collectFiles([duplicate, collision, duplicate], library.tracks, track => library.audio.get(track.id));
  check(result.tracks.length === 1 && result.duplicates === 2, 'Dedupe did not compare actual bytes');
  check(result.resolvedIds[0] === oldId && result.resolvedIds[2] === oldId && result.resolvedIds[1] !== oldId, 'Studio resolved ID is not the persisted ID');
  await saveTracks(result.tracks.map(track => ({ track, audio: result.originals.get(track.id)! })));
  const restored = await readLibrary();
  check(restored.tracks.length === 2 && await restored.audio.get(result.resolvedIds[1]!)!.text() === 'BBBB', 'Collision imported incorrect audio bytes');
  check(!(await sameFileBytes(duplicate, collision)), 'Byte comparator accepted different audio');
  return { databaseVersion: db.version, trackCount: restored.tracks.length, legacyIdPreserved: true, newId: result.resolvedIds[1] };
}
export async function draftSave(id: string, fail = false, quota = false) {
  const project = newProject(id, id + '.wav'); project.updatedAt = Date.now(); project.lines[0] = editText(project.lines[0], 'Unsaved ' + id);
  const put = IDBObjectStore.prototype.put, set = Storage.prototype.setItem;
  IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
    const request = put.apply(this, args);
    if (fail && this.name === 'settings' && String(args[1]).startsWith('lyric-studio:')) queueMicrotask(() => { try { this.transaction.abort(); } catch {} });
    return request;
  };
  if (quota) Storage.prototype.setItem = function (key, value) { if (key.startsWith('lyric-studio-recovery')) throw new DOMException('Injected quota', 'QuotaExceededError'); return set.call(this, key, value); };
  try { await saveStudioDraft(project); return { saved: true }; }
  finally { IDBObjectStore.prototype.put = put; Storage.prototype.setItem = set; }
}
export function recoveries() { return studioRecoveries().map(entry => ({ trackId: entry.draft.trackId, text: entry.draft.lines[0].text })); }
export function seedLegacyDraft() {
  const project = newProject('legacy-draft', 'legacy.wav'); project.lines[0] = editText(project.lines[0], 'Legacy recovery');
  localStorage.setItem('lyric-studio-recovery', JSON.stringify(project));
}
export async function saveRestored(id: string) { const draft = await readStudioDraft(id); check(draft, 'No draft recovered'); await saveStudioDraft(draft!); }

export async function nativeIntentRegressions() {
  let listener: (state: any) => void = () => {}, state: any = { id: '', time: 0, duration: 90, paused: true, ended: false, ready: false };
  let loadGate: ReturnType<typeof deferred> | undefined, entered: ReturnType<typeof deferred> | undefined;
  const log: { command: string; context?: any; value?: number }[] = [];
  window.localMusicDesktop = {
    nativeAudioLoad: async (value: any) => {
      state = { ...state, id: value.id, paused: true, ready: false, error: undefined, time: 0 }; entered?.resolve();
      const gate = loadGate; if (gate) await gate.promise;
      if (state.id === value.id) { state.ready = true; listener({ ...state }); }
      return { ok: true };
    },
    nativeAudioCommand: async (command: string, value: number | undefined, context: any) => {
      log.push({ command, context: { ...context }, value });
      if (command === 'play') state.paused = false;
      if (command === 'pause') state.paused = true;
      if (command === 'stop') { state.ready = false; state.paused = true; }
      if (command === 'seek') state.time = value;
      listener({ ...state }); return { ok: true };
    }, onNativeAudioState: (callback: (state: any) => void) => { listener = callback; return () => { listener = () => {}; }; },
  } as any;
  const normal = new Blob(['audio']), blobGate = deferred();
  let blob: Blob = normal;
  const audio = new Audio(), dispose = attachNativeAudio(audio, () => blob)!;
  await configureNativeOutput({ device: 'auto', exclusive: false });
  const pauseAndAwait = async (pending: Promise<void>, release: () => void) => {
    const result = pending.catch(error => error.kind); audio.pause(); const start = log.length; release();
    check(await result === 'cancelled', 'Delayed play was not cancelled'); await tick();
    check(audio.paused && !log.slice(start).some(c => c.command === 'play'), 'Pause allowed stale play');
  };
  try {
    // Delay reading Blob bytes, not only the helper response.
    blob = { arrayBuffer: async () => { await blobGate.promise; return normal.arrayBuffer(); } } as Blob;
    audio.src = 'blob:read-delay'; audio.load(); const reading = audio.play();
    await pauseAndAwait(reading, blobGate.resolve);
    blob = normal; loadGate = deferred(); entered = deferred();
    audio.src = 'blob:load-delay'; audio.load(); const loading = audio.play(); await entered.promise;
    await pauseAndAwait(loading, loadGate.resolve);
    // Latest intent must win without cancelling the useful loaded resource.
    loadGate = deferred(); entered = deferred(); audio.src = 'blob:play-pause-play'; audio.load();
    const old = audio.play().catch(error => error.kind); audio.pause(); const latest = audio.play();
    await entered.promise; const count = log.filter(c => c.command === 'play').length;
    loadGate.resolve(); await latest; check(await old === 'cancelled', 'Old play survived the newer intent');
    check(!audio.paused && log.filter(c => c.command === 'play').length === count + 1, 'Last play did not win exactly once');
    // Pause while switching from one native output to another.
    loadGate = deferred(); entered = deferred();
    const switching = configureNativeOutput({ device: 'wasapi/other', exclusive: true }); await entered.promise;
    audio.pause(); const switchPause = log.length; loadGate.resolve(); await switching;
    check(audio.paused && !log.slice(switchPause).some(c => c.command === 'play'), 'Output switching resurrected playback');
    // Switching must never restore its old song or old seek after a new selection.
    loadGate = deferred(); entered = deferred();
    const changing = configureNativeOutput({ device: 'auto', exclusive: false }); await entered.promise;
    const release = loadGate.resolve; loadGate = undefined; entered = undefined;
    audio.src = 'blob:new-song'; audio.load(); audio.currentTime = 12;
    const playNew = audio.play(); release(); await changing; await playNew; await tick();
    check(audio.currentSrc === 'blob:new-song' && !audio.paused && audio.currentTime >= 12, 'Old switch changed the new song');
    check(log.filter(c => c.command === 'play').every(c => c.context.playing), 'Play did not carry latest desired intent');
    return { cases: ['pause-during-blob-read', 'pause-during-native-load', 'play-pause-play', 'pause-during-output-switch', 'switch-and-new-song'], passed: true };
  } finally { dispose(); delete window.localMusicDesktop; }
}
export async function bridgeDeviceFaults() {
  let send: (value: any) => void = () => {}, state: any = { id: '', time: 0, duration: 90, paused: true, ready: false, ended: false };
  let loadFailure = false;
  window.localMusicDesktop = {
    nativeAudioLoad: async (value: any) => {
      if (loadFailure) return { ok: false, error: { kind: 'device-exclusive-busy', message: 'Device is busy.' } };
      state = { ...state, id: value.id, paused: true, ready: true, error: undefined }; send({ ...state }); return { ok: true };
    }, nativeAudioCommand: async (command: string, value: number) => {
      if (command === 'play') state.paused = false; if (command === 'pause') state.paused = true; if (command === 'seek') state.time = value;
      send({ ...state }); return { ok: true };
    }, onNativeAudioState: (fn: any) => { send = fn; return () => {}; },
  } as any;
  const audio = new Audio(), dispose = attachNativeAudio(audio, () => new Blob(['audio']))!;
  await configureNativeOutput({ device: 'auto', exclusive: true });
  const failures: string[] = [], player = new LocalAudioPlayer(audio, { onChange() {}, onDuration() {}, onSelect() {}, revokeUrl() {}, onFailure: id => { failures.push(id); } });
  try {
    player.addTracks([{ id: 'a', url: 'blob:a' }, { id: 'b', url: 'blob:b' }]);
    player.play('a'); await tick(); await tick();
    state.time = 28; send({ ...state }); state.error = { kind: 'device-unavailable', message: 'Output was lost.' }; send({ ...state });
    check(player.getState().currentId === 'a' && player.getState().position >= 28 && audio.paused && !failures.length, 'Device error skipped a healthy song');
    loadFailure = true; player.play();
    await waitFor(() => player.getState().error?.kind === 'device-exclusive-busy', 'Timed out waiting for structured device fault');
    check(player.getState().currentId === 'a' && !failures.length, 'IPC envelope lost structured device error');
    return { retainedSong: 'a', errorKind: player.getState().error?.kind, failures };
  } finally { player.dispose(); dispose(); delete window.localMusicDesktop; }
}
