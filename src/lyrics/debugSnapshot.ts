import type { SavedLyrics, LyricLine } from './types.ts';
import { lyricFrame, lineEnd } from './timeline.ts';
import { vocalLayout } from './vocalLayout.ts';
import { interludeBefore } from './interludes.ts';
import { interludePresentation } from './interludeProgress.ts';
const layouts = new WeakMap<object, ReturnType<typeof vocalLayout>>();
const gaps = new WeakMap<object, ReturnType<typeof interludeBefore>>();
export function lyricDebugSnapshot(saved: SavedLyrics | undefined, playbackTime: number, duration: number,
  appearance: { performerAlignment: boolean; wordByWord: boolean; showTranslations?: boolean }) {
  if (!saved) return { source: 'None', playbackTime, status: 'No saved lyrics' };
  const document = saved.document, offset = (saved.offsetMs || 0) / 1000, time = playbackTime - offset;
  duration -= offset;
  if (!layouts.has(document)) layouts.set(document, vocalLayout(document.lines));
  if (!gaps.has(document)) gaps.set(document, interludeBefore(document));
  const layout = layouts.get(document)!, frame = lyricFrame(document, time, duration), focus = document.lines.findIndex(line => line.id === frame.focusId);
  const lineInfo = (line: LyricLine) => ({ id: line.id, groupId: line.groupId, text: line.parts.map(part => part.text).join(''), start: line.start, end: lineEnd(line, duration),
    performerId: line.agent ?? null, vocal: line.role === 'background' ? 'Background Vocal' : 'Main',
    layout: appearance.performerAlignment ? layout.get(line.id) : { side: 'left', split: false },
    wordTimestamps: line.parts.slice(0, 200), wordCount: line.parts.length,
    currentWords: line.parts.map((part, index) => ({ ...part, index })).filter(part => part.start !== undefined && part.end !== undefined && time >= part.start && time < part.end),
    translation: { visible: appearance.showTranslations !== false, annotations: line.annotations.filter(annotation => annotation.kind === 'translation') } });
  const active = document.lines.filter(line => frame.activeIds.has(line.id));
  const gap = !active.length ? [...gaps.get(document)!].find(([, gap]) => time >= gap.start && time < gap.end) : undefined;
  return { trackId: saved.trackId, source: saved.origin === 'amll' ? 'AMLL TTML' : saved.origin === 'embedded' ? 'Embedded' : document.format === 'ttml' ? 'Local TTML' : 'LRC',
    fileName: saved.fileName, parserVersion: saved.parserVersion, playbackTime, lyricTime: time, offsetMs: saved.offsetMs || 0,
    format: document.format, timing: document.timing, totalLines: document.lines.length, agents: document.agents,
    previous: focus > 0 ? lineInfo(document.lines[focus - 1]) : null, current: focus >= 0 ? lineInfo(document.lines[focus]) : null,
    next: focus >= 0 && focus + 1 < document.lines.length ? lineInfo(document.lines[focus + 1]) : null,
    activeLines: active.slice(0, 16).map(lineInfo), activeCount: active.length,
    overlap: { active: active.length > 1, lines: active.map(line => line.id), duplicateStart: new Set(active.map(line => line.start)).size < active.length, performers: [...new Set(active.map(line => line.agent ?? 'unassigned'))] },
    interlude: gap ? { id: gap[0], ...gap[1], ...interludePresentation(gap[1].start, gap[1].end, time) } : { phase: 'none' },
    translation: { visible: appearance.showTranslations !== false, available: document.lines.some(line => line.annotations.some(a => a.kind === 'translation')) },
    wordByWord: appearance.wordByWord, performerAlignment: appearance.performerAlignment };
}
