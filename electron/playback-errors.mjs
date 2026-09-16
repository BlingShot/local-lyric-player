export const faultKinds = new Set(['device-unavailable', 'device-exclusive-busy', 'backend-stopped', 'file-unavailable', 'decode', 'timeout', 'cancelled']);
export class PlaybackFault extends Error {
  constructor(kind, message) { super(message); this.name = kind === 'cancelled' ? 'AbortError' : 'PlaybackFault'; this.kind = kind; }
}
export function faultInfo(error, fallback = 'backend-stopped') {
  return { kind: faultKinds.has(error?.kind) ? error.kind : fallback,
    message: String(error?.message || error || 'Native audio failed.').slice(0, 2000) };
}
export async function audioResult(action) {
  try { await action(); return { ok: true }; }
  catch (error) { return { ok: false, error: faultInfo(error) }; }
}
/** Interpret documented mpv error strings only at the helper boundary.
 * Unknown failures are never evidence that every file in the queue is broken.
 */
export function mpvFault(message, exclusive = false) {
  const text = String(message || 'unknown error');
  if (['unrecognized file format', 'audio/video decoding failed', 'decoding failed'].includes(text))
    return new PlaybackFault('decode', `Audio decoding failed: ${text}.`);
  if (text === 'loading failed') return new PlaybackFault('file-unavailable', 'The saved audio copy could not be read.');
  if (text === 'audio output initialization failed') return new PlaybackFault('device-unavailable',
    exclusive ? 'The exclusive audio output could not open. Check the device or other applications; shared mode was not selected automatically.' : 'The audio output could not open. Check the selected device.');
  return new PlaybackFault('backend-stopped', `Native audio stopped: ${text}. Check the output and retry this song.`);
}
