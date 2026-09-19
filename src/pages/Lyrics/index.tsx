import '../../styles/lyrics-display-area.css';
import { trackCover } from '../../library/importFiles';
import { LyricRemoteNotice } from '../../components/Lyrics/LyricRemoteNotice';
import { AudioDebugOverlay, GlobalDebugOverlay } from '../../components/Debug/DebugOverlays';
import { t } from '../../i18n';
import { useEffect, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '../../store/store';
import { uiActions } from '../../store/slices/offlineUi';
import { useResolvedLyrics } from '../../lyrics/useResolvedLyrics';
import { LyricsImport } from '../../components/Lyrics/LyricsImport';
import { LyricsView } from '../../components/Lyrics/LyricsView';
import { FullscreenButton } from '../../components/Lyrics/FullscreenButton';
import { useCoverColor } from '../../lyrics/useCoverColor';
import { useLyricOffset } from '../../lyrics/useLyricOffset';
import { LyricsTiming } from '../../components/Lyrics/LyricsTiming';
import { useLocalFonts } from '../../theme/fonts';
import { LyricBackdrop } from '../../components/Lyrics/LyricBackdrop';
import { EmbeddedLyricSwitch } from '../../components/Lyrics/EmbeddedLyricSwitch';

export function LyricsPage() {
  const dispatch = useAppDispatch();
  const track = useAppSelector(state => state.library.tracks.find(item => item.id === state.player.currentId));
  const color = useCoverColor(track?.coverUrl);
  const fonts = useLocalFonts();
  const appearance = useAppSelector(state => state.ui.lyricsAppearance);
  const fullscreen = useAppSelector(state => state.ui.lyricsFullscreen);
  const immersive = useAppSelector(state => state.ui.lyricsImmersive);
  const { saved, loading, error, reload, remoteStatus, retryRemote } = useResolvedLyrics(track);
  const displayed = saved;
  const timing = useLyricOffset(displayed);
  const storageError = useAppSelector(state => state.library.storageError);
  const checkingEmbedded = !!track && !track.embeddedLyricsChecked && !track.unavailable && !saved && !storageError;
  const [importFor, setImportFor] = useState<string>();
  const [droppedFile, setDroppedFile] = useState<File>();
  const [dropError, setDropError] = useState('');
  useEffect(() => { setImportFor(undefined); setDroppedFile(undefined); setDropError(''); }, [track?.id]);
  return <section className='lyrics-page' aria-label={t("Lyrics page")} style={{ '--lyrics-cover-color': color,
    '--lyrics-font-max': `${appearance.fontSize}px`, '--lyric-translation-size': `${appearance.translationSize}px`,
    '--lyrics-font-scale': appearance.fontSize / 48, '--lyrics-line-gap': `${appearance.lineGap}px` } as CSSProperties}
    onDragEnter={event => event.stopPropagation()} onDragLeave={event => event.stopPropagation()}
    onDragOver={event => { event.preventDefault(); event.stopPropagation(); }}
    onDrop={event => {
      event.preventDefault(); event.stopPropagation(); setDropError('');
      if (!track) { setDropError('Select a track before importing lyrics.'); return; }
      const files = [...event.dataTransfer.files];
      if (files.length !== 1) { setDropError('Drop one TTML or LRC file for the current track.'); return; }
      setDroppedFile(files[0]); setImportFor(track.id);
    }}>
    <LyricBackdrop coverUrl={track?.coverUrl} />
    <header className='lyrics-header'>
      <div className='lyrics-heading'>
        {fullscreen && track && <img className='lyrics-heading-cover' src={trackCover(track)} width={52} height={52} alt='' draggable={false} />}
        <div className='lyrics-heading-copy'><h1 title={fullscreen ? track?.name : undefined}>{fullscreen ? track?.name || t("No track selected") : t("Lyrics")}</h1>
          <p title={fullscreen ? [track?.artist, track?.album].filter(Boolean).join(' / ') : track?.name}>{fullscreen ? [track?.artist, track?.album].filter(Boolean).join(' / ') || t("Unknown artist") : track?.name || t("No track selected")}</p></div>
      </div>
      <div className='lyrics-header-actions' inert={immersive || undefined} aria-hidden={immersive || undefined}>
        {displayed && <EmbeddedLyricSwitch key={`source:${displayed.trackId}`} saved={displayed} />}
        <button className='offline-icon-button lyrics-fullscreen-settings' aria-label={t("Settings")} title={t("Settings")} onClick={() => dispatch(uiActions.setSettingsOpen(true))}>⚙</button>
        <LyricsTiming offsetMs={timing.offsetMs} onChange={value => void timing.update(value)} disabled={!displayed} /><FullscreenButton /></div>
    </header>
    {dropError && <p className='lyrics-page-notice' role='alert'>{dropError}</p>}
    {timing.error && <p className='lyrics-page-notice' role='alert'>{t(timing.error)}<button onClick={() => void timing.update(timing.offsetMs)}>{t("Retry save")}</button></p>}
    <div className='lyrics-content'>
    <div className='lyrics-debug-band'><GlobalDebugOverlay /><AudioDebugOverlay /></div>
    <LyricRemoteNotice status={remoteStatus} onRetry={retryRemote} />
    {displayed && track ? <LyricsView key={`${track.id}-${displayed.savedAt}-${displayed.document.format}`} document={displayed.document} trackId={track.id} offsetMs={timing.offsetMs} fontKey={`${fonts.lyrics.family}:${appearance.fontSize}`} entranceKey={fullscreen ? 'fullscreen' : 'page'} /> : <div className='lyrics-empty'>
      <h2>{loading ? t("Loading saved lyrics…") : checkingEmbedded ? t("Checking embedded lyrics…") : error ? t("Lyrics could not be restored") : track ? t("Bring your lyrics") : t("Choose a song to get started")}</h2>
      <p>{error || track?.lyricsWarning || (track ? 'Import a local TTML or LRC file for this song. Your lyrics will follow the music.' : 'Play a song from your local library, then import its lyrics here.')}</p>
      {error && <button className='white-button' onClick={reload}>{t("Retry")}</button>}
      {!track && <Link className='white-button' to='/'>{t("Open library")}</Link>}
      {track && !loading && <button className='lyrics-import-button' onClick={() => { setDroppedFile(undefined); setImportFor(track.id); }}>{t("Import lyrics")}</button>}
      {track && !loading && !error && <p className='lyrics-empty-formats'>{t("TTML · LRC · Local files only")}</p>}
    </div>}
    </div>
    {track && importFor === track.id && <LyricsImport key={track.id} trackId={track.id} trackName={track.name} initialFile={droppedFile}
      onClose={() => setImportFor(undefined)} onSaved={reload} />}
  </section>;
}
