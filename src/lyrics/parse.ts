import { parseLrc } from './parseLrc';
import { importProjectTtml } from '../studio/projectImport';
import { projectToPlayer } from '../studio/playerAdapter';
import { LyricsError } from './types';

export const LYRICS_PARSER_VERSION = 2;
export function parseLyrics(source: string, fileName: string) {
  if (source.length > 2 * 1024 * 1024) throw new LyricsError('Lyrics must be smaller than 2 MB.');
  if (/\.ttml$/i.test(fileName)) return projectToPlayer(importProjectTtml(source, '', fileName));
  if (/\.lrc$/i.test(fileName)) return parseLrc(source);
  throw new LyricsError('Choose a .ttml or .lrc lyric file.');
}
