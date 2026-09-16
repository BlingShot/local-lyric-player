// Browser-only regression harness. Not shipped by the application entry point.
import { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { store } from '../src/store/store';
import { uiActions } from '../src/store/slices/offlineUi';
import { playerActions } from '../src/store/slices/player';
import { initialPlaybackState, LocalAudioPlayer } from '../src/player/LocalAudioPlayer';
import { getLocalAudioElement } from '../src/player/runtime';
import { attachNativeAudio, configureNativeOutput } from '../src/player/nativeAudio';
import { LyricsView } from '../src/components/Lyrics/LyricsView';
import { StudioLivePreview } from '../src/components/Studio/StudioLivePreview';
import { newProject, vocalLine } from '../src/studio/project';
import { importProjectTtml } from '../src/studio/projectImport';
import { exportProjectTtml, NS } from '../src/studio/projectExport';
import { validateProject } from '../src/studio/validation';
import { assertProjectIdentity } from '../src/studio/importIds';
import type { LyricDocument } from '../src/lyrics/types';
import '../src/index.css';
import '../src/styles/lyrics.scss';
import '../src/styles/studio.scss';
import '../src/styles/mini-lyrics.scss';
import '../src/styles/v08.css';
export * from '../src/library/database';
const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };

export function ttmlRoundtrip(marked: boolean) {
  const source = `<tt xmlns="${NS.tt}" xmlns:ttm="${NS.meta}" xmlns:itunes="${NS.apple}" xmlns:amll="${NS.amll}" itunes:timing="Word"><head><metadata>
    ${marked ? '<amll:meta key="localMusic:idEncoding" value="utf8-hex-v1"/>' : ''}
    <ttm:agent xml:id="v1"><ttm:name>A</ttm:name></ttm:agent><ttm:agent xml:id="v2"><ttm:name>B</ttm:name></ttm:agent>
    </metadata></head><body><div xml:id="chorus" itunes:song-part="Chorus"><p xml:id="a" begin="0s" end="4s" ttm:agent="v1">
    <span xml:id="one" begin="0s" end="1s">One</span><span xml:id="id_61" begin="1s" end="2s" ttm:agent="v2">Two</span><span xml:id="id_FF" begin="2s" end="3s">Three</span>
    <span xml:id="translation" ttm:role="x-translation">翻译</span><span xml:id="backing" ttm:role="x-bg" begin="1s" end="3s" ttm:agent="v2"><span xml:id="backing-word" begin="1s" end="3s">Ooh</span></span>
    </p></div></body></tt>`;
  const project = importProjectTtml(source, 'fixture', 'fixture.ttml');
  assertProjectIdentity(project);
  const errors = validateProject(project, 10000, 'word').filter(issue => issue.severity === 'error');
  check(!errors.length, JSON.stringify(errors));
  const word = project.lines.flatMap(line => line.units).find(w => w.text === 'Two')!;
  check(marked ? word.id !== 'a' : word.id === 'id_61', 'external IDs must not collapse');
  const split = project.lines.find(line => line.units.includes(word))!;
  check(split.id !== word.id && split.performerId === 'v2', 'split line must have its own identity and performer');
  check(project.lines.flatMap(line => line.units).some(w => w.id === 'id_FF'), 'malformed UTF-8 identity changed');
  const encoded = exportProjectTtml(project, 10000, 'word');
  const again = importProjectTtml(encoded, 'fixture', 'roundtrip.ttml');
  assertProjectIdentity(again);
  const signature = (p: typeof project) => JSON.stringify(p.lines.map(l => ({ id: l.id, parent: l.parentId,
    text: l.text, performer: l.performerId, units: l.units.filter(w => w.kind === 'word'), annotations: l.annotations })).sort((a, b) => a.id.localeCompare(b.id)));
  check(signature(project) === signature(again), 'TTML export/reimport changed identities or content');
  check(JSON.stringify(project.sections) === JSON.stringify(again.sections), 'section references changed');
  return { lines: project.lines.length, distinctWord: word.id, distinctLine: split.id };
}

