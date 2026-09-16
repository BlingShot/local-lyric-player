import { parseStudioTime, studioTime, type StudioDraft } from './model.ts';
import type { LyricDocument } from '../lyrics/types.ts';

export type Millis = number | null;
export interface Unit { id: string; text: string; kind: 'word' | 'separator'; startMs: Millis; endMs: Millis; performerId?: string }
export interface Annotation { id: string; targetId: string; kind: 'translation' | 'romanization'; text: string; language: string }
export interface VocalLine { id: string; text: string; units: Unit[]; startMs: Millis; endMs: Millis; performerId?: string; role: 'lead' | 'background'; parentId?: string; annotations: Annotation[] }
export interface Performer { id: string; name: string; type: 'person' | 'group'; color: string; align: 'auto' | 'left' | 'right' | 'center' }
export const STRUCTURES = ['INTRO', 'VERSE', 'PRECHORUS', 'CHORUS', 'BRIDGE', 'REFRAIN', 'OUTRO', 'INSTRUMENTAL'] as const;
export interface Section { id: string; tag: typeof STRUCTURES[number]; lineIds: string[]; startMs: Millis; endMs: Millis }
export interface StudioProject {
  version: 2; trackId: string; audioName: string; updatedAt: number; selectedId: string; selectedUnitId?: string;
  lines: VocalLine[]; performers: Performer[]; sections: Section[];
  metadata: { title: string; artist: string; album: string; language: string; extra: Record<string, string[]> };
  metadataInitialized?: boolean;
  playerSource?: { key: string; format: 'lrc' | 'ttml' };
  boundaries?: { startMs: Millis; endMs: Millis };
  settings: { mode: 'line' | 'word'; split: SplitMode; preRollMs: number; preview: boolean; colors: boolean; alignment: boolean; wordArrowKeys?: boolean };
  source?: { text: string; fileName: string; notices: string[] };
}
export type SplitMode = 'auto' | 'word' | 'character' | 'manual';
export const uid = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
export const msText = (value: Millis) => value === null ? '' : studioTime(value / 1000);
export const textMs = (value: string): Millis => { const seconds = parseStudioTime(value); return seconds === undefined ? null : Math.round(seconds * 1000); };
export const complete = (unit: Pick<Unit, 'startMs' | 'endMs'>) => unit.startMs !== null && unit.endMs !== null && unit.endMs > unit.startMs;
export const graphemes = (text: string) => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map(part => part.segment);
export const unit = (text: string, kind: Unit['kind'] = /[\p{L}\p{N}\p{Extended_Pictographic}\p{Regional_Indicator}]/u.test(text) ? 'word' : 'separator'): Unit => ({ id: uid('w'), text, kind, startMs: null, endMs: null });
export function tokenize(text: string, mode: SplitMode = 'auto'): Unit[] {
  if (!text) return [];
  if (mode === 'manual') return [unit(text)];
  if (mode === 'word' || mode === 'auto' && !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)) {
    const result: Unit[] = [];
    for (const part of new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text)) {
      // Word segmentation handles scripts without whitespace. Punctuation is attached
      // when adjacent, preserving contractions/case and never demanding another mark.
      const last = result.at(-1);
      const next = unit(part.segment);
      if (!part.isWordLike && next.kind === 'separator' && /^[\p{P}\p{S}]+$/u.test(part.segment) && last?.kind === 'word') last.text += part.segment;
      else if (next.kind === 'word' && last?.kind === 'separator' && !/\s/u.test(last.text)) { result.pop(); result.push(unit(last.text + next.text)); }
      else result.push(next);
    }
    return result;
  }
  const pieces: string[] = [];
  let buffer = '';
  const flush = () => { if (buffer) pieces.push(buffer); buffer = ''; };
  for (const char of graphemes(text)) {
    if (/^\s+$/u.test(char)) { flush(); if (pieces.length && /^\s+$/u.test(pieces[pieces.length - 1])) pieces[pieces.length - 1] += char; else pieces.push(char); }
    else if (mode === 'character' || (mode === 'auto' && /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u.test(char))) { flush(); pieces.push(char); }
    else buffer += char;
  }
  flush();
  // Punctuation can remain literal separators; it never demands its own recording.
  return pieces.map(text => unit(text));
}
export function vocalLine(text = '', role: VocalLine['role'] = 'lead', parentId?: string): VocalLine {
  return { id: uid('l'), text, units: tokenize(text), startMs: null, endMs: null, role, parentId, annotations: [] };
}
export function newProject(trackId: string, audioName: string): StudioProject {
  const line = vocalLine();
  return { version: 2, trackId, audioName, updatedAt: Date.now(), selectedId: line.id, lines: [line], performers: [], sections: [],
    metadata: { title: '', artist: '', album: '', language: 'und', extra: {} },
    settings: { mode: 'line', split: 'auto', preRollMs: 800, preview: true, colors: true, alignment: false } };
}
export function editText(line: VocalLine, text: string, mode: SplitMode = 'auto'): VocalLine {
  if (line.text === text) return line;
  const before = graphemes(line.text), after = graphemes(text);
  let prefix = 0, suffix = 0;
  while (prefix < Math.min(before.length, after.length) && before[prefix] === after[prefix]) prefix++;
  while (suffix < Math.min(before.length, after.length) - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
  const left = before.slice(0, prefix).join('').length, right = line.text.length - before.slice(before.length - suffix).join('').length;
  let pos = 0;
  const ranges = line.units.map(item => { const start = pos; pos += item.text.length; return { item, start, end: pos }; });
  const keptLeft = ranges.filter(r => r.end <= left), keptRight = ranges.filter(r => r.start >= right && r.start >= left);
  const from = keptLeft.at(-1)?.end || 0, tail = keptRight.length ? line.text.length - keptRight[0].start : 0;
  return { ...line, text, units: [...keptLeft.map(r => r.item), ...tokenize(text.slice(from, text.length - tail), mode), ...keptRight.map(r => r.item)] };
}
export function splitUnit(line: VocalLine, id: string, at: number): VocalLine {
  const original = line.units.find(w => w.id === id); if (!original) return line;
  const boundary = new Set([0]); let offset = 0; for (const g of graphemes(original.text)) { offset += g.length; boundary.add(offset); }
  if (!boundary.has(at) || at <= 0 || at >= original.text.length) throw new Error('Choose a boundary between complete visible characters.');
  // No invented syllable boundary times. Unaffected units retain both ID and times.
  const parts = [unit(original.text.slice(0, at)), unit(original.text.slice(at))].map(w => ({ ...w, performerId: original.performerId }));
  return { ...line, units: line.units.flatMap(w => w.id === id ? parts : [w]) };
}
export function mergeUnits(line: VocalLine, ids: string[]): VocalLine {
  const indices = ids.map(id => line.units.findIndex(w => w.id === id)).filter(i => i >= 0).sort((a, b) => a - b);
  if (indices.length < 2) throw new Error('Select at least two adjacent fragments.');
  const from = indices[0], to = indices.at(-1)!;
  if (line.units.slice(from, to + 1).some(w => w.kind === 'word' && !ids.includes(w.id))) throw new Error('Select adjacent fragments.');
  const items = line.units.slice(from, to + 1), words = items.filter(w => w.kind === 'word');
  if (new Set(words.map(w => w.performerId || line.performerId || '')).size > 1) throw new Error('Assign a single Performer or an explicit group before merging.');
  const continuous = words.every(complete) && words.every((w, i) => !i || words[i - 1].endMs === w.startMs);
  const merged = { ...unit(items.map(w => w.text).join('')), performerId: words[0]?.performerId,
    startMs: continuous ? words[0].startMs : null, endMs: continuous ? words.at(-1)!.endMs : null };
  return { ...line, units: [...line.units.slice(0, from), merged, ...line.units.slice(to + 1)] };
}
export function removePerformer(project: StudioProject, id: string, replacement: string | null): StudioProject {
  if (replacement && (replacement === id || !project.performers.some(p => p.id === replacement))) throw new Error('Choose an existing replacement Performer.');
  return { ...project, performers: project.performers.filter(p => p.id !== id), lines: project.lines.map(line => ({ ...line,
    performerId: line.performerId === id ? replacement || undefined : line.performerId,
    units: line.units.map(w => ({ ...w, performerId: w.performerId === id ? replacement || undefined : w.performerId })) })) };
}
export function shiftProject(project: StudioProject, delta: number, scope: 'all' | 'line' | 'word', ids: string[] = []): StudioProject {
  if (!Number.isSafeInteger(delta)) throw new Error('Use an integer millisecond offset.');
  const shift = (v: Millis) => { if (v === null) return null; if (v + delta < 0) throw new Error('Times cannot go below zero.'); return v + delta; };
  const selected = new Set(ids.length ? ids : [project.selectedId]);
  return { ...project, lines: project.lines.map(line => {
    const whole = scope === 'all' || (scope === 'line' && (selected.has(line.id) || !!line.parentId && selected.has(line.parentId)));
    return { ...line, startMs: whole ? shift(line.startMs) : line.startMs, endMs: whole ? shift(line.endMs) : line.endMs,
      units: line.units.map(w => whole || (scope === 'word' && w.id === project.selectedUnitId) ? { ...w, startMs: shift(w.startMs), endMs: shift(w.endMs) } : w) };
  }), boundaries: scope === 'all' && project.boundaries ? { startMs: shift(project.boundaries.startMs), endMs: shift(project.boundaries.endMs) } : project.boundaries,
    sections: scope === 'all' ? project.sections.map(s => ({ ...s, startMs: shift(s.startMs), endMs: shift(s.endMs) })) : project.sections };
}
export function migrateDraft(value: StudioDraft | StudioProject): StudioProject {
  if ('version' in value && value.version === 2) return value;
  const old = value as StudioDraft;
  return { ...newProject(old.trackId, old.audioName), ...old, version: 2,
    lines: old.lines.map(line => ({ ...vocalLine(line.text), id: line.id, startMs: textMs(line.start), endMs: textMs(line.end) })) };
}
export function fromPreview(document: LyricDocument, trackId: string, audioName: string, offset = 0): StudioProject {
  const project = newProject(trackId, audioName);
  project.performers = Object.entries(document.agents).map(([id, name], i) => ({ id, name, type: 'person', color: ['#1ed760', '#85b7ff', '#ffb6de'][i % 3], align: 'auto' }));
  const leads = new Map<string, string>();
  project.lines = document.lines.map(row => {
    const line = vocalLine(row.parts.map(p => p.text).join(''), row.role);
    if (row.role === 'lead') leads.set(row.groupId, line.id);
    line.parentId = row.role === 'background' ? leads.get(row.groupId) : undefined;
    if (!line.parentId) line.role = 'lead';
    line.startMs = Math.round(row.start * 1000) + offset; line.endMs = row.end === undefined ? null : Math.round(row.end * 1000) + offset;
    line.performerId = row.agent;
    line.units = row.parts.flatMap(p => p.start !== undefined && p.end !== undefined ? [{ ...unit(p.text), startMs: Math.round(p.start * 1000) + offset, endMs: Math.round(p.end * 1000) + offset }] : tokenize(p.text));
    line.annotations = row.annotations.map(a => ({ ...a, id: uid('a'), targetId: line.id, language: a.language || '' }));
    return line;
  });
  project.selectedId = project.lines[0]?.id || ''; return project;
}
export function parseProject(source: string): StudioProject {
  if (source.length > 8_000_000) throw new Error('Project exceeds 8 MB.');
  const p = JSON.parse(source);
  if (p?.playerSource !== undefined && (!p.playerSource || typeof p.playerSource.key !== 'string' || !/^[a-f0-9]{64}$/.test(p.playerSource.key) || !['lrc', 'ttml'].includes(p.playerSource.format))) throw new Error('Invalid player lyric source.');
  const time = (t: unknown) => t === null || Number.isSafeInteger(t);
  if (p?.version !== 2 || typeof p.trackId !== 'string' || typeof p.audioName !== 'string' || typeof p.selectedId !== 'string' || !Number.isFinite(p.updatedAt)
    || !Array.isArray(p.lines) || p.lines.length > 5000 || !Array.isArray(p.performers) || !Array.isArray(p.sections)
    || !p.metadata || !['title', 'artist', 'album', 'language'].every(k => typeof p.metadata[k] === 'string') || !p.metadata.extra || typeof p.metadata.extra !== 'object' || !Object.values(p.metadata.extra).every(v => Array.isArray(v) && v.every(t => typeof t === 'string'))
    || !p.settings || !['line', 'word'].includes(p.settings.mode) || !['auto', 'word', 'character', 'manual'].includes(p.settings.split) || !Number.isSafeInteger(p.settings.preRollMs) || p.settings.preRollMs < 0 || p.settings.preRollMs > 10000 || !['preview', 'colors', 'alignment'].every(k => typeof p.settings[k] === 'boolean')
    || p.source !== undefined && (typeof p.source?.text !== 'string' || typeof p.source?.fileName !== 'string' || !Array.isArray(p.source?.notices) || !p.source.notices.every((n: unknown) => typeof n === 'string'))
    || !p.lines.every((l: VocalLine) => [l.performerId, l.parentId, ...l.units?.map(w => w.performerId) || []].every(v => v === undefined || typeof v === 'string'))
    || !p.lines.every((l: VocalLine) => typeof l.id === 'string' && typeof l.text === 'string' && l.text.length <= 20000 && ['lead', 'background'].includes(l.role) && time(l.startMs) && time(l.endMs) && Array.isArray(l.units) && l.units.every(w => typeof w.id === 'string' && typeof w.text === 'string' && ['word', 'separator'].includes(w.kind) && time(w.startMs) && time(w.endMs)) && l.units.map(w => w.text).join('') === l.text && Array.isArray(l.annotations) && l.annotations.every(a => typeof a.id === 'string' && typeof a.targetId === 'string' && typeof a.text === 'string' && typeof a.language === 'string' && ['translation', 'romanization'].includes(a.kind)))
    || !p.performers.every((a: Performer) => typeof a.id === 'string' && typeof a.name === 'string' && ['person', 'group'].includes(a.type) && /^#[\da-f]{6}$/i.test(a.color) && ['auto', 'left', 'right', 'center'].includes(a.align))
    || !p.sections.every((s: Section) => typeof s.id === 'string' && STRUCTURES.includes(s.tag) && Array.isArray(s.lineIds) && s.lineIds.every(id => typeof id === 'string') && time(s.startMs) && time(s.endMs))) throw new Error('Invalid or unsupported Lyric Studio project. Your current draft is unchanged.');
  if (p.boundaries !== undefined && (!p.boundaries || !time(p.boundaries.startMs) || !time(p.boundaries.endMs))) throw new Error('Invalid lyric boundary times.');
  if (p.settings.wordArrowKeys !== undefined && typeof p.settings.wordArrowKeys !== 'boolean') throw new Error('Invalid word shortcut setting.');
  return p as StudioProject;
}
