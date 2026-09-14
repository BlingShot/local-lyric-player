import type { Millis, StudioProject, VocalLine } from './project.ts';

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
  const words = line.units.filter(w => w.kind === 'word');
  const at = words.findIndex(w => w.id === p.selectedUnitId);
  if (at > 0) return { ...p, selectedUnitId: words[at - 1].id };
  const previous = p.lines.slice(0, p.lines.indexOf(line)).reverse().find(l => l.role === line.role && l.parentId === line.parentId && l.units.some(w => w.kind === 'word'));
  return previous ? { ...p, selectedId: previous.id, selectedUnitId: previous.units.filter(w => w.kind === 'word').at(-1)!.id } : p;
}

/** Finish an actual media-time interval and move through the same voice. */
export function recordWord(p: StudioProject, lineId: string, unitId: string, startMs: number, endMs: number): StudioProject {
  const line = p.lines.find(l => l.id === lineId), at = line?.units.findIndex(w => w.id === unitId) ?? -1;
  if (!line || at < 0 || line.units[at].kind !== 'word' || !Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs) || startMs < 0 || endMs <= startMs) return p;
  const next = line.units.slice(at + 1).find(w => w.kind === 'word');
  const following = p.lines.slice(p.lines.indexOf(line) + 1);
  const nextLine = next ? undefined : following.find(l => l.role === line.role && l.parentId === line.parentId && l.units.some(w => w.kind === 'word'))
    || (line.role === 'background' ? following.find(l => l.role === 'lead' && l.units.some(w => w.kind === 'word')) : undefined);
  const units = line.units.map(w => w.id === unitId ? { ...w, startMs, endMs } : w);
  const timed = units.filter(w => w.kind === 'word' && w.startMs !== null && w.endMs !== null);
  // A re-recorded word cannot be clipped by an obsolete imported line envelope.
  const start = Math.min(startMs, ...timed.map(w => w.startMs!));
  const end = Math.max(endMs, ...timed.map(w => w.endMs!));
  return { ...p, selectedId: nextLine?.id || lineId, selectedUnitId: next?.id || nextLine?.units.find(w => w.kind === 'word')?.id || unitId,
    lines: p.lines.map(l => l.id !== lineId ? l : { ...l, units, startMs: l.startMs === null ? start : Math.min(l.startMs, start), endMs: !next ? end : l.endMs === null ? null : Math.max(l.endMs, end) }) };
}
