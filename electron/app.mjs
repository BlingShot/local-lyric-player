import { app, BrowserWindow, ipcMain, Menu, protocol, screen, session, shell, safeStorage } from 'electron';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { APP_URL, EXTERNAL_LINKS, isAppUrl, allowedRequest, allowedPermission, assetPath, isPagePath } from './policy.mjs';
import { DesktopStorage } from './storage.mjs';
import { registerStorageIpc } from './storage-ipc.mjs';
import { useNativeFfmpeg } from './audio-backend.mjs';
import { DesktopConfig } from './config.mjs';
import { DesktopLogger } from './logging.mjs';
import { redactLogText } from './log-redaction.mjs';
import { FolderImporter } from './folder-import.mjs';
import { registerSettingsIpc } from './settings-ipc.mjs';

// Registration must precede app.ready. The stable origin also owns IndexedDB.
protocol.registerSchemesAsPrivileged([{ scheme: 'localmusic', privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true,
} }]);

const root = path.resolve(import.meta.dirname, '../build');
const mimeTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.wasm': 'application/wasm',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };

export async function localResponse(request) {
  if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
  let file;
  try { file = assetPath(request.url, root); }
  catch { return new Response('Invalid local address', { status: 400 }); }
  if (isPagePath(request.url)) file = path.join(root, 'index.html');
  try {
    if (!(await stat(file)).isFile()) return new Response('Not found', { status: 404 });
    const data = await readFile(file);
    return new Response(request.method === 'HEAD' ? null : data, { headers: {
      'Content-Type': mimeTypes[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': String(data.length), 'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-cache',
    } });
  } catch { return new Response('Not found', { status: 404 }); }
}

export async function startDesktop({ show = true, userData, singleInstance = true, onWindow, offscreen = false } = {}) {
  const devUrl = !app.isPackaged && process.env.LOCAL_MUSIC_DEV_URL === 'http://127.0.0.1:3000/'
    ? process.env.LOCAL_MUSIC_DEV_URL : undefined;
  app.setName('Lyric Player');
  app.setAppUserModelId('com.localmusic.player');
  // Keep the existing storage namespace and instance lock when changing the display name.
  const storageName = devUrl ? 'Local Music Development' : 'Local Music';
  const defaultData = userData || path.join(app.getPath('appData'), storageName);
  const controlRoot = userData ? `${userData}-control` : path.join(app.getPath('appData'), `${storageName} Control`);
  const defaultCache = userData ? `${userData}-cache` : path.join(process.env.LOCALAPPDATA || app.getPath('appData'), `${storageName} Cache`);
  // The instance lock keeps a fixed location even when the data directory changes.
  app.setPath('userData', controlRoot);
  if (singleInstance && !app.requestSingleInstanceLock()) { app.quit(); return; }
  const storage = new DesktopStorage({ controlRoot, defaultData, defaultCache });
  const locations = storage.startup(); // Previous process is closed; copy/verify before Chromium opens IndexedDB.
  app.setPath('userData', locations.dataPath);
  app.setPath('sessionData', locations.dataPath);
  app.commandLine.appendSwitch('disk-cache-size', String(128 * 1024 * 1024));
  useNativeFfmpeg(app.commandLine);

  let win;
  // Only an explicit second launch can restore the window. Media events never do.
  app.on('second-instance', () => {
    if (!win || win.isDestroyed() || !show) return;
    if (win.isMinimized()) win.restore();
    win.show(); win.focus();
  });
  app.on('window-all-closed', () => app.quit());
  await app.whenReady();
  const ses = session.defaultSession;
  ses.setCodeCachePath(path.join(locations.cachePath, 'Code Cache'));
  const config = new DesktopConfig(locations.dataPath, safeStorage);
  const logger = new DesktopLogger(locations.dataPath);
  const log = (level, scope, message) => { void logger.write({ level, scope, message: redactLogText(message) }).catch(() => {}); };
  try { logger.setDebug((await config.get('diagnostics'))?.debug === true); } catch (error) { log('warn', 'config', error); }
  log('info', 'startup', `Lyric Player ${app.getVersion()} / ${process.platform} ${process.arch}`);
  process.on('uncaughtExceptionMonitor', error => log('error', 'main', error));
  app.on('child-process-gone', (_event, details) => log('error', 'process', `${details.type}: ${details.reason} (${details.exitCode})`));
  const folders = new FolderImporter(config);
  await ses.protocol.handle('localmusic', request => new URL(request.url).pathname.startsWith('/__folder/') ? folders.response(request) : localResponse(request));
  ses.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !allowedRequest(details.url, devUrl) }));
  ses.setPermissionCheckHandler((contents, permission, origin, details) =>
    Boolean(contents && isAppUrl(contents.getURL(), devUrl) && isAppUrl(origin, devUrl) && allowedPermission(permission, details)));
  ses.setPermissionRequestHandler((contents, permission, callback, details) =>
    callback(isAppUrl(contents.getURL(), devUrl) && isAppUrl(details.requestingUrl, devUrl) && allowedPermission(permission, details)));
  ses.setDevicePermissionHandler(() => false);
  ses.on('file-system-access-restricted', (_event, _details, callback) => callback('deny'));
  ses.on('will-download', (event, item, contents) => {
    if (!contents || !isAppUrl(contents.getURL(), devUrl)) { event.preventDefault(); return; }
    // Existing Blob downloads (lyrics, projects, audio copies) use a native Save As.
    item.setSaveDialogOptions({ title: 'Save exported file', defaultPath: path.join(app.getPath('downloads'), path.basename(item.getFilename())) });
  });

  const stateFile = path.join(app.getPath('userData'), 'window-state.json');
  let saved;
  try { saved = JSON.parse(readFileSync(stateFile, 'utf8')); } catch { /* First launch. */ }
  const area = screen.getPrimaryDisplay().workArea;
  const bounds = saved?.bounds;
  const validBounds = bounds && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(bounds[key])) &&
    bounds.width >= 900 && bounds.height >= 600 && screen.getAllDisplays().some(({ workArea: a }) =>
      bounds.x + bounds.width > a.x + 100 && bounds.x < a.x + a.width - 100 &&
      bounds.y >= a.y && bounds.y < a.y + a.height - 100);
  win = new BrowserWindow({
    ...(validBounds ? bounds : { width: Math.min(1440, area.width), height: Math.min(940, area.height) }),
    minWidth: 900, minHeight: 600, title: 'Lyric Player', show: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#b3b3b3', height: 60 },
    backgroundColor: '#080808', icon: path.join(root, 'images/app-icon.png'), autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: path.join(import.meta.dirname, 'preload.cjs'),
      offscreen, // Used only by the hidden animation test; production keeps normal rendering.
      webSecurity: true, allowRunningInsecureContent: false, navigateOnDragDrop: false,
      // Audio and lyric clocks must keep working while the desktop is in front.
      backgroundThrottling: false, spellcheck: false, autoplayPolicy: 'no-user-gesture-required' },
  });
  registerStorageIpc(win, storage, devUrl);
  registerSettingsIpc(win, config, folders, devUrl, logger);
  win.webContents.on('render-process-gone', (_event, details) => log('error', 'renderer', `${details.reason} (${details.exitCode})`));
  win.webContents.on('preload-error', (_event, _file, error) => log('error', 'preload', error));
  ipcMain.handle('desktop-window:theme', (event, mode) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame ||
        !isAppUrl(event.senderFrame.url, devUrl) || !['dark', 'light'].includes(mode)) throw new Error('Invalid window theme request.');
    // Let the page's current surface show through the native caption controls.
    win.setTitleBarOverlay({ color: '#00000000',
      symbolColor: mode === 'light' ? '#62676e' : '#b3b3b3', height: 60 });
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'File', submenu: [{ role: 'close' }] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
      { type: 'separator' }, { role: 'togglefullscreen' }, ...(!app.isPackaged ? [{ role: 'toggleDevTools' }] : [])] },
  ]));
  win.webContents.on('will-navigate', (event, url) => { if (!isAppUrl(url, devUrl)) event.preventDefault(); });
  win.webContents.on('will-redirect', (event, url) => { if (!isAppUrl(url, devUrl)) event.preventDefault(); });
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (EXTERNAL_LINKS.has(url) && win.isFocused()) void shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  win.on('close', () => {
    try { writeFileSync(stateFile, JSON.stringify({ bounds: win.getNormalBounds(), maximized: win.isMaximized() })); }
    catch (error) { console.error('Could not save window position:', error.message); }
  });
  // Never attach show/focus to page loads, title updates, routes, playback, or downloads.
  if (show) win.once('ready-to-show', () => { if (saved?.maximized) win.maximize(); win.show(); });
  onWindow?.(win);
  await win.loadURL(devUrl || APP_URL);
  return win;
}
