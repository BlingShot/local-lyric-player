import { diagnosticLog } from '../../desktop/diagnostics';
import { t } from '../../i18n';
import { useEffect, useState } from 'react';
import type { DesktopStorageInfo } from '../../desktop/types';
import { useAppSelector } from '../../store/store';
import './desktop-storage.css';

const size = (bytes: number) => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
export function DesktopStorageSettings() {
  const desktop = window.localMusicDesktop;
  const importing = useAppSelector(state => state.library.busy);
  const [info, setInfo] = useState<DesktopStorageInfo>();
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    desktop?.storageInfo().then(value => { if (active) setInfo(value); }).catch(reason => { if (active) setError(String(reason.message || reason)); });
    return () => { active = false; };
  }, [desktop]);
  if (!desktop) return null;
  const run = async (action: () => Promise<DesktopStorageInfo | void>, success = '') => {
    setBusy(true); setError(''); setMessage('');
    try { const next = await action(); if (next) setInfo(next); setMessage(success); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Storage operation failed.'); }
    finally { setBusy(false); }
  };
  const disabled = busy || !!importing;
  return <section className='desktop-storage-settings'>
    <h3>{t("Storage")}</h3>
    <p>{t("Saved outside the executable. Audio copies, lyrics, Studio drafts, analysis and settings stay in your data folder.")}</p>
    {info ? <>
      {(['data', 'cache'] as const).map(kind => <div className='desktop-storage-location' key={kind}>
        <div className='desktop-storage-heading'><strong>{kind === 'data' ? t("Database & audio") : t("Cache")}</strong><span>{size(kind === 'data' ? info.dataBytes : info.cacheBytes)}</span></div>
        <code>{kind === 'data' ? info.dataPath : info.cachePath}</code>
        <div className='settings-folder-actions'>
          <button className='lyrics-import-button' disabled={disabled} onClick={() => void run(() => desktop.chooseStorage(kind))}>{t("Change")}{' '}{kind === 'data' ? t("data") : t("cache")} {t("location")}</button>
          <button className='lyrics-import-button' disabled={disabled} onClick={() => void run(() => desktop.openStorage(kind))}>{t("Open folder")}</button>
        </div>
      </div>)}
      <p>{t("HTTP cache limit: 128 MB. Code and graphics caches are stored separately here and can be regenerated.")}</p>
      <div className='settings-folder-actions'><button className='lyrics-import-button' disabled={disabled} onClick={() => void run(async () => { const result = await desktop.clearCache(); window.dispatchEvent(new Event('local-cache-cleared')); diagnosticLog('info', 'cache', 'Generated caches cleared; library, lyrics and Studio drafts retained.'); return result; }, 'Cache cleared. Songs, lyrics and settings are kept.')}>{t("Clear cache")}</button>
        <button className='lyrics-import-button' disabled={disabled} onClick={() => void run(desktop.storageInfo)}>{t("Refresh usage")}</button></div>
      <p>{t("App memory:")}{' '}{size(info.memoryBytes)} {t("at last refresh. This includes Chromium, playback buffers and any active analysis.")}</p>
      {info.pending && <div className='desktop-storage-pending'>
        <strong>{t("Apply on restart")}</strong><p>{t("New data location")}</p><code>{info.pending.dataPath}</code><p>{t("New cache location")}</p><code>{info.pending.cachePath}</code>
        <p>{t("Playback will stop. On the next launch, the library is copied and verified before it opens. Large libraries may take a while. The old data folder is kept as a backup.")}</p>
        <div className='settings-folder-actions'><button className='white-button' disabled={disabled} onClick={() => void run(desktop.applyStorageChange, 'Restarting to apply storage locations…')}>{t("Apply and restart")}</button>
          <button className='lyrics-import-button' disabled={disabled} onClick={() => void run(desktop.cancelStorageChange)}>{t("Cancel changes")}</button></div>
      </div>}
      {info.previousDataPath && <div className='desktop-storage-previous'><p>{t("Previous data backup (also uses disk space)")}</p><code>{info.previousDataPath}</code><p>{t("After checking your restored library, you can remove this old folder yourself.")}</p>
        <button className='lyrics-import-button' disabled={disabled} onClick={() => void run(() => desktop.openStorage('previous'))}>{t("Open previous data folder")}</button></div>}
      {!!info.backups?.length && <details className='desktop-storage-previous'><summary>{t("Previous storage locations ·")}{' '}{info.backups.length}</summary>
        <p>{t("These old folders were kept, not duplicated on every launch. Remove them yourself when no longer needed.")}</p>
        {info.backups.map((backup, index) => <div key={`${backup.path}-${index}`}><p>{backup.kind === 'data' ? t("Data backup") : t("Previous cache")}</p><code>{backup.path}</code></div>)}
      </details>}
      {info.error && <p role='alert'>{t(info.error)}</p>}
    </> : <p>{t("Reading storage usage…")}</p>}
    {busy && <p role='status'>{t("Working…")}</p>}{message && <p role='status'>{t(message)}</p>}{error && <p role='alert'>{t(error)}</p>}
  </section>;
}
