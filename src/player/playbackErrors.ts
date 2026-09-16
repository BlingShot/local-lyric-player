export type PlaybackErrorKind = 'device-unavailable' | 'device-exclusive-busy' | 'backend-stopped' | 'file-unavailable' | 'decode' | 'timeout' | 'cancelled';
export interface PlaybackErrorInfo { kind: PlaybackErrorKind; message: string }
export interface NativeCommandContext { id: string; generation: number; intent: number; seek: number; playing: boolean }
export type NativeAudioResult = { ok: true } | { ok: false; error: PlaybackErrorInfo };
const kinds = new Set<PlaybackErrorKind>(['device-unavailable', 'device-exclusive-busy', 'backend-stopped', 'file-unavailable', 'decode', 'timeout', 'cancelled']);
export function playbackError(error: unknown): PlaybackErrorInfo | undefined {
  if (!error || typeof error !== 'object' || !('kind' in error) || !kinds.has(error.kind as PlaybackErrorKind) || !('message' in error) || typeof error.message !== 'string') return;
  return { kind: error.kind as PlaybackErrorKind, message: error.message };
}
export class NativePlaybackError extends Error {
  kind: PlaybackErrorKind;
  constructor(info: PlaybackErrorInfo) { super(info.message); this.kind = info.kind; this.name = info.kind === 'cancelled' ? 'AbortError' : 'NativePlaybackError'; }
}
export function unwrapAudioResult(result: NativeAudioResult | void) {
  // Void remains accepted for injected/older bridges; production sends a plain envelope.
  if (result && !result.ok) throw new NativePlaybackError(result.error);
}
export const isMediaFailure = (kind: PlaybackErrorKind) => kind === 'decode' || kind === 'file-unavailable';
