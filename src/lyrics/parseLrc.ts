import { LyricsError, timingKind, type LyricDocument, type LyricLine, type LyricPart } from './types.ts';

export const LRC_LIMITS = { source: 2 * 1024 * 1024, physicalLines: 10000, tagsPerLine: 128, events: 10000, words: 50000, time: 86400 } as const;
function supportedTime(value: number): number {
  if (!Number.isFinite(value) || Math.abs(value) > LRC_LIMITS.time)
    throw new LyricsError('LRC time or offset exceeds the supported 24-hour range.');
  return value;
}
function matches(input: string, pattern: RegExp, limit: number, label: string) {
  const result: RegExpMatchArray[] = [];
  for (const match of input.matchAll(pattern)) {
    if (result.length >= limit) throw new LyricsError(`LRC exceeds the ${label} limit (${limit}).`);
    result.push(match);
  }
  return result;
}
const timestamp = /^(\d{1,3}):([0-5]\d)(?:[.:](\d{1,3}))?$/;
function seconds(value: string) {
  const match = value.match(timestamp);
  if (!match) throw new LyricsError(`Unsupported LRC timestamp: ${value}. Use mm:ss.xx or mm:ss.xxx.`);
  return supportedTime(Number(match[1]) * 60 + Number(match[2]) + Number(`0.${match[3] || '0'}`));
}

export function parseLrc(source: string): LyricDocument {
  if (source.length > LRC_LIMITS.source) throw new LyricsError('LRC exceeds 2 MB.');
  const physical = matches(source.replace(/^\uFEFF/, ''), /[^\n]*(?:\n|$)/g, LRC_LIMITS.physicalLines + 1, 'physical lines').filter(m => m[0].length);
  if (physical.length > LRC_LIMITS.physicalLines) throw new LyricsError('LRC exceeds the physical lines limit.');
  const lines: LyricLine[] = [], notices = new Set<string>();
  let offset = 0, offsetTags = 0, wordCount = 0;
  for (const match of physical) {
    const tag = match[0].trim().match(/^\[offset:([^\]]*)\]$/i);
    if (!tag) continue;
    if (!/^[+-]?\d+$/.test(tag[1])) throw new LyricsError('Invalid LRC offset.');
    offset = supportedTime(Number(tag[1]) / 1000); offsetTags++;
  }
  if (offsetTags > 1) notices.add('Multiple offset tags found; the last offset is used.');
  // Positive offsets advance lyrics; small negative effective times are valid.
  for (const [index, raw] of physical.map(match => match[0]).entries()) {
    const row = raw.trim();
    if (!row) continue;
    if (/^\[(?:ar|al|ti|au|by|re|ve|length|offset):[^\]]*\]$/i.test(row)) continue;
    const tags = row.match(/^(?:\[\d[^\]]*\])+/)?.[0];
    if (!tags) throw new LyricsError(`LRC line ${index + 1} has no supported timestamp. Plain text, speaker tags and non-LRC timing extensions are not supported.`);
    const starts = matches(tags, /\[([^\]]+)\]/g, LRC_LIMITS.tagsPerLine, 'timestamps per line').map(match => seconds(match[1]));
    if (lines.length + starts.length > LRC_LIMITS.events) throw new LyricsError('LRC exceeds the total timestamp events limit.');
    const text = row.slice(tags.length);
    if (/\[(?:\d|[a-z]+:)/i.test(text) || /\(\d+,\d+\)/.test(text)) throw new LyricsError(`Unsupported inline timing on LRC line ${index + 1}. Use standard or enhanced LRC.`);
    const words = matches(text, /<(\d{1,3}:[^>]+)>/g, LRC_LIMITS.words, 'word nodes');
    // Count expanded nodes (including untimed/empty rows), not just visible text.
    wordCount += (words.length + 1) * starts.length;
    if (wordCount > LRC_LIMITS.words) throw new LyricsError('LRC exceeds the total word nodes limit.');
    if (/<\d{1,3}:/.test(text) && !words.length) throw new LyricsError(`Malformed enhanced LRC on line ${index + 1}.`);
    const baseParts: LyricPart[] = [];
    if (words.length) {
      if (words[0].index! > 0) baseParts.push({ text: text.slice(0, words[0].index) });
      for (const [i, word] of words.entries()) {
        const start = seconds(word[1]), next = words[i + 1];
        const content = text.slice(word.index! + word[0].length, next?.index ?? text.length);
        if (/<\d{1,3}:/.test(content)) throw new LyricsError(`Malformed enhanced LRC on line ${index + 1}.`);
        const end = next ? seconds(next[1]) : undefined;
        if (end !== undefined && end < start) throw new LyricsError(`Word timestamps run backwards on LRC line ${index + 1}.`);
        if (!content) continue;
        if (end === undefined || end === start) {
          baseParts.push({ text: content });
          notices.add('Some words have no usable end timestamp. Those words use line highlighting; no word timings were invented.');
        } else baseParts.push({ text: content, start, end });
      }
    } else baseParts.push({ text });
    for (const start of starts) {
      const delta = start - starts[0] - offset;
      const parts = baseParts.map(part => part.start === undefined ? { ...part } : { ...part, start: supportedTime(part.start + delta), end: supportedTime(part.end! + delta) });
      if (parts.some(part => part.start !== undefined && part.start < start - offset - .001)) throw new LyricsError(`A word starts before its line on LRC line ${index + 1}.`);
      lines.push({ id: `lrc-${lines.length}`, groupId: `lrc-${lines.length}`, start: supportedTime(start - offset), parts, role: 'lead', annotations: [] });
    }
  }
  lines.sort((a, b) => a.start - b.start);
  let nextStart: number | undefined;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (i + 1 < lines.length && lines[i + 1].start > lines[i].start) nextStart = lines[i + 1].start;
    // Blank timestamps terminate the previous lyric; equal starts share an end.
    lines[i].end = nextStart;
    if (lines[i].parts.some(part => part.end !== undefined && nextStart !== undefined && part.end > nextStart + .001))
      throw new LyricsError('Enhanced LRC word timing extends beyond the next line. Use TTML for explicit overlapping voices.');
  }
  const visible = lines.filter(line => line.parts.some(part => part.text.trim()));
  if (!visible.length) throw new LyricsError('This LRC file contains no timed lyric text.');
  if (visible.length > 5000) throw new LyricsError('This file exceeds the limit of 5,000 lyric lines.');
  return { format: 'lrc', timing: timingKind(visible), lines: visible, agents: {}, notices: [...notices] };
}
