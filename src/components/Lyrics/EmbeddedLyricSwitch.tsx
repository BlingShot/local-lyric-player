import { useEffect, useRef, useState } from 'react';
import { t } from '../../i18n';
import type { SavedLyrics } from '../../lyrics/types';
import { switchLyricFormat } from '../../lyrics/repository';
import { discoverEmbeddedLyricVariants } from '../../player/runtime';

const EMPTY_NOTICE = { text: '', error: false, visible: false };
export function EmbeddedLyricSwitch({ saved }: { saved: SavedLyrics }) {
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(EMPTY_NOTICE);
  const mounted = useRef(false), running = useRef(false), generation = useRef(0);
  const formats = new Set([saved.document.format, ...(saved.alternates ?? []).map(item => item.document.format)]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current++; };
  }, []);
  useEffect(() => {
    if (!notice.visible) return;
    const timer = setTimeout(() => setNotice(current => ({ ...current, visible: false })), 3000);
    return () => clearTimeout(timer);
  }, [notice]);
  const run = async (action: () => Promise<string | void>) => {
    if (running.current) return;
    running.current = true;
    const request = ++generation.current;
    setBusy(true); setNotice(EMPTY_NOTICE);
    try {
      const message = await action();
      if (mounted.current && request === generation.current && message) setNotice({ text: message, error: false, visible: true });
    } catch (error) {
      if (mounted.current && request === generation.current) setNotice({
        text: error instanceof Error ? error.message : 'Lyric source could not be changed.', error: true, visible: true,
      });
    } finally {
      if (request === generation.current) {
        running.current = false;
        if (mounted.current) setBusy(false);
      }
    }
  };
  return <div className='embedded-source-control'>
    <div className='embedded-format-switch' role='group' aria-label={t('Embedded lyric format')}>
      {(['lrc', 'ttml'] as const).map(format => <button key={format} disabled={busy || !formats.has(format)}
        aria-pressed={saved.document.format === format}
        title={formats.has(format) ? t('Switch lyric source') : t('Read embedded lyrics to discover this format')}
        onClick={() => void run(() => switchLyricFormat(saved.trackId, format))}>{format.toUpperCase()}</button>)}
    </div>
    {formats.size < 2 && <button className='embedded-source-refresh' disabled={busy} onClick={() => void run(async () => {
      const count = await discoverEmbeddedLyricVariants(saved.trackId);
      return count ? 'Embedded lyric formats refreshed.' : 'No embedded LRC or TTML found.';
    })}>{t(busy ? 'Reading...' : 'Read embedded')}</button>}
    <span className='embedded-source-notice' data-visible={notice.visible || undefined} data-error={notice.error || undefined}
      role='status' aria-live='polite' aria-hidden={!notice.visible}>{t(notice.text)}</span>
  </div>;
}
