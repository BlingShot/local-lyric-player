// Isolated browser fixtures: no live API calls and no user library data.
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import App from '../src/App';
import { store } from '../src/store/store';
import { libraryActions } from '../src/store/slices/library';
import { playerActions } from '../src/store/slices/player';
import { uiActions } from '../src/store/slices/offlineUi';
import { initialPlaybackState } from '../src/player/LocalAudioPlayer';
import { getLocalAudioElement } from '../src/player/runtime';
import { saveTracks } from '../src/library/database';
import { saveLyrics, readLyrics } from '../src/lyrics/repository';
import { serializeLyrics } from '../src/lyrics/serialize';
import { parseLyrics, LYRICS_PARSER_VERSION } from '../src/lyrics/parse';
import { defaultLyricsAppearance } from '../src/lyrics/appearance';
import { MiniLyrics } from '../src/components/Lyrics/MiniLyrics';
import { StudioLivePreview } from '../src/components/Studio/StudioLivePreview';
import { importProjectTtml } from '../src/studio/projectImport';
import { importProjectLrc } from '../src/studio/projectImportLrc';
import { readStudioDraft, saveStudioDraft, studioSourceBackups } from '../src/studio/repository';
import { resolveAmll } from '../src/lyrics/amll';
import { translateLyrics } from '../src/lyrics/translate';
import { diagnosticLog, diagnosticText, initializeDiagnostics, setDebugMode } from '../src/desktop/diagnostics';
import type { LocalTrack } from '../src/library/importFiles';
import type { LyricDocument, SavedLyrics } from '../src/lyrics/types';
import '../src/index.css';
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
let renderer: ReturnType<typeof createRoot> | undefined, time = 96;
const track: LocalTrack = { id: 'polish', name: 'Regression song', artist: 'Alice', album: 'Test album', size: 4, lastModified: 1,
  fileName: 'regression.wav', duration: 210, embeddedLyricsChecked: true, unavailable: true } as LocalTrack;
const document: LyricDocument = { format: 'ttml', timing: 'word', agents: { A: 'Alice', B: 'Bob' }, notices: [], lines: Array.from({ length: 45 }, (_, i) => {
  const start = i * 4 + (i >= 20 ? 10 : 0) + 4;
  return { id: `line-${i}`, groupId: `line-${i}`, start, end: start + 3, agent: i >= 21 ? 'B' : 'A', role: 'lead',
    parts: [{ text: `Line ${i} · `, start, end: start + 1 }, { text: '星', start: start + 1, end: start + 1.1 }, { text: '光', start: start + 1.1, end: start + 3 }],
    annotations: [{ text: `译文 ${i} 风起时 你仍在`, kind: 'translation', language: 'zh-CN' }, { text: 'xing guang', kind: 'romanization' }] };
}) };
const saved: SavedLyrics = { trackId: track.id, fileName: 'current-amll.ttml', source: serializeLyrics(document, 210, track), document,
  parserVersion: LYRICS_PARSER_VERSION, savedAt: 100, origin: 'amll' };
