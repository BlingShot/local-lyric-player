import assert from 'node:assert/strict';
import test from 'node:test';
import { SpotifyService, chooseTrack, REDIRECT_URI } from '../electron/spotify.mjs';

const track = { name: 'Song', artist: 'Artist', duration: 200 };
const candidate = { id: 'a'.repeat(22), name: 'Song', artists: [{ name: 'Artist' }], duration_ms: 200000, external_ids: { isrc: 'USAAA2600001' } };
test('matching never silently selects another recording or artist', () => {
  assert.equal(chooseTrack([candidate], track), candidate);
  assert.equal(chooseTrack([{ ...candidate, duration_ms: 210000 }], track), null);
  assert.equal(chooseTrack([{ ...candidate, name: 'Song (Live)' }], track), null);
  assert.equal(chooseTrack([candidate, { ...candidate, external_ids: { isrc: 'USAAA2600002' } }], track), null);
});
test('Spotify metadata flow uses official track details for ISRC; tokens stay in main', async () => {
  const requests = [], config = { get: async () => ({ clientId: 'a'.repeat(32), accessToken: 'secret', refreshToken: 'refresh', expiresAt: Date.now() + 3600000 }) };
  const service = new SpotifyService(config, () => {}, async (url, options) => {
    requests.push({ url, options }); return Response.json(url.includes('/search?') ? { tracks: { items: [candidate] } } : candidate);
  });
  assert.deepEqual(await service.match(track), { id: candidate.id, isrc: candidate.external_ids.isrc });
  assert.equal(requests.length, 2); assert.ok(requests[1].url.endsWith(`/tracks/${candidate.id}`));
  assert.deepEqual(await service.info(), { clientId: 'a'.repeat(32), connected: true });
  assert.equal(REDIRECT_URI, 'http://127.0.0.1:43821/spotify/callback');
});
test('expired session refreshes once and encrypted config boundary receives new token', async () => {
  let saved = { clientId: 'a'.repeat(32), accessToken: 'expired', refreshToken: 'refresh', expiresAt: 0 }, requests = 0;
  const service = new SpotifyService({ get: async () => saved, set: async (_key, value) => { saved = value; } }, () => {}, async url => { requests++; assert.equal(url, 'https://accounts.spotify.com/api/token'); return Response.json({ access_token: 'new', expires_in: 3600 }); });
  assert.deepEqual(await Promise.all([service.access(), service.access()]), ['new', 'new']); assert.equal(requests, 1); assert.equal(saved.refreshToken, 'refresh');
});

test('official PKCE flow checks callback state and exchanges a verifier, never a client secret', async () => {
  let saved, opened;
  const config = { get: async () => saved, set: async (_key, value) => { saved = value; } };
  const service = new SpotifyService(config, async url => {
    opened = new URL(url);
    const bad = await fetch(REDIRECT_URI + '?state=wrong&code=fake'); assert.equal(bad.status, 400);
    const callback = new URL(REDIRECT_URI); callback.search = new URLSearchParams({ state: opened.searchParams.get('state'), code: 'test-code' });
    const response = await fetch(callback); assert.equal(response.status, 200);
  }, async (url, options) => {
    assert.equal(url, 'https://accounts.spotify.com/api/token');
    assert.equal(options.body.get('grant_type'), 'authorization_code'); assert.equal(options.body.get('code'), 'test-code');
    assert.ok(options.body.get('code_verifier').length >= 43); assert.equal(options.body.has('client_secret'), false);
    return Response.json({ access_token: 'test-access', refresh_token: 'test-refresh', expires_in: 3600 });
  });
  try { assert.deepEqual(await service.login('a'.repeat(32)), { clientId: 'a'.repeat(32), connected: true }); assert.equal(opened.searchParams.get('code_challenge_method'), 'S256'); }
  finally { service.cancel(); }
});
