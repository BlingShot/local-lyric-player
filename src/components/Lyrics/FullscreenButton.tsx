import { t } from '../../i18n';
import { useState } from 'react';
import { useAppSelector } from '../../store/store';
import { enterLyricsFullscreen, exitLyricsFullscreen } from '../../lyrics/fullscreen';

export function FullscreenButton() {
  const fullscreen = useAppSelector(state => state.ui.lyricsFullscreen);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const toggle = async () => {
    if (busy) return;
    setBusy(true); setNotice('');
    try {
      if (fullscreen) await exitLyricsFullscreen();
      else if (!await enterLyricsFullscreen()) setNotice('Browser full screen is unavailable. Lyrics now fill this window.');
    } catch {
      setNotice('Browser full screen is unavailable. Lyrics now fill this window.');
    } finally { setBusy(false); }
  };
  return <>
    <button className='lyrics-fullscreen-button offline-icon-button' aria-label={fullscreen ? t("Exit full screen") : t("Full screen lyrics")}
      title={fullscreen ? t("Exit full screen (Esc)") : t("Full screen lyrics")} aria-pressed={fullscreen} disabled={busy} onClick={() => void toggle()}>
      <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.8' aria-hidden='true'>
        <path d={fullscreen ? 'M9 3v6H3m12-6v6h6M3 15h6v6m6 0v-6h6' : 'M9 3H3v6m12-6h6v6M3 15v6h6m6 0h6v-6'} />
      </svg>
    </button>
    {notice && <span className='lyrics-fullscreen-notice' role='status'>{notice}</span>}
  </>;
}
