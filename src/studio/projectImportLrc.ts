import { parseLrc } from '../lyrics/parseLrc.ts';
import { fromPreview } from './project.ts';

// Blank cues at the outer edges can carry the editor's boundaries. Inner blank
// cues are interludes and stay in the normal LRC parser's explicit line endings.
export function importProjectLrc(source: string, trackId: string, audioName: string) {
  const document = parseLrc(source), project = fromPreview(document, trackId, audioName);
  const offsets = [...source.matchAll(/^\s*\[offset:([+-]?\d+)\]\s*$/gim)];
  const offset = offsets.length ? Number(offsets.at(-1)![1]) : 0;
  const blank = source.replace(/^\uFEFF/, '').split(/\r?\n/).flatMap(row => {
    if (!/^(?:\[\d{1,3}:[0-5]\d(?:[.:]\d{1,3})?\])+\s*$/.test(row.trim())) return [];
    return [...row.matchAll(/\[(\d{1,3}):([0-5]\d)(?:[.:](\d{1,3}))?\]/g)].map(m => Math.round((Number(m[1]) * 60 + Number(m[2]) + Number(`0.${m[3] || '0'}`)) * 1000) - offset);
  }).filter(n => Number.isSafeInteger(n) && n >= 0).sort((a,b) => a-b);
  const startMs = blank[0], endMs = blank.at(-1);
  if (endMs !== undefined && endMs > project.lines.at(-1)!.startMs!) project.boundaries = { startMs: startMs !== undefined && startMs <= project.lines[0].startMs! ? startMs : null, endMs };
  return project;
}
