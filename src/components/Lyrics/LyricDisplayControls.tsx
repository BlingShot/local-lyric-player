import { AppDropdown } from '../Menu';
import { t } from '../../i18n';
import { useAppearance } from '../../lyrics/useAppearance';
import type { LyricCapabilities } from '../../lyrics/capabilities';

export function LyricDisplayControls({ compact = false, capabilities }: { compact?: boolean; capabilities?: LyricCapabilities }) {
  const { appearance, update, error } = useAppearance();
  const has = capabilities;
  const controls = <div className={compact ? 'lyric-display-controls ant-dropdown-menu' : 'lyric-display-controls'}>
    <label><input type='checkbox' disabled={!!has && !has.hasWordTiming} checked={appearance.wordByWord} onChange={e => update({ wordByWord: e.target.checked })} />{t('Word-by-word highlighting')}</label>
    <label><input type='checkbox' disabled={!!has && !has.hasMultiplePerformers} checked={appearance.performerAlignment} onChange={e => update({ performerAlignment: e.target.checked })} />{t('Align lyrics by performer')}</label>
    <label><input type='checkbox' disabled={!!has && !has.hasMultiplePerformers} checked={appearance.showVocalLabels} onChange={e => update({ showVocalLabels: e.target.checked })} />{t('Show performer labels')}</label>
    <label><input type='checkbox' disabled={!!has && !has.hasTranslations} checked={appearance.showTranslations !== false} onChange={e => update({ showTranslations: e.target.checked })} />{t('Show translations')}</label>
    {error && <p role='alert'>{t(error)}</p>}
  </div>;
  return compact ? <AppDropdown popupRender={() => controls} trigger={['click']} placement='bottomRight'><button className='lyrics-import-button'>{t('Lyric display')}</button></AppDropdown> : controls;
}
