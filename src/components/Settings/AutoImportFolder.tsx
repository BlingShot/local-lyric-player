import { t } from '../../i18n';
import { useState, useSyncExternalStore } from 'react';
import { isDesktop } from '../../desktop/environment';
import { allowFolderAccess, chooseImportFolder, disconnectImportFolder, getFolderImportState, scanFolder, subscribeFolderImport, supportsFolderImport } from '../../library/folderImport';

export function AutoImportFolder() {
  const folder = useSyncExternalStore(subscribeFolderImport, getFolderImportState);
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<void>) => { setBusy(true); try { await action(); } finally { setBusy(false); } };
  const supported = supportsFolderImport();
  return <section className='settings-auto-import'>
    <h3>{t("Auto import folder")}</h3>
    <p>{t("Checks for new audio once on startup, including subfolders. Use Scan now to check again.")}</p>
    {folder.name && <p className='settings-track-name'>{folder.name}</p>}
    {!supported && <p>{t("Folder auto import is unavailable in this browser. Use Import music to choose files.")}</p>}
    {folder.message && <p role={folder.status === 'error' || folder.status === 'permission' ? 'alert' : 'status'}>{t(folder.message)}</p>}
    <div className='settings-folder-actions'>
      <button className='lyrics-import-button' disabled={!supported || busy || folder.status === 'choosing'} onClick={() => void run(chooseImportFolder)}>{folder.name ? t("Change folder") : t("Choose folder")}</button>
      {folder.name && <>
        {folder.status === 'permission'
          ? <button className='lyrics-import-button' disabled={busy || !supported} onClick={() => void run(allowFolderAccess)}>{t("Allow folder access")}</button>
          : <button className='lyrics-import-button' disabled={busy || !supported || folder.status === 'scanning'} onClick={() => void run(scanFolder)}>{t("Scan now")}</button>}
        <button className='lyrics-import-button' disabled={busy} onClick={() => void run(disconnectImportFolder)}>{t("Disconnect folder")}</button>
      </>}
    </div>
    <p>{t("Saved songs use")}{' '}{isDesktop ? t("this app’s local storage") : t("browser storage")}{t(". Originals are never changed or deleted. Songs you remove stay removed on later scans of this folder.")}</p>
  </section>;
}
