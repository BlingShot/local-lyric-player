import { t } from '../../i18n';
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { importAudioFiles } from '../../player/runtime';
import { useAppDispatch, useAppSelector } from '../../store/store';
import { uiActions } from '../../store/slices/offlineUi';
import { StorageStatus } from './StorageStatus';

export function FileDropZone({ children }: { children: ReactNode }) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const dispatch = useAppDispatch();
  const { importOpen, importMessage, importNoticeId } = useAppSelector(state => state.ui);
  useEffect(() => {
    if (importOpen || !importMessage) return;
    const timeout = window.setTimeout(() => dispatch(uiActions.setImportMessage('')), 4000);
    return () => window.clearTimeout(timeout);
  }, [dispatch, importOpen, importMessage, importNoticeId]);
  const isFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files');
  return <div className='offline-file-drop-zone'
    onDragEnter={event => {
      if (!isFiles(event)) return;
      event.preventDefault(); depth.current++; setDragging(true);
    }}
    onDragOver={event => {
      if (!isFiles(event)) return;
      event.preventDefault(); event.dataTransfer.dropEffect = 'copy';
    }}
    onDragLeave={event => {
      if (!isFiles(event)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (!depth.current) setDragging(false);
    }}
    onDrop={event => {
      // Prevent files and URL drops from navigating the application away from the player.
      event.preventDefault();
      depth.current = 0; setDragging(false);
      const files = Array.from(event.dataTransfer.files);
      if (files.length) importAudioFiles(files);
    }}>
    {children}
    <StorageStatus />
    {dragging && <div className='offline-drop-overlay'>{t("Drop to import music")}</div>}
    {!importOpen && importMessage && <div className='offline-import-feedback' role='status'>
      <span>{importMessage}</span>
      <button aria-label={t("Dismiss import message")} onClick={() => dispatch(uiActions.setImportMessage(''))}>×</button>
    </div>}
  </div>;
}
