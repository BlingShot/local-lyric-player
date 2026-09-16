import { exportName } from './export.ts';
import { msText, type StudioProject, type VocalLine, type Unit } from './project.ts';
import { lineBounds, validateProject, type TtmlMode } from './validation.ts';

export { exportName };
export const NS = { tt: 'http://www.w3.org/ns/ttml', meta: 'http://www.w3.org/ns/ttml#metadata', apple: 'http://music.apple.com/lyric-ttml-internal', amll: 'http://www.example.com/ns/amll', xml: 'http://www.w3.org/XML/1998/namespace', param: 'http://www.w3.org/ns/ttml#parameter', xmlns: 'http://www.w3.org/2000/xmlns/' };
export const escapeXml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const time = (ms: number) => `${(ms / 1000).toFixed(3)}s`;
// Valid XML IDs are encoded reversibly without confusing display names and identities.
const xmlId = (id: string) => `id_${Array.from(new TextEncoder().encode(id)).map(b => b.toString(16).padStart(2, '0')).join('')}`;
export function decodeId(value: string) { if (!/^id_(?:[\da-f]{2})+$/i.test(value)) return value; try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(value.slice(3).match(/../g)!, h => parseInt(h, 16)));
    return decoded && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(decoded) ? decoded : value;
  } catch { return value; } }
