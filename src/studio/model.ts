import type { LyricDocument } from '../lyrics/types.ts';

export interface StudioLine { id: string; text: string; start: string; end: string }
export interface StudioDraft { trackId: string; audioName: string; lines: StudioLine[]; selectedId: string; updatedAt: number }
export interface StudioIssue { lineId?: string; field?: 'start' | 'end' | 'text'; message: string }
export const MAX_STUDIO_LINES = 5000;
export const newLine = (text = ''): StudioLine => ({ id: crypto.randomUUID(), text, start: '', end: '' });
export function newDraft(trackId: string, audioName: string): StudioDraft {
  const line = newLine(); return { trackId, audioName, lines: [line], selectedId: line.id, updatedAt: Date.now() };
}
export function parseStudioTime(value: string): number | undefined {
  if (!value.trim()) return;
  const match = value.trim().match(/^(?:(\d+):)?([0-5]?\d)(?:\.(\d{1,3}))?$/);
  if (match) return Number(match[1] || 0) * 60 + Number(match[2]) + Number(`0.${match[3] || 0}`);
  if (/^\d+(?:\.\d{1,3})?$/.test(value.trim()) && Number.isFinite(Number(value))) return Number(value);
}
export function studioTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return String(seconds);
  const ms = Math.round(seconds * 1000);
  return `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}
export function defaultEnd(lines: readonly StudioLine[], index: number, duration: number) {
  return index + 1 < lines.length ? parseStudioTime(lines[index + 1].start) : Number.isFinite(duration) && duration > 0 ? duration : undefined;
}
export function lineEnd(lines: readonly StudioLine[], index: number, duration: number) {
  return lines[index].end.trim() ? parseStudioTime(lines[index].end) : defaultEnd(lines, index, duration);
}
export function pastedLines(text: string) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter(value => value.trim()).map(value => newLine(value));
  if (lines.length > MAX_STUDIO_LINES || text.length > 1_000_000) throw new Error('Use at most 5,000 lines and 1 MB of lyric text.');
  return lines;
}
export function shiftLines(lines: readonly StudioLine[], seconds: number): StudioLine[] {
  if (!Number.isFinite(seconds)) throw new Error('Enter a valid shift in seconds.');
  return lines.map(line => {
    const shift = (value: string) => {
      if (!value.trim()) return '';
      const time = parseStudioTime(value);
      if (time === undefined || time + seconds < 0) throw new Error('Fix invalid times or choose a smaller shift. Times cannot go below zero.');
      return studioTime(time + seconds);
    };
    return { ...line, start: shift(line.start), end: shift(line.end) };
  });
}
export function studioFromLyrics(document: LyricDocument, offsetMs = 0) {
  const offset = offsetMs / 1000;
  const notices = [...document.notices];
  if (document.timing !== 'line') notices.push('Word timings will become line timings. This studio exports line-synced lyrics only.');
  if (document.lines.some(line => line.role !== 'lead' || line.agent)) notices.push('All vocal lines are kept as separate text lines. Voice labels and background-vocal roles are not included in studio exports.');
  if (document.lines.some(line => line.annotations.length)) notices.push('Translations and romanization are not included in this line editor or its exports. Your original lyric file is unchanged.');
  const lines = document.lines.map(line => ({ ...newLine(line.parts.map(part => part.text).join('')), start: studioTime(line.start + offset),
    end: line.end === undefined ? '' : studioTime(line.end + offset) }));
  return { lines, notices };
}
export function validateStudio(lines: readonly StudioLine[], duration: number, format: 'ttml' | 'lrc' | 'both'): StudioIssue[] {
  const issues: StudioIssue[] = [];
  if (!Number.isFinite(duration) || duration <= 0) issues.push({ message: 'Choose a playable audio file and wait for its duration before exporting.' });
  if (!lines.length) issues.push({ message: 'Add some lyrics before exporting.' });
  if (lines.length > MAX_STUDIO_LINES) issues.push({ message: 'Use at most 5,000 lyric lines.' });
  lines.forEach((line, index) => {
    const add = (field: StudioIssue['field'], message: string) => issues.push({ lineId: line.id, field, message: `Line ${index + 1}: ${message}` });
    const start = parseStudioTime(line.start), end = lineEnd(lines, index, duration);
    if (!line.text.trim()) add('text', 'add text or remove this empty line.');
    if (/[\r\n]/.test(line.text)) add('text', 'split this text into separate lyric lines before exporting.');
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/u.test(line.text) || /[\uD800-\uDFFF]/u.test(line.text)) add('text', 'remove unsupported control characters.');
    if (start === undefined) add('start', line.start.trim() ? 'enter a valid start time (mm:ss.mmm or seconds).' : 'this line has not been marked.');
    if (end === undefined) add('end', line.end.trim() ? 'enter a valid end time.' : 'the next line needs a start time, or enter an end manually.');
    if (start !== undefined && start >= duration) add('start', 'start must be before the audio ends.');
    if (end !== undefined && end > duration + .001) add('end', 'end must not exceed the audio duration.');
    if (start !== undefined && end !== undefined && start >= end) add('end', 'end must be later than start.');
    const previous = index ? parseStudioTime(lines[index - 1].start) : undefined;
    if (start !== undefined && previous !== undefined && start < previous) add('start', 'start is before the previous line. Adjust the time or line order.');
    if (format !== 'ttml') {
      if (/\[\d[^\]]*\]|\[(?:[a-z]+):|<\d{1,3}:|\(\d+,\d+\)/i.test(line.text)) add('text', 'this text resembles LRC timing syntax. Change it or export TTML to preserve it literally.');
      if (start !== undefined && start >= 60000) add('start', 'this time exceeds the supported LRC range. Export TTML instead.');
      if (end !== undefined && end >= 60000) add('end', 'this time exceeds the supported LRC range. Export TTML instead.');
      const next = lines.slice(index + 1).map(item => parseStudioTime(item.start)).find(time => time !== undefined && start !== undefined && time > start);
      if (end !== undefined && next !== undefined && end > next + .001) add('end', 'LRC cannot preserve this overlap. Shorten the end or export TTML.');
      const same = lines.findIndex(item => item.id !== line.id && parseStudioTime(item.start) === start);
      if (same >= 0 && end !== lineEnd(lines, same, duration)) add('end', 'simultaneous LRC lines need the same end time. Adjust it or export TTML.');
    }
  });
  return issues;
}
