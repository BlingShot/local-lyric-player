import { useEffect, useState } from 'react';
import { Modal } from 'antd';
import { t, setLanguage, useLanguage, type Language } from '../../i18n';
import { AppSelect } from '../Menu';
import { useAppDispatch, useAppSelector } from '../../store/store';
import { uiActions } from '../../store/slices/offlineUi';
import { setThemeMode, useAppTheme, type ThemeMode } from '../../theme';
import { setGlassSurface, useSurface } from '../../theme/surface';
import { useConfigReadError } from '../../desktop/config';
import { AutoImportFolder } from './AutoImportFolder';
import { NormalizationSettings } from './Normalization';
import { DeepSeekSettings } from './DeepSeek';
import { SpotifySettings } from './Spotify';
import { DesktopStorageSettings } from './DesktopStorage';
import { ListeningTimeSettings } from './ListeningTime';
import { LocalFontPicker } from './LocalFontPicker';
import { LyricAppearanceSettings } from './LyricAppearance';
import { AudioOutputSettings } from './AudioOutput';
import { useSavedLyrics } from '../../lyrics/useSavedLyrics';
import { useLyricOffset } from '../../lyrics/useLyricOffset';
import { LyricsTimingControls } from '../Lyrics/LyricsTiming';
import { VolumeControl } from '../VolumeControl';

const categories = ['Appearance', 'Lyrics', 'Playback', 'Online services', 'Storage'] as const;
function SettingsContent() {
  const [tab, setTab] = useState<typeof categories[number]>('Appearance'), locale = useLanguage(), theme = useAppTheme(), surface = useSurface(), configError = useConfigReadError();
  const track = useAppSelector(state => state.library.tracks.find(track => track.id === state.player.currentId));
  const { saved } = useSavedLyrics(track?.id, track?.embeddedLyricsChecked), timing = useLyricOffset(saved);
  return <div className='settings-workspace'><nav className='settings-navigation' aria-label={t('Settings categories')}>
    {categories.map(category => <button key={category} aria-current={tab === category ? 'page' : undefined} onClick={() => setTab(category)}>{t(category)}</button>)}
  </nav><div className='settings-pages'>
    {configError && <p role='alert'>{t(configError)}</p>}
    <div hidden={tab !== 'Appearance'} className='settings-category'><header><h2>{t('Appearance')}</h2></header>
      <section><h3>{t('Interface')}</h3><div className='settings-field'><span>{t('Language')}</span><AppSelect label={t('Interface language')} value={locale.language} onChange={value => void setLanguage(value as Language)} options={[{ value: 'en', label: 'English' }, { value: 'zh-CN', label: '简体中文' }]} /></div>
        <div className='settings-field'><span>{t('Theme')}</span><AppSelect label={t('App theme')} value={theme.mode} onChange={value => setThemeMode(value as ThemeMode)} options={[{ value: 'dark', label: t('Night') }, { value: 'light', label: t('Day') }]} /></div>
        <label><input type='checkbox' checked={surface.glass} onChange={e => void setGlassSurface(e.target.checked)} />{t('Liquid glass')}</label>
        {(locale.error || theme.error || surface.error) && <p role='alert'>{t(locale.error || theme.error || surface.error)}</p>}
      </section><section><LocalFontPicker target='app' /></section>
    </div>
    <div hidden={tab !== 'Lyrics'} className='settings-category'><header><h2>{t('Lyrics')}</h2></header><LyricAppearanceSettings />
      <section><h3>{t('Lyrics timing')}</h3><p>{track?.name || t('No track selected')}</p>{saved ? <LyricsTimingControls offsetMs={timing.offsetMs} onChange={value => void timing.update(value)} /> : <p>{t('Select a song with saved or embedded lyrics to adjust its timing.')}</p>}{timing.error && <p role='alert'>{t(timing.error)}</p>}</section>
    </div>
    <div hidden={tab !== 'Playback'} className='settings-category'><header><h2>{t('Playback')}</h2></header><section><h3>{t('Volume')}</h3><VolumeControl /></section><AudioOutputSettings active={tab === 'Playback'} /><NormalizationSettings /><ListeningTimeSettings /></div>
    <div hidden={tab !== 'Online services'} className='settings-category'><header><h2>{t('Online services')}</h2></header><SpotifySettings /><DeepSeekSettings /></div>
    <div hidden={tab !== 'Storage'} className='settings-category'><header><h2>{t('Storage')}</h2></header><AutoImportFolder /><DesktopStorageSettings /></div>
  </div></div>;
}
export function SettingsDrawer() {
  const open = useAppSelector(state => state.ui.settingsOpen), ready = useAppSelector(state => state.library.ready), appearance = useAppSelector(state => state.ui.lyricsAppearance), dispatch = useAppDispatch();
  useEffect(() => { document.documentElement.style.setProperty('--translation-font-size', `${appearance.translationSize}px`); }, [appearance.translationSize]);
  return <Modal title={t('Settings')} open={open} centered width={980} className='settings-window' footer={null} destroyOnHidden onCancel={() => dispatch(uiActions.setSettingsOpen(false))}>
    {open && (ready ? <SettingsContent /> : <p>{t('Loading local preferences…')}</p>)}
  </Modal>;
}
