import { openLibraryDatabase } from '../library/database';
import { LYRICS_PARSER_VERSION, parseLyrics } from './parse';
import { LyricsError, type SavedLyrics } from './types';

export async function readLyrics(trackId: string): Promise<SavedLyrics | undefined> {
  const db = await openLibraryDatabase();
  const record = await new Promise<SavedLyrics | undefined>((resolve, reject) => {
    const request = db.transaction('lyrics', 'readonly').objectStore('lyrics').get(trackId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  if (!record) return undefined;
  if (record.parserVersion !== LYRICS_PARSER_VERSION) return { ...record, document: parseLyrics(record.source, record.fileName), parserVersion: LYRICS_PARSER_VERSION };
  return record;
}

export async function saveLyrics(record: SavedLyrics) {
  const db = await openLibraryDatabase();
  // Check track membership and save in the same transaction, including concurrent removal.
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['tracks', 'lyrics'], 'readwrite');
    let failure: unknown;
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(failure ?? tx.error ?? new Error('The lyric save was cancelled.'));
    tx.onerror = () => {};
    const request = tx.objectStore('tracks').getKey(record.trackId);
    request.onsuccess = () => {
      if (request.result === undefined) { failure = new LyricsError('This track was removed. Select another track before importing lyrics.'); tx.abort(); return; }
      try { tx.objectStore('lyrics').put(record, record.trackId); }
      catch (error) { failure = error; tx.abort(); }
    };
  });
  window.dispatchEvent(new CustomEvent('local-lyrics-updated', { detail: record.trackId }));
}

export async function readLyricFile(file: File, trackId: string): Promise<SavedLyrics> {
  if (file.size > 2 * 1024 * 1024) throw new LyricsError('Lyrics must be smaller than 2 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
  let source: string;
  try { source = new TextDecoder(encoding, { fatal: true }).decode(bytes); }
  catch { throw new LyricsError('This file’s encoding is not supported. Save it as UTF-8 (or UTF-16 with a BOM), then import it again.'); }
  const document = parseLyrics(source, file.name);
  return { trackId, fileName: file.name, source, document, parserVersion: LYRICS_PARSER_VERSION, savedAt: Date.now(), origin: 'file' };
}

export async function saveLyricOffset(trackId: string, offsetMs: number, savedAt?: number) {
  if (!Number.isFinite(offsetMs) || Math.abs(offsetMs) > 60000) throw new LyricsError('Choose an offset between −60 and +60 seconds.');
  const db = await openLibraryDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('lyrics', 'readwrite');
    let failure: unknown;
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(failure ?? tx.error); tx.onerror = () => {};
    const request = tx.objectStore('lyrics').get(trackId);
    request.onsuccess = () => {
      if (!request.result) { failure = new LyricsError('This track has no saved lyrics to adjust.'); tx.abort(); return; }
      if (savedAt !== undefined && request.result.savedAt !== savedAt) { failure = new LyricsError('The lyric file changed. Adjust timing for the current lyrics.'); tx.abort(); return; }
      try { tx.objectStore('lyrics').put({ ...request.result, offsetMs: Math.round(offsetMs) }, trackId); }
      catch (error) { failure = error; tx.abort(); }
    };
  });
  window.dispatchEvent(new CustomEvent('local-lyrics-updated', { detail: trackId }));
}
