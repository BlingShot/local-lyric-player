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
function savedView(recent: boolean): { sort: TrackSort; descending: boolean; grouped: boolean } {
  try { const value = JSON.parse(localStorage.getItem(recent ? 'recent-list-view' : 'library-list-view') || '{}'); return { sort: Object.hasOwn(trackSortLabels, value.sort) ? value.sort : recent ? 'lastPlayedAt' : 'addedAt', descending: value.descending === undefined ? recent : value.descending === true, grouped: value.grouped === true }; }
  catch { return { sort: recent ? 'lastPlayedAt' : 'addedAt', descending: recent, grouped: false }; }
}
export function LibraryPage({ searching = false, recent = false }: { searching?: boolean; recent?: boolean }) {
  const [params] = useSearchParams(), query = searching ? params.get('q') ?? '' : '';
  const { tracks, ready, storageError } = useAppSelector(state => state.library), currentId = useAppSelector(state => state.player.currentId);
  const [view, setView] = useState(() => savedView(recent)), [viewError, setViewError] = useState('');
  const changeView = (value: typeof view) => { setView(value); try { localStorage.setItem(recent ? 'recent-list-view' : 'library-list-view', JSON.stringify(value)); setViewError(''); } catch { setViewError('This list preference could not be saved.'); } };
  const filtered = filterTracks(recent ? tracks.filter(track => Number.isFinite(track.lastPlayedAt) && track.lastPlayedAt! > 0) : tracks, query), sorted = sortTracks(filtered, view.sort, view.descending), visible = view.grouped ? groupTracksByAlbum(sorted) : sorted;
  return <div className={`Home-seccion home offline-library-page offline-track-page ${recent ? 'recent-playback-page' : ''}`}>
    <LibraryTabs /><header className='offline-page-header'><div>{recent && <span className='settings-eyebrow'>{t('Your listening history')}</span>}<h1 className='playlist-header'>{t(recent ? 'Recently played' : searching ? 'Search local music' : 'Local library')}</h1><p className='offline-muted'>{query ? t('{0} results', visible.length) : t('{0} files', visible.length)}</p></div><ImportButton /></header>
    <div className='offline-list-tools'><div className='app-select-field'>{t('Sort by')}<AppSelect label={t('Sort tracks by')} value={view.sort} onChange={value => changeView({ ...view, sort: value as TrackSort })} options={Object.entries(trackSortLabels).map(([value, label]) => ({ value, label: t(label) }))} /></div>
      <button aria-label={t(view.descending ? 'Sort ascending' : 'Sort descending')} onClick={() => changeView({ ...view, descending: !view.descending })}>{view.descending ? '↓' : '↑'}</button>
      <button aria-pressed={view.grouped} onClick={() => changeView({ ...view, grouped: !view.grouped })}>{t('Group by album')}</button>
      <button disabled={!currentId || !visible.some(track => track.id === currentId)} onClick={() => window.dispatchEvent(new Event('reveal-playing-track'))}>{t('Show playing song')}</button>{viewError && <span role='status'>{t(viewError)}</span>}
    </div>
    <TrackTable tracks={visible} grouped={view.grouped} sort={view.sort} descending={view.descending} showPlayedAt={recent} revealCurrent={!searching && !recent} onSort={field => changeView({ ...view, sort: field, descending: view.sort === field ? !view.descending : field === 'lastPlayedAt' })} />
    {ready && !visible.length && <div className='offline-empty' role='status'><h2>{t(recent ? 'No recent plays yet' : tracks.length ? 'No matching files' : 'Your library is empty')}</h2><p>{t(recent ? 'Play a song to start your local history.' : 'Choose or drop music files from your device to start listening.')}</p><Link className='transparent-button' to='/'>{t('View all music')}</Link></div>}
    {!ready && <div className='offline-empty'>{t(storageError ? 'Local library could not be restored. Retry storage above.' : 'Restoring local library…')}</div>}
  </div>;
}
