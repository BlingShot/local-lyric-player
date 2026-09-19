import type { LyricDocument, SavedLyrics } from './types';

export interface LyricCapabilities {
  hasLyrics: boolean;
  hasWordTiming: boolean;
  hasMultiplePerformers: boolean;
  hasTranslations: boolean;
}

export function lyricCapabilities(document?: LyricDocument): LyricCapabilities {
  if (!document) return { hasLyrics: false, hasWordTiming: false, hasMultiplePerformers: false, hasTranslations: false };
  const performers = new Set(document.lines.map(line => line.agent).filter((agent): agent is string => !!agent));
  const words = document.lines.flatMap(line => line.parts).filter(part => part.text.trim());
  const timedWords = words.filter(part => part.start !== undefined && part.end !== undefined).length;
  return {
    hasLyrics: true,
    hasWordTiming: timedWords > 0,
    hasMultiplePerformers: performers.size > 1,
    hasTranslations: document.lines.some(line => line.annotations.some(annotation => annotation.kind === 'translation')),
  };
}

export function selectEmbeddedVariant(record: SavedLyrics, format: 'lrc' | 'ttml'): SavedLyrics {
  if (record.document.format === format) return record;
  const alternate = record.alternates?.find(variant => variant.document.format === format);
  if (!alternate) return record;
  const previous = { format: record.document.format, fileName: record.fileName, source: record.source,
    document: record.document, origin: record.origin, offsetMs: record.offsetMs };
  return { ...record, fileName: alternate.fileName, source: alternate.source, document: alternate.document,
    origin: alternate.origin ?? record.origin, offsetMs: alternate.offsetMs ?? 0,
    alternates: [previous, ...(record.alternates ?? []).filter(item => item !== alternate)] };
}
