import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ListeningCounter, emptyListeningTotals, parseListeningTotals, localDay, type ListeningSample } from '../src/player/listeningTime.ts';

const base = new Date(2026, 8, 13, 12).getTime();
const point = (second: number, media = second, patch: Partial<ListeningSample> = {}): ListeningSample => ({ source: 'song-a', mediaMs: media * 1000, monotonicMs: second * 1000, wallMs: base + second * 1000, rate: 1, playing: true, ...patch });
test('listening counts real elapsed playback, pause tails, buffering and source boundaries', () => {
  const c = new ListeningCounter(emptyListeningTotals(base));
  c.sample(point(0)); c.sample(point(1)); c.sample(point(2, 2, { playing: false }));
  c.sample(point(10, 2, { playing: false })); c.sample(point(11, 2)); c.sample(point(12, 3));
  assert.equal(c.totals.totalMs, 3000);
  c.sample(point(13, 3)); c.sample(point(14, 3)); assert.equal(c.totals.totalMs, 3000, 'stopped media earns no time');
  c.sample(point(15, 0, { source: 'song-b' })); c.sample(point(16, 1, { source: 'song-b' }));
  assert.equal(c.totals.totalMs, 4000);
});
test('seeks and source restoration are not playback, including missing seek events', () => {
  const c = new ListeningCounter(emptyListeningTotals(base));
  c.sample(point(0)); c.sample(point(1, 50)); c.sample(point(2, 51)); assert.equal(c.totals.totalMs, 1000);
  c.resetAnchor(); c.sample(point(3, 90)); c.sample(point(4, 91)); assert.equal(c.totals.totalMs, 2000);
  c.sample(point(5, 3)); assert.equal(c.totals.totalMs, 2000);
});
test('half/double speed count wall time and fractional sampling is preserved', () => {
  for (const rate of [.5, 1, 2]) {
    const c = new ListeningCounter(emptyListeningTotals(base));
    for (let n = 0; n <= 120; n++) c.sample(point(n / 3, n / 3 * rate, { rate }));
    assert.ok(Math.abs(c.totals.totalMs - 40000) <= 1);
  }
});
test('midnight rolls today only; recovery validates totals and bounded stored shape', () => {
  const midnight = new Date(2026, 8, 14).getTime(), c = new ListeningCounter(emptyListeningTotals(midnight - 500));
  c.sample(point(0, 0, { wallMs: midnight - 500 })); c.sample(point(1, 1, { wallMs: midnight + 500 }));
  assert.equal(c.totals.totalMs, 1000); assert.equal(c.totals.todayMs, 500); assert.equal(c.totals.day, localDay(midnight));
  assert.deepEqual(parseListeningTotals(JSON.stringify(c.totals), midnight), c.totals);
  assert.equal(parseListeningTotals(JSON.stringify(c.totals), midnight + 86400000).todayMs, 0);
  for (const raw of ['broken', '{"version":2}', JSON.stringify({ ...c.totals, todayMs: 90000 }), JSON.stringify({ ...c.totals, totalMs: -1 })]) assert.throws(() => parseListeningTotals(raw, midnight));
  assert.ok(JSON.stringify(c.totals).length < 128);
});
