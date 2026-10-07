import type { StudioProject } from '../../studio/project.ts';
import { validateContentV1 } from './adapter.ts';
import type { ContentV1 } from './types.ts';
import type { Component } from './contributionTypes.ts';

export interface ConversionIssue { code: string; lineId?: string; unitId?: string; message: string }
export interface ConversionReport { content: ContentV1; losses: ConversionIssue[]; warnings: ConversionIssue[]; blockingIssues: ConversionIssue[]; lineMap: Record<string, string> }
const all: Component[] = ['text', 'sync', 'structure', 'performers'];
const sectionNames: Record<string, ContentV1['structure'][number]['section']> = { INTRO: 'intro', VERSE: 'verse', PRECHORUS: 'pre-chorus', CHORUS: 'chorus', BRIDGE: 'bridge', REFRAIN: 'refrain', OUTRO: 'outro', INSTRUMENTAL: 'instrumental' };
const empty = (): ContentV1 => ({ schemaVersion: 1, text: { lines: [] }, sync: null, structure: [], performers: { participants: [], assignments: [] }, source: null });

/** Produces an independent line-level copy; never changes the editable project. */
export function projectToContentV1(project: StudioProject, options: { trackId: string; durationMs: number | null; baseline?: ContentV1 | null; components?: Component[]; lineMap?: Record<string, string> }): ConversionReport {
  const baseline = options.baseline ? validateContentV1(options.baseline) : null;
  const content = structuredClone(baseline || empty()), selected = options.components || all;
  const losses: ConversionIssue[] = [], warnings: ConversionIssue[] = [], blockingIssues: ConversionIssue[] = [];
  const issue = (target: ConversionIssue[], code: string, message: string, lineId?: string, unitId?: string) => target.push({ code, message, lineId, unitId });
  const lineMap = { ...(options.lineMap || {}) };
  const lead = project.lines.filter(line => line.role === 'lead');
  const imported = project.lyricflow?.trackId === options.trackId && baseline && project.lyricflow.baseSnapshot.content;
  if (imported) Object.assign(lineMap, project.lyricflow!.lineMap);
  for (const line of project.lines) {
    if (line.role === 'background') issue(losses, 'BACKGROUND_RELATION_UNSUPPORTED', 'Background vocals are not submitted.', line.id);
    if (line.units.some(unit => unit.startMs !== null || unit.endMs !== null)) issue(losses, 'WORD_TIMING_OMITTED', 'Word timing is omitted; only line timing is submitted.', line.id);
    for (const annotation of line.annotations) issue(losses, annotation.kind === 'translation' ? 'TRANSLATION_NOT_SUBMITTED' : 'ROMANIZATION_UNSUPPORTED', annotation.kind === 'translation' ? 'Translations are not submitted.' : 'Romanization is not submitted.', line.id, annotation.targetId);
  }
  if (project.performers.length || project.sections.length) issue(losses, 'STYLE_LOCAL_ONLY', 'Colors, alignment and section styling stay in the local project.');
  const mapped = new Set<string>();
  for (const line of lead) {
    lineMap[line.id] ||= line.id;
    const id = lineMap[line.id];
    if (!id || id.length > 120 || mapped.has(id)) issue(blockingIssues, 'LINE_ID_INVALID', 'Line IDs must be unique and at most 120 characters.', line.id);
    mapped.add(id);
    if (line.text.length > 4000) issue(blockingIssues, 'LINE_TOO_LONG', 'A submitted line exceeds 4000 characters.', line.id);
  }
  if (!lead.some(line => line.text.trim())) issue(blockingIssues, 'EMPTY_TEXT', 'Add original lyrics before submitting.');
  if (selected.includes('text')) {
    const previous = baseline?.text.lines || [];
    if (imported) {
      // Keep note/blank records and original order/IDs that Studio cannot represent.
      const ordered = [...previous].sort((a, b) => a.order - b.order);
      const converted = lead.map(line => ({ ...previous.find(old => old.lineId === lineMap[line.id]), lineId: lineMap[line.id], order: 0, text: line.text, kind: 'vocal' as const }));
      let vocalIndex = 0;
      content.text.lines = ordered.flatMap(line => line.kind !== 'vocal' ? [structuredClone(line)] : vocalIndex < converted.length ? [converted[vocalIndex++]] : []);
      content.text.lines.push(...converted.slice(vocalIndex));
      const sameOrder = content.text.lines.length === ordered.length && content.text.lines.every((line, index) => line.lineId === ordered[index].lineId);
      content.text.lines.forEach((line, index) => { line.order = sameOrder ? ordered[index].order : index; });
    } else content.text.lines = lead.map((line, order) => ({ lineId: lineMap[line.id], order, text: line.text, kind: line.text === '' ? 'blank' : 'vocal' }));
  } else {
    const vocals = baseline?.text.lines.filter(line => line.kind === 'vocal') || [];
    if (!baseline || vocals.length !== lead.length || lead.some(line => !vocals.some(old => old.lineId === lineMap[line.id] && old.text === line.text))) issue(blockingIssues, 'TEXT_ALIGNMENT_REQUIRED', 'Timing-only submission requires unchanged original text and stable remote line IDs. Load the published lyrics in Studio first.');
  }
  if (content.text.lines.length > 2000 || content.text.lines.reduce((n, line) => n + line.text.length, 0) > 300000) issue(blockingIssues, 'TEXT_TOO_LARGE', 'Lyrics exceed the server text limit.');
  const ids = new Set(content.text.lines.map(line => line.lineId));
  if (selected.includes('sync')) {
    const prior = baseline?.sync;
    content.sync = { textFingerprint: '', reference: { trackId: options.trackId, source: options.durationMs ? 'client' : 'unknown', externalId: null, durationMs: options.durationMs, offsetMs: 0 },
      timings: lead.map(line => {
        const old = prior?.timings.find(timing => timing.lineId === lineMap[line.id]);
        const unchangedEnd = old?.endMs !== null && old?.endMs !== undefined && old.endMs + (prior?.reference.offsetMs || 0) === line.endMs;
        if (line.startMs === null && line.text.trim()) issue(warnings, 'UNTIMED_LINE', 'This line has no start time and will remain unverified.', line.id);
        for (const value of [line.startMs, line.endMs]) if (value !== null && (!Number.isSafeInteger(value) || value < 0 || value > (options.durationMs || 86400000))) issue(blockingIssues, 'TIMING_OUT_OF_RANGE', 'Timing is outside the measured audio duration.', line.id);
        if (line.endMs !== null && (line.startMs === null || line.endMs < line.startMs)) issue(blockingIssues, 'TIMING_RANGE_INVALID', 'End time needs a valid start time.', line.id);
        return { lineId: lineMap[line.id], startMs: line.startMs, endMs: line.endMs, endSource: line.endMs === null ? 'unknown' as const : unchangedEnd ? old!.endSource : 'manual' as const };
      }).filter(timing => ids.has(timing.lineId)) };
    for (const timing of prior?.timings || []) if (ids.has(timing.lineId) && !mapped.has(timing.lineId)) content.sync.timings.push({ ...timing, startMs: timing.startMs === null ? null : timing.startMs + prior!.reference.offsetMs, endMs: timing.endMs === null ? null : timing.endMs + prior!.reference.offsetMs });
  }
  if (selected.includes('structure')) {
    content.structure = imported ? content.structure.filter(item => ids.has(item.lineId) && !Object.values(sectionNames).includes(item.section)) : [];
    for (const section of project.sections) for (const localId of section.lineIds) if (lineMap[localId] && ids.has(lineMap[localId])) {
      if (content.structure.some(item => item.lineId === lineMap[localId])) issue(blockingIssues, 'SECTION_CONFLICT', 'A remote section cannot be replaced without explicit alignment.', localId);
      else content.structure.push({ lineId: lineMap[localId], section: sectionNames[section.tag] });
    }
  }
  if (selected.includes('performers')) {
    const complex = baseline?.performers.assignments.some(item => item.performerIds.length > 1 || item.ranges?.length);
    if (complex) issue(blockingIssues, 'PERFORMER_ALIGNMENT_REQUIRED', 'Remote performer ranges must be preserved. Select timing-only submission.');
    content.performers = { participants: project.performers.map(person => ({ id: person.id, name: person.name })), assignments: [] };
    for (const line of lead) {
      let offset = 0; const ranges: NonNullable<ContentV1['performers']['assignments'][number]['ranges']> = [];
      for (const unit of line.units) { if (unit.performerId && unit.text) ranges.push({ start: offset, end: offset + unit.text.length, performerIds: [unit.performerId] }); offset += unit.text.length; }
      if (line.performerId || ranges.length) content.performers.assignments.push({ lineId: lineMap[line.id], performerIds: line.performerId ? [line.performerId] : [], ...(ranges.length ? { ranges } : {}) });
    }
  }
  if (content.performers.assignments.some(item => !ids.has(item.lineId)) || content.structure.some(item => !ids.has(item.lineId)) || content.sync?.timings.some(item => !ids.has(item.lineId))) issue(blockingIssues, 'DANGLING_REFERENCE', 'A preserved component references a deleted line.');
  try { validateContentV1(content); } catch { issue(blockingIssues, 'CONTENT_INVALID', 'The converted content contains invalid IDs, timing or performer references.'); }
  if (new TextEncoder().encode(JSON.stringify({ content })).length > 512000) issue(blockingIssues, 'REQUEST_TOO_LARGE', 'The line-level submission exceeds 512000 bytes.');
  return { content, losses, warnings, blockingIssues, lineMap };
}

export function changedComponents(baseline: ContentV1 | null, content: ContentV1): Component[] {
  const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value !== null && typeof value === 'object' ? `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}` : JSON.stringify(value);
  return all.filter(component => !baseline || canonical(component === 'text' ? [...baseline.text.lines].sort((a, b) => a.order - b.order) : baseline[component]) !== canonical(component === 'text' ? [...content.text.lines].sort((a, b) => a.order - b.order) : content[component]));
}
