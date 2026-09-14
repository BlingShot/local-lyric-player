import { ipcMain, dialog } from 'electron';
import { isAppUrl } from './policy.mjs';
import { DesktopFonts } from './font-store.mjs';

export function registerSettingsIpc(win, config, folders, devUrl) {
  const fonts = new DesktopFonts(config);
  const handle = (name, fn) => ipcMain.handle(name, (event, ...args) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || !isAppUrl(event.senderFrame.url, devUrl)) throw new Error('Untrusted settings request.');
    return fn(...args);
  });
  const allowed = new Set(['deepseek', 'theme', 'surface', 'language', 'playback', 'lyrics-appearance', 'track-columns', 'normalization']);
  handle('desktop-font:get', slot => fonts.get(slot));
  handle('desktop-font:set', (slot, value) => fonts.set(slot, value));
  handle('desktop-window:zoom', direction => {
    if (![-1, 0, 1].includes(direction)) throw new Error('Invalid zoom request.');
    const factor = direction === 0 ? 1 : Math.max(.6, Math.min(2, Math.round((win.webContents.getZoomFactor() + direction * .1) * 10) / 10));
    win.webContents.setZoomFactor(factor); return factor;
  });
  handle('desktop-config:get', key => { if (!allowed.has(key)) throw new Error('Unknown setting.'); return config.get(key); });
  handle('desktop-config:set', (key, value) => { if (!allowed.has(key)) throw new Error('Unknown setting.'); return config.set(key, value); });
  handle('desktop-config:path', () => config.file);
  handle('desktop-folder:info', () => folders.info());
  let choosing = false;
  handle('desktop-folder:choose', async () => {
    if (choosing) return null; choosing = true;
    try {
      const selected = await dialog.showOpenDialog(win, { title: 'Import music folder', properties: ['openDirectory', 'dontAddToRecent'] });
      return selected.canceled || !selected.filePaths[0] ? null : await folders.choose(selected.filePaths[0]);
    } finally { choosing = false; }
  });
  handle('desktop-folder:start', () => folders.start());
  handle('desktop-folder:next', id => folders.next(id));
  handle('desktop-folder:end', id => folders.end(id));
  handle('desktop-folder:disconnect', () => folders.disconnect());
  win.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) void folders.end(); });
  win.on('closed', () => { void folders.end(); });
}
