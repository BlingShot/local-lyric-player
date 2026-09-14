import { adjacentTrack, shuffled, type RepeatMode } from './queue.ts';

export interface PlaybackState {
  currentId: string | null;
  queue: string[];
  status: 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error';
  position: number;
  duration: number;
  volume: number;
  shuffle: boolean;
  repeat: RepeatMode;
  error: { trackId: string; message: string } | null;
}

export const initialPlaybackState: PlaybackState = {
  currentId: null, queue: [], status: 'idle', position: 0, duration: 0,
  volume: 1, shuffle: false, repeat: 'off', error: null,
};

export type AudioPort = Pick<HTMLAudioElement,
  'src' | 'currentSrc' | 'currentTime' | 'duration' | 'volume' | 'paused' | 'ended' |
  'readyState' | 'error' | 'play' | 'pause' | 'load' | 'removeAttribute' |
  'addEventListener' | 'removeEventListener'
>;

interface PlayerOptions {
  onChange: (state: PlaybackState) => void;
  onDuration: (id: string, duration: number) => void;
  onFailure: (id: string, message: string) => void;
  onSelect: (id: string) => void;
  revokeUrl: (url: string) => void;
  random?: () => number;
  loadTimeoutMs?: number;
}

export class LocalAudioPlayer {
  private audio: AudioPort;
  private options: PlayerOptions;
  private state: PlaybackState = { ...initialPlaybackState, queue: [] };
  private sources = new Map<string, string>();
  private originalQueue: string[] = [];
  private failed = new Set<string>();
  private listeners: [string, EventListener][] = [];
  private watchdog: ReturnType<typeof setTimeout> | undefined;
  private command = 0;
  private wantsPlayback = false;
  private disposed = false;

  constructor(audio: AudioPort, options: PlayerOptions) {
    this.audio = audio;
    this.options = options;
    this.listen('loadedmetadata', this.readMetadata);
    this.listen('durationchange', this.readMetadata);
    this.listen('timeupdate', this.readPosition);
    this.listen('seeked', this.readPosition);
    this.listen('playing', () => {
      if (!this.isCurrentSource() || audio.paused || !this.wantsPlayback) return;
      this.clearWatchdog();
      this.update({ status: 'playing' });
    });
    this.listen('pause', () => {
      if (!this.isCurrentSource() || !audio.paused || audio.ended ||
          ['idle', 'error', 'ended'].includes(this.state.status)) return;
      this.clearWatchdog();
      this.update({ status: 'paused' });
    });
    for (const event of ['waiting', 'stalled']) this.listen(event, () => {
      if (this.isCurrentSource() && this.wantsPlayback) {
        this.update({ status: 'loading' });
        this.armWatchdog();
      }
    });
    this.listen('ended', () => {
      if (!this.isCurrentSource() || !audio.ended || !this.wantsPlayback) return;
      this.clearWatchdog();
      this.readPosition();
      if (this.state.repeat === 'one' && this.state.currentId) {
        this.seek(0);
        this.resume();
      } else {
        const next = this.adjacent(1);
        if (next) this.loadTrack(next, true);
        else {
          this.wantsPlayback = false;
          this.update({ status: 'ended' });
        }
      }
    });
    this.listen('error', () => {
      if (!this.isCurrentSource() || !audio.error) return;
      this.fail(audio.error.code === 2
        ? 'Unable to read this audio. Please import the file again.'
        : 'This audio cannot be decoded. The file may be damaged or its format is not supported by your browser.');
    });
    this.listen('volumechange', () => this.update({ volume: audio.volume }));
  }

  getState = () => this.state;

  private listen(event: string, callback: () => void) {
    const listener: EventListener = () => { if (!this.disposed) callback(); };
    this.audio.addEventListener(event, listener);
    this.listeners.push([event, listener]);
  }

  private update(patch: Partial<PlaybackState>) {
    if (this.disposed) return;
    if (Object.entries(patch).every(([key, value]) => this.state[key as keyof PlaybackState] === value)) return;
    this.state = { ...this.state, ...patch };
    this.options.onChange(this.state);
  }

  private isCurrentSource() {
    return !!this.state.currentId && this.audio.currentSrc === this.sources.get(this.state.currentId);
  }

  private readMetadata = () => {
    if (!this.isCurrentSource() || this.audio.readyState < 1) return;
    const duration = this.audio.duration;
    if (Number.isFinite(duration) && duration > 0) {
      this.update({ duration });
      this.options.onDuration(this.state.currentId!, duration);
    }
    if (!this.wantsPlayback) this.clearWatchdog();
  };

  private readPosition = () => {
    if (this.isCurrentSource()) {
      this.update({ position: Math.max(0, this.audio.currentTime) });
    }
  };

  private armWatchdog() {
    if (this.watchdog) return;
    const command = this.command;
    this.watchdog = setTimeout(() => {
      this.watchdog = undefined;
      if (!this.disposed && command === this.command) {
        this.fail('Audio loading timed out. Import the file again or choose another track.');
      }
    }, this.options.loadTimeoutMs ?? 15000);
  }

  private clearWatchdog() {
    clearTimeout(this.watchdog);
    this.watchdog = undefined;
  }

  addTracks(tracks: readonly { id: string; url: string }[]) {
    const added: string[] = [];
    for (const { id, url } of tracks) {
      if (this.sources.has(id)) { this.options.revokeUrl(url); continue; }
      this.sources.set(id, url);
      this.originalQueue.push(id);
      added.push(id);
    }
    if (added.length) this.update({
      queue: [...this.state.queue, ...(this.state.shuffle ? shuffled(added, this.options.random) : added)],
    });
  }

