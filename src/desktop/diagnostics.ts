import { useSyncExternalStore } from 'react';
import { redactLogText, sanitizeLogEntry } from '../../electron/log-redaction.mjs';
import { configPreference } from './config';

const key = 'local-music-debug';
const read = () => { try { return localStorage.getItem(key) === 'true'; } catch { return false; } };
let state = { debug: read(), error: '' }, revision = 0, initialized = false;
const listeners = new Set<() => void>(), entries: string[] = [];
const notify = () => listeners.forEach(listener => listener());
export const useDiagnostics = () => useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => state);
export function diagnosticLog(level: 'debug' | 'info' | 'warn' | 'error', scope: string, message: unknown) {
  if (level === 'debug' && !state.debug) return;
  try {
    const entry = sanitizeLogEntry({ level, scope, message: redactLogText(message) });
    entries.push(JSON.stringify(entry)); if (entries.length > 500) entries.shift();
    void window.localMusicDesktop?.writeLog?.(entry).catch(() => { if (!state.error) { state = { ...state, error: 'Log file could not be written. Session logs are still available.' }; notify(); } });
  } catch { /* Diagnostics must not interrupt playback or turn failures into a logging loop. */ }
}
export async function initializeDiagnostics() {
  if (initialized) return; initialized = true;
  window.addEventListener('error', event => diagnosticLog('error', 'renderer', event.error || event.message));
  window.addEventListener('unhandledrejection', event => diagnosticLog('error', 'promise', event.reason));
  const request = revision, value = await configPreference('diagnostics', { debug: state.debug });
  if (request === revision) { state = { ...state, debug: value?.debug === true }; notify(); }
  diagnosticLog('info', 'startup', 'Renderer initialized.');
}
let writes = Promise.resolve();
export async function setDebugMode(debug: boolean) {
  const request = ++revision; state = { debug, error: '' }; notify();
  writes = writes.catch(() => {}).then(async () => {
    if (window.localMusicDesktop) await window.localMusicDesktop.setConfig('diagnostics', { debug });
    else localStorage.setItem(key, String(debug));
  });
  try { await writes; diagnosticLog('info', 'diagnostics', `Debug mode ${debug ? 'enabled' : 'disabled'}.`); }
  catch { if (request === revision) { state = { ...state, error: 'Debug setting could not be saved.' }; notify(); } }
}
export async function diagnosticText() {
  const desktop = window.localMusicDesktop;
  if (desktop?.readLog) { try { return await desktop.readLog(); } catch { /* Export the in-memory session when disk is unavailable. */ } }
  return entries.join('\n') + '\n';
}