let renderer: ReturnType<typeof createRoot> | undefined, clock = 0;
export function renderGeometry(mode: 'main' | 'sidebar' | 'fullscreen', chain = false, alignment = true, extended = false) {
  const audio = getLocalAudioElement();
  Object.defineProperties(audio, { currentTime: { configurable: true, get: () => clock }, duration: { configurable: true, get: () => 20 } });
  store.dispatch(playerActions.update({ ...initialPlaybackState, currentId: 'geometry', duration: 20 }));
  store.dispatch(uiActions.setLyricsAppearance({ ...store.getState().ui.lyricsAppearance, performerAlignment: alignment }));
  const specs: [string, string, number, number][] = chain ? [['a1', 'A', 1, 4], ['b', 'B', 3, 6], ['a2', 'A', 5, 8]] : [['a', 'A', 1, 4], ['b', 'B', 2, 6]];
  if (extended) specs.push(['solo-b', 'B', 9, 10], ['b-later', 'B', 11, 14], ['a-later', 'A', 12, 15]);
  const document: LyricDocument = { format: 'ttml', timing: 'word', agents: { A: 'Alice', B: 'Bob' }, notices: [],
    lines: specs.map(([id, agent, start, end]) => ({ id, groupId: id, agent, start, end, role: 'lead',
      parts: [{ text: `${id} phrase stays in its lane`, start, end }], annotations: [{ text: 'Translation', kind: 'translation' }] })) };
  const project = newProject('geometry', 'geometry.wav');
  project.performers = ['A', 'B'].map(id => ({ id, name: id, type: 'person', color: '#fff', align: 'auto' }));
  project.lines = specs.map(([id, agent, start, end]) => {
    const line = vocalLine(`${id} phrase`); line.id = id; line.performerId = agent; line.startMs = start * 1000; line.endMs = end * 1000;
    return line;
  });
  const width = mode === 'sidebar' ? 400 : mode === 'main' ? 1000 : 1440;
  renderer ||= createRoot(window.document.getElementById('root')!);
  renderer.render(h(Provider, { store, children: h('div', { className: 'offline-app', 'data-lyrics-fullscreen': mode === 'fullscreen' || undefined, style: { width, '--lyrics-font-max': '30px' } },
    h('div', { className: mode === 'sidebar' ? 'lyrics-page mini-lyrics' : 'lyrics-page', style: { height: 720 } }, h(LyricsView, { document, trackId: 'geometry', entranceKey: mode })),
    h('div', { style: { height: 700 } }, h(StudioLivePreview, { project, durationMs: 20000, enabled: true }))) }));
}
export function setClock(time: number) { clock = time; getLocalAudioElement().dispatchEvent(new Event('timeupdate')); }

export async function repeatNativePlay() {
  const listeners = new Set<(state: any) => void>();
  let state: any = { id: '', time: 0, duration: 20, paused: true, ready: false, ended: false }, playCalls = 0;
  const send = () => listeners.forEach(listener => listener({ ...state }));
  window.localMusicDesktop = {
    nativeAudioLoad: async (value: any) => { state = { ...state, id: value.id, ready: true, paused: true }; send(); },
    nativeAudioCommand: async (command: string) => {
      if (command === 'play') { playCalls++; state.paused = false; }
      if (command === 'pause') state.paused = true;
      if (command === 'stop') { state.ready = false; state.paused = true; }
      send();
    }, onNativeAudioState: (listener: (state: any) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
  } as any;
  const audio = new Audio(); attachNativeAudio(audio, () => new Blob(['audio']));
  await configureNativeOutput({ device: 'auto', exclusive: false });
  const failures: string[] = [];
  const player = new LocalAudioPlayer(audio, { loadTimeoutMs: 25, onChange: () => {}, onDuration: () => {}, onSelect: () => {},
    onFailure: id => failures.push(id), revokeUrl: () => {} });
  try {
    player.addTracks([{ id: 'native', url: 'blob:native' }]); player.play('native');
    await new Promise(resolve => setTimeout(resolve, 10));
    check(player.getState().status === 'playing', 'native first play failed');
    const before = playCalls;
    for (let i = 0; i < 5; i++) player.play('native');
    await new Promise(resolve => setTimeout(resolve, 80));
    check(playCalls === before && player.getState().status === 'playing' && !failures.length, 'native repeated play restarted or timed out');
    return { playCalls, failures };
  } finally { player.dispose(); }
}
