// Test-only entry. Not staged into the distributed application.
import { app, BrowserWindow } from 'electron';
import { startDesktop } from '../electron/app.mjs';

globalThis.desktopWindowEvents = [];
globalThis.desktopDownloads = [];
startDesktop({ show: false, userData: process.env.DESKTOP_TEST_PROFILE, singleInstance: false,
  onWindow(win) {
    win.webContents.setAudioMuted(true);
    for (const name of ['show', 'focus', 'restore']) win.on(name, () => globalThis.desktopWindowEvents.push(name));
    // Save test downloads without displaying a native dialog.
    win.webContents.session.on('will-download', (_event, item, source) => {
      globalThis.desktopDownloads.push({ name: item.getFilename(), url: item.getURL(), source: source?.getURL(), prevented: _event.defaultPrevented });
      item.setSavePath(`${process.env.DESKTOP_TEST_DOWNLOADS}/${item.getFilename()}`);
      item.on('done', (_e, state) => globalThis.desktopDownloads.push({ state }));
    });
  },
}).catch(error => { console.error(error); app.exit(1); });
app.on('before-quit', () => { for (const win of BrowserWindow.getAllWindows()) win.destroy(); });
