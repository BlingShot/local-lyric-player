import type { IAudioMetadata } from 'music-metadata';
import { parseLrc } from './parseLrc.ts';
import type { LyricDocument } from './types.ts';

export interface EmbeddedLyrics { source: string; document: LyricDocument }
/** Workers return XML as text; DOM parsing is performed in the renderer. */
export function extractEmbeddedTtml(metadata: Pick<IAudioMetadata, 'native' | 'common'>): string | undefined {
  const values: string[] = [];
  const collect = (v: unknown) => {
    if (typeof v === 'string') values.push(v.replace(/\0+$/, ''));
    else if (Array.isArray(v)) v.forEach(collect);
    else if (v && typeof v === 'object' && 'text' in v) collect(v.text);
  };
  for (const tags of Object.values(metadata.native)) for (const tag of tags) if (/^(?:USLT|ULT|SYLT|©lyr|LYRICS|UNSYNCEDLYRICS|WM\/Lyrics|TXXX:(?:LYRICS|UNSYNCEDLYRICS))$/i.test(tag.id)) collect(tag.value);
  for (const tag of metadata.common.lyrics ?? []) collect(tag.text);
  return values.find(v => v.length <= 2 * 1024 * 1024 && /<(?:[\w-]+:)?tt[\s>]/.test(v));
}
export function extractEmbeddedLrc(metadata: Pick<IAudioMetadata, 'native' | 'common'>): { lyrics?: EmbeddedLyrics; warning?: string } {
  const candidates = new Set<string>();
  let found = false;
  const collect = (value: unknown) => {
    if (typeof value === 'string' && value.trim()) candidates.add(value.replace(/\0+$/, ''));
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object' && 'text' in value) collect(value.text);
  };
  // Read original native strings before generic tag normalization loses LRC offsets or word markers.
  for (const tags of Object.values(metadata.native)) for (const tag of tags) {
    if (/^(?:USLT|ULT|SYLT|©lyr|LYRICS|UNSYNCEDLYRICS|WM\/Lyrics|TXXX:(?:LYRICS|UNSYNCEDLYRICS))$/i.test(tag.id)) {
      found = true; collect(tag.value);
    }
  }
  if (!candidates.size) for (const tag of metadata.common.lyrics ?? []) { found = true; collect(tag.text); }
  if (!found) return {};
  const parsed: EmbeddedLyrics[] = [], failures: string[] = [];
  for (const source of candidates) {
    if (!/\[\d{1,3}:\d{2}/.test(source)) continue;
    try {
      if (source.length > 2 * 1024 * 1024) throw new Error('Embedded lyrics exceed the 2 MB limit.');
      parsed.push({ source, document: parseLrc(source) });
    } catch (error) { failures.push(error instanceof Error ? error.message : 'Invalid embedded LRC.'); }
  }
  if (parsed.length) {
    const notes = [...parsed[0].document.notices];
    if (parsed.length > 1) notes.push(`Found ${parsed.length} embedded LRC versions. The first timed version is used; import another lyric file to replace it.`);
    if (failures.length) notes.push(`${failures.length} other embedded lyric entries could not be parsed.`);
    return { lyrics: { ...parsed[0], document: { ...parsed[0].document, notices: notes } }, warning: notes.join(' ') || undefined };
  }
  return { warning: failures.length ? `Embedded LRC could not be read. ${failures[0]} Import a supported LRC or TTML file.`
    : 'Embedded lyrics were found, but they do not contain supported LRC timestamps. Plain text and binary synchronized lyric frames are not converted into invented timings. Import a timed LRC or TTML file.' };
}
