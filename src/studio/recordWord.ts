import type { Millis, StudioProject, VocalLine } from './project.ts';
import { adjacentVoiceWord } from './recordingVoices.ts';

/** Direct timing edits extend an existing envelope so the edited word stays visible. */
export function editWordTime(line: VocalLine, id: string, values: { startMs?: Millis; endMs?: Millis }): VocalLine {
  const units = line.units.map(w => w.id === id ? { ...w, ...values } : w);
  const word = units.find(w => w.id === id);
  if (!word) return line;
  const valid = (value: Millis) => value !== null && Number.isSafeInteger(value) && value >= 0;
  return { ...line, units,
    startMs: line.startMs !== null && valid(word.startMs) ? Math.min(line.startMs, word.startMs!) : line.startMs,
    endMs: line.endMs !== null && valid(word.endMs) ? Math.max(line.endMs, word.endMs!) : line.endMs };
}

export function previousWord(p: StudioProject): StudioProject {
  const line = p.lines.find(l => l.id === p.selectedId); if (!line) return p;
  const word = line.units.find(w => w.id === p.selectedUnitId && w.kind === 'word') || line.units.find(w => w.kind === 'word');
  const previous = word && adjacentVoiceWord(p, line.id, word.id, -1);
  return previous ? { ...p, selectedId: previous.lineId, selectedUnitId: previous.unitId } : p;
}

/** Finish an actual media-time interval and move through the same voice. */
export function recordWord(p: StudioProject, lineId: string, unitId: string, startMs: number, endMs: number): StudioProject {
  const line = p.lines.find(l => l.id === lineId), at = line?.units.findIndex(w => w.id === unitId) ?? -1;
  if (!line || at < 0 || line.units[at].kind !== 'word' || !Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs) || startMs < 0 || endMs <= startMs) return p;
  const next = line.units.slice(at + 1).find(w => w.kind === 'word');
  const cursor = adjacentVoiceWord(p, lineId, unitId, 1);
  const units = line.units.map(w => w.id === unitId ? { ...w, startMs, endMs } : w);
  const timed = units.filter(w => w.kind === 'word' && w.startMs !== null && w.endMs !== null);
  // A re-recorded word cannot be clipped by an obsolete imported line envelope.
  const start = Math.min(startMs, ...timed.map(w => w.startMs!));
  const end = Math.max(endMs, ...timed.map(w => w.endMs!));
  return { ...p, selectedId: cursor?.lineId || lineId, selectedUnitId: cursor?.unitId || unitId,
    lines: p.lines.map(l => l.id !== lineId ? l : { ...l, units, startMs: l.startMs === null ? start : Math.min(l.startMs, start), endMs: !next ? end : l.endMs === null ? null : Math.max(l.endMs, end) }) };
}
