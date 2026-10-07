import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DesktopConfig } from '../electron/config.mjs';
import { LyricFlowService, boundedJson, lyricFlowOperation, validateLyricFlowConfig, verifyLyricFlowIdToken } from '../electron/lyricflow.mjs';

const settings = { apiOrigin: 'https://lyricflow.example', siteOrigin: 'https://lyrics.example', issuer: 'https://lyricflow.example/oidc', clientId: 'native-player' };
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwks = { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'fixture', alg: 'RS256', use: 'sig' }] };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const gate = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function token(overrides = {}, header = {}) {
  const now = Math.floor(Date.now() / 1000);
  const payload = [Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'fixture', ...header })).toString('base64url'), Buffer.from(JSON.stringify({ iss: settings.issuer, aud: settings.clientId, sub: 'account-one', iat: now, exp: now + 300, ...overrides })).toString('base64url')].join('.');
  return payload + '.' + sign('RSA-SHA256', Buffer.from(payload), privateKey).toString('base64url');
}
function callback(url, { host, method = 'GET' } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method, headers: host ? { Host: host } : {} }, response => {
      let body = ''; response.setEncoding('utf8'); response.on('data', value => { body += value; }); response.on('end', () => resolve({ status: response.statusCode, body }));
    });
    req.on('error', reject); req.end();
  });
}
function fixture(options = {}) {
  const values = new Map([['lyricflow', settings]]), calls = [], opened = gate();
  const config = { get: async key => values.get(key), set: async (key, value) => { values.set(key, structuredClone(value)); } };
  const discovery = { issuer: settings.issuer, authorization_endpoint: settings.issuer + '/auth', token_endpoint: settings.issuer + '/token', jwks_uri: settings.issuer + '/jwks', revocation_endpoint: settings.issuer + '/revoke', code_challenge_methods_supported: ['S256'] };
  let authorization, exchanges = 0;
  const request = async (url, init = {}) => {
    calls.push({ url, init });
    assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error');
    if (url.endsWith('/.well-known/openid-configuration')) return json(options.discovery ?? discovery);
    if (url === discovery.jwks_uri) return json(jwks);
    if (url === discovery.revocation_endpoint) return json({});
    if (url === discovery.token_endpoint) {
      exchanges++;
      if (options.exchange) return options.exchange(init.body, exchanges);
      assert.equal(init.body.get('grant_type'), 'authorization_code');
      assert.equal(init.body.get('client_id'), settings.clientId);
      assert.equal(init.body.get('redirect_uri'), authorization.searchParams.get('redirect_uri'));
      assert.equal(createHash('sha256').update(init.body.get('code_verifier')).digest('base64url'), authorization.searchParams.get('code_challenge'));
      assert.equal(init.body.has('client_secret'), false);
      return json({ access_token: 'access-one', token_type: 'Bearer', expires_in: 300, scope: 'openid profile lyrics:contribute', refresh_token: 'refresh-one', id_token: token({ nonce: authorization.searchParams.get('nonce'), name: 'Account One' }) });
    }
    return options.api ? options.api(url, init) : json({ ok: true });
  };
  const service = new LyricFlowService(config, async url => { authorization = new URL(url); opened.resolve(authorization); if (options.open) return options.open(authorization); }, request);
  return { service, values, config, calls, opened, discovery, exchanges: () => exchanges };
}
test('native login uses bound random loopback, state, PKCE and nonce and exposes no token', async () => {
  const f = fixture(); const completion = f.service.connect({ remember: true });
  const authorization = await f.opened.promise;
  assert.equal(authorization.origin, settings.apiOrigin);
  assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(authorization.searchParams.get('scope'), 'openid profile lyrics:contribute offline_access');
  const uri = new URL(authorization.searchParams.get('redirect_uri'));
  assert.equal(uri.hostname, '127.0.0.1'); assert.ok(Number(uri.port) > 0); assert.equal(uri.pathname, '/lyricflow/callback');
  uri.search = new URLSearchParams({ state: authorization.searchParams.get('state'), code: 'one-time-code' }).toString();
  assert.equal((await callback(uri, { host: 'attacker.example' })).status, 404);
  assert.equal((await callback(new URL('/wrong-path' + uri.search, uri))).status, 404);
  const wrong = new URL(uri); wrong.searchParams.set('state', 'x'.repeat(43));
  assert.equal((await callback(wrong)).status, 400);
  wrong.searchParams.set('state', '你'.repeat(43)); assert.equal((await callback(wrong)).status, 400);
  wrong.searchParams.set('state', authorization.searchParams.get('state')); wrong.searchParams.append('state', 'duplicate');
  assert.equal((await callback(wrong)).status, 400);
  assert.equal(f.exchanges(), 0);
  assert.equal((await callback(uri)).status, 200);
  const info = await completion;
  assert.equal(info.connected, true); assert.equal(info.remembered, true); assert.equal(info.sub, 'account-one');
  assert.equal('accessToken' in info, false); assert.equal('refreshToken' in info, false);
  assert.equal(f.values.get('lyricflow-session').refreshToken, 'refresh-one');
  assert.equal('accessToken' in f.values.get('lyricflow-session'), false);
  await assert.rejects(callback(uri)); assert.equal(f.exchanges(), 1);
  await f.service.disconnect(); assert.equal((await f.service.info()).connected, false);
  assert.equal(f.calls.find(call => call.url.endsWith('/revoke')).init.body.get('token'), 'refresh-one');
});

