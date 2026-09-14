import { lineBounds } from './validation.ts';
import type { StudioProject } from './project.ts';
import { timingKind, type LyricDocument } from '../lyrics/types.ts';

/** Render data uses seconds. It is never used as the editable project or export source. */
export function projectToPlayer(project: StudioProject): LyricDocument {
  const lines: LyricDocument['lines'] = project.lines.map(line => {
    const b = lineBounds(project, line, 0);
    if (b.start === null || b.end === null || b.end <= b.start) throw new Error(`Line ${line.text.slice(0, 30)} needs a valid finite start and end before playback.`);
    return { id: line.id, groupId: line.parentId || line.id, start: b.start / 1000, end: b.end / 1000, role: line.role, agent: line.performerId,
      section: project.sections.find(s => s.lineIds.includes(line.parentId || line.id))?.tag,
      parts: line.units.map(w => ({ text: w.text, agent: w.performerId, ...(w.startMs !== null && w.endMs !== null ? { start: w.startMs / 1000, end: w.endMs / 1000 } : {}) })), annotations: line.annotations.map(a => ({ kind: a.kind, text: a.text, language: a.language || undefined })) };
  });
  return { format: 'ttml', profile: 'apple', timing: timingKind(lines), lines: lines.sort((a, b) => a.start - b.start), agents: Object.fromEntries(project.performers.map(p => [p.id, p.name])), notices: project.source?.notices || [] };
}
