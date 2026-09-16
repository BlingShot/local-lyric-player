/** Per-library/project recovery slots. Never evict another unsaved project. */
export const RECOVERY_PREFIX = 'lyric-studio-recovery:v2:local-music-library:';
export const LEGACY_RECOVERY_KEY = 'lyric-studio-recovery';
export const RECOVERY_LIMITS = { entries: 32, recordBytes: 2 * 1024 * 1024, totalBytes: 4 * 1024 * 1024 } as const;
export interface RecoveryEntry<T> { key: string; raw: string; draft: T }
export class RecoveryJournal<T extends { trackId: string; updatedAt: number }> {
  constructor(privateStorage: Storage) { this.storage = privateStorage; }
  private storage: Storage;
  key(trackId: string) { return RECOVERY_PREFIX + encodeURIComponent(trackId); }
  entry(key: string): RecoveryEntry<T> | undefined {
    const raw = this.storage.getItem(key);
    if (!raw) return;
    try {
      const value = JSON.parse(raw), draft = key === LEGACY_RECOVERY_KEY ? value : value.draft;
      if (!draft || typeof draft.trackId !== 'string' || !Number.isFinite(draft.updatedAt)) return;
      if (key !== LEGACY_RECOVERY_KEY && key !== this.key(draft.trackId)) return;
      return { key, raw, draft };
    } catch { return; }
  }
  entries(): RecoveryEntry<T>[] {
    const keys = new Set<string>([LEGACY_RECOVERY_KEY]);
    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i);
      if (key?.startsWith(RECOVERY_PREFIX)) keys.add(key);
    }
    return [...keys].flatMap(key => this.entry(key) ?? []).sort((a, b) => b.draft.updatedAt - a.draft.updatedAt);
  }
  forTrack(trackId: string): RecoveryEntry<T>[] {
    return [this.entry(this.key(trackId)), this.entry(LEGACY_RECOVERY_KEY)]
      .filter((entry): entry is RecoveryEntry<T> => !!entry && entry.draft.trackId === trackId)
      .sort((a, b) => b.draft.updatedAt - a.draft.updatedAt);
  }
  stage(draft: T): RecoveryEntry<T> {
    const previous = this.forTrack(draft.trackId)[0];
    if (previous && previous.draft.updatedAt > draft.updatedAt) throw new Error('A newer recovery draft is already stored.');
    const key = this.key(draft.trackId), raw = JSON.stringify({ revision: crypto.randomUUID(), draft });
    if (raw.length * 2 > RECOVERY_LIMITS.recordBytes) throw new Error('This draft exceeds the recovery copy size limit.');
    let count = 0, bytes = raw.length * 2;
    for (let i = 0; i < this.storage.length; i++) {
      const other = this.storage.key(i);
      if (other && (other.startsWith(RECOVERY_PREFIX) || other === LEGACY_RECOVERY_KEY) && other !== key) {
        count++; bytes += (this.storage.getItem(other)?.length ?? 0) * 2;
      }
    }
    if (count >= RECOVERY_LIMITS.entries || bytes > RECOVERY_LIMITS.totalBytes)
      throw new Error('Recovery storage is full. Save, export or discard existing recovery drafts before leaving.');
    this.storage.setItem(key, raw);
    return { key, raw, draft };
  }
  clear(entry: RecoveryEntry<T>) {
    // A prior save must never clear a newer journal revision, even at the same timestamp.
    if (this.storage.getItem(entry.key) === entry.raw) this.storage.removeItem(entry.key);
  }
}
