import { useState } from 'react';
import { t } from '../../i18n';
import { AppSelect } from '../Menu';
import { debugReport, clearDiagnostics, diagnosticText, setDebugMode, setLogLevel, retryDiagnosticSettings, useDiagnostics, type LogLevel } from '../../desktop/diagnostics';

function save(text: string, extension: string) {
  const url = URL.createObjectURL(new Blob([text], { type: extension === 'json' ? 'application/json' : 'text/plain;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `lyric-player-debug-${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function DiagnosticsSettings() {
  const { debug, level, error, ready, saving, saved } = useDiagnostics(), [failure, setFailure] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const desktop = window.localMusicDesktop;
  const run = async (action: () => Promise<unknown>, success = '') => { setBusy(true); setFailure(''); setNotice(''); try { await action(); setNotice(success); } catch (error) { setFailure((error as Error).message); } finally { setBusy(false); } };
  const actions = <div className='settings-folder-actions'>
    <button disabled={busy} onClick={() => void run(async () => { const report = await debugReport(); if (desktop?.copyDebugInfo) await desktop.copyDebugInfo(report); else await navigator.clipboard.writeText(report); }, 'Debug info copied.')}>{t('Copy Debug Info')}</button>
    <button disabled={busy} onClick={() => void run(async () => save(await debugReport(), 'json'))}>{t('Export Debug Report')}</button>
    {desktop?.openLogFolder && <button disabled={busy} onClick={() => void run(desktop.openLogFolder)}>{t('Open Log Folder')}</button>}
    <button disabled={busy} onClick={() => void run(clearDiagnostics, 'Logs cleared.')}>{t('Clear Logs')}</button>
  </div>;
  return <section className='diagnostics-settings'><h3>{t('Diagnostics')}</h3>
    <div className='diagnostics-summary'><span>{t('Recording')}: {level.toUpperCase()}+</span><span>{t('Debug mode')}: {debug ? t('On') : t('Off')}</span><span>{t('Local logs only')}</span></div>
    <div className='settings-field'><span>{t('Log level')}</span><AppSelect label={t('Recorded log level')} value={level} disabled={!ready}
      onChange={value => void setLogLevel(value as LogLevel)}
      options={[{ value: 'debug', label: 'DEBUG' }, { value: 'info', label: 'INFO' }, { value: 'warn', label: 'WARN' }, { value: 'error', label: 'ERROR' }, { value: 'fatal', label: 'FATAL' }]} /></div>
    <p className='diagnostics-hint'>{t('INFO: normal activity. WARN: recoverable problems. ERROR: failed operations. FATAL: crashes or an unusable process. The selected level includes all higher levels.')}</p>
    {level === 'debug' && !debug && <p className='diagnostics-hint'>{t('Enable Debug mode to collect DEBUG details. Normal runtime logs do not require Debug mode.')}</p>}
    <label><input aria-label={t('Debug mode')} type='checkbox' checked={debug} disabled={!ready} onChange={event => void setDebugMode(event.target.checked)} />{t('Debug mode')}</label>
    <p role='status' aria-live='polite'>{t(!ready ? 'Loading debug settings...' : saving ? 'Saving debug settings...' :
      saved ? desktop ? 'Debug settings saved to config.json. They will be restored on restart.' : 'Debug settings saved in this browser.' : 'Debug settings have not been saved.')}</p>
    {ready && !saving && !saved && <button onClick={() => void retryDiagnosticSettings()}>{t('Retry save')}</button>}
    <p>{t('Logs are recorded at the selected level and above. Debug data is shown directly on the app, player, and lyric surfaces. Logs stay on this device and sensitive values are redacted.')}</p>
    <div className='settings-folder-actions'>
      <button disabled={busy} onClick={() => void run(async () => save(await diagnosticText(), 'log'))}>{t('Export log')}</button>
      {desktop?.openDebugTools && <button disabled={!debug || busy} onClick={() => void run(desktop.openDebugTools, 'Developer tools opened.')}>{t('Developer tools')}</button>}
    </div>
    {actions}{(error || failure) && <p role='alert'>{t(failure || error)}</p>}{notice && <p role='status'>{t(notice)}</p>}
  </section>;
}
