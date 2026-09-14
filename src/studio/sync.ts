import type { StudioProject, Millis } from './project.ts';
export const LYRIC_START = 'studio:lyric-start', LYRIC_END = 'studio:lyric-end';
export const syncOrder = (p: StudioProject) => [...p.lines.filter(l => l.role === 'lead').map(l => l.id), LYRIC_END];
export function setBoundary(p: StudioProject, id: string, value: Millis): StudioProject {
  return { ...p, boundaries: { startMs: p.boundaries?.startMs ?? null, endMs: p.boundaries?.endMs ?? null, [id === LYRIC_START ? 'startMs' : 'endMs']: value } };
}
export function clearSync(p: StudioProject, id?: string): StudioProject {
  const boundary = id === LYRIC_START || id === LYRIC_END;
  return { ...p, boundaries: !id ? { startMs: null, endMs: null } : boundary ? setBoundary(p, id!, null).boundaries : p.boundaries,
    selectedId: id || LYRIC_START,
    sections: id ? p.sections : p.sections.map(s => ({ ...s, startMs: null, endMs: null })),
    lines: p.lines.map(l => !id || l.id === id || l.parentId === id ? { ...l, startMs: null, endMs: null, units: l.units.map(w => ({ ...w, startMs: null, endMs: null })) } : l) };
}
export function syncDestination(p: StudioProject, direction: -1 | 1): string {
  // LYRIC_START is only an internal before-first cursor for a cleared draft.
  // The pressed time belongs to the destination row, never the row being left.
  const current = p.lines.find(l => l.id === p.selectedId);
  const order = current?.role === 'background' ? p.lines.filter(l => l.parentId === current.parentId).map(l => l.id) : syncOrder(p);
  const at = order.indexOf(p.selectedId);
  return order[Math.max(0, Math.min(at + direction, order.length - 1))];
}
export function markSync(p: StudioProject, time: number, direction: -1 | 1): StudioProject {
  if (!Number.isSafeInteger(time) || time < 0) return p;
  const selectedId = syncDestination(p, direction);
  if (selectedId === LYRIC_END) return { ...setBoundary(p, selectedId, time), selectedId };
  const line = p.lines.find(l => l.id === selectedId); if (!line?.text.trim()) return p;
  return { ...p, selectedId, lines: p.lines.map(l => l.id === line.id ? { ...l, startMs: time } : l) };
}
