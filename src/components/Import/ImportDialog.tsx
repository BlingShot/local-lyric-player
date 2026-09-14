import { t } from '../../i18n';
import { useRef, useState, type ChangeEvent } from 'react';
import { Modal } from 'antd';
import { AUDIO_ACCEPT } from '../../library/importFiles';
import { importAudioFiles } from '../../player/runtime';
import { uiActions } from '../../store/slices/offlineUi';
import { useAppDispatch, useAppSelector } from '../../store/store';
import { isDesktop } from '../../desktop/environment';

export function ImportDialog() {
  const dispatch = useAppDispatch();
  const open = useAppSelector(state => state.ui.importOpen);
  const status = useAppSelector(state => state.ui.importMessage);
  const { busy, ready, storageError } = useAppSelector(state => state.library);
  const [retention, setRetention] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const selectFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length) importAudioFiles(files);
    event.target.value = '';
  };
  return (
    <Modal title={t("Import local music")} open={open} centered footer={null}
      onCancel={() => dispatch(uiActions.closeImport())}>
      <div className='offline-import'>
        <p>{t("Choose audio files from this device, or drag multiple files into this window.")}</p>
        <p className='offline-muted'>{t("Import MP3, WAV, FLAC, M4A, AAC, OGG and more. Playback support depends on")}{' '}{isDesktop ? t("the built-in audio decoder") : t("your browser")}.</p>
        <p className='offline-muted'>{t("Audio copies, artwork, tags and playback settings are saved")}{' '}{isDesktop ? t("in this app on this device") : t("in this browser on this device using IndexedDB")}{t(". Files are never uploaded. Your originals stay unchanged.")}</p>
        <p className='offline-muted'>{isDesktop
          ? t("Your library is restored when you reopen Lyric Player. This desktop library is separate from your browser library. Keep your original files as a backup.")
          : t("Reopen this same address and browser profile to restore your library. Clearing site data, private browsing or browser storage cleanup can remove the saved copies. Keep your original files as a backup.")}</p>
        <button className='transparent-button' onClick={async () => {
          try {
            const retained = await navigator.storage?.persist?.();
            setRetention(retained ? 'Persistent storage is enabled. Clearing site data will still remove this library.'
              : 'The browser did not grant persistent storage. Copies are saved, but may be removed during storage cleanup.');
          } catch { setRetention('Persistent storage is unavailable. Keep your original files as a backup.'); }
        }}>{t("Protect saved library from automatic cleanup")}</button>
        {retention && <p role='status'>{retention}</p>}
        <input ref={input} type='file' multiple accept={AUDIO_ACCEPT} onChange={selectFiles}
          aria-label={t("Choose audio files")} hidden />
        <button className='white-button' disabled={!!busy || !ready} onClick={() => input.current?.click()}><span>{busy || t("Choose files")}</span></button>
        {storageError && <p role='alert'>{storageError}</p>}
        <p role='status' aria-live='polite'>{status}</p>
      </div>
    </Modal>
  );
}
