import { EmbeddedLyricSwitch } from './EmbeddedLyricSwitch';
import { LyricRemoteNotice } from './LyricRemoteNotice';
import { t } from '../../i18n';
import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useAppSelector } from '../../store/store';
import { useResolvedLyrics } from '../../lyrics/useResolvedLyrics';
import { useLyricOffset } from '../../lyrics/useLyricOffset';
import { useLocalFonts } from '../../theme/fonts';
import { useCoverColor } from '../../lyrics/useCoverColor';
import { trackCover, type LocalTrack } from '../../library/importFiles';
import { LyricsView } from './LyricsView';
import { LyricBackdrop } from './LyricBackdrop';

export function MiniLyrics({ track, visible = true }: { track?: LocalTrack; visible?: boolean }) {
  const fonts = useLocalFonts();
  const appearance = useAppSelector(state => state.ui.lyricsAppearance);
  const { saved, loading, error, reload, remoteStatus, retryRemote } = useResolvedLyrics(track);
  const timing = useLyricOffset(saved), color = useCoverColor(track?.coverUrl);
  const fontSize = Math.max(18, appearance.fontSize - 20);
  return <div className='mini-lyrics' style={{ '--lyrics-background': color,
    '--lyric-translation-size': `${Math.max(10, appearance.translationSize * .65)}px`, '--lyrics-font-max': `${fontSize}px`, '--lyrics-line-gap': `${Math.max(8, appearance.lineGap - 6)}px` } as CSSProperties}>
    <LyricBackdrop coverUrl={track?.coverUrl} />
    {track && <div className='mini-lyrics-song'><img src={trackCover(track)} alt='' /><div><strong>{track.name}</strong><span>{track.artist || t("Unknown artist")}</span></div></div>}
    {saved && <EmbeddedLyricSwitch key={`source:${saved.trackId}`} saved={saved} />}
    <div className='lyrics-content'>
    <LyricRemoteNotice status={remoteStatus} onRetry={retryRemote} />
    {saved && track ? <LyricsView key={`${track.id}:${saved.savedAt}:${saved.document.format}`} document={saved.document} trackId={track.id} offsetMs={timing.offsetMs} fontKey={`${fonts.lyrics.family}:${fontSize}`} visible={visible} />
      : <div className='mini-lyrics-empty'><p>{error || (loading ? 'Loading lyrics…' : track ? 'No lyrics for this song.' : 'Play a song to see its lyrics.')}</p>
        {error && <button className='lyrics-import-button' onClick={reload}>{t("Retry")}</button>}
        {track && !loading && <Link className='lyrics-import-button' to='/lyrics'>{t("Open lyrics")}</Link>}</div>}
    </div>
    {timing.error && <p className='mini-lyrics-error' role='alert'>{t(timing.error)}</p>}
  </div>;
}
