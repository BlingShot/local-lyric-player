export interface LyricPart { text: string; start?: number; end?: number; agent?: string }
export interface LyricAnnotation { text: string; kind: 'translation' | 'romanization'; language?: string }
export interface LyricLine {
  id: string;
  groupId: string;
  start: number;
  end?: number;
  parts: LyricPart[];
  role: 'lead' | 'background';
  agent?: string;
  section?: string;
  annotations: LyricAnnotation[];
}
export interface LyricDocument {
  format: 'lrc' | 'ttml';
  timing: 'line' | 'word' | 'mixed';
  profile?: 'standard' | 'apple';
  lines: LyricLine[];
  agents: Record<string, string>;
  notices: string[];
}
export interface SavedLyrics {
  trackId: string;
  fileName: string;
  source: string;
  document: LyricDocument;
  parserVersion: number;
  savedAt: number;
  origin?: 'file' | 'embedded' | 'amll';
  remote?: { isrc: string; spotifyId: string; authors: string[] };
  offsetMs?: number;
}
export class LyricsError extends Error {
  constructor(message: string) { super(message); this.name = 'LyricsError'; }
}
export function timingKind(lines: readonly LyricLine[]): LyricDocument['timing'] {
  const parts = lines.flatMap(line => line.parts).filter(part => part.text.trim());
  const timed = parts.filter(part => part.start !== undefined && part.end !== undefined).length;
  return timed === 0 ? 'line' : timed === parts.length ? 'word' : 'mixed';
}
