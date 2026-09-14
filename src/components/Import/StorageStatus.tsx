import { t } from '../../i18n';
import { useAppDispatch, useAppSelector } from '../../store/store';
import { libraryActions } from '../../store/slices/library';
import { retryPlaybackMemory, retryStorage } from '../../player/runtime';
import { uiActions } from '../../store/slices/offlineUi';

export function StorageStatus() {
  const { busy, storageError, ready } = useAppSelector(state => state.library);
  const memoryError = useAppSelector(state => state.ui.playbackMemoryError);
  const dispatch = useAppDispatch();
  return <>
    {busy && <div className='offline-storage-busy' role='status'>{busy}</div>}
    {(storageError || memoryError) && <div className='offline-storage-error' role='alert'><span>{storageError || memoryError}</span>
      <button onClick={() => storageError ? void retryStorage() : retryPlaybackMemory()}>{storageError ? ready ? t("Retry saving settings") : t("Retry storage") : t("Retry playback memory")}</button>
      {ready && <button aria-label={t("Dismiss storage error")} onClick={() => dispatch(storageError ? libraryActions.setStorageError('') : uiActions.setPlaybackMemoryError(''))}>×</button>}
    </div>}
  </>;
}
