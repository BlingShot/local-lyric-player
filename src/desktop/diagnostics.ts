import { useSyncExternalStore } from 'react';
import { version } from '../../package.json';
import { redactLogText, redactDiagnostic, sanitizeLogEntry, serializeDebugReport } from '../../electron/log-redaction.mjs';

export type DebugSection = 'live' | 'lyrics' | 'audio' | 'ttml' | 'performance';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
export interface DiagnosticEntry { time: string; level: LogLevel; scope: string; message: string; data?: unknown }
const LOG_SEVERITY: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3, fatal: 4 };
const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'fatal'] as const;
const validLogLevel = (value: unknown): LogLevel => typeof value === 'string' && (LOG_LEVELS as readonly string[]).includes(value) ? value as LogLevel : 'info';
const key = 'local-music-debug';
const read = () => {
  try {
    const saved = localStorage.getItem(key);
    if (saved === 'true' || saved === 'false') return { debug: saved === 'true', level: 'info' as LogLevel };
    const parsed = JSON.parse(saved || 'null') as { debug?: boolean; level?: LogLevel } | null;
    return { debug: parsed?.debug === true, level: validLogLevel(parsed?.level) };
  } catch { return { debug: false, level: 'info' as LogLevel }; }
};
interface DiagnosticPreferences { debug: boolean; level: LogLevel }
const initialPreferences = read();
let state = { ...initialPreferences, ready: false, saving: false, saved: false, error: '' }, revision = 0, initialized = false;
const listeners = new Set<() => void>(), telemetryListeners = new Set<() => void>();
const sources = new Map<DebugSection, () => unknown>(), entries: DiagnosticEntry[] = [], sizes: number[] = [];
let retainedBytes = 0, dropped = 0, timer: ReturnType<typeof setInterval> | undefined, raf = 0, frames = 0, frameAt = 0, generation = 0;
let desktopPending = false, desktopAt = 0;
let metrics: Record<string, unknown> = {}, sections: Partial<Record<DebugSection, unknown>> = {}, desktopInfo: unknown;
let snapshot = { sampledAt: '', sections, metrics, desktop: desktopInfo, retainedBytes: 0, dropped: 0 };
const notify = () => listeners.forEach(listener => listener());
export const subscribeDebugMode = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const isDebugMode = () => state.debug;
export const useDiagnostics = () => useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => state);
export const useDebugSnapshot = () => useSyncExternalStore(listener => { telemetryListeners.add(listener); return () => { telemetryListeners.delete(listener); }; }, () => snapshot);
export const registerDebugSource = (section: DebugSection, read: () => unknown) => { sources.set(section, read); return () => { if (sources.get(section) === read) sources.delete(section); }; };
export function diagnosticState(section: DebugSection, value: unknown) { if (state.debug) sections = { ...sections, [section]: redactDiagnostic(value) }; }
export function diagnosticMetric(name: string, value: unknown) { if (state.debug) metrics = { ...metrics, [name]: redactDiagnostic(value) }; }
export function diagnosticLog(level: LogLevel, scope: string, message: unknown, data?: unknown) {
  if (level === 'debug' && !state.debug) return;
  if (LOG_SEVERITY[level] < LOG_SEVERITY[state.level]) return;
  try {
    const entry = sanitizeLogEntry({ level, scope, message: redactLogText(message), data: data ?? (message instanceof Error ? { error: message } : undefined) }) as DiagnosticEntry;
    let text = JSON.stringify(entry);
    if (text.length > 24000) { entry.data = { truncated: true }; entry.message = entry.message.slice(0, 8000); text = JSON.stringify(entry); }
    const bytes = new TextEncoder().encode(text).byteLength;
    while (entries.length && (entries.length >= 500 || retainedBytes + bytes > 512 * 1024)) { retainedBytes -= sizes.shift()!; entries.shift(); dropped++; }
    entries.push(entry); sizes.push(bytes); retainedBytes += bytes;
    void window.localMusicDesktop?.writeLog?.(entry).catch(() => {
      if (!state.error) { state = { ...state, error: 'Log file could not be written. Session logs are still available.' }; notify(); }
    });
  } catch { /* A failed diagnostic must not change playback or recursively log itself. */ }
}
export const recentDiagnosticLogs = () => entries.slice();
export function captureDebugSnapshot() {
  // Also called once on explicit export, but never starts collectors in normal mode.
  for (const [section, read] of sources) {
    try { if (state.debug || section === 'live' || section === 'audio') sections = { ...sections, [section]: redactDiagnostic(read()) }; }
    catch (error) { sections = { ...sections, [section]: { unavailable: redactLogText(error) } }; }
  }
  snapshot = { sampledAt: new Date().toISOString(), sections, metrics, desktop: desktopInfo, retainedBytes, dropped };
  telemetryListeners.forEach(listener => listener());
  return snapshot;
}
function stopCapture() {
  generation++; clearInterval(timer); timer = undefined; cancelAnimationFrame(raf); raf = 0; frames = 0;
  // Old song/word/FPS data must not masquerade as live readings after disabling.
  sections = {}; metrics = {}; desktopInfo = undefined;
  captureDebugSnapshot();
}
function startCapture() {
  if (!initialized || !state.debug || timer) return;
  const token = ++generation; frameAt = performance.now(); desktopAt = 0;
  const frame = () => { if (!state.debug || token !== generation) return; frames++; raf = requestAnimationFrame(frame); };
  raf = requestAnimationFrame(frame);
  const sample = () => {
    if (!state.debug || token !== generation) return;
    const now = performance.now(), elapsed = now - frameAt;
    if (elapsed >= 900) { diagnosticMetric('fps', document.visibilityState === 'visible' ? Math.round(frames * 1000 / elapsed) : null); frames = 0; frameAt = now; }
    const memory = (performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
    if (memory) diagnosticMetric('rendererHeap', { usedBytes: memory.usedJSHeapSize, limitBytes: memory.jsHeapSizeLimit });
    if (!desktopPending && now - desktopAt >= 5000 && window.localMusicDesktop?.debugInfo) {
      desktopPending = true; desktopAt = now;
      void window.localMusicDesktop.debugInfo().then(info => { if (state.debug && token === generation) desktopInfo = redactDiagnostic(info); })
        .catch(() => {}).finally(() => { desktopPending = false; });
    }
    captureDebugSnapshot();
  };
  timer = setInterval(sample, 500); sample();
}
export async function initializeDiagnostics() {
  if (initialized) return; initialized = true;
  window.addEventListener('error', event => diagnosticLog('fatal', 'renderer', event.error || event.message));
  window.addEventListener('unhandledrejection', event => diagnosticLog('error', 'promise', event.reason));
  document.addEventListener('securitypolicyviolation', event => diagnosticLog('warn', 'security-policy', 'A resource was blocked by Content Security Policy.', { directive: event.violatedDirective, blockedURI: event.blockedURI }));
  window.addEventListener('pagehide', stopCapture);
  window.addEventListener('pageshow', () => { if (state.debug) startCapture(); });
  const request = revision;
  // Initialization shares the write queue, so a slow startup read cannot restore
  // old values over a later user change.
  const task = writes.catch(() => {}).then(async () => {
    const desktop = window.localMusicDesktop;
    const fallback: DiagnosticPreferences = { debug: state.debug, level: state.level };
    const stored = desktop ? await desktop.getConfig<Partial<DiagnosticPreferences>>('diagnostics') : undefined;
    if (request !== revision) return;
    if (stored !== undefined && (!stored || typeof stored.debug !== 'boolean' ||
        stored.level !== undefined && !(LOG_LEVELS as readonly unknown[]).includes(stored.level))) {
      throw new Error('Saved debug settings are invalid. They have not been overwritten.');
    }
    const preference: DiagnosticPreferences = stored
      ? { debug: stored.debug === true, level: validLogLevel(stored.level) } : fallback;
    if (desktop && (stored === undefined || stored.level === undefined)) await desktop.setConfig('diagnostics', preference);
    else if (!desktop) localStorage.setItem(key, JSON.stringify(preference));
    if (request === revision) {
      state = { ...state, ...preference, ready: true, saving: false, saved: true, error: '' }; notify();
    }
  });
  writes = task;
  try { await task; }
  catch (error) {
    if (request === revision) {
      state = { ...state, ready: true, saving: false, saved: false,
        error: error instanceof Error ? error.message : 'Debug settings could not be restored.' }; notify();
    }
  }
  if (state.debug) startCapture();
  diagnosticLog('info', 'startup', 'Renderer initialized.', { version });
}
let writes = Promise.resolve();

async function persistDiagnostics(preference: DiagnosticPreferences, request: number) {
  const task = writes.catch(() => {}).then(async () => {
    if (window.localMusicDesktop) await window.localMusicDesktop.setConfig('diagnostics', preference);
    else localStorage.setItem(key, JSON.stringify(preference));
  });
  writes = task;
  try {
    await task;
    if (request === revision) { state = { ...state, ready: true, saving: false, saved: true, error: '' }; notify(); }
    diagnosticLog('info', 'diagnostics', 'Debug preferences saved.', preference);
  } catch (error) {
    if (request === revision) {
      state = { ...state, ready: true, saving: false, saved: false,
        error: `Debug settings were not saved. ${error instanceof Error ? error.message : 'Check storage permissions and try again.'}` };
      notify();
    }
  }
}
export async function setDebugMode(debug: boolean) {
  const request = ++revision;
  state = { ...state, debug, saving: true, saved: false, error: '' };
  if (debug) startCapture(); else stopCapture(); notify();
  await persistDiagnostics({ debug, level: state.level }, request);
}
export async function setLogLevel(level: LogLevel) {
  const request = ++revision;
  state = { ...state, level: validLogLevel(level), saving: true, saved: false, error: '' }; notify();
  await persistDiagnostics({ debug: state.debug, level: state.level }, request);
}
export async function retryDiagnosticSettings() {
  const request = ++revision;
  const preference = { debug: state.debug, level: state.level };
  state = { ...state, saving: true, saved: false, error: '' }; notify();
  await persistDiagnostics(preference, request);
}
export async function diagnosticText() {
  if (window.localMusicDesktop?.readLog) { try { return (await window.localMusicDesktop.readLog()).split('\n').map(line => { try { return JSON.stringify(redactDiagnostic(JSON.parse(line))); } catch { return redactLogText(line); } }).join('\n'); } catch { /* Fall back to session logs. */ } }
  return entries.map(entry => JSON.stringify(entry)).join('\n') + '\n';
}
export async function clearDiagnostics() {
  await window.localMusicDesktop?.clearLogs?.();
  entries.length = 0; sizes.length = 0; retainedBytes = 0; dropped = 0; captureDebugSnapshot();
}
export async function debugReport() {
  const current = captureDebugSnapshot();
  let desktop: unknown = current.desktop;
  try { desktop = await window.localMusicDesktop?.debugInfo?.() ?? desktop; } catch { /* Renderer report remains usable. */ }
  let desktopLogs: unknown[] = [];
  try { const text = await window.localMusicDesktop?.readLog?.(); desktopLogs = (text || '').split('\n').filter(Boolean).slice(-100).map(line => { try { return JSON.parse(line); } catch { return { legacy: line }; } }); } catch { /* Session-only report. */ }
  const report = { reportVersion: 1, generatedAt: new Date().toISOString(), debugMode: state.debug,
    environment: { version, userAgent: navigator.userAgent, platform: navigator.platform, language: navigator.language, online: navigator.onLine, desktop },
    currentSong: current.sections.live, audio: current.sections.audio, lyrics: current.sections.lyrics ?? { status: 'Debug capture is disabled.' },
    amllTtml: current.sections.ttml ?? { status: 'No AMLL trace captured in this session.' }, performance: { ...current.metrics, ...Object(current.sections.performance), retainedLogBytes: retainedBytes, dropped },
    recentErrors: entries.filter(entry => entry.level === 'error' || entry.level === 'warn' || entry.level === 'fatal').slice(-30), recentLogs: entries.slice(-100), recentDesktopLogs: desktopLogs };
  return serializeDebugReport(report);
}
