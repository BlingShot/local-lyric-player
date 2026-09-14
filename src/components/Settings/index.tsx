import { t } from '../../i18n';
import { AppSelect } from '../Menu';
import { setLanguage, useLanguage, type Language } from '../../i18n';
import { useRef, useState } from 'react';
import { Drawer } from 'antd';
import { store, useAppDispatch, useAppSelector } from '../../store/store';
import { uiActions } from '../../store/slices/offlineUi';
import { saveLyricsAppearance } from '../../library/database';
import { defaultLyricsAppearance, validLyricsAppearance, type LyricsAppearance } from '../../lyrics/appearance';
import { useSavedLyrics } from '../../lyrics/useSavedLyrics';
import { useLyricOffset } from '../../lyrics/useLyricOffset';
import { LyricsTimingControls } from '../Lyrics/LyricsTiming';
import { AutoImportFolder } from './AutoImportFolder';
import { NormalizationSettings } from './Normalization';
import { DeepSeekSettings } from './DeepSeek';
import { DesktopStorageSettings } from './DesktopStorage';
import { setThemeMode, useAppTheme, type ThemeMode } from '../../theme';
import { useConfigReadError } from '../../desktop/config';
import { setGlassSurface, useSurface } from '../../theme/surface';
import { ListeningTimeSettings } from './ListeningTime';
import { LocalFontPicker } from './LocalFontPicker';
import { chooseLocalFont } from '../../theme/fonts';
import { VocalLabelsToggle } from '../Lyrics/VocalLabelsToggle';

function SettingsContent() {
  const locale = useLanguage();
  const dispatch = useAppDispatch();
  const appTheme = useAppTheme();
  const surface = useSurface();
  const configError = useConfigReadError();
  const appearance = useAppSelector(state => state.ui.lyricsAppearance);
  const track = useAppSelector(state => state.library.tracks.find(item => item.id === state.player.currentId));
  const { saved, loading, error: lyricError } = useSavedLyrics(track?.id, track?.embeddedLyricsChecked);
  const timing = useLyricOffset(saved);
  const [error, setError] = useState('');
  const request = useRef(0);
  const update = async (patch: Partial<LyricsAppearance>) => {
    const next = validLyricsAppearance({ ...store.getState().ui.lyricsAppearance, ...patch });
    const current = ++request.current;
    dispatch(uiActions.setLyricsAppearance(next)); setError('');
    try { await saveLyricsAppearance(next); }
    catch { if (current === request.current) setError('Appearance changed for this session but could not be saved. Check browser storage, then retry.'); }
  };
  return <div className='offline-settings-content'>
    <section><h3>{t("Language")}</h3><AppSelect label={t("Interface language")} value={locale.language} onChange={value => void setLanguage(value as Language)} options={[{ value: 'en', label: t("English") }, { value: 'zh-CN', label: '简体中文' }]} />{locale.error && <p role='alert'>{t(locale.error)}<button onClick={() => void setLanguage(locale.language)}>{t("Retry save")}</button></p>}</section>
    {configError && <p role='alert'>{t(configError)}</p>}
    <section><h3>{t("Appearance")}</h3><div className='app-select-field'>{t("Theme")}<AppSelect label={t("App theme")} value={appTheme.mode} onChange={value => setThemeMode(value as ThemeMode)} options={[{ value: 'dark', label: t("Night") }, { value: 'light', label: t("Day") }]} /></div>{appTheme.error && <p role='alert'>{t(appTheme.error)}<button onClick={() => setThemeMode(appTheme.mode)}>{t("Retry theme save")}</button></p>}</section>
    <section><label><span>{t("Liquid glass")}</span><input type='checkbox' aria-label={t("Liquid glass")} checked={surface.glass} onChange={e => void setGlassSurface(e.target.checked)} /></label>
      {surface.error && <p role='alert'>{t(surface.error)}<button onClick={() => void setGlassSurface(surface.glass)}>{t("Retry save")}</button></p>}
    </section>
    <section><LocalFontPicker target='app' /></section>
    <ListeningTimeSettings />
    <DeepSeekSettings />
    <AutoImportFolder />
    <DesktopStorageSettings />
    <NormalizationSettings />
    <section><h3>{t("Lyric appearance")}</h3>
      <VocalLabelsToggle />
      <LocalFontPicker target='lyrics' />
      <label>{t("Font size")}<span>{appearance.fontSize} {t("px")}</span><input aria-label={t("Lyric font size")} type='range' min={24} max={64} step={1} value={appearance.fontSize}
        onChange={event => void update({ fontSize: Number(event.target.value) })} /></label>
      <label>{t("Line spacing")}<span>{appearance.lineGap} {t("px")}</span><input aria-label={t("Lyric line spacing")} type='range' min={4} max={48} step={1} value={appearance.lineGap}
        onChange={event => void update({ lineGap: Number(event.target.value) })} /></label>
      <p>{t("Font size stays fixed. Long lines wrap when needed. Missing glyphs use local bold fallback fonts.")}</p>
      <button className='lyrics-import-button' onClick={() => { void chooseLocalFont('lyrics', { kind: 'system' }); void update(defaultLyricsAppearance); }}>{t("Reset lyric appearance")}</button>
      {error && <p role='alert'>{t(error)}<button onClick={() => void update(appearance)}>{t("Retry save")}</button></p>}
    </section>
    <section><h3>{t("Lyrics timing")}</h3><p className='settings-track-name'>{track?.name || t("No track selected")}</p>
      {saved ? <LyricsTimingControls offsetMs={timing.offsetMs} onChange={value => void timing.update(value)} />
        : <p>{t(lyricError || (loading ? 'Loading saved lyrics…' : 'Select a song with saved or embedded lyrics to adjust its timing.'))}</p>}
      {timing.error && <p role='alert'>{t(timing.error)}<button onClick={() => void timing.update(timing.offsetMs)}>{t("Retry save")}</button></p>}
    </section>
  </div>;
}

export function SettingsDrawer() {
  const open = useAppSelector(state => state.ui.settingsOpen);
  const ready = useAppSelector(state => state.library.ready);
  const dispatch = useAppDispatch();
  return <Drawer title={t("Settings")} open={open} placement='right' width={380} destroyOnHidden onClose={() => dispatch(uiActions.setSettingsOpen(false))}>
    {open && (ready ? <SettingsContent /> : <p>{t("Loading local preferences…")}</p>)}
  </Drawer>;
}
