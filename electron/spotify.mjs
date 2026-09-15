import { createServer } from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

export const REDIRECT_URI = 'http://127.0.0.1:43821/spotify/callback';
const normalize = value => String(value || '').normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
export function chooseTrack(items, track) {
  if (!track.artist || !normalize(track.name)) return null;
  const candidates = items.filter(item => /^[a-zA-Z0-9]{22}$/.test(item?.id || '') && normalize(item.name) === normalize(track.name)
    && item.artists?.some(artist => normalize(artist.name) === normalize(track.artist))
    && (!track.duration || Math.abs(item.duration_ms / 1000 - track.duration) <= 3));
  candidates.sort((a, b) => Math.abs(a.duration_ms / 1000 - (track.duration || 0)) - Math.abs(b.duration_ms / 1000 - (track.duration || 0)));
  if (candidates.length > 1 && candidates.some(item => item.external_ids?.isrc !== candidates[0].external_ids?.isrc)) return null;
  return candidates[0] || null;
}
export class SpotifyService {
  constructor(config, openExternal, request = fetch) { this.config = config; this.openExternal = openExternal; this.request = request; this.generation = 0; }
  async info() { const saved = await this.config.get('spotify'); return { clientId: saved?.clientId || '', connected: Boolean(saved?.refreshToken) }; }
  cancel() { this.generation++; this.cancelLogin?.(); this.cancelLogin = undefined; }
  async logout() { this.cancel(); const previous = await this.config.get('spotify').catch(() => null); await this.config.set('spotify', { clientId: previous?.clientId || '' }); }
  async json(url, options = {}) {
    const response = await this.request(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (!response.ok) {
      await response.body?.cancel();
      const error = new Error(response.status === 401 ? 'Spotify login expired. Sign in again in Settings.' : response.status === 403 ? 'Spotify denied API access. Check your app users and account eligibility in the Spotify dashboard.' : response.status === 429 ? 'Spotify rate limit reached. Try again later.' : `Spotify request failed (HTTP ${response.status}).`);
      error.status = response.status; throw error;
    }
    return response.json();
  }
  async token(parameters, previous, generation) {
    const value = await this.json('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(parameters) });
    if (typeof value.access_token !== 'string' || !Number.isFinite(value.expires_in) || value.expires_in <= 0) throw new Error('Spotify returned an invalid session.');
    const saved = { clientId: parameters.client_id, accessToken: value.access_token, refreshToken: value.refresh_token || previous?.refreshToken, expiresAt: Date.now() + value.expires_in * 1000 };
    if (typeof saved.refreshToken !== 'string' || generation !== this.generation) throw new Error('Spotify login was cancelled.');
    await this.config.set('spotify', saved); return saved.accessToken;
  }
  async login(clientId) {
    if (typeof clientId !== 'string' || !/^[a-fA-F0-9]{32}$/.test(clientId.trim())) throw new Error('Enter your 32-character Spotify Client ID. No Client Secret is needed.');
    clientId = clientId.trim(); this.cancel(); const generation = this.generation;
    const verifier = randomBytes(48).toString('base64url'), state = randomBytes(32).toString('hex');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const code = await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); server.close(); this.cancelLogin = undefined; error ? reject(error) : resolve(value); };
      const server = createServer((req, res) => {
        const url = new URL(req.url || '/', REDIRECT_URI), candidate = url.searchParams.get('state') || '';
        res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Security-Policy', "default-src 'none'");
        if (req.method !== 'GET' || req.headers.host !== '127.0.0.1:43821' || url.pathname !== '/spotify/callback') { res.writeHead(404); res.end('Not found'); return; }
        if (Buffer.byteLength(candidate) !== Buffer.byteLength(state) || !timingSafeEqual(Buffer.from(candidate), Buffer.from(state))) { res.writeHead(400); res.end('Invalid login state.'); return; }
        const code = url.searchParams.get('code');
        if (url.searchParams.has('error') || !code || code.length > 4096) { res.end('Authorization declined. Return to Lyric Player.'); finish(new Error('Spotify authorization was declined.')); return; }
        res.end('Authorization received. Return to Lyric Player.'); finish(null, code);
      });
      const timer = setTimeout(() => finish(new Error('Spotify login timed out. Please try again.')), 180000);
      this.cancelLogin = () => finish(new Error('Spotify login was cancelled.'));
      server.on('error', () => finish(new Error('Cannot open Spotify callback port 43821. Close another login window and retry.')));
      server.listen(43821, '127.0.0.1', () => {
        const url = new URL('https://accounts.spotify.com/authorize');
        url.search = new URLSearchParams({ client_id: clientId, response_type: 'code', redirect_uri: REDIRECT_URI, state, code_challenge: challenge, code_challenge_method: 'S256' }).toString();
        Promise.resolve(this.openExternal(url.href)).catch(() => finish(new Error('Could not open the Spotify login browser.')));
      });
    });
    if (generation !== this.generation) throw new Error('Spotify login was cancelled.');
    await this.token({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, client_id: clientId, code_verifier: verifier }, null, generation);
    return this.info();
  }
  async access(force = false) {
    const saved = await this.config.get('spotify');
    if (!saved?.refreshToken) throw new Error('Connect Spotify in Settings to search AMLL lyrics.');
    if (!force && saved.accessToken && saved.expiresAt > Date.now() + 60000) return saved.accessToken;
    if (!this.refresh) this.refresh = this.token({ grant_type: 'refresh_token', refresh_token: saved.refreshToken, client_id: saved.clientId }, saved, this.generation).finally(() => { this.refresh = undefined; });
    return this.refresh;
  }
  async api(path) {
    try { return await this.json(`https://api.spotify.com/v1/${path}`, { headers: { Authorization: `Bearer ${await this.access()}` } }); }
    catch (error) { if (error.status !== 401) throw error; return this.json(`https://api.spotify.com/v1/${path}`, { headers: { Authorization: `Bearer ${await this.access(true)}` } }); }
  }
  async match(track) {
    if (!track || typeof track.name !== 'string' || track.name.length > 300 || track.artist !== undefined && (typeof track.artist !== 'string' || track.artist.length > 300) || track.duration !== undefined && (!Number.isFinite(track.duration) || track.duration < 0)) throw new Error('Invalid song metadata.');
    if (!track.artist?.trim() || !track.name.trim()) return null;
    const clean = value => value.replace(/["\\]/g, ' ').trim();
    const query = new URLSearchParams({ q: `track:"${clean(track.name)}" artist:"${clean(track.artist)}"`, type: 'track', limit: '10' });
    const found = await this.api(`search?${query}`), match = chooseTrack(Array.isArray(found?.tracks?.items) ? found.tracks.items : [], track);
    if (!match) return null;
    const full = await this.api(`tracks/${match.id}`), isrc = full?.external_ids?.isrc?.toUpperCase();
    return typeof isrc === 'string' && /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(isrc) ? { id: match.id, isrc } : null;
  }
}
