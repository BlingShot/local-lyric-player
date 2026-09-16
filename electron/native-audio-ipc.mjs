import { audioResult } from './playback-errors.mjs';
import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { NativeAudio } from './native-audio.mjs';
import { cleanupStaleAudioSessions } from './audio-temp-files.mjs';
const sessions = new Set();
let quitHookInstalled = false;
export const disposeNativeAudio = () => Promise.all([...sessions].map(audio => audio.dispose()));
export function registerNativeAudio(win, _config, handle) {
  if (!quitHookInstalled) {
    quitHookInstalled = true;
    let complete = false, pending = false;
    // Windows are already closed, so a cancelled unsaved-draft prompt never
    // disposes the still-open player's audio. The OS may still force exit;
    // owned crash leftovers are handled by the next startup sweep.
    app.on('will-quit', event => {
      if (complete) return;
      event.preventDefault();
      if (pending) return;
      pending = true;
      void disposeNativeAudio().catch(error => console.warn('Audio cleanup deferred:', error.message))
        .finally(() => { complete = true; app.quit(); });
    });
  }
  const binary = app.isPackaged ? path.join(process.resourcesPath, 'native', 'mpv.exe') : path.resolve(import.meta.dirname, '../desktop/native/mpv.exe');
  const audio = new NativeAudio(binary, path.join(app.getPath('temp'), `lyric-player-audio-${randomUUID()}`));
  sessions.add(audio);
  const sweep = cleanupStaleAudioSessions(app.getPath('temp')).catch(error => console.warn('Audio session sweep failed:', error.message));
  audio.on('state', state => { if (!win.isDestroyed()) win.webContents.send('native-audio:state', state); });
  handle('native-audio:devices', () => sweep.then(() => audio.devices()));
  handle('native-audio:meter', enabled => audio.setMeter(enabled));
  handle('native-audio:energy', () => audio.energy());
  handle('native-audio:load', value => audioResult(() => { if (!value?.context) throw new Error('Missing native load context.'); return audio.load(value); }));
  handle('native-audio:command', (command, value, context) => audioResult(() => { if (!context) throw new Error('Missing native command context.'); return audio.command(command, value, context); }));
  win.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) { audio.resetCommands(); void audio.command('stop').then(() => audio.setMeter(false)).catch(() => {}); } });
  win.on('closed', () => { void audio.dispose().catch(error => console.warn('Audio shutdown cleanup deferred:', error.message)); });
}
