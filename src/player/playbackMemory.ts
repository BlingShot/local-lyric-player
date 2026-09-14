import type { AudioPort, LocalAudioPlayer, PlaybackState } from './LocalAudioPlayer.ts';

export const PLAYBACK_MEMORY_KEY = 'local-music-playback-position';
interface PlaybackBookmark { version: 1; trackId: string | null; position: number }

export function parsePlaybackBookmark(raw: string | null): PlaybackBookmark | undefined {
  if (raw === null) return undefined;
  const value = JSON.parse(raw);
  if (!value || value.version !== 1 || !(value.trackId === null || typeof value.trackId === 'string' && value.trackId.length > 0)
      || !Number.isFinite(value.position) || value.position < 0) throw new Error('Invalid playback bookmark');
  return { version: 1, trackId: value.trackId, position: value.position };
}

interface MemoryOptions {
  player: Pick<LocalAudioPlayer, 'getState' | 'cue' | 'seek'>;
  audio: AudioPort;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  page: EventTarget;
  document: EventTarget & { readonly visibilityState: string };
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  now?: () => number;
}

/** Only a stable song ID and seconds are saved; audio remains in the library database. */
export class PlaybackMemory {
  private options: MemoryOptions;
  private active = false;
  private pending: PlaybackBookmark | undefined;
  private hadTrack = false;
  private lastId: string | null = null;
  private lastStatus: PlaybackState['status'] = 'idle';
  private lastSignature = '';
  private lastAttemptAt = -Infinity;

  constructor(options: MemoryOptions) {
    this.options = options;
    options.audio.addEventListener('loadedmetadata', this.restorePosition);
    options.audio.addEventListener('durationchange', this.restorePosition);
    options.audio.addEventListener('seeked', this.flush);
    options.page.addEventListener('pagehide', this.flush);
    options.document.addEventListener('visibilitychange', this.visibilityChanged);
  }

  restore(tracks: readonly { id: string; name: string; unavailable?: boolean }[]) {
    this.active = false;
    let saved: PlaybackBookmark | undefined;
    try {
      saved = parsePlaybackBookmark(this.options.storage.getItem(PLAYBACK_MEMORY_KEY));
      this.options.onError('');
    } catch {
      this.options.onError('The saved playback position could not be read. Allow local storage, or select a song to start a new session.');
    }
    this.active = true;
    // A user-selected song always takes priority over a delayed library restore.
    if (this.options.player.getState().currentId) { this.flush(); return; }
    if (!saved?.trackId) return;
    const track = tracks.find(track => track.id === saved.trackId);
    if (!track || track.unavailable) {
      this.options.onNotice(track ? `The last played song “${track.name}” is unavailable. Choose its original file to restore the audio copy.`
        : 'The last played song is no longer in your library. Select another song to continue.');
      return;
    }
    this.pending = saved;
    this.hadTrack = true;
    this.lastSignature = JSON.stringify(saved);
    this.options.player.cue(saved.trackId);
    this.restorePosition();
  }

  private restorePosition = () => {
    const { player, audio } = this.options, saved = this.pending, state = player.getState();
    if (!saved || state.currentId !== saved.trackId || state.status === 'error' || state.duration <= 0 || audio.readyState < 1) return;
    this.pending = undefined;
    // Metadata is authoritative; seek() clamps bookmarks beyond a file's actual end.
    player.seek(saved.position);
    this.flush();
  };

  observe(state: PlaybackState) {
    const changed = state.currentId !== this.lastId || state.status !== this.lastStatus;
    this.lastId = state.currentId; this.lastStatus = state.status;
    if (!this.active) return;
    if (this.pending && state.currentId !== this.pending.trackId) this.pending = undefined;
    if (state.currentId) this.hadTrack = true;
    this.save(changed || state.status === 'paused' || state.status === 'ended');
  }

  private save(force: boolean) {
    const { player, audio, storage, onError } = this.options;
    const state = player.getState();
    if (!this.active || this.pending || state.status === 'error' || !state.currentId && !this.hadTrack) return;
    const now = (this.options.now || Date.now)();
    if (!force && now - this.lastAttemptAt < 5000) return;
    // A track-change notification arrives before the old audio source is replaced.
    const position = state.currentId && state.duration > 0 && audio.readyState >= 1 && Number.isFinite(audio.currentTime)
      ? Math.max(0, Math.min(audio.currentTime, state.duration)) : 0;
    const bookmark: PlaybackBookmark = { version: 1, trackId: state.currentId, position };
    const signature = JSON.stringify(bookmark);
    if (signature === this.lastSignature) return;
    this.lastAttemptAt = now;
    try {
      // Small synchronous writes also work during pagehide; Blob URLs are never stored.
      storage.setItem(PLAYBACK_MEMORY_KEY, signature);
      this.lastSignature = signature;
      onError('');
    } catch {
      onError('Playback position could not be saved. Allow local storage or free some browser storage, then retry.');
    }
  }

  flush = () => this.save(true);
  private visibilityChanged = () => { if (this.options.document.visibilityState === 'hidden') this.flush(); };

  dispose() {
    this.flush();
    this.active = false;
    const { audio, page, document } = this.options;
    audio.removeEventListener('loadedmetadata', this.restorePosition);
    audio.removeEventListener('durationchange', this.restorePosition);
    audio.removeEventListener('seeked', this.flush);
    page.removeEventListener('pagehide', this.flush);
    document.removeEventListener('visibilitychange', this.visibilityChanged);
  }
}