  play(id?: string) {
    if (id && !this.sources.has(id)) return;
    const target = id ?? this.state.currentId ?? this.state.queue[0];
    if (!target) return;
    this.failed.delete(target);
    this.update({ error: null });
    if (target !== this.state.currentId || this.state.status === 'error') this.loadTrack(target, true);
    else {
      if (this.audio.ended) this.seek(0);
      this.resume();
    }
  }

  cue(id: string) {
    if (this.disposed || !this.sources.has(id)) return;
    this.failed.delete(id);
    this.update({ error: null });
    this.loadTrack(id, false);
  }

  private loadTrack(id: string, autoplay: boolean) {
    const url = this.sources.get(id);
    if (!url) return;
    this.command++;
    this.clearWatchdog();
    this.wantsPlayback = autoplay;
    this.audio.pause();
    this.update({ currentId: id, duration: 0, position: 0, status: autoplay ? 'loading' : 'paused' });
    this.options.onSelect(id);
    this.audio.src = url;
    this.audio.load();
    this.armWatchdog();
    if (autoplay) this.resume();
  }

  private resume() {
    if (!this.state.currentId || this.disposed) return;
    const command = ++this.command;
    this.clearWatchdog();
    this.wantsPlayback = true;
    this.update({ status: 'loading' });
    this.armWatchdog();
    // play() must run directly within the user's gesture, not in a React effect.
    this.audio.play().catch((error: unknown) => {
      if (this.disposed || command !== this.command) return;
      const name = error instanceof Error ? error.name : '';
      if (name === 'NotAllowedError' || name === 'AbortError') {
        this.wantsPlayback = false;
        this.clearWatchdog();
        this.update({
          status: 'paused',
          error: name === 'NotAllowedError'
            ? { trackId: this.state.currentId!, message: 'Your browser blocked autoplay. Press Play to try again.' }
            : null,
        });
      } else {
        this.fail('This audio cannot be decoded or played. Try a different file or audio format.');
      }
    });
  }

  pause() {
    this.command++;
    this.wantsPlayback = false;
    this.clearWatchdog();
    this.audio.pause();
    // Browsers may not emit another pause event if play() was still pending.
    if (this.state.currentId && this.audio.paused && this.state.status !== 'error') {
      this.update({ status: 'paused' });
    }
  }

  toggle() {
    if (this.wantsPlayback && ['playing', 'loading'].includes(this.state.status)) this.pause();
    else this.play();
  }

  private adjacent(direction: 1 | -1, wrap = this.state.repeat === 'all') {
    return adjacentTrack(this.state.queue, this.state.currentId, direction, wrap, this.failed);
  }

  next() {
    const next = this.adjacent(1);
    if (next) this.loadTrack(next, true);
  }

  previous() {
    const previous = this.adjacent(-1);
    if (previous) this.loadTrack(previous, true);
    else this.seek(0);
  }

  seek(seconds: number) {
    if (!this.state.currentId || !Number.isFinite(seconds) || this.state.duration <= 0 ||
        this.audio.readyState < 1) return;
    try {
      this.audio.currentTime = Math.max(0, Math.min(seconds, this.state.duration));
      this.readPosition();
    } catch {
      // The source may have changed during a pointer gesture; its metadata will arrive next.
    }
  }

  setVolume(volume: number) {
    if (Number.isFinite(volume)) this.audio.volume = Math.max(0, Math.min(1, volume));
  }

  toggleShuffle() {
    const shuffle = !this.state.shuffle;
    const current = this.state.currentId;
    this.update({
      shuffle,
      queue: shuffle
        ? [...(current ? [current] : []), ...shuffled(this.originalQueue.filter(id => id !== current), this.options.random)]
        : [...this.originalQueue],
    });
  }

  cycleRepeat() {
    const repeat: RepeatMode = this.state.repeat === 'off' ? 'all' : this.state.repeat === 'all' ? 'one' : 'off';
    this.update({ repeat });
  }

  dismissError() { this.update({ error: null }); }

  private fail(message: string) {
    const id = this.state.currentId;
    if (!id || this.failed.has(id)) return;
    const continuePlaying = this.wantsPlayback;
    this.command++;
    this.failed.add(id);
    this.clearWatchdog();
    this.wantsPlayback = false;
    this.audio.pause();
    this.update({ status: 'error', error: { trackId: id, message } });
    this.options.onFailure(id, message);
    // Never repeat a broken file; keep the message visible when moving to the next file.
    const next = continuePlaying ? this.adjacent(1) : null;
    if (next) this.loadTrack(next, true);
  }

  removeTrack(id: string) {
    const url = this.sources.get(id);
    if (!url) return;
    const playing = this.wantsPlayback;
    const replacement = this.adjacent(1) ?? this.adjacent(-1);
    this.sources.delete(id);
    this.failed.delete(id);
    this.originalQueue = this.originalQueue.filter(item => item !== id);
    this.update({ queue: this.state.queue.filter(item => item !== id) });
    if (id === this.state.currentId) {
      if (replacement && replacement !== id) this.loadTrack(replacement, playing);
      else this.clearSource();
    }
    this.options.revokeUrl(url);
    if (this.state.error?.trackId === id) this.dismissError();
  }

  private clearSource() {
    this.command++;
    this.wantsPlayback = false;
    this.clearWatchdog();
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    this.update({ currentId: null, duration: 0, position: 0, status: 'idle' });
  }

  dispose() {
    this.clearSource();
    this.disposed = true;
    for (const [event, listener] of this.listeners) this.audio.removeEventListener(event, listener);
    for (const url of this.sources.values()) this.options.revokeUrl(url);
    this.sources.clear();
  }
}
