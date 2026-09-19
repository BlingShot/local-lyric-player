import { t } from '../../i18n';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Row, Col } from 'antd';
import { buildAlbums, albumKey, type LocalAlbum } from '../../library/albums';
import { store, useAppSelector } from '../../store/store';
import { playLocalTrack } from '../../player/runtime';
import { ImportButton } from '../../components/Import/ImportButton';
import { Play } from '../../components/Icons';
import { TrackTable } from '../../components/LocalTracks/TrackTable';
import { TrackEditor } from '../../components/LocalTracks/TrackEditor';

export function LibraryTabs() {
  return <div className='offline-page-tabs'><Link to='/' className='chip'><span>{t("All music")}</span></Link>
    <Link to='/collection/albums' className='chip'><span>{t("Albums")}</span></Link>
    <Link to='/collection/recent' className='chip'><span>{t("Recently played")}</span></Link></div>;
}
function playAlbum(album: LocalAlbum) {
  const first = album.tracks.find(track => !track.unavailable);
  if (first) playLocalTrack(first.id, album.tracks.map(track => track.id));
}

// Retain the original AlbumCard's image, info and overlay structure and SCSS classes.
export function AlbumCard({ album }: { album: LocalAlbum }) {
  return <article className='playlist-card relative rounded-lg overflow-hidden transition offline-album-card'>
    <div className='aspect-square p-4' style={{ position: 'relative' }}>
      <Link to={`/album/${encodeURIComponent(album.id)}`} aria-label={t("Open album {0} by {1}", album.name, album.artist)}>
        <img src={album.coverUrl || '/images/playlist.png'} alt='' style={{ borderRadius: 5, width: '100%' }} />
      </Link>
      <div className='circle-play-div'><button className='offline-album-play' aria-label={t("Play album {0} by {1}", album.name, album.artist)}
        disabled={album.tracks.every(track => track.unavailable)} onClick={() => playAlbum(album)}><Play /></button></div>
    </div>
    <div className='playlist-card-info'><Link to={`/album/${encodeURIComponent(album.id)}`}><h3 className='text-md font-semibold text-white'>{album.name}</h3></Link>
      <p>{album.artist}</p><p>{album.tracks.length} {t("imported tracks")}</p></div>
  </article>;
}

export function AlbumsPage() {
  const tracks = useAppSelector(state => state.library.tracks);
  const albums = useMemo(() => buildAlbums(tracks), [tracks]);
  return <div className='Home-seccion home offline-library-page'><LibraryTabs />
    <header className='offline-page-header'><div><h1 className='playlist-header'>{t("Local albums")}</h1>
      <p className='offline-muted'>{albums.length} {t("albums ·")}{tracks.length} {t("imported tracks")}</p></div><ImportButton /></header>
    <div className='playlist-grid'>{albums.map(album => <AlbumCard key={album.id} album={album} />)}</div>
    {!albums.length && <div className='offline-empty'><h2>{t("No local albums yet")}</h2><p>{t("Import music to build albums from its embedded tags.")}</p><ImportButton /></div>}
  </div>;
}

export function AlbumPage() {
  const { albumId } = useParams();
  const tracks = useAppSelector(state => state.library.tracks);
  const ready = useAppSelector(state => state.library.ready);
  const album = useMemo(() => buildAlbums(tracks).find(item => item.id === albumId), [tracks, albumId]);
  const [editing, setEditing] = useState(false);
  const navigate = useNavigate();
  if (!ready) return <div className='offline-empty'>{t("Restoring local library…")}</div>;
  if (!album) return <div className='offline-empty'><h2>{t("Album not found")}</h2><p>{t("It may have been removed or regrouped.")}</p><Link to='/collection/albums'>{t("View local albums")}</Link></div>;
  return <div className='offline-library-page offline-album-page offline-track-page'><div className='offline-album-tabs'><LibraryTabs /></div>
    <Row className='offline-album-header' gutter={[24, 24]} align='bottom'>
      <Col xs={24} sm={6} lg={5}><img className='playlist-img' src={album.coverUrl || '/images/playlist.png'} alt={`${album.name} cover`} /></Col>
      <Col xs={24} sm={18} lg={19}><p>{t("Album")}</p><h1 className='playlist-title'>{album.name}</h1>
        <p>{album.artist} {album.releaseDate ? `· ${album.releaseDate}` : ''}</p><p>{album.tracks.length} {t("imported tracks")}</p></Col>
    </Row>
    <div className='offline-album-actions'><button className='offline-album-play' aria-label={t("Play album")}
      disabled={album.tracks.every(track => track.unavailable)} onClick={() => playAlbum(album)}><Play /></button>
      <button className='transparent-button' onClick={() => setEditing(true)}>{t("Edit album")}</button></div>
    {album.uncertain && <p className='offline-album-note offline-muted'>{t("Some album tags are missing. This album is grouped conservatively. Use Edit album or a track's Edit details to adjust its grouping.")}</p>}
    <TrackTable tracks={album.tracks} album />
    {editing && <TrackEditor tracks={album.tracks} albumOnly onClose={() => setEditing(false)} onSaved={() => {
      const updated = store.getState().library.tracks.find(track => track.id === album.tracks[0].id);
      if (updated) navigate(`/album/${encodeURIComponent(albumKey(updated))}`, { replace: true });
    }} />}
  </div>;
}
