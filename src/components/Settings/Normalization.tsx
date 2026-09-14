import { t } from '../../i18n';
import { AppSelect } from '../Menu';
import { useSyncExternalStore } from 'react';
import { getNormalization, subscribeNormalization, updateNormalization } from '../../player/normalization';

export function NormalizationSettings() {
  const state = useSyncExternalStore(subscribeNormalization, getNormalization), s = state.settings;
  return <section className='normalization-settings'><h3>{t("Volume normalization")}</h3>
    <label>{t("Use measured ReplayGain")}<input aria-label={t("Use measured ReplayGain")} type='checkbox' checked={s.enabled} disabled={!state.ready || state.saving} onChange={e => void updateNormalization({ enabled: e.target.checked })} /></label>
    <label>{t("Preamp")}<span>{s.preampDb > 0 ? '+' : ''}{s.preampDb} {t("dB")}</span><input aria-label={t("Normalization preamp")} type='range' min={-12} max={12} step={1} value={s.preampDb} disabled={state.saving} onChange={e => void updateNormalization({ preampDb: Number(e.target.value) })} /></label>
    <label>{t("Prevent clipping")}<input aria-label={t("Prevent clipping")} type='checkbox' checked={s.preventClipping} disabled={state.saving} onChange={e => void updateNormalization({ preventClipping: e.target.checked })} /></label>
    {s.preventClipping && <div className='app-select-field'>{t("True-peak ceiling")}<AppSelect label={t("True-peak ceiling")} value={String(s.ceilingDbtp)} disabled={state.saving} onChange={value => void updateNormalization({ ceilingDbtp: Number(value) })} options={[0, -1, -2, -3, -4, -5, -6].map(value => ({ value: String(value), label: `${value} dBTP` }))} /></div>}
    <p>{t("ReplayGain 2.0 · −18 LUFS reference. Missing or stale results use no gain.")}</p>
    <p role='status'>{t(state.message)}{s.enabled && t(" · {0}{1} dB", state.appliedDb > 0 ? '+' : '', state.appliedDb.toFixed(1))}</p>
    {state.error && <p role='alert'>{t(state.error)}</p>}
  </section>;
}
