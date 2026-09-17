import type { ReactNode } from 'react';
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
function shorten(value: unknown, max = 72) {
  const source = text(value);
  return source.length > max ? `${source.slice(0, max - 1)}…` : source;
}
function compactRecord(value: unknown) {
  const entries = Object.entries(record(value)).filter(([, item]) => ['string', 'number', 'boolean'].includes(typeof item)).slice(0, 3);
  return entries.length ? entries.map(([key, item]) => `${key}=${text(item)}`).join(' · ') : '—';
}

function DebugValue({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return <><dt>{label}</dt><dd className={wide ? 'debug-overlay-wide' : undefined} title={value}>{value}</dd></>;
}
function DebugCard({ title, className, children }: { title: string; className: string; children: ReactNode }) {
  return <aside className={`debug-overlay ${className}`} aria-label={`${title} debug overlay`}>
    <header><strong>{title}</strong><span>LIVE</span></header><dl>{children}</dl>
  </aside>;
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
  const lineRange = current.id ? `${text(current.id)} · ${seconds(current.start)}–${seconds(current.end)}` : '—';
  const api = latestStep.stage ? `${text(latestStep.stage)}${latestStep.status ? ` · ${text(latestStep.status)}` : ''}` : compactRecord(ttml);
  const follow = rendered.following ? `${text(rendered.following)} · scroll ${Math.round(number(rendered.scrollTop) || 0)}px` : '—';
  return <DebugCard title='LYRICS' className='debug-overlay-lyrics'>
    <DebugValue label='Source' value={`${text(lyrics.source)} · ${text(lyrics.format)}`} />
    <DebugValue label='Clock' value={`${seconds(lyrics.lyricTime)} / ${seconds(lyrics.playbackTime)} · offset ${text(lyrics.offsetMs, '0')}ms`} />
    <DebugValue label='Line' value={lineRange} />
    <DebugValue label='Text' value={shorten(current.text)} wide />
    <DebugValue label='Word' value={shorten(words)} wide />
    <DebugValue label='Active' value={`${text(lyrics.activeCount, '0')} · overlap ${text(overlap.active, 'false')}`} />
    <DebugValue label='Follow' value={follow} />
    <DebugValue label='TTML/API' value={shorten(api)} wide />
  </DebugCard>;
}

export function AudioDebugOverlay() {
  const { debug } = useDiagnostics();
  const snapshot = useDebugSnapshot();
  if (!debug) return null;
  const audio = record(snapshot.sections.audio), pipeline = record(audio.pipeline), output = record(audio.output), context = record(audio.audioContext);
  const state = `${pipeline.paused === true ? 'paused' : 'playing'} · ready ${text(pipeline.readyState)} · net ${text(pipeline.networkState)}`;
  const outputName = text(output.deviceLabel, text(output.device));
  const contextState = text(context.state, text(context.contextState, compactRecord(context)));
  return <DebugCard title='AUDIO' className='debug-overlay-audio'>
    <DebugValue label='Backend' value={text(pipeline.backend)} />
    <DebugValue label='Clock' value={`${seconds(pipeline.currentTime)} / ${seconds(pipeline.duration)}`} />
    <DebugValue label='State' value={state} />
    <DebugValue label='Output' value={`${outputName}${output.exclusive === true ? ' · exclusive' : ''}`} />
    <DebugValue label='Context' value={shorten(contextState)} />
    {pipeline.error ? <DebugValue label='Error' value={shorten(compactRecord(pipeline.error))} wide /> : null}
  </DebugCard>;
}

export function GlobalDebugOverlay() {
  const { debug } = useDiagnostics();
  const snapshot = useDebugSnapshot();
  if (!debug) return null;
  const metrics = record(snapshot.metrics), heap = record(metrics.rendererHeap);
  const desktop = record(snapshot.desktop), desktopLogs = list(record(desktop.logs).recent).map(record);
  const logs = [...recentDiagnosticLogs(), ...desktopLogs];
  const warnings = logs.filter(entry => entry.level === 'warn').length, errors = logs.filter(entry => entry.level === 'error').length;
  return <DebugCard title='DEBUG' className='debug-overlay-global'>
    <DebugValue label='FPS' value={text(metrics.fps)} />
    <DebugValue label='Heap' value={bytes(heap.usedBytes)} />
    <DebugValue label='Switch' value={metrics.songSwitchMs === undefined ? '—' : `${text(metrics.songSwitchMs)}ms`} />
    <DebugValue label='Logs' value={`${bytes(snapshot.retainedBytes)} · dropped ${snapshot.dropped}`} />
    <DebugValue label='Warn/Error' value={`${warnings} / ${errors}`} />
  </DebugCard>;
}
