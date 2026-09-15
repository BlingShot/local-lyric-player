import { useEffect, useState } from 'react';
import { t } from '../../i18n';

export function SpotifySettings() {
  const desktop = window.localMusicDesktop;
  const [clientId, setClientId] = useState(''), [connected, setConnected] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { let live = true; desktop?.spotifyInfo().then(value => { if (live) { setClientId(value.clientId); setConnected(value.connected); } }).catch(e => { if (live) setError(e.message); }); return () => { live = false; }; }, []);
  const login = async () => {
    if (!desktop || busy) return; setBusy(true); setError('');
    try { const info = await desktop.spotifyLogin(clientId); setConnected(info.connected); window.dispatchEvent(new Event('spotify-session-updated')); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const logout = async () => {
    try { await desktop?.spotifyLogout(); setConnected(false); window.dispatchEvent(new Event('spotify-session-updated')); }
    catch (e) { setError((e as Error).message); }
  };
  return <section className='spotify-lyrics-settings'><h3>{t('Spotify / AMLL lyrics')}</h3>
    <p>{t('Match local songs with Spotify ISRC, then prefer AMLL TTML. Only song title, artist and duration are sent; audio stays local.')}</p>
    {!desktop ? <p>{t('Spotify login is available in the desktop app.')}</p> : <>
      <label>{t('Spotify Client ID')}<input aria-label={t('Spotify Client ID')} value={clientId} onChange={e => setClientId(e.target.value)} maxLength={32} autoComplete='off' spellCheck={false} disabled={busy} /></label>
      <p>{t('Register this exact Redirect URI in your Spotify app. No Client Secret is required.')}</p><code style={{ overflowWrap: 'anywhere' }}>http://127.0.0.1:43821/spotify/callback</code>
      <p role='status'>{t(busy ? 'Waiting for Spotify authorization...' : connected ? 'Spotify connected' : 'Spotify disconnected')}</p>
      <button onClick={() => void login()} disabled={busy || !/^[a-f\d]{32}$/i.test(clientId.trim())}>{t('Sign in with Spotify')}</button>
      {(connected || busy) && <button onClick={() => void logout()}>{t(busy ? 'Cancel login' : 'Disconnect Spotify')}</button>}
    </>}
    {error && <p role='alert'>{t(error)}</p>}
  </section>;
}
