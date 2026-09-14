import { app, dialog } from 'electron';
import { startDesktop } from './app.mjs';

startDesktop().catch(error => {
  console.error(error);
  dialog.showErrorBox('Lyric Player could not start', `${error.message}\nYour saved library has not been removed.`);
  app.quit();
});
