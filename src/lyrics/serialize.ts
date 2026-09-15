import type { LyricDocument, LyricLine } from './types';

const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const id = (value: string) => `id_${[...new TextEncoder().encode(value)].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
const time = (value: number) => `${value.toFixed(3)}s`;
// A mixed-timing writer: only timed words receive begin/end attributes. No re-tokenizing.
export function serializeLyrics(document: LyricDocument, duration: number, metadata: { name: string; artist?: string; album?: string }) {
  const bounds = (line: LyricLine) => {
    const end = line.end ?? document.lines.find(other => other.start > line.start)?.start ?? duration;
    if (!Number.isFinite(end) || end <= line.start) throw new Error('The final lyric needs an end time or a known audio duration before saving translation.');
    return { start: line.start, end };
  };
  const agents = new Set([...Object.keys(document.agents), ...document.lines.flatMap(line => [line.agent, ...line.parts.map(part => part.agent)]).filter((value): value is string => !!value).flatMap(value => value.split(/\s+/))]);
  const agent = (value?: string) => value ? ` ttm:agent="${value.split(/\s+/).map(id).join(' ')}"` : '';
  const content = (line: LyricLine) => line.parts.map(part => {
    const timing = part.start !== undefined && part.end !== undefined && part.end > part.start ? ` begin="${time(part.start)}" end="${time(part.end)}"` : '';
    return `<span${timing}${agent(part.agent)}>${escape(part.text)}</span>`;
  }).join('') + line.annotations.map((annotation, index) => `<span xml:id="${id(`${line.id}-annotation-${index}`)}" ttm:role="${annotation.kind === 'translation' ? 'x-translation' : 'x-roman'}"${annotation.language ? ` xml:lang="${escape(annotation.language)}"` : ''}>${escape(annotation.text)}</span>`).join('');
  const leads = document.lines.filter(line => line.role === 'lead');
  if (document.lines.some(line => line.role === 'background' && !leads.some(lead => lead.groupId === line.groupId))) throw new Error('A background lyric has no parent. Keep the original lyrics and repair its grouping first.');
  const body = leads.map(line => {
    const bg = document.lines.filter(other => other.role === 'background' && other.groupId === line.groupId), own = bounds(line), ranges = bg.map(bounds);
    const start = Math.min(own.start, ...ranges.map(range => range.start)), end = Math.max(own.end, ...ranges.map(range => range.end));
    const main = `<span ttm:role="x-lead" begin="${time(own.start)}" end="${time(own.end)}"${agent(line.agent)}>${content(line)}</span>`;
    const backing = bg.map(other => { const range = bounds(other); return `<span xml:id="${id(other.id)}" ttm:role="x-bg" begin="${time(range.start)}" end="${time(range.end)}"${agent(other.agent)}>${content(other)}</span>`; }).join('');
    return `<div${line.section ? ` itunes:song-part="${escape(line.section)}"` : ''}><p xml:id="${id(line.id)}" begin="${time(start)}" end="${time(end)}" xml:space="preserve">${main}${backing}</p></div>`;
  }).join('');
  const head = [...agents].map(value => `<ttm:agent xml:id="${id(value)}" type="person"><ttm:name>${escape(document.agents[value] || value)}</ttm:name></ttm:agent>`).join('')
    + Object.entries({ musicName: metadata.name, artists: metadata.artist, album: metadata.album }).filter(([, value]) => value).map(([key, value]) => `<amll:meta key="${key}" value="${escape(value!)}"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" xmlns:amll="http://www.example.com/ns/amll" xml:lang="und" itunes:timing="Word"><head><metadata>${head}</metadata></head><body>${body}</body></tt>\n`;
}
