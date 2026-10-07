import { useEffect, useState } from 'react';
import '../../integrations/lyricflow/styles.css';
import { t } from '../../i18n';
import type { LyricFlowConfiguration, LyricFlowConnectionInfo } from '../../integrations/lyricflow/contributionTypes';

export function LyricFlowConnection() {
  const bridge = window.localMusicDesktop;
  const [info, setInfo] = useState<LyricFlowConnectionInfo>();
  const [config, setConfig] = useState<LyricFlowConfiguration>({ apiOrigin: '', siteOrigin: '', issuer: '', clientId: '' });
  const [remember, setRemember] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { let live = true; bridge?.lyricflowInfo?.().then(value => { if (live) { setInfo(value); setConfig({ apiOrigin: value.apiOrigin || '', siteOrigin: value.siteOrigin || '', issuer: value.issuer || '', clientId: value.clientId || '' }); } }).catch(e => { if (live) setError(e.message); }); return () => { live = false; }; }, [bridge]);
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); setError(''); try { await fn(); setInfo(await bridge!.lyricflowInfo()); window.dispatchEvent(new Event('lyricflow-connection-updated')); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  if (!bridge?.lyricflowInfo) return <p>{t('LyricFlow contributions are available in the desktop app. Public lyrics need no account.')}</p>;
  return <section className='lyricflow-connection' aria-label={t('LyricFlow connection')}>
    <h3>{t('LyricFlow connection')}</h3>
    <p role='status' aria-live='polite'>{info?.connected ? `${t('Connected')}: ${info.displayName || info.sub}` : t('Not connected')}</p>
    <details><summary>{t('Registered client settings')}</summary>
      {(['apiOrigin', 'siteOrigin', 'issuer', 'clientId'] as const).map(key => <label key={key} style={{ display: 'block', marginBlock: 8 }}>{t({ apiOrigin: 'API origin', siteOrigin: 'Website origin', issuer: 'OIDC issuer', clientId: 'Public Client ID' }[key])}<input value={config[key]} disabled={busy} onChange={e => setConfig(v => ({ ...v, [key]: e.target.value }))} autoComplete='off' spellCheck={false} /></label>)}
      <button disabled={busy} onClick={() => void run(() => bridge.lyricflowConfigure(config))}>{t('Save client settings')}</button>
    </details>
    <label><input type='checkbox' checked={remember} onChange={e => setRemember(e.target.checked)} disabled={busy} />{t('Remember connection on this computer')}</label>
    <div><button disabled={busy || !info?.configured} onClick={() => void run(() => bridge.lyricflowConnect({ remember }))}>{t('Connect to LyricFlow')}</button>
      <button disabled={!info?.configured} onClick={() => void run(() => bridge.lyricflowDisconnect())}>{t('Disconnect')}</button></div>
    {busy && <p role='status'>{t('Complete authorization in your system browser.')}</p>}
    {error && <p role='alert'>{t(error)}</p>}
  </section>;
}
