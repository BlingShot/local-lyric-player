import { openLibraryDatabase } from './database';
import { fileFingerprint, isAudioFileName } from './importFiles';
import { importAudioFiles } from '../player/runtime';
import { store } from '../store/store';

type ReadableDirectory = FileSystemDirectoryHandle & {
  queryPermission(options: { mode: 'read' }): Promise<PermissionState>;
  requestPermission(options: { mode: 'read' }): Promise<PermissionState>;
  values(): AsyncIterableIterator<FileSystemDirectoryHandle | FileSystemFileHandle>;
};
type DirectoryPicker = (options: { mode: 'read'; id: string; startIn: 'music' }) => Promise<ReadableDirectory>;
interface SavedFolder { handle: ReadableDirectory; seenIds: string[] }
interface DesktopFolder { path: string; name: string; seenIds: string[] }
type Status = 'off' | 'choosing' | 'scanning' | 'ready' | 'permission' | 'error';
interface FolderImportState { name: string; status: Status; message: string; lastScan?: number }

const key = 'auto-import-folder';
const listeners = new Set<() => void>();
let state: FolderImportState = { name: '', status: 'off', message: '' };
let folder: SavedFolder | undefined;
let desktopFolder: DesktopFolder | undefined;
let running: Promise<void> | undefined;
let initialized = false;
let generation = 0;
const picker = () => (window as Window & { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;
export const supportsFolderImport = () => Boolean(window.localMusicDesktop || picker());
export const getFolderImportState = () => state;
export const subscribeFolderImport = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const publish = (patch: Partial<FolderImportState>) => { state = { ...state, ...patch }; listeners.forEach(listener => listener()); };

async function saveFolder(value?: SavedFolder) {
  const db = await openLibraryDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('settings', 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('Folder settings were not saved.'));
    try {
      if (value) tx.objectStore('settings').put(value, key);
      else tx.objectStore('settings').delete(key);
    } catch (error) { tx.abort(); reject(error); }
  });
}

function fail(error: unknown) {
  const permission = error instanceof DOMException && error.name === 'NotAllowedError';
  const message = error instanceof DOMException && error.name === 'QuotaExceededError'
    ? 'Browser storage is full. Free space, then scan again.'
    : error instanceof Error ? error.message : 'The folder could not be accessed.';
  publish({ status: permission ? 'permission' : 'error', message: permission
    ? 'Folder access is needed. Allow access or choose the folder again.'
    : `Auto import paused. ${message} Previously saved songs are still available.` });
}

async function desktopHistory(path: string, seenIds?: string[]): Promise<string[]> {
  const db = await openLibraryDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('settings', seenIds ? 'readwrite' : 'readonly');
    const historyKey = `desktop-folder-history:${path}`;
    const request = seenIds ? tx.objectStore('settings').put(seenIds, historyKey) : tx.objectStore('settings').get(historyKey);
    tx.oncomplete = () => resolve(seenIds || (Array.isArray(request.result) ? request.result : []));
    tx.onabort = () => reject(tx.error || new Error('Folder import history could not be saved.'));
  });
}

