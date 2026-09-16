import { t } from '../../i18n';
import { useAppearance } from '../../lyrics/useAppearance';
import { defaultLyricsAppearance } from '../../lyrics/appearance';
import { LyricDisplayControls } from '../Lyrics/LyricDisplayControls';
import { LocalFontPicker } from './LocalFontPicker';

export function LyricAppearanceSettings() {
  const { appearance, update, error } = useAppearance();
  return <><section><h3>{t('Lyric display')}</h3><LyricDisplayControls /></section>
    <section><h3>{t('Lyric typography')}</h3><LocalFontPicker target='lyrics' />
      <label className='settings-range'>{t('Font size')}<output>{appearance.fontSize} px</output><input aria-label={t('Lyric font size')} type='range' min={24} max={64} value={appearance.fontSize} onChange={e => update({ fontSize: Number(e.target.value) })} /></label>
      <label className='settings-range'>{t('Translation font size')}<output>{appearance.translationSize} px</output><input aria-label={t('Translation font size')} type='range' min={12} max={40} value={appearance.translationSize} onChange={e => update({ translationSize: Number(e.target.value) })} /></label>
      <label className='settings-range'>{t('Line spacing')}<output>{appearance.lineGap} px</output><input aria-label={t('Lyric line spacing')} type='range' min={4} max={48} value={appearance.lineGap} onChange={e => update({ lineGap: Number(e.target.value) })} /></label>
      <button onClick={() => update(defaultLyricsAppearance)}>{t('Reset lyric appearance')}</button>{error && <p role='alert'>{t(error)}</p>}
    </section></>;
}