test('identity token validates signature, issuer, audience, nonce, time, subject and access hash', () => {
  const expected = { ...settings, nonce: 'nonce-value', accessToken: 'access-one' };
  const valid = { nonce: expected.nonce, at_hash: createHash('sha256').update(expected.accessToken).digest().subarray(0, 16).toString('base64url') };
  assert.equal(verifyLyricFlowIdToken(token(valid), jwks, expected).sub, 'account-one');
  for (const claims of [
    { iss: 'https://attacker.example' }, { aud: 'another-client' }, { aud: [settings.clientId, 'other'] },
    { nonce: 'wrong' }, { nonce: '你'.repeat(expected.nonce.length) }, { exp: 0 },
    { iat: Date.now() / 1000 + 600 }, { nbf: Date.now() / 1000 + 600 }, { sub: '' }, { at_hash: 'wrong' },
  ]) assert.throws(() => verifyLyricFlowIdToken(token({ ...valid, ...claims }), jwks, expected));
  assert.throws(() => verifyLyricFlowIdToken(token(valid, { alg: 'none' }), jwks, expected));
  const signed = token(valid); assert.throws(() => verifyLyricFlowIdToken(signed.slice(0, -8) + 'AAAAAAAA', jwks, expected));
  assert.throws(() => verifyLyricFlowIdToken(signed, { keys: [...jwks.keys, ...jwks.keys] }, expected));
  assert.throws(() => verifyLyricFlowIdToken(signed, jwks, { ...expected, sub: 'another-account' }));
});

test('discovery redirects and endpoints cannot move tokens to another origin', async () => {
  assert.throws(() => validateLyricFlowConfig({ ...settings, apiOrigin: 'http://remote.example' }));
  assert.throws(() => validateLyricFlowConfig({ ...settings, issuer: 'https://other.example/oidc' }));
  const f = fixture();
  for (const change of [{ issuer: 'https://other.example/oidc' }, { token_endpoint: 'https://attacker.example/oidc/token' }, { jwks_uri: settings.apiOrigin + '/outside' }, { code_challenge_methods_supported: ['plain'] }]) {
    const invalid = fixture({ discovery: { ...f.discovery, ...change } });
    await assert.rejects(invalid.service.connect({ remember: false })); assert.equal(invalid.exchanges(), 0);
  }
});

