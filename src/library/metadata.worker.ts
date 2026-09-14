import { parseBlob } from 'music-metadata';
import type { LocalTrack } from './importFiles';
import { extractEmbeddedLrc, extractEmbeddedTtml } from '../lyrics/embedded';
import { analysisMetadata } from './analysisMetadata';

self.onmessage = async (event: MessageEvent<{ file: File; durationOnly?: boolean; analysisOnly?: boolean }>) => {
  const { file, durationOnly, analysisOnly } = event.data;
  try {
    const metadata = await parseBlob(file, { duration: true, skipCovers: durationOnly || analysisOnly });
    const audioMetadata = analysisMetadata(metadata);
    if (analysisOnly) { self.postMessage({ metadata: audioMetadata }); return; }
    const { common, format } = metadata;
    const embedded = extractEmbeddedLrc(metadata);
    const duration = format.duration && Number.isFinite(format.duration) && format.duration > 0 ? format.duration : undefined;
    if (durationOnly) { self.postMessage({ tags: { duration, durationChecked: true, analysisMetadata: audioMetadata, embeddedLyricsChecked: true, lyricsWarning: embedded.warning }, lyrics: embedded.lyrics, ttmlSource: extractEmbeddedTtml(metadata) }); return; }
    const text = (value?: string) => value?.trim() || undefined;
    const positive = (value?: number | null) => value && Number.isInteger(value) && value > 0 ? value : undefined;
    const tags: Partial<LocalTrack> = {
      name: text(common.title) || file.name, fileName: file.name,
      artist: text(common.artist) || common.artists?.filter(Boolean).join(', ') || undefined,
      album: text(common.album), albumArtist: text(common.albumartist) || common.albumartists?.filter(Boolean).join(', ') || undefined,
      trackNumber: positive(common.track.no), discNumber: positive(common.disk.no),
      releaseDate: text(common.releasedate) || text(common.date) || (common.year ? String(common.year) : undefined),
      compilation: common.compilation,
      duration, durationChecked: true, analysisMetadata: audioMetadata,
      embeddedLyricsChecked: true, lyricsWarning: embedded.warning,
    };
    // Prefer a decodable front cover. Never interpret linked artwork as a URL.
    const pictures = [...(common.picture ?? [])].sort((a, b) =>
      Number(b.type?.toLowerCase() === 'cover (front)') - Number(a.type?.toLowerCase() === 'cover (front)'));
    let cover: Blob | undefined;
    for (const picture of pictures) {
      if (!/^image\/(jpeg|jpg|png|webp|gif)$/i.test(picture.format) || picture.data.length > 20 * 1024 * 1024) continue;
      const candidate = new Blob([new Uint8Array(picture.data)], { type: picture.format });
      try {
        const bitmap = await createImageBitmap(candidate);
        bitmap.close(); cover = candidate;
        tags.artworkType = picture.type?.toLowerCase() === 'cover (front)' ? 'front' : 'other';
        break;
      } catch { /* Try another embedded picture, then use a local placeholder. */ }
    }
    if (pictures.length && !cover) tags.tagWarning = 'Embedded artwork could not be read. Choose a local cover image in Edit details.';
    if (cover) tags.artworkSource = 'embedded';
    self.postMessage({ tags, cover, lyrics: embedded.lyrics, ttmlSource: extractEmbeddedTtml(metadata) });
  } catch {
    if (analysisOnly) { self.postMessage({ error: 'Audio metadata could not be read. The file may be damaged or unsupported.' }); return; }
    if (durationOnly) { self.postMessage({ tags: { durationChecked: true, analysisMetadata: { tags: {}, technicalVersion: 1 }, embeddedLyricsChecked: true, lyricsWarning: 'Embedded lyrics could not be read. Import a local lyric file if needed.' } }); return; }
    self.postMessage({ tags: { name: file.name, fileName: file.name,
      durationChecked: true,
      embeddedLyricsChecked: true, lyricsWarning: 'Embedded lyrics could not be read. Import a local lyric file if needed.',
      tagWarning: 'Audio tags could not be read. File-name fallback is in use; playback may be unsupported.' } });
  }
};
