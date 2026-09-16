import type { SavedLyrics } from './types.ts';
/** Opaque CAS token. Legacy records stay readable without rewriting user data. */
export function lyricRevision(record?: SavedLyrics): string | null {
  if (!record) return null;
  return record.revision ?? `legacy:${JSON.stringify([record.source, record.savedAt, record.offsetMs ?? 0, record.fileName])}`;
}
export function revisedLyrics(record: SavedLyrics): SavedLyrics {
  return { ...record, revision: crypto.randomUUID() };
}
