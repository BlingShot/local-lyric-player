import { t } from '../../i18n';
import { AppSelect } from '../../components/Menu';
import { Link, useSearchParams } from 'react-router-dom';
import { useState } from 'react';
import { ImportButton } from '../../components/Import/ImportButton';
import { filterTracks } from '../../library/importFiles';
import { useAppSelector } from '../../store/store';
import { TrackTable } from '../../components/LocalTracks/TrackTable';
import { LibraryTabs } from '../Albums';
import { groupTracksByAlbum, sortTracks, trackSortLabels, type TrackSort } from '../../library/sortTracks';

function savedView(): { sort: TrackSort; descending: boolean; grouped: boolean } {
  try { const value = JSON.parse(localStorage.getItem('library-list-view') || '{}');
    return { sort: Object.prototype.hasOwnProperty.call(trackSortLabels, value.sort) ? value.sort : 'addedAt', descending: value.descending === true, grouped: value.grouped === true };
  } catch { return { sort: 'addedAt', descending: false, grouped: false }; }
}

export function LibraryPage({ searching = false }: { searching?: boolean }) {
  const [params] = useSearchParams();
  const query = searching ? params.get('q') ?? '' : '';
  const { tracks, ready, storageError } = useAppSelector(state => state.library);
  const [view, setView] = useState(savedView), [viewError, setViewError] = useState('');
  const changeView = (value: typeof view) => {
    setView(value);
    try { localStorage.setItem('library-list-view', JSON.stringify(value)); setViewError(''); }
    catch { setViewError('This list preference could not be saved. It will reset when you reopen the player.'); }
  };
  const sorted = sortTracks(filterTracks(tracks, query), view.sort, view.descending);
  const visibleTracks = view.grouped ? groupTracksByAlbum(sorted) : sorted;
  return <div className='Home-seccion home offline-library-page offline-track-page'>
    <LibraryTabs />
    <header className='offline-page-header'>
      <div><h1 className='playlist-header'>{searching ? t("Search local music") : t("Local library")}</h1>
        <p className='offline-muted'>{query ? t("“{0}” · {1} results", query, visibleTracks.length) : t("{0} files", tracks.length)}</p></div>
      <ImportButton />
    </header>
    <div className='offline-list-tools'><div className='app-select-field'>{t("Sort by")}<AppSelect label={t("Sort tracks by")} value={view.sort} onChange={value => changeView({ ...view, sort: value as TrackSort })} options={Object.entries(trackSortLabels).map(([value, label]) => ({ value, label: t(label) }))} /></div>
      <button aria-label={view.descending ? t("Sort ascending") : t("Sort descending")} title={view.descending ? t("Descending") : t("Ascending")} onClick={() => changeView({ ...view, descending: !view.descending })}>{view.descending ? '↓' : '↑'}</button>
      <button aria-pressed={view.grouped} title={t("Keep each album together in disc / track order")} onClick={() => changeView({ ...view, grouped: !view.grouped })}>{t("Group by album")}</button>
      {viewError && <span role='status'>{viewError}</span>}
    </div>
    <TrackTable tracks={visibleTracks} grouped={view.grouped} sort={view.sort} descending={view.descending}
      onSort={field => changeView({ ...view, sort: field, descending: view.sort === field ? !view.descending : false })} />
    {ready && !visibleTracks.length && <div className='offline-empty' role='status'>
      <img src='/images/playlist.png' width={80} height={80} alt='' />
      <h2>{tracks.length ? t("No matching files") : t("Your library is empty")}</h2>
      <p>{tracks.length ? t("Search by title, artist, album or file name.") : t("Choose or drop music files from your device to start listening.")}</p>
      {tracks.length ? <Link className='transparent-button' to='/'>{t("View all music")}</Link> : <ImportButton />}
    </div>}
    {!ready && <div className='offline-empty'>{storageError ? t("Local library could not be restored. Retry storage above.") : t("Restoring local library…")}</div>}
  </div>;
}

