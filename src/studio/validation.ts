import { complete, type StudioProject, type VocalLine } from './project.ts';

export interface ProjectIssue { severity: 'error' | 'warning'; message: string; lineId?: string; unitId?: string; sectionId?: string; field?: 'text' | 'start' | 'end' }
export type TtmlMode = 'word' | 'line';
export function lineBounds(project: StudioProject, line: VocalLine, durationMs: number): { start: number | null; end: number | null } {
  const words = line.units.filter(w => w.kind === 'word');
  const ready = words.length > 0 && words.every(complete);
  const start = line.startMs ?? (ready ? Math.min(...words.map(w => w.startMs!)) : null);
  const next = project.lines.filter(l => l.role === line.role && l.parentId === line.parentId && l.performerId === line.performerId && l.startMs !== null && start !== null && l.startMs > start).map(l => l.startMs!);
  const end = line.endMs ?? (ready ? Math.max(...words.map(w => w.endMs!)) : next.length ? Math.min(...next) : project.boundaries?.endMs ?? (durationMs > 0 ? durationMs : null));
  return { start, end };
}
const invalidXml = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF\uD800-\uDFFF]/u;
export function validateProject(project: StudioProject, durationMs: number, mode: TtmlMode): ProjectIssue[] {
  const issues: ProjectIssue[] = [], ids = new Set<string>();
  const add = (message: string, context: Partial<ProjectIssue> = {}) => issues.push({ severity: 'error', message, ...context });
  const id = (value: string, context: Partial<ProjectIssue> = {}) => { if (!value || ids.has(value)) add(`Duplicate or empty ID: ${value}`, context); ids.add(value); };
  const text = (value: string, context: Partial<ProjectIssue> = {}) => { if (invalidXml.test(value)) add('Remove invalid XML characters.', context); };
  const range = (start: number | null, end: number | null, context: Partial<ProjectIssue>) => {
    if (start === null || !Number.isSafeInteger(start) || start < 0) add('Start time is pending or invalid.', { ...context, field: 'start' });
    if (end === null || !Number.isSafeInteger(end) || end < 0) add('End time is pending or invalid.', { ...context, field: 'end' });
    if (start !== null && end !== null && end <= start) add('End must be later than start.', { ...context, field: 'end' });
    if (durationMs > 0 && end !== null && end > durationMs) add('End exceeds the audio duration.', { ...context, field: 'end' });
  };
  const agents = new Set(project.performers.map(p => p.id));
  if (project.boundaries) {
    const { startMs, endMs } = project.boundaries;
    if (startMs !== null && (!Number.isSafeInteger(startMs) || startMs < 0)) add('Invalid imported lyric start.', { lineId: project.lines[0]?.id, field: 'start' });
    if (endMs === null || !Number.isSafeInteger(endMs) || endMs <= (startMs ?? -1) || durationMs > 0 && endMs > durationMs) add('Sync End of Lyric after the start and within the audio.', { lineId: 'studio:lyric-end', field: 'end' });
  }
  const agent = (value: string | undefined, context: Partial<ProjectIssue>) => { if (value && !agents.has(value)) add(`Performer reference is missing: ${value}`, context); };
  if (!project.lines.length && !project.sections.length) add('Add lyrics or an instrumental section.');
  if (project.lines.length > 5000) add('Use at most 5,000 lines.');
  project.performers.forEach(p => { id(p.id); text(p.name); if (!p.name.trim()) add('Give each Performer a display name.'); });
  Object.values(project.metadata).filter((v): v is string => typeof v === 'string').forEach(v => text(v));
  Object.entries(project.metadata.extra).forEach(([k, values]) => { text(k); values.forEach(v => text(v)); });
  project.lines.forEach((line, index) => {
    const context = { lineId: line.id }; id(line.id, context); text(line.text, context); agent(line.performerId, context);
    if (!line.text.trim()) add(`Line ${index + 1}: add text or remove the empty line.`, { ...context, field: 'text' });
    if (line.units.map(w => w.text).join('') !== line.text) add('Fragments no longer match original text.', context);
    if (/[\r\n]/.test(line.text)) add('Split embedded newlines into lyric rows.', context);
    if (line.role === 'background' && !project.lines.some(l => l.id === line.parentId && l.role === 'lead')) add('Background vocal has no valid lead parent.', context);
    const b = lineBounds(project, line, durationMs); range(b.start, b.end, context);
    if (project.boundaries?.startMs != null && b.start !== null && b.start < project.boundaries.startMs || project.boundaries?.endMs != null && b.end !== null && b.end > project.boundaries.endMs) add('Lyric line is outside Start / End of Lyric.', context);
    for (const w of line.units) {
      const wc = { ...context, unitId: w.id }; id(w.id, wc); text(w.text, wc); agent(w.performerId, wc);
      if (w.kind === 'word' && mode === 'word') {
        range(w.startMs, w.endMs, wc);
        if (w.startMs !== null && b.start !== null && w.startMs < b.start || w.endMs !== null && b.end !== null && w.endMs > b.end) add('Word time is outside its vocal line. Adjust the word or line bounds.', wc);
      }
    }
    line.annotations.forEach(a => { id(a.id, context); text(a.text, context); text(a.language, context); if (a.targetId !== line.id) add('Annotation has an invalid original-line reference.', context); });
    if (new Set(line.units.filter(w => w.kind === 'word').map(w => w.performerId || line.performerId || '')).size > 1) add('AMLL 1.0.1 cannot retain inline Performer switches. Use this player or explicitly split into Performer phrases.', { ...context, severity: 'warning' });
    if (line.role === 'background' && line.performerId !== project.lines.find(l => l.id === line.parentId)?.performerId) add('AMLL 1.0.1 does not retain an independent background Performer. This player preserves it; AMLL conversion makes it a separate vocal line.', { ...context, severity: 'warning' });
    if (line.role === 'lead' && project.lines.filter(l => l.parentId === line.id).length > 1) add('Multiple background layers are supported here; AMLL 1.0.1 needs separate vocal lines.', { ...context, severity: 'warning' });
    if (line.annotations.filter(a => a.kind === 'translation' && a.text).length > 1 || line.annotations.filter(a => a.kind === 'romanization' && a.text).length > 1) add('The AMLL renderer selects one translation and one romanization. This player and the project retain all imported annotations.', { ...context, severity: 'warning' });
    if (line.role === 'background') {
      const parent = project.lines.find(l => l.id === line.parentId);
      if (parent) { const parentBounds = lineBounds(project, parent, durationMs); if (b.start! < parentBounds.start! || b.end! > parentBounds.end!) add('This background extends beyond its lead voice. This player preserves both bounds; AMLL conversion uses a separate vocal line.', { ...context, severity: 'warning' }); }
      if (/^[（(]|[）)]$/.test(line.text)) add('AMLL removes surrounding background parentheses. The full text remains in this player and the project.', { ...context, severity: 'warning' });
    }
    if (/^\s|\s$| {2}|\t/.test(line.text)) add('AMLL 1.0.1 normalizes some whitespace. This player and the project file preserve it.', { ...context, severity: 'warning' });
  });
  const assigned = new Set<string>();
  project.sections.forEach(s => {
    const context = { sectionId: s.id, lineId: s.lineIds[0] }; id(s.id, context);
    const leadOrder = project.lines.filter(l => l.role === 'lead').map(l => l.id), positions = s.lineIds.map(id => leadOrder.indexOf(id));
    if (positions.some((position, i) => i > 0 && position !== positions[i - 1] + 1)) add('Select a contiguous lyric range for a section; export will not reorder your lyrics.', context);
    if (!s.lineIds.length || s.startMs !== null || s.endMs !== null) range(s.startMs, s.endMs, context);
    s.lineIds.forEach(lineId => {
      const line = project.lines.find(l => l.id === lineId && l.role === 'lead');
      if (!line || assigned.has(lineId)) add('Section has a missing or already assigned line.', { ...context, lineId });
      assigned.add(lineId);
      if (line) for (const voice of [line, ...project.lines.filter(l => l.parentId === line.id)]) { const b = lineBounds(project, voice, durationMs); if (s.startMs !== null && b.start !== null && b.start < s.startMs || s.endMs !== null && b.end !== null && b.end > s.endMs) add('Vocal line exceeds the section time range.', { ...context, lineId: voice.id }); }
    });
  });
  if (project.source?.notices.length) add('Unsupported imported details remain in the project source, but are not reproduced in TTML.', { severity: 'warning' });
  return issues;
}
