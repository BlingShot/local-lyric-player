import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PlaybackRouteFollower } from '../src/player/playbackRoute.ts';

const analyze = { key: 'analyze-a', pathname: '/analyze/a', search: '' };

test('background automatic track changes do not navigate; returning follows only the latest song', () => {
  const follow = new PlaybackRouteFollower('a');
  assert.equal(follow.update('b', analyze, false), undefined);
  assert.equal(follow.update('c', analyze, false), undefined);
  assert.equal(follow.update('c', analyze, false), undefined);
  assert.equal(follow.update('c', analyze, true), '/analyze/c');
  assert.equal(follow.update('c', analyze, true), undefined);
});

test('foreground song changes still follow Analyze immediately', () => {
  const follow = new PlaybackRouteFollower('a');
  assert.equal(follow.update('b', analyze, true), '/analyze/b');
});

test('pending navigation cannot override an explicit new page or inspection link', () => {
  const follow = new PlaybackRouteFollower('a');
  follow.update('b', analyze, false);
  assert.equal(follow.update('b', { ...analyze, key: 'manual-c', pathname: '/analyze/c' }, true), undefined);
  assert.equal(follow.update('c', { ...analyze, key: 'library', pathname: '/collection/tracks' }, true), undefined);
});

test('initial restore, removed current song and a queue returning to the same song do not redirect', () => {
  const follow = new PlaybackRouteFollower(null);
  assert.equal(follow.update('b', analyze, true), undefined);
  follow.update('c', analyze, false);
  assert.equal(follow.update(null, analyze, true), undefined);
  const looping = new PlaybackRouteFollower('a');
  looping.update('b', analyze, false);
  assert.equal(looping.update('a', analyze, true), undefined);
});

test('Studio defers background changes and preserves editor URL options', () => {
  const location = { key: 'studio-a', pathname: '/studio', search: '?trackId=a&mode=ttml' };
  const follow = new PlaybackRouteFollower('a');
  assert.equal(follow.update('b', location, false), undefined);
  assert.equal(follow.update('b', location, true), '/studio?trackId=b&mode=ttml');
});

test('lyrics and library pages update through playback state without route navigation', () => {
  const follow = new PlaybackRouteFollower('a');
  assert.equal(follow.update('b', { key: 'lyrics', pathname: '/lyrics', search: '' }, false), undefined);
  assert.equal(follow.update('b', { key: 'lyrics', pathname: '/lyrics', search: '' }, true), undefined);
});
