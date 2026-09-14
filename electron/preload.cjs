// Electron requires CommonJS for a sandboxed preload. Expose only these fixed operations.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('localMusicDesktop', Object.freeze({
  zoom: direction => ipcRenderer.invoke('desktop-window:zoom', direction),
  getConfig: key => ipcRenderer.invoke('desktop-config:get', key),
  setConfig: (key, value) => ipcRenderer.invoke('desktop-config:set', key, value),
  configPath: () => ipcRenderer.invoke('desktop-config:path'),
  getFont: slot => ipcRenderer.invoke('desktop-font:get', slot),
  setFont: (slot, value) => ipcRenderer.invoke('desktop-font:set', slot, value),
  importFolderInfo: () => ipcRenderer.invoke('desktop-folder:info'),
  chooseImportFolder: () => ipcRenderer.invoke('desktop-folder:choose'),
  startFolderScan: () => ipcRenderer.invoke('desktop-folder:start'),
  nextFolderBatch: id => ipcRenderer.invoke('desktop-folder:next', id),
  endFolderScan: id => ipcRenderer.invoke('desktop-folder:end', id),
  disconnectImportFolder: () => ipcRenderer.invoke('desktop-folder:disconnect'),
  setWindowTheme: mode => ipcRenderer.invoke('desktop-window:theme', mode),
  storageInfo: () => ipcRenderer.invoke('desktop-storage:info'),
  chooseStorage: kind => ipcRenderer.invoke('desktop-storage:choose', kind),
  cancelStorageChange: () => ipcRenderer.invoke('desktop-storage:cancel'),
  clearCache: () => ipcRenderer.invoke('desktop-storage:clear-cache'),
  openStorage: kind => ipcRenderer.invoke('desktop-storage:open', kind),
  applyStorageChange: () => ipcRenderer.invoke('desktop-storage:apply'),
}));
