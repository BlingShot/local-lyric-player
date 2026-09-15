import { t } from '../../i18n';
import { trackActivation } from './trackActivation';
import { Fragment, useState, useLayoutEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Clock, DeleteIcon } from '../Icons';
import { AUDIO_ACCEPT, formatSize, formatTime, trackCover, type LocalTrack } from '../../library/importFiles';
import { albumKey, buildAlbums } from '../../library/albums';
import { technicalFields, technicalLabels, technicalValue } from '../../library/technicalInfo';
import type { TrackSort } from '../../library/sortTracks';
import { useAppSelector } from '../../store/store';
import { playLocalTrack, removeAudioFile, restoreAudioFile } from '../../player/runtime';
import { TrackEditor } from './TrackEditor';
import { useTrackColumns, type Column } from './useTrackColumns';
import { TrackContextMenu } from './TrackContextMenu';

export function TrackTable({ tracks, album = false, grouped = false, sort, descending, onSort, showPlayedAt = false, revealCurrent = false }: { tracks: LocalTrack[]; album?: boolean; grouped?: boolean; showPlayedAt?: boolean; revealCurrent?: boolean; sort?: TrackSort; descending?: boolean; onSort?: (field: TrackSort) => void }) {
  const selectedId = useAppSelector(state => state.library.selectedId);
  const busy = useAppSelector(state => state.library.busy);
  const [editing, setEditing] = useState<LocalTrack>();
  const sizing = useTrackColumns();
  const currentId = useAppSelector(state => state.player.currentId), revealed = useRef(false);
  const reveal = () => {
    const port = sizing.table.current?.parentElement, row = currentId && sizing.table.current?.querySelector<HTMLElement>(`[data-track-id="${CSS.escape(currentId)}"]`);
    if (!port || !row) return false;
    const bounds = row.getBoundingClientRect(), viewport = port.getBoundingClientRect();
    port.scrollTo({ top: port.scrollTop + bounds.top - viewport.top - port.clientHeight / 2 + bounds.height / 2, behavior: 'instant' });
    row.classList.add('offline-revealed-track'); return true;
  };
  useLayoutEffect(() => { if (!revealCurrent || revealed.current) return; const frame = requestAnimationFrame(() => { revealed.current = reveal(); }); return () => cancelAnimationFrame(frame); }, [revealCurrent, currentId, tracks]);
  useLayoutEffect(() => { const show = () => { reveal(); }; window.addEventListener('reveal-playing-track', show); return () => window.removeEventListener('reveal-playing-track', show); }, [currentId, tracks]);
  const groups = new Map((grouped ? buildAlbums(tracks) : []).map(item => [item.tracks[0].id, item]));
  const sortLabel = (field: TrackSort, label: string) => onSort ? <button className='offline-sort-heading' onClick={() => onSort(field)}>{t(label)}{sort === field && <span aria-hidden='true'>{descending ? ' ↓' : ' ↑'}</span>}</button> : t(label);
  const sortState = (field: TrackSort) => sort === field ? descending ? 'descending' as const : 'ascending' as const : undefined;
  const handle = (column: Column, label: string) => <span
    className='offline-column-resizer' role='separator' aria-orientation='vertical' tabIndex={0}
    aria-label={t("Resize {0} column", label)} title={t("Drag to resize. Double-click to fit. Arrow keys adjust width.")}
    aria-valuenow={Math.round(sizing.columns[column] ?? 300)} aria-valuemin={column === 'title' ? 120 : column === 'duration' ? 56 : column === 'sampleRate' ? 96 : 80}
    aria-valuemax={column === 'duration' ? 240 : column === 'title' || column === 'album' ? 4096 : 400}
    onPointerDown={event => sizing.start(event, column)} onPointerMove={sizing.move}
    onPointerUp={sizing.end} onPointerCancel={sizing.cancel} onLostPointerCapture={sizing.end}
    onDoubleClick={() => sizing.fit(column)} onKeyDown={event => {
      if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); sizing.keyboard(column, event.key === 'ArrowRight' ? 20 : -20); }
    }} />;
  return <div className={`playlist-list offline-track-list ${tracks.length ? '' : 'offline-track-list-empty'}`}>
    <div className='offline-table-scroll' role='region' aria-label={t("Scrollable tracks")} tabIndex={0}>
    <table aria-label={t("Tracks")} ref={sizing.table} style={sizing.style} className={sizing.custom ? 'offline-custom-columns' : undefined}>
      <colgroup><col className='offline-index' /><col className='offline-title-column' />
        <col className='offline-size' style={{ width: 'var(--track-album-width)' }} />
        {technicalFields.map(field => <col key={field} className={`offline-tech offline-${field}`} style={{ width: `var(--track-${field}-width)` }} />)}
        {showPlayedAt && <col className='offline-played-at' />}<col className='offline-duration' style={{ width: 'var(--track-duration-width)' }} /><col style={{ width: 76 }} /></colgroup>
      <thead><tr><th className='offline-index'>#</th><th data-column='title' aria-sort={sortState('name')}>{sortLabel('name', 'Title')}{handle('title', 'Title')}</th>
        <th className='offline-size' data-column='album' aria-sort={sortState('album')}>{album ? t("Disc / Track") : sortLabel('album', 'Album')}{handle('album', album ? 'Disc / Track' : 'Album')}</th>
        {technicalFields.map(field => <th key={field} className={`offline-tech offline-${field}`} data-column={field} aria-sort={sortState(field)}>{sortLabel(field, t(technicalLabels[field]))}{handle(field, t(technicalLabels[field]))}</th>)}
        {showPlayedAt && <th className='offline-played-at' aria-sort={sortState('lastPlayedAt')}>{sortLabel('lastPlayedAt', 'Last played')}</th>}<th className='offline-duration' data-column='duration' aria-sort={sortState('duration')}>{onSort ? <button aria-label={t("Sort by duration")} className='offline-sort-heading' onClick={() => onSort('duration')}><Clock /></button> : <span aria-label={t("Duration")}><Clock /></span>}{handle('duration', 'Duration')}</th>
        <th className='offline-track-actions'><button className='offline-reset-columns' aria-label={t("Reset column widths")}
          title={t("Reset column widths")} onClick={sizing.reset}>↔</button></th></tr></thead>
      <tbody>{tracks.map((track, index) => <Fragment key={track.id}>
        {groups.has(track.id) && <tr className='offline-album-group'><th colSpan={showPlayedAt ? 9 : 8} scope='rowgroup'><Link to={`/album/${encodeURIComponent(albumKey(track))}`}><img src={groups.get(track.id)!.coverUrl || trackCover(track)} alt='' /><span>{groups.get(track.id)!.name}<small>{groups.get(track.id)!.artist} · {groups.get(track.id)!.tracks.length} {t("files")}</small></span></Link></th></tr>}
        <TrackContextMenu trackId={track.id}><tr aria-selected={selectedId === track.id} data-track-id={track.id}>
        <td className='offline-index'>{index + 1}</td>
        <td><button className='offline-track-name' disabled={track.unavailable}
          {...trackActivation(track.id, () => playLocalTrack(track.id, album || onSort ? tracks.map(item => item.id) : undefined))}>
          <img src={trackCover(track)} width={40} height={40} alt='' />
          <span><strong title={track.name}>{track.name}</strong><small title={track.error || track.tagWarning || track.artist}>
            {track.unavailable ? t("Audio copy unavailable") : track.error ? t("Unable to play · Double-click to retry") : track.artist || t("Local file")}
          </small></span></button>
          {(track.unavailable || track.error) && <label className='offline-restore-file'>{t("Choose original file")}<input type='file' accept={AUDIO_ACCEPT} aria-label={t("Restore {0}", track.name)} disabled={!!busy}
              onChange={event => { const file = event.target.files?.[0]; if (file) void restoreAudioFile(track.id, file); event.target.value = ''; }} />
          </label>}
        </td>
        <td className='offline-size' title={formatSize(track.size)}>{album
          ? `${track.discNumber ?? '—'} / ${track.trackNumber ?? '—'}`
          : <Link to={`/album/${encodeURIComponent(albumKey(track))}`} title={track.album || t("Unknown album")}>{track.album || t("Unknown album")}</Link>}</td>
        {technicalFields.map(field => <td key={field} className={`offline-tech offline-${field}`} title={technicalValue(track, field) === '—' ? t("Not available in file metadata") : undefined}>{technicalValue(track, field)}</td>)}
        {showPlayedAt && <td className='offline-played-at'>{track.lastPlayedAt ? <time dateTime={new Date(track.lastPlayedAt).toISOString()} title={new Date(track.lastPlayedAt).toLocaleString()}>{new Date(track.lastPlayedAt).toLocaleString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}</time> : t('Never played')}</td>}<td className='offline-duration' title={track.duration ? undefined : track.durationChecked || track.unavailable ? t("Duration unavailable") : t("Reading duration…")}>{track.duration ? formatTime(track.duration) : '—'}</td>
        <td className='offline-track-actions'><button className='offline-icon-button' aria-label={t("Edit {0}", track.name)} onClick={() => setEditing(track)} disabled={!!busy}>✎</button>
          <button className='offline-icon-button' aria-label={t("Remove {0}", track.name)} title={t("Remove this player’s record and copy; keep the original file")}
            disabled={!!busy} onClick={() => void removeAudioFile(track.id)}><DeleteIcon /></button></td>
      </tr></TrackContextMenu></Fragment>)}</tbody>
    </table>
    </div>
    {editing && <TrackEditor tracks={[editing]} onClose={() => setEditing(undefined)} />}
  </div>;
}
