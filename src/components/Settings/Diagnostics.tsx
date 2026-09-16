import { useEffect, useState } from 'react';
import { t } from '../../i18n';
import { diagnosticText, setDebugMode, useDiagnostics } from '../../desktop/diagnostics';

export function DiagnosticsSettings() {
  const { debug, error } = useDiagnostics(), [path, setPath] = useState(''), [failure, setFailure] = useState('');
  const desktop = window.localMusicDesktop;
  useEffect(() => { let live = true; void desktop?.logPath?.().then(value => { if (live) setPath(value); }).catch(() => {}); return () => { live = false; }; }, [desktop]);
  const run = async (action: () => Promise<unknown>) => { setFailure(''); try { await action(); } catch (error) { setFailure((error as Error).message); } };
  return <section className='diagnostics-settings'><h3>{t('Diagnostics')}</h3>
    <label><input aria-label={t('Debug mode')} type='checkbox' checked={debug} onChange={event => void setDebugMode(event.target.checked)} />{t('Debug mode')}</label>
    <p>{t('Logs stay on this device. API credentials and lyric request bodies are not recorded.')}</p>
    {path && <code className='diagnostics-path'>{path}</code>}
    <div className='settings-folder-actions'><button onClick={() => void run(async () => {
      const text = await diagnosticText(), url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url; link.download = `lyric-player-${new Date().toISOString().replace(/[:.]/g, '-')}.log`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    })}>{t('Export log')}</button>
    {desktop?.openLogFolder && <button onClick={() => void run(desktop.openLogFolder)}>{t('Open log folder')}</button>}
    {desktop?.openDebugTools && debug && <button onClick={() => void run(desktop.openDebugTools)}>{t('Developer tools')}</button>}</div>
    {(error || failure) && <p role='alert'>{t(failure || error)}</p>}
  </section>;
}