export function exportProjectTtml(project: StudioProject, durationMs: number, mode: TtmlMode, target: 'player' | 'amll' = 'player'): string {
  const errors = validateProject(project, durationMs, mode).filter(i => i.severity === 'error');
  if (errors.length) throw new Error(errors[0].message);
  const e = escapeXml;
  const agent = (id?: string) => id ? ` ttm:agent="${xmlId(id)}"` : '';
  const annotations = (line: VocalLine) => line.annotations.filter(a => a.text).map(a => `<span xml:id="${xmlId(a.id)}" ttm:role="${a.kind === 'translation' ? 'x-translation' : 'x-roman'}"${a.language ? ` xml:lang="${e(a.language)}"` : ''}>${e(a.text)}</span>`).join('');
  const content = (line: VocalLine, inherited?: string) => line.units.map(w => {
    const performer = w.performerId || line.performerId;
    const attrs = performer !== inherited ? agent(performer) : '';
    if (w.kind === 'separator') return e(w.text);
    const times = mode === 'word' ? ` begin="${time(w.startMs!)}" end="${time(w.endMs!)}"` : '';
    return `<span xml:id="${xmlId(w.id)}"${times}${attrs}>${e(w.text)}</span>`;
  }).join('');
  const uniform = (line: VocalLine) => { const set = new Set(line.units.filter(w => w.kind === 'word').map(w => w.performerId || line.performerId)); return set.size === 1 ? [...set][0] : undefined; };
  let key = 0;
  const paragraph = (line: VocalLine, bgs: VocalLine[] = [], id = line.id, common = false) => {
    const b = lineBounds(project, line, durationMs), ranges = bgs.map(bg => lineBounds(project, bg, durationMs));
    const start = Math.min(b.start!, ...ranges.map(b => b.start!)), end = Math.max(b.end!, ...ranges.map(b => b.end!));
    const singer = uniform(line);
    const main = content(line, singer) + annotations(line);
    // The p is a timing container for all voices. The main span retains its own bounds.
    const body = bgs.length && !common ? `<span ttm:role="x-lead" begin="${time(b.start!)}" end="${time(b.end!)}"${agent(singer)}>${main}</span>` : main;
    const bg = bgs.map(l => { const t = lineBounds(project, l, durationMs), a = uniform(l); return `<span xml:id="${xmlId(l.id)}" ttm:role="x-bg" begin="${time(t.start!)}" end="${time(t.end!)}"${common ? '' : agent(a)}>${content(l, a)}${annotations(l)}</span>`; }).join('');
    return `<p xml:id="${xmlId(id)}" itunes:key="L${++key}" begin="${time(start)}" end="${time(end)}"${bgs.length && !common ? '' : agent(singer)} xml:space="preserve">${body}${bg}</p>`;
  };
  const render = (line: VocalLine) => {
    const bgs = project.lines.filter(l => l.parentId === line.id);
    const b = lineBounds(project, line, durationMs), singer = uniform(line);
    const common = bgs.length <= 1 && !!singer && bgs.every(bg => { const t = lineBounds(project, bg, durationMs); return uniform(bg) === singer && t.start! >= b.start! && t.end! <= b.end!; });
    if (target === 'player' || common) return paragraph(line, bgs, line.id, common);
    // User-selected conversion: each Performer phrase / background layer becomes a p.
    const all = [line, ...bgs];
    return all.flatMap(v => {
      const groups: { performerId?: string; words: Unit[] }[] = [];
      for (const w of v.units) { const performerId = w.performerId || v.performerId; const last = groups.at(-1); if (last && last.words.every(w => w.kind === 'separator')) { last.performerId = performerId; last.words.push(w); } else if (last && (w.kind === 'separator' || last.performerId === performerId)) last.words.push(w); else groups.push({ performerId, words: [w] }); }
      return groups.map((g, i) => {
        const words = g.words.filter(w => w.kind === 'word');
        const startMs = mode === 'word' && words.length ? Math.min(...words.map(w => w.startMs!)) : v.startMs;
        const endMs = mode === 'word' && words.length ? Math.max(...words.map(w => w.endMs!)) : v.endMs;
        return paragraph({ ...v, performerId: g.performerId, units: g.words, text: g.words.map(w => w.text).join(''), startMs, endMs, annotations: i ? [] : v.annotations }, [], `${v.id}-phrase-${i}`);
      });
    }).join('');
  };
  const names: Record<string, string> = { PRECHORUS: 'PreChorus', INSTRUMENTAL: 'Instrumental' };
  const rendered = new Set<string>(), divs: string[] = [];
  for (const line of project.lines.filter(l => l.role === 'lead')) {
    if (rendered.has(line.id)) continue;
    const section = project.sections.find(s => s.lineIds.includes(line.id));
    const lines = section ? section.lineIds.map(id => project.lines.find(l => l.id === id)!).filter(Boolean) : [line];
    lines.forEach(l => rendered.add(l.id));
    divs.push(`<div${section ? ` xml:id="${xmlId(section.id)}" itunes:song-part="${names[section.tag] || section.tag[0] + section.tag.slice(1).toLowerCase()}"${section.startMs !== null ? ` begin="${time(section.startMs)}" end="${time(section.endMs!)}"` : ''}` : ''}>${lines.map(render).join('')}</div>`);
  }
  for (const s of project.sections.filter(s => !s.lineIds.length)) divs.push(`<div xml:id="${xmlId(s.id)}" itunes:song-part="${names[s.tag] || s.tag[0] + s.tag.slice(1).toLowerCase()}" begin="${time(s.startMs!)}" end="${time(s.endMs!)}"/>`);
  const metadata = project.performers.map(p => `<ttm:agent xml:id="${xmlId(p.id)}" type="${p.type}"><ttm:name>${e(p.name)}</ttm:name></ttm:agent>`).join('');
  const metas: Record<string, string[]> = { ...project.metadata.extra, musicName: project.metadata.title ? [project.metadata.title] : [], artists: project.metadata.artist ? [project.metadata.artist] : [], album: project.metadata.album ? [project.metadata.album] : [] };
  delete metas['localMusic:idEncoding'];
  const extra = Object.entries(metas).flatMap(([key, values]) => values.map(value => `<amll:meta key="${e(key)}" value="${e(value)}"/>`)).join('');
  const boundaryMeta = project.boundaries ? Object.entries(project.boundaries).filter(([, value]) => value !== null).map(([key, value]) => `<amll:meta key="localMusic:lyric${key === 'startMs' ? 'Start' : 'End'}Ms" value="${value}"/>`).join('') : '';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<tt xmlns="${NS.tt}" xmlns:ttm="${NS.meta}" xmlns:itunes="${NS.apple}" xmlns:amll="${NS.amll}" xml:lang="${e(project.metadata.language || 'und')}" itunes:timing="${mode === 'word' ? 'Word' : 'Line'}"><head><metadata><amll:meta key="localMusic:idEncoding" value="utf8-hex-v1"/>${metadata}${extra}${boundaryMeta}</metadata></head><body>${divs.join('')}</body></tt>\n`;
}
export interface LrcPolicy { voices: 'lead' | 'all'; annotations: 'omit' | 'append' }
export function exportProjectLrc(project: StudioProject, durationMs: number, policy: LrcPolicy): string {
  const errors = validateProject(project, durationMs, 'line').filter(i => i.severity === 'error'); if (errors.length) throw new Error(errors[0].message);
  const lines = project.lines.filter(l => policy.voices === 'all' || l.role === 'lead');
  const cues = lines.map(l => { const b = lineBounds(project, l, durationMs); const text = l.text + (policy.annotations === 'append' ? l.annotations.filter(a => a.text).map(a => ` / ${a.text}`).join('') : ''); if (/\[\d[^\]]*\]|\[(?:[a-z]+):|<\d{1,3}:|\(\d+,\d+\)/i.test(text)) throw new Error('Text resembles LRC timing syntax; use TTML to preserve it literally.'); return { ...b, text }; }).sort((a, b) => a.start! - b.start!);
  const rows = cues.map(c => ({ time: c.start!, text: c.text }));
  if (project.boundaries) for (const value of Object.values(project.boundaries)) if (value !== null) rows.push({ time: value, text: '' });
  // Never insert a blank cue while any voice is still singing.
  for (const c of cues) if (!cues.some(other => other.start! <= c.end! && other.end! > c.end!)) rows.push({ time: c.end!, text: '' });
  return rows.sort((a, b) => a.time - b.time || Number(!a.text) - Number(!b.text)).filter((r, i, a) => r.text || !a.slice(0, i).some(v => v.time === r.time && !v.text)).map(r => `[${msText(r.time)}]${r.text}`).join('\n') + '\n';
}
