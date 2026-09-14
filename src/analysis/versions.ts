import type { TrackRecord } from '../library/database.ts';
import type { InputVersions } from './types.ts';

export const audioVersion = (track: TrackRecord) => track.audioRevision || JSON.stringify([track.id, track.size, track.lastModified, track.addedAt]);
export async function fingerprint(value: unknown) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
export function staleReasons(saved: InputVersions, current: InputVersions) {
  const reasons: string[] = [];
  if (saved.lyrics && (saved.lyrics.kind !== current.lyrics?.kind || saved.lyrics.fingerprint !== current.lyrics.fingerprint)) reasons.push('The lyrics or selected lyric source changed. Lyrics insights may need updating.');
  if (saved.audio && Object.entries(saved.audio).some(([id, version]) => current.audio?.[id] !== version)) reasons.push('The audio source changed or is unavailable. Audio analysis needs to be run again.');
  if (saved.metadata && saved.metadata !== current.metadata) reasons.push('Library metadata changed. Review or regenerate the suggestions.');
  return reasons;
}