function scanDesktopFolder(): Promise<void> {
  if (running) return running;
  const desktop = window.localMusicDesktop, current = desktopFolder, run = generation;
  if (!desktop || !current) return Promise.resolve();
  running = (async () => {
    let scanId: string | undefined, added = 0, count = 0;
    try {
      publish({ status: 'scanning', message: 'Checking for new audio…' });
      scanId = await desktop.startFolderScan();
      const seen = new Set(current.seenIds);
      while (run === generation) {
        const batch = await desktop.nextFolderBatch(scanId);
        let changed = false;
        for (const entry of batch.files) {
          if (run !== generation) return;
          count++;
          const id = `v2:${JSON.stringify([entry.relativePath, fileFingerprint(entry)])}`;
          if (seen.has(id)) continue;
          {
            if (!entry.size) throw new Error(`“${entry.name}” is empty.`);
            if (entry.size > 512 * 1024 * 1024) throw new Error(`“${entry.name}” exceeds the 512 MB automatic import limit. Import this file separately.`);
            publish({ message: `Importing ${entry.name}…` });
            if (!/^localmusic:\/\/app\/__folder\/[\da-f-]+\/[\da-f-]+$/.test(entry.url)) throw new Error('Invalid local import address.');
            const response = await fetch(entry.url);
            if (!response.ok) throw new Error(await response.text());
            const blob = await response.blob();
            if (run !== generation) return;
            if (blob.size !== entry.size) throw new Error(`“${entry.name}” could not be read completely. Scan again.`);
            const file = new File([blob], entry.name, { lastModified: entry.lastModified });
            const before = new Set(store.getState().library.tracks.map(track => track.id));
            if (!await importAudioFiles([file])) throw new Error(`“${entry.name}” was not saved. Check the library error and scan again.`);
            added += store.getState().library.tracks.filter(track => !before.has(track.id)).length;
          }
          seen.add(id); changed = true;
        }
        if (changed) { await desktopHistory(current.path, [...seen]); current.seenIds = [...seen]; }
        if (batch.done) break;
      }
      if (run === generation) publish({ status: 'ready', lastScan: Date.now(), message: added ? `Added ${added} new ${added === 1 ? 'file' : 'files'}. Saved on this device.` : count ? 'Up to date. Next automatic scan is on startup.' : 'No supported audio files found in this folder or its subfolders.' });
    } catch (error) { if (run === generation) fail(error); }
    finally { if (scanId) await desktop.endFolderScan(scanId).catch(() => {}); }
  })().finally(() => { running = undefined; });
  return running;
}

async function* filesIn(directory: ReadableDirectory, run: number, path = ''): AsyncGenerator<{ file: File; path: string }> {
  for await (const entry of directory.values()) {
    if (run !== generation) return;
    const entryPath = `${path}${entry.name}`;
    if (entry.kind === 'directory') yield* filesIn(entry as ReadableDirectory, run, `${entryPath}/`);
    else if (isAudioFileName(entry.name)) {
      try {
        const file = await (entry as FileSystemFileHandle).getFile();
        if (!file.size) throw new Error('The audio file is empty.');
        yield { file, path: entryPath };
      } catch (error) {
        if (error instanceof DOMException && error.name === 'NotAllowedError') throw error;
        throw new Error(`Cannot read “${entryPath}”. Check the file and folder, then scan again.`);
      }
    }
  }
}

export function scanFolder(): Promise<void> {
  if (window.localMusicDesktop) return scanDesktopFolder();
  if (running) return running;
  if (!folder) return Promise.resolve();
  const current = folder, run = generation;
  running = (async () => {
    let added = 0;
    try {
      publish({ status: 'scanning', message: 'Checking for new audio…' });
      if (await current.handle.queryPermission({ mode: 'read' }) !== 'granted') {
        throw new DOMException('Folder access is needed.', 'NotAllowedError');
      }
      const seen = new Set(current.seenIds);
      let pending: File[] = [], pendingIds: string[] = [];
      const flush = async () => {
        if (run !== generation) return;
        if (pending.length) {
          const before = new Set(store.getState().library.tracks.map(track => track.id));
          if (!await importAudioFiles(pending)) throw new Error('Audio could not be saved. Check the library error, then scan again.');
          added += store.getState().library.tracks.filter(track => !before.has(track.id)).length;
        }
        if (pendingIds.length) {
          const next = { handle: current.handle, seenIds: [...seen] };
          try { await saveFolder(next); }
          catch { throw new Error('Some audio may have been saved, but the folder scan history could not be saved. Check browser storage, then scan again.'); }
          current.seenIds = next.seenIds;
        }
        pending = []; pendingIds = [];
      };
      for await (const { file, path } of filesIn(current.handle, run)) {
        if (run !== generation) return;
        const id = `v2:${JSON.stringify([path, fileFingerprint(file)])}`;
        if (seen.has(id)) continue;
        seen.add(id); pendingIds.push(id);
        pending.push(file);
        // Bound metadata work and audio copies held by a transaction.
        if (pendingIds.length >= 25) await flush();
      }
      if (run !== generation) return;
      await flush();
      publish({ status: 'ready', lastScan: Date.now(), message: added ? `Added ${added} new ${added === 1 ? 'file' : 'files'}. Saved on this device.` : 'Up to date. Next automatic scan is on startup.' });
    } catch (error) { if (run === generation) fail(error); }
  })().finally(() => { running = undefined; });
  return running;
}

