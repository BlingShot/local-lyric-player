import type { LocalTrack } from './importFiles';
import type { EmbeddedLyrics } from '../lyrics/embedded';
import type { AudioAnalysisMetadata } from './analysisMetadata';
import { parseLyrics } from '../lyrics/parse';
export interface AudioTagsResult { tags: Partial<LocalTrack>; cover?: Blob; lyrics?: EmbeddedLyrics; ttml?: EmbeddedLyrics }

export function readAudioAnalysisMetadata(file: File, signal: AbortSignal): Promise<AudioAnalysisMetadata> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const worker = new Worker(new URL('./metadata.worker.ts', import.meta.url), { type: 'module' });
    const cleanup = () => { clearTimeout(timeout); worker.terminate(); signal.removeEventListener('abort', abort); };
    const fail = (error: unknown) => { cleanup(); reject(error); };
    const abort = () => fail(new DOMException('Cancelled', 'AbortError'));
    const timeout = setTimeout(() => fail(new Error('Reading audio metadata timed out.')), 20000);
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = event => { cleanup(); if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data.metadata); };
    worker.onerror = event => { event.preventDefault(); fail(new Error('The local metadata reader could not start.')); };
    try { worker.postMessage({ file, analysisOnly: true }); }
    catch (error) { fail(error); }
  });
}

export function readAudioTags(file: File, durationOnly = false): Promise<AudioTagsResult> {
  return new Promise(resolve => {
    const worker = new Worker(new URL('./metadata.worker.ts', import.meta.url), { type: 'module' });
    const finish = (result: AudioTagsResult) => {
      clearTimeout(timeout); worker.terminate(); resolve(result);
    };
    const fallback = () => finish({ tags: { embeddedLyricsChecked: true, lyricsWarning: 'Embedded lyrics could not be read in time. Import a local lyric file if needed.',
      ...(durationOnly ? { durationChecked: true, analysisMetadata: { tags: {}, technicalVersion: 1 } } : { name: file.name, fileName: file.name,
      durationChecked: true, tagWarning: 'Audio tags could not be read in time. File-name fallback is in use.' }) } });
    const timeout = setTimeout(fallback, 20000);
    worker.onmessage = event => {
      const result: AudioTagsResult = event.data;
      if (typeof event.data.ttmlSource === 'string') {
        try {
          const document = parseLyrics(event.data.ttmlSource, 'embedded.ttml');
          result.ttml = { source: event.data.ttmlSource, document };
          result.tags.lyricsWarning = document.notices.join(' ') || result.tags.lyricsWarning;
        } catch {
          result.tags.lyricsWarning = result.tags.lyricsWarning || 'Embedded TTML could not be parsed. Import a supported lyric file.';
        }
      }
      finish(result);
    };
    worker.onerror = event => { event.preventDefault(); fallback(); };
    worker.postMessage({ file, durationOnly });
  });
}

export async function validateCover(file: File) {
  if (!/^image\/(jpeg|png|webp|gif)$/i.test(file.type) || !file.size || file.size > 20 * 1024 * 1024) {
    throw new Error('Choose a PNG, JPEG, WebP or GIF image under 20 MB.');
  }
  try { const image = await createImageBitmap(file); image.close(); }
  catch { throw new Error('This cover image cannot be read. Choose another image.'); }
  return file;
}