test('refresh is deduplicated, owner-bound, rotates secure state and failure clears authorization', async () => {
  const release = gate();
  const f = fixture({ exchange: async (body, number) => {
    assert.equal(body.get('grant_type'), 'refresh_token');
    if (number === 1) { await release.promise; return json({ access_token: 'fresh', token_type: 'Bearer', expires_in: 300, refresh_token: 'rotated', scope: 'lyrics:contribute' }); }
    return json({ error: { code: 'INVALID_GRANT' } }, 401);
  } });
  f.values.set('lyricflow-session', { ...settings, sub: 'account-one', refreshToken: 'remembered' });
  const first = f.service.access(), second = f.service.access(); release.resolve();
  assert.equal((await first).accessToken, 'fresh'); assert.equal(await first, await second); assert.equal(f.exchanges(), 1);
  assert.equal(f.values.get('lyricflow-session').refreshToken, 'rotated');
  await assert.rejects(f.service.operation('context', { id: 'song', owner: { ...settings, sub: 'account-two' } }), /different/);
  const readsBefore = f.calls.length;
  await f.service.operation('context', { id: 'song', owner: { ...settings, sub: 'account-one' } });
  assert.equal(f.calls[readsBefore].init.headers.Authorization, 'Bearer fresh');
  await assert.rejects(f.service.access(true));
  assert.equal((await f.service.info()).connected, false); assert.deepEqual(f.values.get('lyricflow-session'), {});
});

test('disconnect during refresh cannot restore tokens, and a late encrypted save cannot erase a newer account', async () => {
  const response = gate(), started = gate();
  const f = fixture({ exchange: async () => { started.resolve(); await response.promise; return json({ access_token: 'late', token_type: 'Bearer', expires_in: 300, refresh_token: 'late-refresh', scope: 'lyrics:contribute' }); } });
  f.values.set('lyricflow-session', { ...settings, sub: 'account-one', refreshToken: 'remembered' });
  const refreshing = f.service.access(); const rejected = assert.rejects(refreshing, /cancel/);
  await started.promise; await f.service.disconnect(); response.resolve(); await rejected;
  assert.equal((await f.service.info()).connected, false);
  const saveStarted = gate(), finishSave = gate(); const originalSet = f.config.set;
  f.config.set = async (key, value) => { if (value.refreshToken === 'old-save') { saveStarted.resolve(); await finishSave.promise; } await originalSet(key, value); };
  const oldGeneration = f.service.generation;
  const old = f.service.acceptTokens({ access_token: 'old', token_type: 'Bearer', expires_in: 300, refresh_token: 'old-save' }, settings, f.discovery, { sub: 'account-one' }, true, oldGeneration);
  const oldRejected = assert.rejects(old, /cancel/); await saveStarted.promise;
  f.service.cancel();
  const newer = f.service.acceptTokens({ access_token: 'new', token_type: 'Bearer', expires_in: 300, refresh_token: 'new-save' }, settings, f.discovery, { sub: 'account-two' }, true, f.service.generation);
  finishSave.resolve(); await oldRejected; await newer;
  assert.equal(f.values.get('lyricflow-session').refreshToken, 'new-save'); assert.equal((await f.service.info()).sub, 'account-two');
});

test('scopes, callback issuer, cancellation and browser launch failure reject before connecting', async () => {
  const f = fixture();
  await assert.rejects(f.service.acceptTokens({ access_token: 'read-only', token_type: 'Bearer', expires_in: 300, scope: 'favorites:read' }, settings, f.discovery, { sub: 'account-one' }, false, 0));
  const pending = f.service.connect({ remember: false }); const rejected = assert.rejects(pending, /issuer/); const auth = await f.opened.promise;
  const uri = new URL(auth.searchParams.get('redirect_uri')); uri.search = new URLSearchParams({ state: auth.searchParams.get('state'), code: 'code', iss: 'https://wrong.example' }).toString();
  assert.equal((await callback(uri)).status, 400); await rejected; assert.equal(f.exchanges(), 0);
  const cancelled = fixture(); const login = cancelled.service.connect({ remember: false }); const cancelledResult = assert.rejects(login, /cancel/);
  await cancelled.opened.promise; await cancelled.service.disconnect(); await cancelledResult;
  const blocked = fixture({ open: () => { throw new Error('Browser unavailable'); } });
  await assert.rejects(blocked.service.connect({ remember: false }), /system browser/);
});

