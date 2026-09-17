import { useState } from 'react';
import { t } from '../../i18n';
import { debugReport, clearDiagnostics, diagnosticText, setDebugMode, useDiagnostics } from '../../desktop/diagnostics';

function save(text: string, extension: string) {
  const url = URL.createObjectURL(new Blob([text], { type: extension === 'json' ? 'application/json' : 'text/plain;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `lyric-player-debug-${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function DiagnosticsSettings() {
  const { debug, error } = useDiagnostics(), [failure, setFailure] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const desktop = window.localMusicDesktop;
  const run = async (action: () => Promise<unknown>, success = '') => { setBusy(true); setFailure(''); setNotice(''); try { await action(); setNotice(success); } catch (error) { setFailure((error as Error).message); } finally { setBusy(false); } };
  const actions = <div className='settings-folder-actions'>
    <button disabled={busy} onClick={() => void run(async () => { const report = await debugReport(); if (desktop?.copyDebugInfo) await desktop.copyDebugInfo(report); else await navigator.clipboard.writeText(report); }, 'Debug info copied.')}>{t('Copy Debug Info')}</button>
    <button disabled={busy} onClick={() => void run(async () => save(await debugReport(), 'json'))}>{t('Export Debug Report')}</button>
    {desktop?.openLogFolder && <button disabled={busy} onClick={() => void run(desktop.openLogFolder)}>{t('Open Log Folder')}</button>}
    <button disabled={busy} onClick={() => void run(clearDiagnostics, 'Logs cleared.')}>{t('Clear Logs')}</button>
  </div>;
  return <section className='diagnostics-settings'><h3>{t('Diagnostics')}</h3>
    <label><input aria-label={t('Debug mode')} type='checkbox' checked={debug} onChange={event => void setDebugMode(event.target.checked)} />{t('Debug mode')}</label>
    <p>{t('Debug data is shown directly on the app, player, and lyric surfaces. Logs stay on this device and sensitive values are redacted.')}</p>
    <div className='settings-folder-actions'>
      <button disabled={busy} onClick={() => void run(async () => save(await diagnosticText(), 'log'))}>{t('Export log')}</button>
      {desktop?.openDebugTools && <button disabled={!debug || busy} onClick={() => void run(desktop.openDebugTools, 'Developer tools opened.')}>{t('Developer tools')}</button>}
    </div>
    {actions}{(error || failure) && <p role='alert'>{t(failure || error)}</p>}{notice && <p role='status'>{t(notice)}</p>}
  </section>;
}
