import { app, dialog, ipcMain, shell } from 'electron';
import { directoryBytes } from './storage.mjs';
import { isAppUrl } from './policy.mjs';

export function registerStorageIpc(win, storage, devUrl) {
  const ses = win.webContents.session;
  let busy = false;
  const info = async () => ({ ...storage.config, pending: storage.pending,
    dataBytes: await directoryBytes(storage.config.dataPath), cacheBytes: await directoryBytes(storage.config.cachePath),
    httpCacheBytes: await ses.getCacheSize(),
    memoryBytes: app.getAppMetrics().reduce((sum, item) => sum + item.memory.workingSetSize * 1024, 0) });
  const handle = (name, action) => ipcMain.handle(`desktop-storage:${name}`, async (event, ...args) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || !isAppUrl(event.senderFrame.url, devUrl)) throw new Error('Untrusted storage request.');
    return action(...args);
  });
  handle('info', info);
  handle('choose', async kind => {
    if (busy || !['data', 'cache'].includes(kind)) throw new Error('Storage operation unavailable.');
    busy = true;
    try {
      const result = await dialog.showOpenDialog(win, { title: kind === 'data' ? 'Choose Lyric Player data location' : 'Choose Lyric Player cache location',
        properties: ['openDirectory', 'createDirectory', 'dontAddToRecent'] });
      if (!result.canceled && result.filePaths[0]) await storage.stage(kind, result.filePaths[0]);
      return info();
    } finally { busy = false; }
  });
  handle('cancel', () => { storage.pending = undefined; return info(); });
  handle('clear-cache', async () => {
    if (busy) throw new Error('Another storage operation is running.');
    busy = true;
    try {
      await ses.clearCache();
      await ses.clearCodeCaches({});
      await ses.clearStorageData({ storages: ['shadercache'] });
      return info();
    } finally { busy = false; }
  });
  handle('open', async kind => {
    const selected = kind === 'data' ? storage.config.dataPath : kind === 'cache' ? storage.config.cachePath : kind === 'previous' ? storage.config.previousDataPath : undefined;
    if (!selected) throw new Error('No storage folder selected.');
    const error = await shell.openPath(selected);
    if (error) throw new Error(error);
  });
  handle('apply', async () => {
    if (busy) throw new Error('Another storage operation is running.');
    busy = true;
    try {
      await storage.schedule();
      ses.flushStorageData();
      // Portable builds must relaunch their persistent launcher, not the temporary extraction.
      app.relaunch({ execPath: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath,
        args: app.isPackaged ? [] : process.argv.slice(1) });
      setTimeout(() => app.quit(), 200);
    } catch (error) { busy = false; throw error; }
  });
}
