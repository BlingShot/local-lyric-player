import { recentDiagnosticLogs, useDebugSnapshot, useDiagnostics } from '../../desktop/diagnostics';
import './debug-overlays.css';

type DebugRecord = Record<string, unknown>;

function record(value: unknown): DebugRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as DebugRecord : {};
}
function list(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function text(value: unknown, fallback = '—') {
  if (typeof value === 'string' && value.length) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return fallback;
}
function number(value: unknown) { return typeof value === 'number' && Number.isFinite(value) ? value : undefined; }
function seconds(value: unknown) { const n = number(value); return n === undefined ? '—' : `${n.toFixed(3)}s`; }
function bytes(value: unknown) {
  const n = number(value); if (n === undefined) return '—';
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${Math.round(n)} B`;
}
function percentage(used: unknown, total: unknown) {
  const current = number(used), limit = number(total);
  if (current === undefined || limit === undefined || limit <= 0) return '—';
  const value = current / limit * 100;
  return `${value < 10 ? value.toFixed(1) : value.toFixed(0)}%`;
}
function shorten(value: unknown, max = 72) {
  const source = text(value);
  return source.length > max ? `${source.slice(0, max - 1)}…` : source;
}
function compactRecord(value: unknown) {
  const entries = Object.entries(record(value)).filter(([, item]) => ['string', 'number', 'boolean'].includes(typeof item)).slice(0, 3);
  return entries.length ? entries.map(([key, item]) => `${key}=${text(item)}`).join(' · ') : '—';
}
function bitrate(value: unknown) {
  const n = number(value);
  if (n === undefined || n <= 0) return '—';
  return `${Math.round(n / 1000)} kbps`;
}

function DebugField({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return <span className={`debug-readout-field${wide ? ' debug-readout-wide' : ''}`} title={`${label}: ${value}`}>
    <span className='debug-readout-label'>{label}</span><span className='debug-readout-value'>{value}</span>
  </span>;
}

export function LyricsDebugOverlay() {
  const { debug } = useDiagnostics();
  const snapshot = useDebugSnapshot();
  if (!debug) return null;
  const lyrics = record(snapshot.sections.lyrics), current = record(lyrics.current), overlap = record(lyrics.overlap);
  const rendered = record(list(lyrics.rendered)[0]);
  const currentWords = list(current.currentWords).map(item => record(item));
  const words = currentWords.length ? currentWords.slice(0, 6).map(word => text(word.text, `#${text(word.index)}`)).join(' ') : '—';
  const ttml = record(snapshot.sections.ttml), steps = list(ttml.steps), latestStep = record(steps[steps.length - 1]);
  const latestLyricTrace = recentDiagnosticLogs().filter(entry => /amll|ttml|lyrics?\.(?:remote|resolver|fetch|api)/i.test(entry.scope)).slice(-1)[0];
  const lineRange = current.id ? `${text(current.id)} · ${seconds(current.start)}–${seconds(current.end)}` : '—';
  const api = latestStep.stage
    ? `${text(latestStep.stage)}${latestStep.status ? ` · ${text(latestStep.status)}` : ''}`
    : latestLyricTrace ? `${latestLyricTrace.scope} · ${latestLyricTrace.message}` : compactRecord(ttml);
  const follow = rendered.following ? `${text(rendered.following)} · ${Math.round(number(rendered.scrollTop) || 0)}px` : '—';
  return <aside className='debug-overlay debug-overlay-lyrics' aria-label='Lyrics debug readout'>
    <DebugField label='Source' value={`${text(lyrics.source)} · ${text(lyrics.format)}`} wide />
    <DebugField label='Clock' value={`${seconds(lyrics.lyricTime)} / ${seconds(lyrics.playbackTime)} · offset ${text(lyrics.offsetMs, '0')}ms`} wide />
    <DebugField label='Line' value={lineRange} wide />
    <DebugField label='Text / Word' value={`${shorten(current.text, 44)} / ${shorten(words, 36)}`} wide />
    <DebugField label='Active' value={`${text(lyrics.activeCount, '0')} · overlap ${text(overlap.active, 'false')}`} wide />
    <DebugField label='Follow' value={follow} wide />
    <DebugField label='TTML/API' value={shorten(api, 58)} wide />
  </aside>;
}

export function AudioDebugOverlay() {
  const { debug } = useDiagnostics();
  const snapshot = useDebugSnapshot();
  if (!debug) return null;
  const audio = record(snapshot.sections.audio), pipeline = record(audio.pipeline), output = record(audio.output), context = record(audio.audioContext);
  const state = `${pipeline.paused === true ? 'paused' : 'playing'} · ready ${text(pipeline.readyState)} · net ${text(pipeline.networkState)}`;
  const outputName = text(output.deviceLabel, text(output.device));
  const contextState = text(context.state, text(context.contextState, compactRecord(context)));
  return <aside className='debug-overlay debug-overlay-audio' aria-label='Audio debug readout'>
    <div className='debug-readout-row'>
      <DebugField label='Audio Clock' value={`${seconds(pipeline.currentTime)} / ${seconds(pipeline.duration)}`} />
      <DebugField label='State' value={state} />
      <DebugField label='Output' value={`${outputName}${output.exclusive === true ? ' · exclusive' : ''}`} />
      <DebugField label='Live bitrate' value={bitrate(pipeline.realtimeBitrate)} />
    </div>
    <div className='debug-readout-row debug-readout-secondary'>
      <DebugField label='Backend' value={text(pipeline.backend)} />
      <DebugField label='Context' value={shorten(contextState, 48)} />
      {pipeline.error ? <DebugField label='Error' value={shorten(compactRecord(pipeline.error), 52)} /> : null}
    </div>
  </aside>;
}

export function GlobalDebugOverlay() {
  const { debug } = useDiagnostics();
  const snapshot = useDebugSnapshot();
  if (!debug) return null;
  const metrics = record(snapshot.metrics), heap = record(metrics.rendererHeap);
  const desktop = record(snapshot.desktop), desktopLogs = list(record(desktop.logs).recent).map(record);
  const logs = [...recentDiagnosticLogs(), ...desktopLogs];
  const warnings = logs.filter(entry => entry.level === 'warn').length, errors = logs.filter(entry => entry.level === 'error').length;
  const memory = `${bytes(heap.usedBytes)} · ${percentage(heap.usedBytes, heap.limitBytes)} heap`;
  return <aside className='debug-overlay debug-overlay-global' aria-label='Global debug readout'>
    <div className='debug-readout-row'>
      <DebugField label='Memory' value={memory} />
      <DebugField label='FPS' value={text(metrics.fps)} />
      <DebugField label='Warn/Error' value={`${warnings} / ${errors}`} />
      <DebugField label='Switch' value={metrics.songSwitchMs === undefined ? '—' : `${text(metrics.songSwitchMs)}ms`} />
      <DebugField label='Logs' value={`${bytes(snapshot.retainedBytes)} · dropped ${snapshot.dropped}`} />
    </div>
  </aside>;
}
