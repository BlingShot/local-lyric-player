import { LyricsError, timingKind, type LyricDocument, type LyricLine, type LyricPart } from './types.ts';

const timestamp = /^(\d{1,3}):([0-5]\d)(?:[.:](\d{1,3}))?$/;
function seconds(value: string) {
  const match = value.match(timestamp);
  if (!match) throw new LyricsError(`Unsupported LRC timestamp: ${value}. Use mm:ss.xx or mm:ss.xxx.`);
  return Number(match[1]) * 60 + Number(match[2]) + Number(`0.${match[3] || '0'}`);
}

export function parseLrc(source: string): LyricDocument {
  const lines: LyricLine[] = [], notices = new Set<string>();
  const offsets = [...source.matchAll(/^\s*\[offset:([+-]?\d+)\]\s*$/gim)];
  if (offsets.length > 1) notices.add('Multiple offset tags found; the last offset is used.');
  // LRC positive offsets advance lyrics relative to the audio.
  const offset = offsets.length ? Number(offsets[offsets.length - 1][1]) / 1000 : 0;
  for (const [index, raw] of source.replace(/^\uFEFF/, '').split(/\r?\n/).entries()) {
    const row = raw.trim();
    if (!row) continue;
    if (/^\[(?:ar|al|ti|au|by|re|ve|length|offset):[^\]]*\]$/i.test(row)) continue;
    const tags = row.match(/^(?:\[\d[^\]]*\])+/)?.[0];
    if (!tags) throw new LyricsError(`LRC line ${index + 1} has no supported timestamp. Plain text, speaker tags and non-LRC timing extensions are not supported.`);
    const starts = [...tags.matchAll(/\[([^\]]+)\]/g)].map(match => seconds(match[1]));
    const text = row.slice(tags.length);
    if (/\[(?:\d|[a-z]+:)/i.test(text) || /\(\d+,\d+\)/.test(text)) throw new LyricsError(`Unsupported inline timing on LRC line ${index + 1}. Use standard or enhanced LRC.`);
    const words = [...text.matchAll(/<(\d{1,3}:[^>]+)>/g)];
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
      const parts = baseParts.map(part => part.start === undefined ? { ...part } : { ...part, start: part.start + delta, end: part.end! + delta });
      if (parts.some(part => part.start !== undefined && part.start < start - offset - .001)) throw new LyricsError(`A word starts before its line on LRC line ${index + 1}.`);
      lines.push({ id: `lrc-${lines.length}`, groupId: `lrc-${lines.length}`, start: start - offset, parts, role: 'lead', annotations: [] });
    }
  }
  lines.sort((a, b) => a.start - b.start);
  for (let i = 0; i < lines.length; i++) {
    const next = lines.slice(i + 1).find(line => line.start > lines[i].start);
    // Blank timestamped lines still terminate the previous line (instrumental gaps).
    lines[i].end = next?.start;
    if (lines[i].parts.some(part => part.end !== undefined && next && part.end > next.start + .001)) {
      throw new LyricsError('Enhanced LRC word timing extends beyond the next line. Use TTML for explicit overlapping voices.');
    }
  }
  const visible = lines.filter(line => line.parts.some(part => part.text.trim()));
  if (!visible.length) throw new LyricsError('This LRC file contains no timed lyric text.');
  if (visible.length > 5000) throw new LyricsError('This file exceeds the limit of 5,000 lyric lines.');
  return { format: 'lrc', timing: timingKind(visible), lines: visible, agents: {}, notices: [...notices] };
}
