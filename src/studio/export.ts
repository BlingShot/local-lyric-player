import { lineEnd, parseStudioTime, studioTime, validateStudio, type StudioDraft } from './model.ts';

const xmlText = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
export function exportName(fileName: string) {
  return (fileName.replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').slice(0, 180) || 'Lyrics');
}
export function exportLyrics(draft: StudioDraft, duration: number, format: 'ttml' | 'lrc') {
  const issues = validateStudio(draft.lines, duration, format);
  if (issues.length) throw new Error(issues[0].message);
  if (format === 'ttml') {
    const rows = draft.lines.map((line, index) => `      <p begin="${(parseStudioTime(line.start)!).toFixed(3)}s" end="${lineEnd(draft.lines, index, duration)!.toFixed(3)}s" xml:space="preserve">${xmlText(line.text)}</p>`);
    return `<?xml version="1.0" encoding="UTF-8"?>\n<tt xmlns="http://www.w3.org/ns/ttml" xml:lang="und">\n  <body>\n    <div>\n${rows.join('\n')}\n    </div>\n  </body>\n</tt>\n`;
  }
  const rows: { time: number; text: string }[] = [];
  for (const [index, line] of draft.lines.entries()) {
    const start = parseStudioTime(line.start)!, end = lineEnd(draft.lines, index, duration)!;
    rows.push({ time: start, text: line.text });
    const next = draft.lines.map(item => parseStudioTime(item.start)!).find(time => time > start);
    // A blank timed cue preserves explicit gaps and the final line's end in standard LRC.
    if (next === undefined || end < next) rows.push({ time: end, text: '' });
  }
  return rows.sort((a, b) => a.time - b.time).filter((row, index, all) => row.text || !index || all[index - 1].text || row.time !== all[index - 1].time)
    .map(row => `[${studioTime(row.time)}]${row.text}`).join('\n') + '\n';
}
