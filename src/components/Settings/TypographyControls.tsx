import { t } from '../../i18n';
import type { FontTarget } from '../../theme/fonts';
import { updateTypography, useTypography } from '../../theme/typography';
export function TypographyControls({ target }: { target: FontTarget }) {
  const state = useTypography(), axes = state.values[target];
  return <div className='font-axis-controls'>
    <label className='settings-range'>{t('Weight')}<output>{axes.weight}</output><input type='range' aria-label={t(target === 'app' ? 'Application font weight' : 'Lyric font weight')} min={100} max={900} step={100} value={axes.weight} onChange={e => updateTypography(target, { weight: Number(e.target.value) })} /></label>
    <label className='settings-range'>{t('Width')}<output>{axes.stretch}%</output><input type='range' aria-label={t(target === 'app' ? 'Application font width' : 'Lyric font width')} min={75} max={125} value={axes.stretch} onChange={e => updateTypography(target, { stretch: Number(e.target.value) })} /></label>
    <label className='settings-range'>{t('Letter spacing')}<output>{axes.spacing.toFixed(2)} em</output><input type='range' aria-label={t(target === 'app' ? 'Application letter spacing' : 'Lyric letter spacing')} min={-.04} max={.15} step={.01} value={axes.spacing} onChange={e => updateTypography(target, { spacing: Number(e.target.value) })} /></label>
    <label><input type='checkbox' checked={axes.italic} onChange={e => updateTypography(target, { italic: e.target.checked })} />{t('Italic')}</label>
    <small>{t('Variable axes require a supporting font. Other fonts use available faces or browser synthesis.')}</small>{state.error && <p role='alert'>{t(state.error)}</p>}
  </div>;
}
