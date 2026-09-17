import { registerNativeAudio } from './native-audio-ipc.mjs';
import { shell, app, clipboard } from 'electron';
import { prepareClipboardReport } from './debug-clipboard.mjs';
import { mkdir } from 'node:fs/promises';
import { redactDiagnostic } from './log-redaction.mjs';
import { SpotifyService } from './spotify.mjs';
import { ipcMain, dialog } from 'electron';
import { isAppUrl } from './policy.mjs';
import { DesktopFonts } from './font-store.mjs';

export function registerSettingsIpc(win, config, folders, devUrl, logger) {
  const fonts = new DesktopFonts(config);
  const handle = (name, fn) => ipcMain.handle(name, (event, ...args) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || !isAppUrl(event.senderFrame.url, devUrl)) throw new Error('Untrusted settings request.');
    return fn(...args);
  });
  registerNativeAudio(win, config, handle, logger);
  const spotify = new SpotifyService(config, url => shell.openExternal(url));
  handle('spotify:info', () => spotify.info());
  handle('spotify:login', clientId => spotify.login(clientId));
  handle('spotify:logout', () => spotify.logout());
  handle('spotify:match', track => spotify.match(track));
  win.on('closed', () => spotify.cancel());
  const allowed = new Set(['deepseek', 'theme', 'surface', 'language', 'playback', 'lyrics-appearance', 'track-columns', 'normalization', 'typography', 'audio-output', 'diagnostics']);
  handle('desktop-font:get', slot => fonts.get(slot));
  handle('desktop-font:set', (slot, value) => fonts.set(slot, value));
  handle('desktop-window:zoom', direction => {
    if (![-1, 0, 1].includes(direction)) throw new Error('Invalid zoom request.');
    const factor = direction === 0 ? 1 : Math.max(.6, Math.min(2, Math.round((win.webContents.getZoomFactor() + direction * .1) * 10) / 10));
    win.webContents.setZoomFactor(factor); return factor;
  });
  handle('desktop-config:get', key => { if (!allowed.has(key)) throw new Error('Unknown setting.'); return config.get(key); });
  handle('desktop-config:set', async (key, value) => { if (!allowed.has(key)) throw new Error('Unknown setting.'); if (key === 'diagnostics') { if (!value || typeof value.debug !== 'boolean' || Object.keys(value).some(key => key !== 'debug')) throw new Error('Invalid debug settings.'); logger?.setDebug(value.debug); } await config.set(key, value); });
  handle('desktop-log:write', entry => logger?.write(entry));
  handle('desktop-log:copy-report', text => clipboard.writeText(prepareClipboardReport(text)));
  handle('desktop-log:read', () => logger?.read() ?? '');
  handle('desktop-log:clear', () => logger?.clear());
  handle('desktop-log:info', async () => redactDiagnostic({ version: app.getVersion(), versions: process.versions, platform: process.platform, arch: process.arch,
    processMemory: app.getAppMetrics().map(item => ({ type: item.type, workingSetBytes: item.memory.workingSetSize * 1024 })),
    httpCacheBytes: await win.webContents.session.getCacheSize(), logs: await logger?.info() }));
  handle('desktop-log:path', () => logger?.file ?? '');
  handle('desktop-log:open', async () => { if (!logger) return; await logger.queue; await mkdir(logger.directory, { recursive: true }); const error = await shell.openPath(logger.directory); if (error) throw new Error(error); });
  handle('desktop-log:devtools', () => { if (!logger?.debug) throw new Error('Enable debug mode first.'); win.webContents.openDevTools({ mode: 'detach' }); });
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
