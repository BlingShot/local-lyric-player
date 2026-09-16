import { AppSelect } from '../Menu';
import { useEffect, useRef, useState } from 'react';
import { Modal } from 'antd';
import { t } from '../../i18n';
import type { SavedLyrics } from '../../lyrics/types';
import type { LocalTrack } from '../../library/importFiles';
import { drawLyricImage, lyricImageSelection, LYRIC_IMAGE_THEMES, parseLyricImageTheme, type LyricImageTheme } from '../../lyrics/lyricImage';
import { readAudioClock } from '../../lyrics/audioClock';
import { useLyricOffset } from '../../lyrics/useLyricOffset';

const COVER_ERROR = 'Unable to load the song cover. Turn off Include cover image to export without it.';

function useExportCover(url: string | undefined, enabled: boolean) {
  const [result, setResult] = useState<{ url: string; image?: HTMLImageElement; error?: string }>();
  useEffect(() => {
    if (!enabled || !url || result?.url === url) return;
    let live = true;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    const fail = () => {
      if (live) setResult({ url, error: COVER_ERROR });
    };
    const timeout = window.setTimeout(() => {
      fail();
      live = false;
      image.onload = null;
      image.onerror = null;
      image.src = '';
    }, 10000);
    image.onload = () => {
      window.clearTimeout(timeout);
      if (!live) return;
      if (!image.naturalWidth || !image.naturalHeight) { fail(); return; }
      setResult({ url, image });
    };
    image.onerror = () => { window.clearTimeout(timeout); fail(); };
    image.src = url;
    return () => {
      live = false;
      window.clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
    };
  }, [url, enabled, result?.url]);
  const current = enabled && url && result?.url === url ? result : undefined;
  return {
    image: current?.image,
    error: current?.error,
    loading: !!(enabled && url && !current),
  };
}

export function LyricImageExport({ saved, track, close }: { saved: SavedLyrics; track: LocalTrack; close: () => void }) {
  const { offsetMs } = useLyricOffset(saved);
  const [selected, setSelected] = useState(() => new Set(lyricImageSelection(saved.document.lines, readAudioClock().time - offsetMs / 1000)));
  const [customTheme, setCustomTheme] = useState<LyricImageTheme>(() => { try { return parseLyricImageTheme(localStorage.getItem('lyric-image-theme') || ''); } catch { return LYRIC_IMAGE_THEMES[0]; } });
  const [themeError, setThemeError] = useState('');
  const themeInput = useRef<HTMLInputElement>(null);
  const [translation, setTranslation] = useState(true), [theme, setTheme] = useState('night'), [preview, setPreview] = useState(''), [error, setError] = useState('');
  const [includeCover, setIncludeCover] = useState(true);
  const cover = useExportCover(track.coverUrl, includeCover);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let live = true; setPreview(''); setError('');
    if (cover.loading) return;
    if (cover.error) { setError(cover.error); return; }
    void document.fonts.ready.then(() => {
      if (!live || !canvas.current) return;
      try {
        const family = getComputedStyle(document.querySelector('.lyric-text') || document.body).fontFamily;
        drawLyricImage(canvas.current, { lines: saved.document.lines.filter(line => selected.has(line.id)), title: track.name, artist: track.artist || '', family, translation, theme: theme === 'custom' ? customTheme : theme, cover: cover.image });
        setPreview(canvas.current.toDataURL('image/png'));
      } catch (e) { setError((e as Error).message); }
    });
    return () => { live = false; };
  }, [saved.document, selected, translation, theme, customTheme, track.name, track.artist, cover.image, cover.error, cover.loading]);
  const download = () => { if (!preview) return; const link = document.createElement('a'); link.href = preview; link.download = `${track.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 100) || 'lyrics'}-lyrics.png`; document.body.append(link); link.click(); link.remove(); };
  return <Modal open title={t('Export lyric image')} onCancel={close} footer={null} width={960} className='lyric-image-modal'>
    <div className='lyric-image-layout'><div className='lyric-image-controls'>
      <p>{t('Select lyrics for a 1080 x 1080 PNG. Preview and download are identical.')}</p>
      <label>{t('Image theme')}<AppSelect label={t('Image theme')} value={theme} onChange={value => setTheme(value as typeof theme)} options={[...LYRIC_IMAGE_THEMES.map(item => ({ value: item.id, label: t(item.name) })), ...(customTheme.id === 'custom' ? [{ value: 'custom', label: customTheme.name }] : [])]} /></label>
      <div className='lyric-theme-actions'><button onClick={() => themeInput.current?.click()}>{t('Import theme')}</button><button onClick={() => {
        const selectedTheme = theme === 'custom' ? customTheme : LYRIC_IMAGE_THEMES.find(item => item.id === theme)!;
        const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, ...selectedTheme }, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = url; link.download = 'lyric-image-theme.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      }}>{t('Export theme')}</button></div>
      <input ref={themeInput} hidden type='file' accept='.json,application/json' aria-label={t('Import image theme')} onChange={async event => {
        const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
        try { if (file.size > 16384) throw new Error('Theme files must be smaller than 16 KB.'); const value = parseLyricImageTheme(await file.text()); setCustomTheme(value); setTheme('custom'); setThemeError('');
          try { localStorage.setItem('lyric-image-theme', JSON.stringify({ version: 1, ...value })); } catch { setThemeError('Theme applied for this session. Storage is unavailable.'); }
        } catch (error) { setThemeError((error as Error).message); }
      }} />
      {themeError && <p role='alert'>{t(themeError)}</p>}
      <label><input type='checkbox' checked={translation} onChange={e => setTranslation(e.target.checked)} />{t('Include translations')}</label>
      <label><input type='checkbox' checked={includeCover && !!track.coverUrl} disabled={!track.coverUrl} onChange={e => setIncludeCover(e.target.checked)} />{t('Include cover image')}</label>
      {!track.coverUrl && <p>{t('This song has no cover image.')}</p>}
      <div className='lyric-image-lines' role='group' aria-label={t('Choose lyric lines')}>{saved.document.lines.map(line => <label key={line.id}>
        <input type='checkbox' checked={selected.has(line.id)} onChange={e => setSelected(previous => { const next = new Set(previous); e.target.checked ? next.add(line.id) : next.delete(line.id); return next; })} />
        <span>{line.role === 'background' && <small>{t('Background vocals')}: </small>}{line.parts.map(part => part.text).join('')}</span>
      </label>)}</div>
      <button className='white-button' disabled={!preview || !!error} onClick={download}>{t('Download PNG')}</button>
      {error && <p role='alert'>{t(error)}</p>}
    </div><div className='lyric-image-preview'>{preview ? <img src={preview} alt={t('Square lyric image preview')} /> : <p role='status'>{t(cover.loading ? 'Loading cover image...' : 'Choose lyric lines')}</p>}<canvas hidden ref={canvas} /></div></div>
  </Modal>;
}
