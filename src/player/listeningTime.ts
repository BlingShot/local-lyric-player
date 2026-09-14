export interface ListeningTotals { version: 1; totalMs: number; todayMs: number; day: string }
export interface ListeningSample { source: string; mediaMs: number; monotonicMs: number; wallMs: number; rate: number; playing: boolean }
export const localDay = (at: number) => { const d = new Date(at); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const emptyListeningTotals = (at: number): ListeningTotals => ({ version: 1, totalMs: 0, todayMs: 0, day: localDay(at) });
export function parseListeningTotals(raw: string | null, at: number): ListeningTotals {
  if (raw === null) return emptyListeningTotals(at);
  const v = JSON.parse(raw);
  if (v?.version !== 1 || !Number.isSafeInteger(v.totalMs) || v.totalMs < 0 || !Number.isSafeInteger(v.todayMs) || v.todayMs < 0 || v.todayMs > v.totalMs || !/^\d{4}-\d{2}-\d{2}$/.test(v.day)) throw new Error('Invalid listening-time record.');
  return { version: 1, totalMs: v.totalMs, todayMs: v.day === localDay(at) ? v.todayMs : 0, day: localDay(at) };
}
/** Credit elapsed listening time, not the distance a seek moves the media clock. */
export class ListeningCounter {
  previous?: ListeningSample;
  private fraction = 0;
  totals: ListeningTotals;
  constructor(totals: ListeningTotals) { this.totals = totals; }
  resetAnchor() { this.previous = undefined; }
  sample(next: ListeningSample) {
    const before = this.previous; this.previous = next;
    const day = localDay(next.wallMs);
    if (this.totals.day !== day) this.totals = { ...this.totals, day, todayMs: 0 };
    if (!before?.playing || !next.source || next.source !== before.source || next.rate !== before.rate || next.rate <= 0) return;
    const wall = next.monotonicMs - before.monotonicMs, media = (next.mediaMs - before.mediaMs) / before.rate;
    // A discontinuity without a seek event is still not listening. Short media-clock
    // quantization is tolerated, while credit is bounded by real elapsed time.
    if (!Number.isFinite(media) || wall <= 0 || media <= 0 || media > wall + 350) return;
    const credit = Math.min(wall, media) + this.fraction, added = Math.floor(credit); this.fraction = credit - added;
    const midnight = new Date(next.wallMs); midnight.setHours(0, 0, 0, 0);
    this.totals = { ...this.totals, totalMs: this.totals.totalMs + added,
      todayMs: this.totals.todayMs + Math.min(added, Math.max(0, next.wallMs - midnight.getTime())) };
  }
}
