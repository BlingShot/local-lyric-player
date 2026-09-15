import { useEffect } from 'react';
import { AppSelect } from '../Menu';
import { t } from '../../i18n';
import { useAudioOutput, refreshAudioDevices, updateAudioOutput } from '../../player/audioOutput';
export function AudioOutputSettings({ active }: { active: boolean }) {
  const state = useAudioOutput(), supported = !!window.localMusicDesktop?.nativeAudioDevices;
  useEffect(() => { if (active && supported) void refreshAudioDevices(); }, [active, supported]);
  const options = [{ value: 'browser', label: t('Browser audio (system default)') }, ...state.devices.map(device => ({ value: device.name, label: device.name === 'auto' ? t('WASAPI system default') : device.description }))];
  if (!options.some(option => option.value === state.settings.device)) options.push({ value: state.settings.device, label: t('Previously selected device (unavailable)') });
  return <section className='settings-card'><h3>{t('Playback device')}</h3>
    <div className='app-select-field'>{t('Audio output')}<AppSelect label={t('Audio output')} value={state.settings.device} options={options} disabled={!state.ready || state.busy || !supported} onChange={device => void updateAudioOutput({ device, ...(device === 'browser' ? { exclusive: false } : {}) })} /></div>
    <button disabled={!supported || state.busy} onClick={() => void refreshAudioDevices()}>{t('Refresh devices')}</button>
    <label className='settings-check'><input type='checkbox' checked={state.settings.exclusive} disabled={!supported || !state.ready || state.busy} onChange={event => void updateAudioOutput({ exclusive: event.target.checked })} />{t('WASAPI exclusive mode')}</label>
    <p className='offline-muted'>{t('Exclusive mode uses the native mpv audio backend and may prevent other apps from playing sound. Unsupported devices report an error instead of silently using shared mode.')}</p>
    {!supported && <p>{t('Native playback devices are available in the Windows desktop app.')}</p>}
    {state.busy && <p role='status'>{t('Switching playback device...')}</p>}
    {state.error && <p role='alert'>{t(state.error)}</p>}
  </section>;
}