function root() { renderer ||= createRoot(window.document.getElementById('root')!); return renderer; }
function clock() {
  Object.defineProperties(getLocalAudioElement(), { currentTime: { configurable: true, get: () => time, set: value => { time = value; } }, duration: { configurable: true, get: () => 210 } });
  store.dispatch(playerActions.update({ ...initialPlaybackState, currentId: track.id, duration: 210, currentTime: time }));
}
export function setClock(value: number) { time = value; getLocalAudioElement().dispatchEvent(new Event('timeupdate')); }
export async function seed() {
  await saveTracks([{ track, audio: new Blob(['test']) }]); await saveLyrics(saved);
  store.dispatch(libraryActions.restore({ tracks: [track], playlists: [] })); store.dispatch(libraryActions.setBusy(''));
  store.dispatch(libraryActions.selectTrack(track.id));
  store.dispatch(uiActions.setLyricsAppearance({ ...defaultLyricsAppearance })); clock();
}
export function mountApp(path = '/lyrics') {
  if (renderer) { renderer.unmount(); renderer = undefined; }
  window.history.replaceState({}, '', path); root().render(<App />);
}
export function appearance(patch: object) { store.dispatch(uiActions.setLyricsAppearance({ ...store.getState().ui.lyricsAppearance, ...patch })); }
export function fullscreen(value: boolean) { store.dispatch(uiActions.setLyricsFullscreen(value)); }
export function settings(value: boolean) { store.dispatch(uiActions.setSettingsOpen(value)); }
export function mountMini() { root().render(<Provider store={store}><MemoryRouter><div className='offline-app' style={{ width: 400, height: 720 }}><MiniLyrics track={track} /></div></MemoryRouter></Provider>); }
export function mountPreview() {
  const project = importProjectTtml(saved.source, track.id, saved.fileName);
  root().render(<Provider store={store}><div className='offline-app studio-page' style={{ height: 800, width: 1100 }}><StudioLivePreview project={project} durationMs={210000} enabled /></div></Provider>);
}
export async function seedOldDraft() { const project = importProjectLrc('[00:01.00]OLD DRAFT MUST SURVIVE', track.id, track.fileName!); await saveStudioDraft(project); }
export async function studioState() { return { current: await readStudioDraft(track.id), backups: await studioSourceBackups(track.id) }; }
export async function translationScenario() {
  const original = window.fetch; let request: any;
  window.fetch = async (_input, init) => { request = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ lines: [{ id: 'L1', text: '风起， 你仍在, 梦里' }] }) } }] }), { status: 200 }); };
  try {
    const document: LyricDocument = { ...saved.document, lines: [saved.document.lines[0]] };
    const before = JSON.stringify(document);
    const result = await translateLyrics(document, { apiKey: 'sk-test-only-never-real', model: 'deepseek-flash', language: 'auto' }, 'zh-CN', new AbortController().signal, () => {});
    assert(JSON.stringify(document) === before, 'translation changed source or times');
    assert(result.lines[0].annotations.find(a => a.kind === 'translation')?.text === '风起 你仍在 梦里', 'comma normalization failed');
    assert(result.lines[0].annotations.some(a => a.kind === 'romanization'), 'romanization was removed');
    assert(request.messages[0].content.includes('literary') && request.messages[0].content.includes('untrusted'), 'translation prompt missing guardrails');
    return { faithfulPrompt: true, punctuation: true, sourceUnchanged: true };
  } finally { window.fetch = original; }
}
let scenarioNumber = 0;
export async function amllScenario(kind: 'api' | 'repository' | 'concurrent' | 'ambiguous' | 'mismatch' | 'existing' | 'offline') {
  const original = window.fetch, calls: string[] = [], status: string[] = [];
  const local = { ...track, id: `amll-${++scenarioNumber}`, name: 'Example', artist: 'A / B', unavailable: false };
  const lyrics = { ...saved, trackId: local.id, fileName: 'local.lrc', source: '[00:01]Local', document: parseLyrics('[00:01]Local', 'local.lrc'), origin: 'file' as const };
  await saveTracks([{ track: local, audio: new Blob(['test']) }]); await saveLyrics(kind === 'existing' ? { ...saved, trackId: local.id } : lyrics);
  const entry = { id: 123, filename: '1768754400682-123-abc.ttml', musicNames: ['Example'], artistNames: ['B', 'A'], ncmMusicIds: ['123'], format: 'ttml', lyrics: saved.source };
  window.fetch = async input => {
    const url = String(input); calls.push(url);
    if (kind === 'offline') throw new TypeError('Network unavailable');
    if (url.includes('api.amll.dev')) {
      if (kind === 'repository' || kind === 'concurrent') return new Response('', { status: 503 });
      if (url.includes('/search')) {
        const query = new URL(url).searchParams;
        return Response.json({ status: 200, data: { items: query.has('artistName') ? [] : kind === 'ambiguous' ? [entry, { ...entry, id: 456, ncmMusicIds: ['456'] }] : [entry], pagination: { hasMore: false } } });
      }
      return Response.json({ status: 200, data: kind === 'mismatch' ? { ...entry, musicNames: ['Wrong song'] } : entry });
    }
    if (url.endsWith('.jsonl')) return new Response(JSON.stringify({ rawLyricFile: entry.filename, metadata: [['musicName', ['Example']], ['artists', ['B', 'A']], ['ncmMusicId', ['123']]] }));
    if (url.includes('/raw-lyrics/')) {
      if (kind === 'concurrent') await saveLyrics({ ...saved, trackId: local.id, source: saved.source.replace('Line 0', 'USER EDIT'), savedAt: Date.now(), fileName: 'user-import.ttml', origin: 'file' });
      return new Response(saved.source);
    }
    throw new Error('Unexpected network request: ' + url);
  };
  let failure = '';
  try { await resolveAmll(local, new AbortController().signal, text => status.push(text)); } catch (error) { failure = (error as Error).message; }
  finally { window.fetch = original; }
  const result = await readLyrics(local.id);
  if (kind === 'api' || kind === 'repository') assert(result?.origin === 'amll' && result.source === saved.source, 'matching lyrics not downloaded');
  if (kind === 'api') assert(calls.filter(url => url.includes('/search')).length === 2, 'title-only retry was not used');
  if (kind === 'repository') assert(calls.some(url => url.includes('/raw-lyrics/')), 'official repository not consulted');
  if (kind === 'concurrent') assert(result?.fileName === 'user-import.ttml' && !!failure, 'a late download overwrote newer user lyrics');
  if (kind === 'ambiguous') assert(result?.fileName === 'local.lrc' && status.some(value => value.includes('multiple recording')), 'ambiguous recording was selected');
  if (kind === 'mismatch') assert(result?.fileName === 'local.lrc' && failure.includes('mismatched'), 'mismatched recording was saved');
  if (kind === 'existing') assert(!calls.length, 'existing TTML was replaced');
  if (kind === 'offline') assert(result?.fileName === 'local.lrc' && !!failure, 'offline failure lost local lyrics');
  return { kind, requests: calls.length, preservedOrDownloaded: true, failure };
}
export async function diagnosticsScenario() {
  await initializeDiagnostics(); await setDebugMode(false); diagnosticLog('debug', 'test', 'SECRET_DEBUG_OFF');
  await setDebugMode(true); diagnosticLog('debug', 'test', 'Debug active Bearer abc123 sk-123456789abcdef');
  const text = await diagnosticText();
  assert(!text.includes('SECRET_DEBUG_OFF') && !text.includes('abc123') && !text.includes('sk-123456789abcdef') && text.includes('Debug active'), 'debug filtering/redaction failed');
  await setDebugMode(false); return { debugToggle: true, redaction: true, export: true };
}
export async function startPulse() {
  // Music-reactive fullscreen background was removed; keep a lightweight guard
  // so older regression scripts fail loudly instead of silently passing.
  return false;
}
export function pausePulse() { getLocalAudioElement().pause(); }
