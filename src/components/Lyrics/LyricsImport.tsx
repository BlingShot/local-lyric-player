import { t } from '../../i18n';
import { useEffect, useRef, useState } from 'react';
import { Modal } from 'antd';
import { readLyricFile, saveLyrics } from '../../lyrics/repository';
import { LyricsError, type SavedLyrics } from '../../lyrics/types';
import { storageError } from '../../library/database';

export function LyricsImport({ trackId, trackName, onClose, onSaved, initialFile }: {
  trackId: string; trackName: string; onClose: () => void; onSaved: () => void; initialFile?: File;
}) {
  const [preview, setPreview] = useState<SavedLyrics>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const request = useRef(0);
  const select = async (files: readonly File[]) => {
    const version = ++request.current;
    setPreview(undefined); setError('');
    if (files.length !== 1) { setError('Choose one TTML or LRC file for this track.'); return; }
    setBusy('Reading lyrics…');
    try { const value = await readLyricFile(files[0], trackId); if (version === request.current) setPreview(value); }
    catch (failure) { if (version === request.current) setError(failure instanceof Error ? failure.message : 'This lyric file could not be read.'); }
    finally { if (version === request.current) setBusy(''); }
  };
  useEffect(() => {
    if (initialFile) void select([initialFile]);
    return () => { request.current++; };
  // A fresh dialog is mounted for each track/import operation.
  }, []);
  const save = async () => {
    if (!preview || busy) return;
    setBusy('Saving lyrics…'); setError('');
    try { await saveLyrics(preview); onSaved(); onClose(); }
    catch (failure) { setError(failure instanceof LyricsError ? failure.message : storageError(failure)); }
    finally { setBusy(''); }
  };
  return <Modal title={t("Import local lyrics")} open onCancel={() => { if (!busy) onClose(); }} footer={null} destroyOnHidden>
    <div className='lyrics-import' onDragEnter={event => event.stopPropagation()} onDragLeave={event => event.stopPropagation()}
      onDragOver={event => { event.preventDefault(); event.stopPropagation(); }}
      onDrop={event => { event.preventDefault(); event.stopPropagation(); if (!busy) void select([...event.dataTransfer.files]); }}>
      <p>{t("For")}<strong>{trackName}</strong></p>
      <label className='lyrics-file-picker'>{t("Choose a TTML or LRC file")}<input type='file' accept='.ttml,.lrc' aria-label={t("Choose lyric file")} disabled={!!busy}
          onChange={event => { if (event.target.files?.length) void select([...event.target.files]); event.target.value = ''; }} />
        <small>{t("Or drop one file here. Saved only with this track, on this device.")}</small>
      </label>
      {busy && <p role='status'>{busy}</p>}
      {error && <p className='lyrics-import-error' role='alert'>{t(error)}</p>}
      {preview && <div className='lyrics-import-preview'>
        <strong>{preview.fileName}</strong>
        <p>{preview.document.lines.length} {t("lyric lines ·")}{' '}{preview.document.timing === 'line' ? t("Line timing") : preview.document.timing === 'word' ? t("Word timing") : t("Mixed line and word timing")}</p>
        {preview.document.profile && <p>{preview.document.profile === 'apple' ? t("Apple / AMLL absolute timestamps") : t("Standard TTML relative timestamps")}</p>}
        {preview.document.notices.length > 0 && <div role='note'><strong>{t("Compatibility notes")}</strong><ul>{preview.document.notices.map(note => <li key={note}>{note}</li>)}</ul></div>}
        <p className='offline-muted'>{t("Saving replaces this track’s saved lyrics. Audio and original files stay unchanged.")}</p>
      </div>}
      <details className='lyrics-compatibility'><summary>{t("Supported formats")}</summary>
        <p>{t("LRC: line timestamps, repeated timestamps, offset, and enhanced <mm:ss.xx> word timestamps. Missing word end times use line highlighting.")}</p>
        <p>{t("TTML: parallel body/div/p/span, begin/end/dur in clock or h/m/s/ms time, timed words, named performers, background vocals, overlapping lines, inline translations and romanization, and plain Apple sidecar annotations.")}</p>
        <p>{t("Apple / AMLL-marked files use absolute timestamps. Other TTML files use standard parent-relative timing. Sequential containers, frame/tick/clock time bases, ruby, animation and nested sidecar annotations are not supported and are reported before saving.")}</p>
        <p>{t("UTF-8 or UTF-16 with a BOM. Up to 2 MB and 5,000 lyric lines. File colors, fonts and positioning are replaced by the player’s styles.")}</p>
      </details>
      <div className='lyrics-import-actions'><button className='white-button' disabled={!preview || !!busy} onClick={() => void save()}>{t("Save lyrics")}</button></div>
    </div>
  </Modal>;
}
