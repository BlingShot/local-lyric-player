import { editText, vocalLine, type StudioProject, type VocalLine } from './project.ts';

export function deleteLine(p: StudioProject, id: string): StudioProject {
  const removed = new Set([id, ...p.lines.filter(l => l.parentId === id).map(l => l.id)]);
  const lines = p.lines.filter(l => !removed.has(l.id));
  return { ...p, lines, selectedId: lines[0]?.id || '', sections: p.sections.map(s => ({ ...s, lineIds: s.lineIds.filter(id => !removed.has(id)) })).filter(s => s.lineIds.length || s.tag === 'INSTRUMENTAL') };
}
export function splitLine(p: StudioProject, id: string, at: number): StudioProject {
  const row = p.lines.find(l => l.id === id); if (!row || p.lines.length >= 5000) return p;
  const first = editText(row, row.text.slice(0, at), p.settings.split), second = editText(row, row.text.slice(at), p.settings.split);
  const next: VocalLine = { ...second, id: vocalLine().id, annotations: [], startMs: null };
  first.endMs = null;
  return { ...p, lines: p.lines.flatMap(l => l.id === id ? [first, next] : [l]), selectedId: next.id,
    sections: p.sections.map(s => ({ ...s, lineIds: s.lineIds.flatMap(i => i === id ? [i, next.id] : [i]) })) };
}
export function mergeLine(p: StudioProject, id: string): StudioProject {
  const at = p.lines.findIndex(l => l.id === id), row = p.lines[at];
  const next = p.lines.slice(at + 1).find(l => l.role === row?.role && l.parentId === row?.parentId);
  if (!row || !next) return p;
  const combined = { ...row, text: row.text + next.text, units: [...row.units, ...next.units.map(w => ({ ...w, performerId: w.performerId || next.performerId }))], endMs: next.endMs,
    annotations: [...row.annotations, ...next.annotations.map(a => ({ ...a, targetId: row.id }))] };
  return { ...p, lines: p.lines.filter(l => l.id !== next.id).map(l => l.id === id ? combined : l.parentId === next.id ? { ...l, parentId: id } : l),
    sections: p.sections.map(s => ({ ...s, lineIds: s.lineIds.filter(i => i !== next.id) })).filter(s => s.lineIds.length || s.tag === 'INSTRUMENTAL') };
}
export function assignPerformer(p: StudioProject, ids: string[], performerId?: string, unitIds?: string[]): StudioProject {
  return { ...p, lines: p.lines.map(l => !ids.includes(l.id) ? l : unitIds ? { ...l, units: l.units.map(w => unitIds.includes(w.id) ? { ...w, performerId } : w) } : { ...l, performerId, units: l.units.map(w => ({ ...w, performerId: undefined })) }) };
}
