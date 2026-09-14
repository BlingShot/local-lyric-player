import { t } from '../../i18n';
import { AppSelect } from '../Menu';
import { MiniLyrics } from '../Lyrics/MiniLyrics';
import { uiActions } from '../../store/slices/offlineUi';
import { useAppDispatch, useAppSelector } from '../../store/store';
import { formatSize, formatTime, trackCover } from '../../library/importFiles';
import { Link } from 'react-router-dom';
import { TechnicalInfo } from './TrackInfo';

export function FileDetails({ visible = true }: { visible?: boolean }) {
  const dispatch = useAppDispatch();
  const mode = useAppSelector(state => state.ui.detailsMode);
  const track = useAppSelector(state => state.library.tracks.find(item => item.id === (mode === 'lyrics' ? state.player.currentId : state.library.selectedId)));
  return <aside className='offline-file-details' data-mode={mode} aria-label={t("File details panel")}>
    <div className='offline-details-heading'>
      <AppSelect label={t("Right sidebar view")} value={mode} options={[{ value: 'details', label: t("File details") }, { value: 'lyrics', label: t("Lyrics") }]}
        onChange={value => dispatch(uiActions.setDetailsMode(value as 'details' | 'lyrics'))} />
      {track && <Link className='analysis-details-link' to={`/analyze/${encodeURIComponent(track.id)}`}>{t("Analyze")}</Link>}
    </div>
    {mode === 'lyrics' ? <MiniLyrics track={track} visible={visible} /> : <>
    <img src={trackCover(track)} alt='' />
    {track ? <><h3>{track.name}</h3><p className='offline-muted'>{formatSize(track.size)}</p>
      <p>{track.artist || t("Unknown artist")} · {track.album || t("Unknown album")}</p>
      <p>{t("Album artist:")}{' '}{track.albumArtist || t("Not tagged")}</p>
      <p>{t("Disc")}{' '}{track.discNumber ?? '—'} {t("· Track")}{' '}{track.trackNumber ?? '—'} · {track.releaseDate || t("Date not tagged")}</p>
      <p className='offline-muted'>{track.fileName || track.name}</p>
      <p className='offline-muted'>{track.error ?? (track.duration ? formatTime(track.duration) : 'Duration not loaded')}</p>
      <TechnicalInfo track={track} />
      {track.tagWarning && <p role='note'>{track.tagWarning}</p>}</> : <p className='offline-muted'>{t("Select an imported file to see its details here.")}</p>}
    {track?.lyricsWarning && <p role='note'>{track.lyricsWarning}</p>}
    </>}
  </aside>;
}
