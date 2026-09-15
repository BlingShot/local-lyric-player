import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { NativeAudio } from './native-audio.mjs';
export function registerNativeAudio(win, _config, handle) {
  const binary = app.isPackaged ? path.join(process.resourcesPath, 'native', 'mpv.exe') : path.resolve(import.meta.dirname, '../desktop/native/mpv.exe');
  const audio = new NativeAudio(binary, path.join(app.getPath('temp'), `lyric-player-audio-${randomUUID()}`));
  audio.on('state', state => { if (!win.isDestroyed()) win.webContents.send('native-audio:state', state); });
  handle('native-audio:devices', () => audio.devices());
  handle('native-audio:meter', enabled => audio.setMeter(enabled));
  handle('native-audio:energy', () => audio.energy());
  handle('native-audio:load', value => audio.load(value));
  handle('native-audio:command', (command, value) => audio.command(command, value));
  win.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) void audio.command('stop').then(() => audio.setMeter(false)).catch(() => {}); });
  win.on('closed', () => { void audio.dispose(); });
}
