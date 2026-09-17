import { useState } from 'react';
import { Modal } from 'antd';
import { t } from '../../i18n';
import { debugReport, clearDiagnostics, diagnosticText, recentDiagnosticLogs, setDebugMode, useDiagnostics, useDebugSnapshot } from '../../desktop/diagnostics';
import './diagnostics.css';

const tabs = ['Live Debug', 'Lyrics', 'Audio', 'TTML/API', 'Performance', 'Errors'] as const;
function save(text: string, extension: string) {
  const url = URL.createObjectURL(new Blob([text], { type: extension === 'json' ? 'application/json' : 'text/plain;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `lyric-player-debug-${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function DebugPanel() {
  const snapshot = useDebugSnapshot(), [tab, setTab] = useState<typeof tabs[number]>('Live Debug');
  const mainLogs = (snapshot.desktop as { logs?: { recent?: ReturnType<typeof recentDiagnosticLogs> } } | undefined)?.logs?.recent || [];
  const logs = [...mainLogs, ...recentDiagnosticLogs()].sort((a, b) => a.time.localeCompare(b.time)), key = ({ 'Live Debug': 'live', Lyrics: 'lyrics', Audio: 'audio', 'TTML/API': 'ttml', Performance: 'performance' } as const)[tab as Exclude<typeof tabs[number], 'Errors'>];
  const value = tab === 'Errors' ? logs.filter(log => ['error', 'warn'].includes(log.level)).slice(-50) : tab === 'Performance'
    ? { ...snapshot.metrics, cache: snapshot.sections.performance, desktop: snapshot.desktop, retainedBytes: snapshot.retainedBytes, dropped: snapshot.dropped }
    : { current: snapshot.sections[key], recentEvents: logs.filter(log => tab === 'Live Debug' || (tab === 'TTML/API' ? /amll|ttml|lyrics\.parse/.test(log.scope) : log.scope.startsWith(key))).slice(-40) };
  return <div className='debug-panel'><nav aria-label={t('Debug categories')}>{tabs.map(name => <button key={name} aria-pressed={tab === name} onClick={() => setTab(name)}>{t(name)}</button>)}</nav>
    <p>{t('Sampled at')}: {snapshot.sampledAt || '—'}</p><pre tabIndex={0} aria-label={tab}>{JSON.stringify(value, null, 2)}</pre></div>;
}
export function DiagnosticsSettings() {
  const { debug, error } = useDiagnostics(), [open, setOpen] = useState(false), [failure, setFailure] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const desktop = window.localMusicDesktop;
  const run = async (action: () => Promise<unknown>, success = '') => { setBusy(true); setFailure(''); setNotice(''); try { await action(); setNotice(success); } catch (error) { setFailure((error as Error).message); } finally { setBusy(false); } };
  const actions = <div className='settings-folder-actions'>
    <button disabled={busy} onClick={() => void run(async () => { await navigator.clipboard.writeText(await debugReport()); }, 'Debug info copied.')}>{t('Copy Debug Info')}</button>
    <button disabled={busy} onClick={() => void run(async () => save(await debugReport(), 'json'))}>{t('Export Debug Report')}</button>
    {desktop?.openLogFolder && <button disabled={busy} onClick={() => void run(desktop.openLogFolder)}>{t('Open Log Folder')}</button>}
    <button disabled={busy} onClick={() => void run(clearDiagnostics, 'Logs cleared.')}>{t('Clear Logs')}</button>
  </div>;
  return <section className='diagnostics-settings'><h3>{t('Diagnostics')}</h3>
    <label><input aria-label={t('Debug mode')} type='checkbox' checked={debug} onChange={event => void setDebugMode(event.target.checked)} />{t('Debug mode')}</label>
    <p>{t('Logs stay on this device. Credentials and user paths are redacted. Debug sampling stops when disabled.')}</p>
    <div className='settings-folder-actions'><button disabled={!debug} onClick={() => setOpen(true)}>{t('Debug Panel')}</button>
      <button disabled={busy} onClick={() => void run(async () => save(await diagnosticText(), 'log'))}>{t('Export log')}</button>
      {desktop?.openDebugTools && debug && <button onClick={() => void run(desktop.openDebugTools)}>{t('Developer tools')}</button>}</div>
    {actions}{(error || failure) && <p role='alert'>{t(failure || error)}</p>}{notice && <p role='status'>{t(notice)}</p>}
    <Modal title={t('Debug Panel')} open={open && debug} onCancel={() => setOpen(false)} width={960} footer={null} destroyOnHidden className='debug-modal'>
      {open && debug && <DebugPanel />}{actions}{failure && <p role='alert'>{failure}</p>}{notice && <p role='status'>{t(notice)}</p>}
    </Modal>
  </section>;
}
