import type { IAudioMetadata } from 'music-metadata';

/** Recording identifiers come from tags, independently of display-name aliases. */
export function recordingMetadata({ common }: IAudioMetadata) {
  const isrc = common.isrc?.map(value => value.replace(/[-\s]/g, '').toUpperCase())
    .find(value => /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(value));
  let spotifyId: string | undefined;
  for (const comment of common.comment ?? []) {
    try {
      const url = new URL(comment.text?.trim() || '');
      if (url.protocol === 'https:' && url.hostname === 'open.spotify.com') {
        spotifyId = url.pathname.match(/^\/(?:intl-[a-z]+\/)?track\/([A-Za-z0-9]{22})\/?$/)?.[1];
        if (spotifyId) break;
      }
    } catch { /* Ordinary comments are not recording URLs. */ }
  }
  return { isrc, spotifyId, recordingMetadataVersion: 1 };
}
