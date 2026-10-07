import { LyricsError, type LyricDocument } from '../../lyrics/types.ts';
import { newProject, vocalLine, type StudioProject, type Section } from '../../studio/project.ts';
import type { ContentV1, LyricFlowRevision, LyricFlowSourceV1 } from './types.ts';
import { TransferSHA256 } from '../../transfer/sha256.ts';

const MAX_MS = 86400000;
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 120;
const ms = (value: unknown) => value === null || Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= MAX_MS;
const keys = (value: Record<string, any>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
function requireValid(condition: unknown): asserts condition { if (!condition) throw new LyricsError('LyricFlow returned an invalid or unsupported lyric document.'); }

/** Validate the wire model before constructing playback or editable data. */
export function validateContentV1(value: unknown): ContentV1 {
  requireValid(object(value) && value.schemaVersion === 1 && keys(value, ['schemaVersion', 'text', 'sync', 'structure', 'performers', 'source']));
  requireValid(object(value.text) && keys(value.text, ['lines']) && Array.isArray(value.text.lines) && value.text.lines.length <= 2000);
  const lines = value.text.lines, ids = new Set<string>(), orders = new Set<number>(); let length = 0;
  for (const line of lines) {
    requireValid(object(line) && keys(line, ['lineId', 'order', 'text', 'kind', 'sourceLineId']) && id(line.lineId) && !ids.has(line.lineId) && Number.isSafeInteger(line.order) && line.order >= 0 && !orders.has(line.order) && typeof line.text === 'string' && line.text.length <= 4000 && ['vocal', 'blank', 'note'].includes(line.kind) && (line.kind !== 'blank' || line.text === '') && (line.sourceLineId === undefined || id(line.sourceLineId)));
    ids.add(line.lineId); orders.add(line.order); length += line.text.length;
  }
  requireValid(length + Math.max(0, lines.length - 1) <= 300000 && value.source === null);
  if (value.sync !== null) {
    const sync = value.sync;
    requireValid(object(sync) && keys(sync, ['textFingerprint', 'reference', 'timings']) && typeof sync.textFingerprint === 'string' && object(sync.reference) && Array.isArray(sync.timings) && sync.timings.length <= 2000);
    const ref = sync.reference;
    requireValid(keys(ref, ['trackId', 'source', 'externalId', 'durationMs', 'offsetMs']) && id(ref.trackId) && ['unknown', 'client', 'catalog', 'server'].includes(ref.source) && (ref.source === 'unknown' || ref.durationMs !== null) && (ref.externalId === null || typeof ref.externalId === 'string' && ref.externalId.length <= 200) && ms(ref.durationMs) && Number.isSafeInteger(ref.offsetMs) && Math.abs(ref.offsetMs) <= MAX_MS);
    const timed = new Set<string>();
    for (const timing of sync.timings) {
      requireValid(object(timing) && keys(timing, ['lineId', 'startMs', 'endMs', 'endSource']) && ids.has(timing.lineId) && !timed.has(timing.lineId) && ms(timing.startMs) && ms(timing.endMs) && ['manual', 'derived', 'unknown'].includes(timing.endSource) && (timing.endMs === null ? timing.endSource === 'unknown' : timing.startMs !== null && timing.endMs >= timing.startMs));
      timed.add(timing.lineId);
    }
  }
  requireValid(Array.isArray(value.structure) && value.structure.length <= 2000);
  const sections = new Set<string>();
  for (const section of value.structure) {
    requireValid(object(section) && keys(section, ['lineId', 'section']) && ids.has(section.lineId) && !sections.has(section.lineId) && ['verse', 'chorus', 'pre-chorus', 'post-chorus', 'bridge', 'intro', 'outro', 'refrain', 'interlude', 'instrumental', 'hook', 'other'].includes(section.section)); sections.add(section.lineId);
  }
  const performers = value.performers;
  requireValid(object(performers) && keys(performers, ['participants', 'assignments']) && Array.isArray(performers.participants) && performers.participants.length <= 100 && Array.isArray(performers.assignments) && performers.assignments.length <= 2000);
  const people = new Set<string>();
  for (const person of performers.participants) {
    requireValid(object(person) && keys(person, ['id', 'name']) && id(person.id) && !people.has(person.id) && id(person.name)); people.add(person.id);
  }
  const assigned = new Set<string>();
  const peopleList = (items: unknown) => Array.isArray(items) && items.length <= 100 && items.every(person => people.has(person)) && new Set(items).size === items.length;
  for (const assignment of performers.assignments) {
    requireValid(object(assignment) && keys(assignment, ['lineId', 'performerIds', 'ranges']) && ids.has(assignment.lineId) && !assigned.has(assignment.lineId) && peopleList(assignment.performerIds)); assigned.add(assignment.lineId);
    if (assignment.ranges !== undefined) {
      requireValid(Array.isArray(assignment.ranges) && assignment.ranges.length <= 4000);
      const text = lines.find(line => line.lineId === assignment.lineId)!.text;
      for (const range of assignment.ranges) requireValid(object(range) && keys(range, ['start', 'end', 'performerIds']) && Number.isSafeInteger(range.start) && Number.isSafeInteger(range.end) && range.start >= 0 && range.end > range.start && range.end <= text.length && peopleList(range.performerIds) && range.performerIds.length > 0);
    }
  }
  return value as ContentV1;
}
export function validateRevision(value: unknown, revisionId?: string, documentId?: string): LyricFlowRevision {
  requireValid(object(value) && id(value.id) && id(value.documentId) && (!revisionId || value.id === revisionId) && (!documentId || value.documentId === documentId) && object(value.components) && typeof value.publishedAt === 'string' && Number.isFinite(Date.parse(value.publishedAt)));
  validateContentV1(value.content); return value as LyricFlowRevision;
}
export function parseLyricFlowSource(source: string): LyricFlowSourceV1 {
  if (source.length > 2 * 1024 * 1024) throw new LyricsError('LyricFlow response is too large.');
  let value: unknown; try { value = JSON.parse(source); } catch { throw new LyricsError('LyricFlow returned invalid JSON.'); }
  requireValid(object(value) && value.formatVersion === 1 && value.provider === 'lyricflow' && typeof value.apiOrigin === 'string' && id(value.trackId) && id(value.documentId) && id(value.revisionId) && Number.isFinite(value.fetchedAt));
  validateRevision(value.snapshot, value.revisionId, value.documentId);
  requireValid(!value.snapshot.content.sync || value.snapshot.content.sync.reference.trackId === value.trackId);
  return value as LyricFlowSourceV1;
}
export function revisionToPlayerDocument(revision: LyricFlowRevision, durationMs?: number): LyricDocument {
  const content = validateRevision(revision).content, offset = content.sync?.reference.offsetMs ?? 0;
  const textState = revision.components.text, syncState = revision.components.sync;
  if (!object(textState) || textState.contentState !== 'complete' || !['verified', 'unverified'].includes(textState.verificationState) || !object(syncState) || syncState.contentState !== 'complete' || !['verified', 'unverified'].includes(syncState.verificationState) || content.sync && content.sync.textFingerprint !== lyricFlowTextFingerprint(content)) throw new LyricsError('LyricFlow timing is incomplete or needs review. Open it in Studio before applying.');
  const timings = new Map(content.sync?.timings.map(item => [item.lineId, item]) ?? []);
  const vocals = content.text.lines.filter(line => line.kind === 'vocal' && line.text.trim()).sort((a, b) => a.order - b.order);
  if (!vocals.length) throw new LyricsError('LyricFlow has no vocal lyrics for this recording.');
  if (durationMs !== undefined && (!Number.isSafeInteger(durationMs) || durationMs <= 0 || durationMs > MAX_MS)) throw new LyricsError('Measure the audio duration before applying LyricFlow lyrics.');
  for (const line of vocals) {
    const timing = timings.get(line.lineId), start = timing?.startMs === null || timing?.startMs === undefined ? null : timing.startMs + offset;
    const end = timing?.endMs === null || timing?.endMs === undefined ? null : timing.endMs + offset;
    if (start === null) throw new LyricsError('LyricFlow lyrics are not fully timed. Open them in Studio to finish timing.');
    if (start < 0 || start > (durationMs ?? MAX_MS) || end !== null && (end <= start || end > (durationMs ?? MAX_MS))) throw new LyricsError('LyricFlow timing does not fit this audio. Local lyrics are unchanged.');
  }
  return { format: 'lyricflow-json', timing: 'line', agents: Object.fromEntries(content.performers.participants.map(person => [person.id, person.name])), notices: [],
    lines: vocals.map(line => {
      const timing = timings.get(line.lineId)!, assignment = content.performers.assignments.find(item => item.lineId === line.lineId);
      const boundaries = [...new Set([0, line.text.length, ...(assignment?.ranges?.flatMap(range => [range.start, range.end]) ?? [])])].sort((a, b) => a - b);
      const parts = boundaries.slice(0, -1).map((start, index) => { const end = boundaries[index + 1], range = assignment?.ranges?.find(range => range.start <= start && range.end >= end); return { text: line.text.slice(start, end), agent: range?.performerIds.join(' ') || undefined }; });
      return { id: line.lineId, groupId: line.lineId, start: (timing.startMs! + offset) / 1000, end: timing.endMs === null ? undefined : (timing.endMs + offset) / 1000, parts, role: 'lead' as const,
        agent: assignment?.performerIds.join(' ') || undefined, section: content.structure.find(item => item.lineId === line.lineId)?.section, annotations: [] };
    }).sort((a, b) => a.start - b.start) };
}
/** Read-side integrity check only; submission obtains its fingerprint from the server. */
export function lyricFlowTextFingerprint(content: ContentV1) {
  const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value !== null && typeof value === 'object' ? `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',')}}` : JSON.stringify(value);
  const hash = new TransferSHA256(); hash.update(new TextEncoder().encode(canonical({ schemaVersion: content.schemaVersion, lines: [...content.text.lines].sort((a, b) => a.order - b.order) }))); return hash.hex();
}
const sectionNames: Partial<Record<ContentV1['structure'][number]['section'], Section['tag']>> = { intro: 'INTRO', verse: 'VERSE', 'pre-chorus': 'PRECHORUS', chorus: 'CHORUS', bridge: 'BRIDGE', refrain: 'REFRAIN', outro: 'OUTRO', instrumental: 'INSTRUMENTAL' };
export function revisionToStudioProject(source: LyricFlowSourceV1, localTrackId: string, audioName: string): StudioProject {
  const valid = parseLyricFlowSource(JSON.stringify(source)), content = valid.snapshot.content, project = newProject(localTrackId, audioName), offset = content.sync?.reference.offsetMs ?? 0;
  const timings = new Map(content.sync?.timings.map(item => [item.lineId, item]) ?? []);
  project.lines = [...content.text.lines].sort((a, b) => a.order - b.order).filter(line => line.kind === 'vocal').map(line => {
    const timing = timings.get(line.lineId), assignment = content.performers.assignments.find(item => item.lineId === line.lineId);
    return { ...vocalLine(line.text), id: line.lineId, startMs: timing?.startMs == null ? null : timing.startMs + offset, endMs: timing?.endMs == null ? null : timing.endMs + offset, performerId: assignment?.performerIds.length === 1 ? assignment.performerIds[0] : undefined };
  });
  project.selectedId = project.lines[0]?.id ?? '';
  project.performers = content.performers.participants.map(person => ({ ...person, type: 'person', color: '#8b7cff', align: 'auto' }));
  project.sections = content.structure.flatMap(item => sectionNames[item.section] && project.lines.some(line => line.id === item.lineId) ? [{ id: `section-${item.lineId}`, tag: sectionNames[item.section]!, lineIds: [item.lineId], startMs: null, endMs: null }] : []);
  project.lyricflow = { apiOrigin: valid.apiOrigin, trackId: valid.trackId, documentId: valid.documentId, revisionId: valid.revisionId, baseSnapshot: structuredClone(valid.snapshot), lineMap: Object.fromEntries(project.lines.map(line => [line.id, line.id])), timeBasis: 'recording' };
  project.source = { text: JSON.stringify(valid), fileName: `${valid.revisionId}.lyricflow.json`, notices: ['LyricFlow original snapshot retained. Unsupported sections and performer ranges remain in the baseline.'] };
  return project;
}