test('concurrent connection attempts cancel the older generation and remembered state stays issuer-bound', async () => {
  const f = fixture();
  const older = f.service.connect({ remember: false }); const rejected = assert.rejects(older, /cancel/);
  const newer = f.service.connect({ remember: false });
  const auth = await f.opened.promise;
  const uri = new URL(auth.searchParams.get('redirect_uri')); uri.search = new URLSearchParams({ state: auth.searchParams.get('state'), code: 'one-time-code' }).toString();
  assert.equal((await callback(uri)).status, 200);
  await rejected; assert.equal((await newer).connected, true); assert.equal(f.exchanges(), 1);
  assert.equal(auth.searchParams.get('scope').includes('offline_access'), false);
  assert.deepEqual(f.values.get('lyricflow-session'), {});
  f.service.cancel();
  f.values.set('lyricflow-session', { ...settings, issuer: 'https://another.example/oidc', sub: 'old-account', refreshToken: 'wrong-issuer' });
  assert.equal((await f.service.info()).connected, false); await assert.rejects(f.service.access(), /Reconnect/);
});

test('public IPC operations omit credentials, reject arbitrary paths and bound request/response bytes', async () => {
  const f = fixture();
  await f.service.read('resolve', { apiOrigin: settings.apiOrigin, title: 'Song', artist: 'AC/DC', durationMs: 123000 });
  const call = f.calls.at(-1); assert.equal(call.init.headers, undefined);
  assert.equal(new URL(call.url).searchParams.get('artist'), 'AC/DC');
  await assert.rejects(f.service.read('fetch', { url: 'https://attacker.example' }));
  await assert.rejects(f.service.read('revision', { id: '../admin/accounts' }));
  assert.throws(() => lyricFlowOperation('admin', {}));
  assert.throws(() => lyricFlowOperation('saveDraft', { id: 'draft', etag: 'unversioned' }));
  assert.throws(() => lyricFlowOperation('submit', { id: 'draft', idempotencyKey: 'short' }));
  const before = f.calls.length; await assert.rejects(f.service.json(settings.apiOrigin, { body: 'x'.repeat(512001) }), /512000/); assert.equal(f.calls.length, before);
  await assert.rejects(boundedJson(new Response('x'.repeat(2097153))), /too large/);
  await assert.rejects(boundedJson(new Response('{broken')), /invalid JSON/);
  const output = await boundedJson(json({ status: 'ok' })); assert.deepEqual(output, { status: 'ok' });
  await f.service.openSite({ trackId: 'song-one' }); assert.equal((await f.opened.promise).href, settings.siteOrigin + '/songs/song-one');
});

test('secure config stores only encrypted refresh state, rejects plaintext backends and generic IPC excludes sessions', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'lyricflow-config-'));
  const crypto = { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'test-secure', encryptString: value => Buffer.from('encrypted:' + Buffer.from(value).toString('base64')), decryptString: value => Buffer.from(value.toString().slice(10), 'base64').toString() };
  try {
    const config = new DesktopConfig(directory, crypto);
    await config.set('lyricflow-session', { ...settings, sub: 'one', refreshToken: 'private-refresh-value' });
    const text = await readFile(config.file, 'utf8'); assert.equal(text.includes('private-refresh-value'), false); assert.equal(text.includes('accessToken'), false);
    assert.equal((await config.get('lyricflow-session')).refreshToken, 'private-refresh-value');
    const insecure = new DesktopConfig(directory, { ...crypto, getSelectedStorageBackend: () => 'basic_text' });
    await assert.rejects(insecure.set('lyricflow-session', { refreshToken: 'must-not-save' }), /unavailable/);
    const ipc = await readFile(new URL('../electron/settings-ipc.mjs', import.meta.url), 'utf8');
    const whitelist = ipc.match(/const allowed = new Set\(\[(.*?)\]\)/s)?.[1]; assert.ok(whitelist); assert.equal(whitelist.includes('lyricflow'), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
