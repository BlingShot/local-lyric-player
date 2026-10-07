import { createServer } from 'node:http';
import { randomBytes, createHash, createPublicKey, timingSafeEqual, verify } from 'node:crypto';

const MAX_RESPONSE = 2097152, MAX_REQUEST = 512000;
const sameSecret = (a, b) => typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function lyricFlowOrigin(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Invalid LyricFlow origin.');
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      !(url.protocol === 'https:' || url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Use HTTPS or a local loopback origin.');
  return url.origin;
}
export function validateLyricFlowConfig(value) {
  const apiOrigin = lyricFlowOrigin(value?.apiOrigin), siteOrigin = lyricFlowOrigin(value?.siteOrigin);
  if (value.issuer !== `${apiOrigin}/oidc` || typeof value.clientId !== 'string' || !/^[\w.-]{1,200}$/.test(value.clientId)) throw new Error('Use the registered LyricFlow issuer and public Client ID.');
  return { apiOrigin, siteOrigin, issuer: value.issuer, clientId: value.clientId };
}
export async function boundedJson(response) {
  const reader = response.body?.getReader(); let size = 0; const chunks = [];
  if (!reader) throw new Error('LyricFlow returned an empty response.');
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength;
    if (size > MAX_RESPONSE) throw new Error('LyricFlow response is too large.'); chunks.push(value); } }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  let result; try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('LyricFlow returned invalid JSON.'); }
  if (!response.ok) {
    const code = result?.error?.code || result?.code || `HTTP_${response.status}`;
    // Never include request URLs, authorization codes, tokens or arbitrary error bodies.
    const error = new Error(`LyricFlow ${String(code).replace(/[^A-Z0-9_]/gi, '').slice(0, 80)} (${response.status})${response.status === 429 ? `; Retry-After: ${response.headers.get('retry-after') || '60'}` : ''}`);
    error.status = response.status; throw error;
  }
  return result;
}
export function verifyLyricFlowIdToken(token, jwks, expected) {
  if (typeof token !== 'string' || token.length > 32000) throw new Error('Invalid LyricFlow identity token.');
  const parts = token.split('.'); if (parts.length !== 3) throw new Error('Invalid LyricFlow identity token.');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  const keys = jwks?.keys?.filter(k => k.kty === 'RSA' && k.kid === header.kid && (!k.alg || k.alg === 'RS256') && (!k.use || k.use === 'sig'));
  if (header.alg !== 'RS256' || header.crit || !header.kid || keys?.length !== 1 ||
      !verify('RSA-SHA256', Buffer.from(parts.slice(0, 2).join('.')), createPublicKey({ key: keys[0], format: 'jwk' }), Buffer.from(parts[2], 'base64url'))) throw new Error('LyricFlow identity signature is invalid.');
  const now = Date.now() / 1000, audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== expected.issuer || !audiences.includes(expected.clientId) || (audiences.length > 1 || claims.azp) && claims.azp !== expected.clientId ||
      !Number.isFinite(claims.exp) || claims.exp <= now || !Number.isFinite(claims.iat) || claims.iat > now + 60 || claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf > now + 60) ||
      typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 200 || expected.nonce && !sameSecret(claims.nonce, expected.nonce) || expected.sub && claims.sub !== expected.sub) throw new Error('LyricFlow identity claims are invalid.');
  if (claims.at_hash && claims.at_hash !== createHash('sha256').update(expected.accessToken).digest().subarray(0, 16).toString('base64url')) throw new Error('LyricFlow access token does not match the identity.');
  return claims;
}
const validId = value => { if (typeof value !== 'string' || !/^[\w-]{1,120}$/.test(value)) throw new Error('Invalid LyricFlow object ID.'); return encodeURIComponent(value); };
export function lyricFlowOperation(operation, input = {}) {
  const id = () => validId(input.id);
  const key = () => { if (typeof input.idempotencyKey !== 'string' || !/^[\w-]{16,128}$/.test(input.idempotencyKey)) throw new Error('A persisted idempotency key is required.'); return { 'Idempotency-Key': input.idempotencyKey }; };
  switch (operation) {
    case 'context': return { path: `/oauth/tracks/${id()}/contribution-context` };
    case 'createDraft': return { path: '/oauth/drafts', method: 'POST', headers: key(), body: { documentId: validId(input.documentId) } };
    case 'draft': return { path: `/oauth/drafts/${id()}` };
    case 'saveDraft': {
      if (typeof input.etag !== 'string' || !/^"draft-[\w-]+-v\d+"$/.test(input.etag)) throw new Error('A saved draft version is required.');
      return { path: `/oauth/drafts/${id()}`, method: 'PUT', headers: { 'If-Match': input.etag }, body: { content: input.content } };
    }
    case 'fingerprint': return { path: `/oauth/drafts/${id()}/fingerprint`, method: 'POST', body: { text: input.text } };
    case 'changes': return { path: `/oauth/drafts/${id()}/changes` };
    case 'submit': return { path: `/oauth/drafts/${id()}/submissions`, method: 'POST', headers: key(), body: input.body };
    case 'status': return { path: `/oauth/submissions/${id()}` };
    case 'withdraw': return { path: `/oauth/submissions/${id()}/withdraw`, method: 'POST', headers: key(), body: {} };
    default: throw new Error('Unknown LyricFlow operation.');
  }
}
export class LyricFlowService {
  constructor(config, openExternal, request = fetch) { this.config = config; this.openExternal = openExternal; this.request = request; this.generation = 0; this.persistence = Promise.resolve(); }
  async settings() { const value = await this.config.get('lyricflow'); return value?.apiOrigin ? validateLyricFlowConfig(value) : null; }
  async info() {
    const settings = await this.settings();
    const stored = await this.config.get('lyricflow-session').catch(() => null);
    const saved = settings && stored && ['issuer', 'clientId', 'apiOrigin'].every(key => settings[key] === stored[key]) ? stored : null;
    return { configured: !!settings, ...settings, connected: !!this.session || !!saved?.refreshToken,
      sub: this.session?.sub || saved?.sub, displayName: this.session?.displayName || saved?.displayName, remembered: !!saved?.refreshToken };
  }
  cancel() { this.generation++; this.cancelLogin?.(); this.cancelLogin = undefined; this.session = undefined; this.refreshing = undefined; }
  persistSession(value, generation) {
    const task = this.persistence.catch(() => {}).then(async () => {
      if (generation !== this.generation) return;
      await this.config.set('lyricflow-session', value);
      // A cancellation may occur during the encrypted write. Clean it up before
      // any newer generation can write, so an old completion cannot erase it.
      if (generation !== this.generation) await this.config.set('lyricflow-session', {});
    });
    this.persistence = task; return task;
  }
  async disconnect() {
    const active = this.session;
    this.cancel(); const generation = this.generation;
    const settings = await this.settings(), old = active || await this.config.get('lyricflow-session').catch(() => null);
    await this.persistSession({}, generation);
    if (generation !== this.generation) return;
    if (settings && (old?.refreshToken || old?.accessToken)) {
      try { const discovery = await this.discovery(settings); if (discovery.revocation_endpoint) await this.request(discovery.revocation_endpoint, { method: 'POST', redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(10000), body: new URLSearchParams({ client_id: settings.clientId, token: old.refreshToken || old.accessToken }) }); } catch { /* Local disconnect is complete even while offline. */ }
    }
  }
  async configure(value) {
    const settings = validateLyricFlowConfig(value), disconnected = this.disconnect(), generation = this.generation;
    await disconnected;
    if (generation !== this.generation) throw new Error('LyricFlow configuration was cancelled.');
    await this.config.set('lyricflow', settings);
    if (generation !== this.generation) throw new Error('LyricFlow configuration was cancelled.');
    return this.info();
  }
  async json(url, options = {}) {
    if (options.body && Buffer.byteLength(options.body.toString()) > MAX_REQUEST) throw new Error('LyricFlow request exceeds 512000 bytes.');
    const response = await this.request(url, { ...options, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10000) });
    return boundedJson(response);
  }
  async discovery(settings) {
    const value = await this.json(`${settings.issuer}/.well-known/openid-configuration`);
    if (value.issuer !== settings.issuer || !value.code_challenge_methods_supported?.includes('S256')) throw new Error('LyricFlow discovery does not match the configured issuer.');
    for (const key of ['authorization_endpoint', 'token_endpoint', 'jwks_uri', 'revocation_endpoint']) {
      if (key === 'revocation_endpoint' && !value[key]) continue;
      const url = new URL(value[key]);
      if (url.origin !== settings.apiOrigin || !url.pathname.startsWith('/oidc/') || url.username || url.password || url.search || url.hash) throw new Error('Untrusted LyricFlow authorization endpoint.');
    }
    return value;
  }
  async acceptTokens(value, settings, discovery, expected, remember, generation) {
    if (typeof value.access_token !== 'string' || value.access_token.length > 32000 || value.token_type?.toLowerCase() !== 'bearer' || !Number.isFinite(value.expires_in) || value.expires_in <= 0 ||
        value.scope !== undefined && (typeof value.scope !== 'string' || !value.scope.split(' ').includes('lyrics:contribute')) ||
        value.refresh_token !== undefined && (typeof value.refresh_token !== 'string' || !value.refresh_token || value.refresh_token.length > 32000)) throw new Error('LyricFlow did not grant contribution access.');
    const identity = value.id_token ? verifyLyricFlowIdToken(value.id_token, await this.json(discovery.jwks_uri), { ...settings, ...expected, accessToken: value.access_token }) : null;
    if (!identity && !expected.sub) throw new Error('LyricFlow returned no identity token.');
    if (generation !== this.generation) throw new Error('LyricFlow connection was cancelled.');
    const session = { ...settings, sub: identity?.sub || expected.sub, displayName: typeof identity?.name === 'string' ? identity.name : expected.displayName || identity?.sub,
      accessToken: value.access_token, expiresAt: Date.now() + value.expires_in * 1000, refreshToken: value.refresh_token || expected.refreshToken };
    this.session = session;
    if (remember && session.refreshToken) {
      try { await this.persistSession({ ...settings, sub: session.sub, displayName: session.displayName, refreshToken: session.refreshToken }, generation); }
      catch { await this.persistSession({}, generation).catch(() => {}); /* Retain only the in-memory connection when encryption is unavailable. */ }
    }
    if (generation !== this.generation) throw new Error('LyricFlow connection was cancelled.');
    return session;
  }
  async connect(options = {}) {
    if (typeof options.remember !== 'boolean') throw new Error('Choose whether to remember this connection.');
    const disconnected = this.disconnect(), generation = this.generation; await disconnected;
    const settings = await this.settings();
    if (!settings) throw new Error('Configure the registered LyricFlow client first.');
    const discovery = await this.discovery(settings), state = randomBytes(32).toString('base64url'), nonce = randomBytes(32).toString('base64url'), verifier = randomBytes(48).toString('base64url');
    if (generation !== this.generation) throw new Error('LyricFlow connection was cancelled.');
    const { code, redirectUri } = await new Promise((resolve, reject) => {
      let settled = false, redirectUri = '';
      const finish = (error, code) => { if (settled) return; settled = true; clearTimeout(timer); server.close(); server.closeAllConnections(); this.cancelLogin = undefined; error ? reject(error) : resolve({ code, redirectUri }); };
      const server = createServer((req, res) => {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Security-Policy', "default-src 'none'");
        let url; try { url = new URL(req.url || '/', redirectUri); } catch { res.writeHead(400); res.end('Invalid callback.'); return; }
        if (req.method !== 'GET' || req.headers.host !== new URL(redirectUri).host || url.origin !== new URL(redirectUri).origin || url.pathname !== '/lyricflow/callback') { res.writeHead(404); res.end('Not found'); return; }
        if (url.searchParams.getAll('state').length !== 1 || !sameSecret(url.searchParams.get('state'), state)) { res.writeHead(400); res.end('Invalid authorization state.'); return; }
        if (url.searchParams.getAll('iss').length > 1 || url.searchParams.has('iss') && url.searchParams.get('iss') !== settings.issuer) { res.writeHead(400); res.end('Invalid issuer.'); finish(new Error('LyricFlow callback issuer is invalid.')); return; }
        const code = url.searchParams.get('code');
        if (url.searchParams.has('error') || url.searchParams.getAll('code').length !== 1 || !code || code.length > 4096) { res.end('Authorization declined.'); finish(new Error('LyricFlow authorization was declined.')); return; }
        res.end('Authorization received. Return to Lyric Player.'); finish(null, code);
      });
      const timer = setTimeout(() => finish(new Error('LyricFlow authorization timed out.')), 180000); timer.unref?.();
      this.cancelLogin = () => finish(new Error('LyricFlow authorization was cancelled.'));
      server.on('error', () => finish(new Error('Cannot open the local authorization callback.')));
      server.listen(0, '127.0.0.1', () => {
        if (generation !== this.generation) { this.cancelLogin?.(); return; }
        redirectUri = `http://127.0.0.1:${server.address().port}/lyricflow/callback`;
        const url = new URL(discovery.authorization_endpoint);
        url.search = new URLSearchParams({ client_id: settings.clientId, redirect_uri: redirectUri, response_type: 'code', scope: `openid profile lyrics:contribute${options.remember ? ' offline_access' : ''}`, state, nonce, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', prompt: 'consent' }).toString();
        Promise.resolve().then(() => {
          if (generation !== this.generation) throw new Error('Connection cancelled');
          return this.openExternal(url.href);
        }).catch(() => finish(new Error('Cannot open the system browser.')));
      });
    });
    if (generation !== this.generation) throw new Error('LyricFlow connection was cancelled.');
    const tokens = await this.json(discovery.token_endpoint, { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', client_id: settings.clientId, code, redirect_uri: redirectUri, code_verifier: verifier }) });
    await this.acceptTokens(tokens, settings, discovery, { nonce }, options.remember, generation); return this.info();
  }
  async access(force = false) {
    if (!force && this.session?.expiresAt > Date.now() + 30000) return this.session;
    if (this.refreshing) return this.refreshing;
    const generation = this.generation;
    const task = (async () => {
      const settings = await this.settings(), saved = await this.config.get('lyricflow-session').catch(() => null), previous = this.session || saved;
      if (generation !== this.generation) throw new Error('LyricFlow connection was cancelled.');
      if (!settings || !previous?.refreshToken || ['issuer', 'clientId', 'apiOrigin'].some(k => previous[k] !== settings[k])) throw new Error('Reconnect to LyricFlow.');
      try { const discovery = await this.discovery(settings);
        const value = await this.json(discovery.token_endpoint, { method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token', client_id: settings.clientId, refresh_token: previous.refreshToken }) });
        return await this.acceptTokens(value, settings, discovery, previous, !!saved?.refreshToken, generation);
      } catch (error) { if (generation === this.generation) { this.session = undefined; await this.persistSession({}, generation); } throw error; }
    })();
    this.refreshing = task;
    try { return await task; } finally { if (this.refreshing === task) this.refreshing = undefined; }
  }
  async operation(operation, input) {
    const request = lyricFlowOperation(operation, input), generation = this.generation;
    const send = async session => {
      // Every mutating/recovery request is bound to the task's frozen owner.
      if (!input?.owner || ['issuer', 'sub', 'clientId'].some(k => input.owner[k] !== session[k])) throw new Error('This upload belongs to a different LyricFlow account.');
      return this.json(`${session.apiOrigin}/api/v1${request.path}`, { method: request.method || 'GET', headers: { 'Content-Type': 'application/json', ...request.headers, Authorization: `Bearer ${session.accessToken}` }, ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }) });
    };
    let result; try { result = await send(await this.access()); } catch (error) { if (error.status !== 401 || generation !== this.generation) throw error; result = await send(await this.access(true)); }
    if (generation !== this.generation) throw new Error('LyricFlow connection changed.'); return result;
  }
  async read(operation, input = {}) {
    const apiOrigin = lyricFlowOrigin(input.apiOrigin || (await this.settings())?.apiOrigin); let path;
    if (operation === 'contract') path = '/contract';
    else if (operation === 'revision') path = `/revisions/${validId(input.id)}`;
    else if (operation === 'track') path = `/tracks/${validId(input.id)}`;
    else if (operation === 'resolve') {
      const query = new URLSearchParams();
      for (const key of ['title', 'artist', 'album', 'durationMs', 'isrc', 'spotifyId']) if (input[key] !== undefined && input[key] !== '') {
        if (!['string', 'number'].includes(typeof input[key]) || String(input[key]).length > 300) throw new Error('Invalid recording metadata.'); query.set(key, String(input[key]));
      }
      path = `/lyrics/resolve?${query}`;
    } else throw new Error('Unknown public LyricFlow operation.');
    return this.json(`${apiOrigin}/api/v1${path}`);
  }
  async openSite(input = {}) {
    const settings = await this.settings(); if (!settings) throw new Error('Configure LyricFlow first.');
    if (input.trackId) return this.openExternal(`${settings.siteOrigin}/songs/${validId(input.trackId)}`);
    return this.openExternal(settings.siteOrigin);
  }
}
