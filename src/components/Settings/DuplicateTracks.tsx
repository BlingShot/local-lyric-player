import { useEffect, useRef, useState } from 'react';
import { Modal } from 'antd';
import { t } from '../../i18n';
import { useAppSelector, store } from '../../store/store';
import { findDuplicateTracks, latestDuplicateMerge, type DuplicateGroup } from '../../library/duplicateCleanup';
import { formatSize } from '../../library/importFiles';
import { mergeDuplicateAudio, undoDuplicateAudioMerge } from '../../player/runtime';
import './duplicate-tracks.css';

export function DuplicateTracksSettings() {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(''), [message, setMessage] = useState('');
  const [groups, setGroups] = useState<DuplicateGroup[]>([]), [choices, setChoices] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState({ done: 0, total: 0 }), [undoAvailable, setUndoAvailable] = useState(false);
  const controller = useRef<AbortController | undefined>(undefined);
  const currentId = useAppSelector(state => state.player.currentId), libraryBusy = useAppSelector(state => state.library.busy);
  useEffect(() => {
    let cancelled = false;
    void latestDuplicateMerge().then(backup => { if (!cancelled) setUndoAvailable(!!backup); }).catch(() => {});
    return () => { cancelled = true; controller.current?.abort(); };
  }, []);
  const scan = async () => {
    controller.current?.abort();
    const current = new AbortController(); controller.current = current;
    setOpen(true); setBusy('scan'); setMessage(''); setGroups([]); setChoices({}); setProgress({ done: 0, total: 0 });
    try {
      const found = await findDuplicateTracks(current.signal, (done, total) => { if (!current.signal.aborted) setProgress({ done, total }); });
      if (!current.signal.aborted) { setGroups(found); if (!found.length) setMessage('No byte-identical duplicate songs found.'); }
    } catch (error) { if (!current.signal.aborted) setMessage(error instanceof Error ? error.message : 'Duplicate scan failed.'); }
    finally { if (!current.signal.aborted) setBusy(''); }
  };
  const merge = async (group: DuplicateGroup, keepId: string) => {
    setBusy('merge'); setMessage('');
    try {
      if (!await mergeDuplicateAudio(group.tracks, keepId)) throw new Error(store.getState().library.storageError || 'Merge failed.');
      setGroups(items => items.filter(item => item !== group)); setUndoAvailable(true); setMessage('Duplicates merged. You can undo this merge.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Merge failed.'); }
    finally { setBusy(''); }
  };
  const undo = async () => {
    setBusy('undo'); setMessage('');
    try {
      if (!await undoDuplicateAudioMerge()) throw new Error(store.getState().library.storageError || 'Undo failed.');
      setGroups([]); setUndoAvailable(!!await latestDuplicateMerge()); setMessage('Merge undone. Scan again to refresh the preview.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Undo failed.'); }
    finally { setBusy(''); }
  };
  return <section className='duplicate-settings'><h3>{t('Duplicate songs')}</h3>
    <p>{t('Find identical audio copies, preview them, then choose which song to retain. Different recordings are never merged by title alone.')}</p>
    <div className='settings-folder-actions'><button disabled={!!busy || !!libraryBusy} onClick={() => void scan()}>{t('Find duplicates')}</button>
      <button disabled={!undoAvailable || !!busy || !!libraryBusy} onClick={() => void undo()}>{t('Undo last merge')}</button></div>
    {!open && message && <p role='status'>{t(message)}</p>}
    <Modal title={t('Duplicate song preview')} open={open} width={760} centered className='duplicate-preview-window' footer={null}
      closable={busy !== 'merge' && busy !== 'undo'} maskClosable={busy !== 'merge' && busy !== 'undo'}
      onCancel={() => { if (busy === 'merge' || busy === 'undo') return; controller.current?.abort(); setBusy(''); setOpen(false); }}>
      <p>{t('Only byte-identical files are listed. The chosen song keeps its metadata, cover and lyrics. Playlists and last-played time are merged. Other copies remain in a local undo backup; original music files are unchanged.')}</p>
      {busy === 'scan' && <p role='status'>{t('Comparing audio contents')} {progress.done} / {progress.total}</p>}
      <div className='duplicate-preview-groups'>
        {groups.map(group => {
          const key = group.tracks[0].id, playing = group.tracks.find(track => track.id === currentId);
          const keepId = playing?.id ?? choices[key] ?? key;
          return <fieldset key={key}><legend>{group.tracks[0].name}</legend>
            {group.tracks.map(track => <label key={track.id} className='duplicate-preview-track'>
              <input type='radio' name={`duplicate-${key}`} checked={keepId === track.id} disabled={!!busy || !!playing}
                onChange={() => setChoices(value => ({ ...value, [key]: track.id }))} />
              <span><strong>{track.name}</strong><small>{track.artist || t('Unknown artist')} / {track.album || t('Unknown album')}</small>
                <small>{track.fileName || track.name} / {formatSize(track.size)}</small>
                <small>{t('Added')}: {track.addedAt ? new Date(track.addedAt).toLocaleString() : '-'}</small></span>
              {keepId === track.id && <span className='duplicate-keep-label'>{t(playing ? 'Current song retained' : 'Keep')}</span>}
            </label>)}
            <button className='duplicate-confirm' disabled={!!busy || !!libraryBusy} onClick={() => void merge(group, keepId)}>{t('Confirm merge')} ({group.tracks.length - 1})</button>
          </fieldset>;
        })}
      </div>
      {message && <p className='duplicate-preview-message' role='status'>{t(message)}</p>}
      <div className='settings-folder-actions'><button disabled={!undoAvailable || !!busy || !!libraryBusy} onClick={() => void undo()}>{t('Undo last merge')}</button>
        <button disabled={!!busy || !!libraryBusy} onClick={() => void scan()}>{t('Scan again')}</button></div>
    </Modal>
  </section>;
}