export async function chooseImportFolder() {
  if (window.localMusicDesktop) {
    if (state.status === 'choosing') return;
    const previous = state;
    publish({ status: 'choosing', message: 'Choose a music folder…' });
    try {
      const selected = await window.localMusicDesktop.chooseImportFolder();
      if (!selected) { publish(previous); return; }
      generation++; await running;
      desktopFolder = { ...selected, seenIds: await desktopHistory(selected.path) };
      publish({ name: selected.name, lastScan: undefined });
      await scanDesktopFolder();
    } catch (error) { fail(error); }
    return;
  }
  const select = picker();
  if (!select || state.status === 'choosing') return;
  const previous = state;
  publish({ status: 'choosing', message: 'Choose a music folder…' });
  try {
    // Invoke the browser picker before awaiting anything to retain the user gesture.
    const handle = await select.call(window, { mode: 'read', id: 'local-music-auto-import', startIn: 'music' });
    generation++;
    await running;
    const same = folder && await handle.isSameEntry(folder.handle);
    const next = { handle, seenIds: same ? folder!.seenIds : [] };
    await saveFolder(next);
    folder = next;
    publish({ name: handle.name, lastScan: undefined });
    await scanFolder();
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') publish(previous);
    else fail(error);
  }
}

export async function allowFolderAccess() {
  if (!folder) return;
  try {
    if (await folder.handle.requestPermission({ mode: 'read' }) !== 'granted') throw new DOMException('Folder access is needed.', 'NotAllowedError');
    await scanFolder();
  } catch (error) { fail(error); }
}

export async function disconnectImportFolder() {
  generation++;
  if (window.localMusicDesktop) {
    await running;
    try { await window.localMusicDesktop.disconnectImportFolder(); desktopFolder = undefined; publish({ name: '', status: 'off', message: 'Auto import is off. Imported songs are kept.', lastScan: undefined }); }
    catch (error) { fail(error); }
    return;
  }
  await running;
  try {
    await saveFolder();
    folder = undefined;
    publish({ name: '', status: 'off', message: 'Auto import is off. Imported songs are kept.', lastScan: undefined });
  } catch { fail(new Error('The saved folder connection could not be removed. Check browser storage and retry.')); }
}

function savedHistoryNeedsReview(ids: string[]) {
  if (!ids.some(id => !id.startsWith('v2:'))) return false;
  publish({ status: 'ready', message: 'Folder identity tracking was upgraded. Scan manually to recheck file contents; previously removed files may be imported again. Existing library data is unchanged.' });
  return true;
}

export async function initializeFolderImport() {
  if (initialized) return;
  initialized = true;
  try {
    if (window.localMusicDesktop) {
      const saved = await window.localMusicDesktop.importFolderInfo();
      if (!saved) return;
      desktopFolder = { ...saved, seenIds: await desktopHistory(saved.path) };
      publish({ name: saved.name });
      if (savedHistoryNeedsReview(desktopFolder.seenIds)) return;
      await scanDesktopFolder();
      return;
    }
    const db = await openLibraryDatabase();
    const saved = await new Promise<SavedFolder | undefined>((resolve, reject) => {
      const request = db.transaction('settings', 'readonly').objectStore('settings').get(key);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    if (!saved) return;
    if (saved.handle?.kind !== 'directory' || !Array.isArray(saved.seenIds)) throw new Error('The saved folder reference is unavailable. Choose the folder again.');
    folder = saved;
    publish({ name: saved.handle.name });
    if (!supportsFolderImport()) throw new Error('This browser cannot reopen saved folders. Use Import music to select files.');
    if (savedHistoryNeedsReview(folder.seenIds)) return;
    await scanFolder();
  } catch (error) { fail(error); }
}

if (import.meta.hot) import.meta.hot.dispose(() => {
  generation++;
});
