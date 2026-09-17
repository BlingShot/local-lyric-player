import { seed, mountApp, settings, setClock, amllScenario } from './lyric-polish-browser';
import { initializeDiagnostics, setDebugMode, isDebugMode, diagnosticLog, recentDiagnosticLogs, debugReport, registerDebugSource, clearDiagnostics } from '../src/desktop/diagnostics';
import { observeAudioDiagnostics } from '../src/desktop/debugSources';
import { getLocalAudioElement } from '../src/player/runtime';
import { amllCacheInfo, clearAmllCache, resolveAmll } from '../src/lyrics/amll';
import { decodeOriginalAudio } from '../src/analysis/audio/decode';
import { saveTracks } from '../src/library/database';
import { saveLyrics, readLyrics } from '../src/lyrics/repository';
import { parseLyrics, LYRICS_PARSER_VERSION } from '../src/lyrics/parse';
let samples = 0, opened = 0, cleared = 0, desktopPolls = 0;
let fileLogs: unknown[] = [];
export async function boot() {
  window.localMusicDesktop = {
    getConfig: async () => undefined, setConfig: async () => {}, spotifyInfo: async () => ({ connected: false, clientId: '' }),
    importFolderInfo: async () => null, getFont: async () => ({ kind: 'system' }), setWindowTheme: async () => {},
    storageInfo: async () => ({ dataPath: '[USER]/data', cachePath: '[USER]/cache', dataBytes: 0, cacheBytes: 0, httpCacheBytes: 0, memoryBytes: 0 }),
    writeLog: async (entry: unknown) => { fileLogs.push(entry); }, readLog: async () => fileLogs.map(value => JSON.stringify(value)).join('\n'),
    clearLogs: async () => { cleared++; fileLogs = []; }, openLogFolder: async () => { opened++; },
    debugInfo: async () => { desktopPolls++; return { version: 'test', httpCacheBytes: 123, logs: { recent: [{ time: new Date().toISOString(), level: 'error', scope: 'audio.native', message: 'Native main-process fixture error', data: { stage: 'Decode' } }] } }; },
  } as any;
  // Config is intentionally unset: a new install must start with Debug Mode off.
  await seed(); mountApp(); observeAudioDiagnostics(getLocalAudioElement());
  registerDebugSource('performance', () => { samples++; return amllCacheInfo(); });
  await initializeDiagnostics(); settings(true);
}
export function stats() { return { samples, opened, cleared, desktopPolls, debug: isDebugMode(), retained: recentDiagnosticLogs().length, cache: amllCacheInfo() }; }
export async function offNoise() { await setDebugMode(false); for (let i = 0; i < 10000; i++) diagnosticLog('debug', 'test', 'disabled-noise'); }
export function clock(value: number) { setClock(value); }
export function sensitiveError() { diagnosticLog('error', 'audio.decode', 'Decoder fixture failed.', { stage: 'Decode', path: 'C:\\Users\\PrivateUser\\Music\\sample.flac', apiKey: 'test-secret-key', authorization: 'Bearer test-bearer-secret', error: new Error('Sample error at /home/PrivateUser/Music/sample.flac') }); }
export const report = debugReport;
export const clear = clearDiagnostics;
export async function amllFlow() {
  clearAmllCache(); await amllScenario('repository');
  const text = await debugReport(), result = JSON.parse(text);
  const steps = result.amllTtml.steps.map((step: any) => step.stage);
  for (const stage of ['ISRC', 'Search', 'Match', 'Download', 'Parse', 'Cache', 'Apply', 'Fallback']) if (!steps.includes(stage)) throw new Error('Missing AMLL stage: ' + stage);
  if (!text.includes('503')) throw new Error('HTTP failure was not retained');
  const cached = amllCacheInfo(); await amllScenario('concurrent');
  if (!recentDiagnosticLogs().some(log => log.scope === 'amll' && log.level === 'warn')) throw new Error('Save conflict was not logged');
  window.dispatchEvent(new Event('local-cache-cleared'));
  if (!cached.indexBytes || amllCacheInfo().indexBytes) throw new Error('Index cache did not clear');
  return { steps, beforeClear: cached, afterClear: amllCacheInfo() };
}
export async function parserFailure() {
  const track = { id: 'debug-invalid-ttml', name: 'Invalid example', artist: 'Artist', fileName: 'example.flac', size: 3, lastModified: 1 };
  await saveTracks([{ track, audio: new Blob(['abc']) }]);
  await saveLyrics({ trackId: track.id, fileName: 'local.lrc', source: '[00:01]Keep local', document: parseLyrics('[00:01]Keep local', 'local.lrc'), parserVersion: LYRICS_PARSER_VERSION, savedAt: 1, origin: 'file' });
  const original = window.fetch;
  const entry = { id: 1, musicNames: [track.name], artistNames: [track.artist], ncmMusicIds: ['1'], format: 'ttml', lyrics: '<tt><broken>', filename: 'invalid.ttml' };
  window.fetch = async input => Response.json({ status: 200, data: String(input).includes('/search') ? { items: [entry], pagination: { hasMore: false } } : entry });
  let failed = false;
  try { await resolveAmll(track, new AbortController().signal, () => {}); } catch { failed = true; } finally { window.fetch = original; }
  if (!failed || (await readLyrics(track.id))?.source !== '[00:01]Keep local') throw new Error('Malformed TTML changed local lyrics');
  const text = await debugReport(); if (!text.includes('Parse') || !text.includes('failed')) throw new Error('Parser failure not diagnosed');
  return { failed, localLyricsPreserved: true };
}
export async function decoderFailure() {
  const buffer = new ArrayBuffer(44 + 44100 * 2), data = new DataView(buffer);
  const text = (offset: number, value: string) => [...value].forEach((c, i) => data.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF'); data.setUint32(4, buffer.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt '); data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, 1, true);
  data.setUint32(24, 44100, true); data.setUint32(28, 88200, true); data.setUint16(32, 2, true); data.setUint16(34, 16, true); text(36, 'data'); data.setUint32(40, buffer.byteLength - 44, true);
  const Original = window.OfflineAudioContext;
  window.OfflineAudioContext = class { sampleRate = 44100; state = 'suspended'; decodeAudioData() { return Promise.reject(new DOMException('Exact native decode fixture failure', 'EncodingError')); } } as any;
  let failed = false;
  try { await decodeOriginalAudio({ track: { id: 'decoder-fixture', name: 'fixture', fileName: 'fixture.wav', size: buffer.byteLength, lastModified: 1 }, readAudio: async () => new Blob([buffer], { type: 'audio/wav' }) } as any, new AbortController().signal, () => {}); }
  catch { failed = true; } finally { window.OfflineAudioContext = Original; }
  const logs = recentDiagnosticLogs().filter(log => log.scope === 'audio.decode');
  const textLogs = JSON.stringify(logs);
  if (!failed || !textLogs.includes('Exact native decode fixture failure') || !textLogs.includes('Decode') || !textLogs.includes('stack')) throw new Error('Decoder diagnostics lost stage or error');
  return { failed, exactError: true, stages: logs.map(log => log.message) };
}
