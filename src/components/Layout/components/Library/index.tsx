import { t } from '../../../../i18n';
import { trackActivation } from '../../../LocalTracks/trackActivation';
import { AppSelect } from '../../../Menu';
import { useMemo, useState } from 'react';
import { LibraryIcon, LibraryCollapsedIcon } from '../../../Icons';
import { ImportButton } from '../../../Import/ImportButton';
import { uiActions } from '../../../../store/slices/offlineUi';
import { useAppDispatch, useAppSelector } from '../../../../store/store';
import { trackCover } from '../../../../library/importFiles';
import { playLocalTrack } from '../../../../player/runtime';
import { TrackContextMenu } from '../../../LocalTracks/TrackContextMenu';

const historyDateFormat = new Intl.DateTimeFormat('en', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const historyDetailFormat = new Intl.DateTimeFormat('en', { dateStyle: 'full', timeStyle: 'long' });
function playedTime(timestamp?: number) {
  if (timestamp === undefined || !Number.isFinite(timestamp)) return undefined;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return undefined;
  return { label: historyDateFormat.format(date), full: historyDetailFormat.format(date), iso: date.toISOString() };
}
function PlayedTime({ timestamp }: { timestamp?: number }) {
  const time = playedTime(timestamp);
  return time ? <time className='offline-history-time' dateTime={time.iso} title={t("Last played: {0}", time.full)}>{time.label}</time> : null;
}

export function Library({ drawer = false, compact = false }: { drawer?: boolean; compact?: boolean }) {
  const dispatch = useAppDispatch();
  const tracks = useAppSelector(state => state.library.tracks);
  const currentId = useAppSelector(state => state.player.currentId);
  const count = tracks.length;
  const [view, setView] = useState('saved');
  const visible = useMemo(() => view === 'history'
    ? tracks.filter(track => track.lastPlayedAt).sort((a, b) => b.lastPlayedAt! - a.lastPlayedAt!)
    : [...tracks].sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0)), [tracks, view]);
  const collapsed = !drawer && compact;
  return (
    <aside aria-label={t("Your library")} className={`Navigation-section library offline-library ${collapsed ? '' : 'open'}`}>
      <div className='offline-library-heading'>
        <button className='offline-icon-button' aria-label={collapsed ? t("Expand library") : t("Collapse library")}
          onClick={() => dispatch(drawer ? uiActions.closeLibraryDrawer() : uiActions.toggleLibrary())}>
          {collapsed ? <LibraryCollapsedIcon /> : <LibraryIcon />}
        </button>
        {!collapsed && <span className='Navigation-button'>{t("Your library")}</span>}
        <ImportButton compact />
      </div>
      {collapsed && <div className='offline-collapsed-tracks' aria-label={t("Saved library covers")}>
        {visible.map(track => <TrackContextMenu key={track.id} trackId={track.id}><button aria-label={t("Play saved track {0}", track.name)}
          title={`${track.name}${track.artist ? ` · ${track.artist}` : ''}${view === 'history' && playedTime(track.lastPlayedAt) ? `\nLast played: ${playedTime(track.lastPlayedAt)!.full}` : ''}`}
          aria-current={currentId === track.id ? 'true' : undefined} disabled={track.unavailable}
          {...trackActivation(track.id, () => playLocalTrack(track.id))}>
          <img src={trackCover(track)} width={48} height={48} alt='' />
        </button></TrackContextMenu>)}
      </div>}
      {!collapsed && <div className='offline-library-body'>
        {!!count && <>
          <div className='offline-library-view'><span className='offline-sr-only'>{t("Library view")}</span>
            <AppSelect label={t("Library view")} value={view} onChange={setView} options={[{ value: 'saved', label: t("Saved tracks") }, { value: 'history', label: t("Recently played") }]} />
          </div>
          <ul className='offline-saved-tracks' aria-label={view === 'history' ? t("Recently played tracks") : t("Saved library tracks")}>
            {visible.map(track => <li key={track.id}><TrackContextMenu trackId={track.id}><button className='library-card' aria-label={t("Play saved track {0}", track.name)}
              aria-current={currentId === track.id ? 'true' : undefined} disabled={track.unavailable}
              {...trackActivation(track.id, () => { playLocalTrack(track.id); if (drawer) dispatch(uiActions.closeLibraryDrawer()); })}>
              <img src={trackCover(track)} width={48} height={48} alt='' />
              <span><strong title={track.name}>{track.name}</strong><small>{track.unavailable ? t("Audio copy unavailable") : track.artist || t("Local file")}</small>
                {view === 'history' && <PlayedTime timestamp={track.lastPlayedAt} />}</span>
            </button></TrackContextMenu></li>)}
          </ul>
          {view === 'history' && !visible.length && <p className='offline-library-note offline-muted'>{t("Play a song to start your local history.")}</p>}
        </>}
        {!count && <div className='offline-library-empty'>
          <h3>{t("Your library is empty")}</h3>
          <p>{t("Import music from your device to start your collection.")}</p>
          <ImportButton />
        </div>}
      </div>}
    </aside>
  );
}
