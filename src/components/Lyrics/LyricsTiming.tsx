import { t } from '../../i18n';
import { Popover } from 'antd';
import { useEffect, useState } from 'react';

export function LyricsTimingControls({ offsetMs, onChange }: { offsetMs: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(String(offsetMs / 1000));
  useEffect(() => setDraft(String(offsetMs / 1000)), [offsetMs]);
  return <div className='lyrics-timing-controls'>
    <label>{t("Offset in seconds")}<input aria-label={t("Lyrics offset in seconds")} type='number' min={-60} max={60} step={.1} value={draft}
      onChange={event => { setDraft(event.currentTarget.value); if (event.currentTarget.value !== '') onChange(event.currentTarget.valueAsNumber * 1000); }}
      onBlur={() => setDraft(String(offsetMs / 1000))} /></label>
    <div className='lyrics-offset-buttons'>
      <button aria-label={t("Lyrics earlier")} disabled={offsetMs <= -60000} onClick={() => onChange(offsetMs - 100)}>{t("−0.1 s")}</button>
      <button aria-label={t("Lyrics later")} disabled={offsetMs >= 60000} onClick={() => onChange(offsetMs + 100)}>{t("+0.1 s")}</button>
      <button onClick={() => onChange(0)}>{t("Reset timing")}</button>
    </div>
    <p>{t("Negative plays lyrics earlier; positive plays them later. Saved for this song.")}</p>
  </div>;
}

export function LyricsTiming({ offsetMs, onChange, disabled }: { offsetMs: number; onChange: (value: number) => void; disabled: boolean }) {
  return <Popover trigger='click' placement='bottomRight' title={t("Lyrics timing")} content={<LyricsTimingControls offsetMs={offsetMs} onChange={onChange} />}>
    <button className='offline-icon-button lyrics-timing-button' aria-label={t("Lyrics timing")} title={t("Lyrics timing: {0}{1} s", offsetMs > 0 ? '+' : '', (offsetMs / 1000).toFixed(1))} disabled={disabled}>
      <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.8' aria-hidden='true'><circle cx='12' cy='12' r='8.5' /><path d='M12 6.5V12l4 2' /></svg>
    </button>
  </Popover>;
}
