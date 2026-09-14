import { openLibraryDatabase, recordFor } from '../library/database';
import type { LocalTrack } from '../library/importFiles';
import { readLyrics } from '../lyrics/repository';
import { readStudioDraft } from '../studio/repository';
import { audioVersion, fingerprint } from './versions';
import type { AnalysisInput, LyricsInput } from './types';

export async function readAnalysisSources(track: LocalTrack, tracks: readonly LocalTrack[]) {
  const [imported, studio] = await Promise.all([readLyrics(track.id), readStudioDraft(track.id)]);
  const lyrics: LyricsInput[] = [];
  const add = async (kind: LyricsInput['kind'], label: string, lines: LyricsInput['lines']) => {
    const visible = lines.filter(line => line.text.trim());
    if (visible.length) lyrics.push({ kind, label, lines: visible, fingerprint: await fingerprint(visible.map(line => line.text)) });
  };
  if (studio) await add('studio', 'Lyric Studio draft', studio.lines.map(line => ({ id: line.id, text: line.text, start: line.startMs === null ? undefined : line.startMs / 1000 })));
  if (imported) await add('imported', 'Imported / embedded lyrics', imported.document.lines.map(line => ({ id: line.id, text: line.parts.map(part => part.text).join(''), start: line.start + (imported.offsetMs || 0) / 1000 })));
  const metadata = await fingerprint([track.name, track.artist, track.album, track.albumArtist, track.trackNumber, track.discNumber, track.releaseDate, track.artworkSource, audioVersion(track)]);
  const audio = Object.fromEntries(tracks.filter(item => !item.unavailable).map(item => [item.id, audioVersion(item)]));
  const input = (source?: LyricsInput): AnalysisInput => ({ track: recordFor(track), lyrics: source, audioScope: { kind: 'track', trackIds: [track.id] },
    versions: { audio, metadata, lyrics: source && { kind: source.kind, fingerprint: source.fingerprint } },
    readAudio: async (id = track.id) => {
      const db = await openLibraryDatabase();
      return new Promise<Blob>((resolve, reject) => {
        const tx = db.transaction(['tracks', 'audio']);
        const record = tx.objectStore('tracks').get(id), data = tx.objectStore('audio').get(id);
        tx.oncomplete = () => {
          if (!record.result || audioVersion(record.result) !== audio[id]) { reject(new Error('The audio changed. Refresh the analysis inputs before running.')); return; }
          if (!(data.result instanceof Blob) || !data.result.size) { reject(new Error('The saved audio cannot be accessed. Restore the original file first.')); return; }
          resolve(data.result);
        };
        tx.onabort = () => reject(tx.error);
      });
    },
  });
  return { lyrics, input };
}
