import { t } from '../../i18n';
import { useState } from 'react';
import { store, useAppDispatch, useAppSelector } from '../../store/store';
import { uiActions } from '../../store/slices/offlineUi';
import { saveLyricsAppearance } from '../../library/database';
import { validLyricsAppearance } from '../../lyrics/appearance';

export function VocalLabelsToggle() {
  const show = useAppSelector(state => state.ui.lyricsAppearance.showVocalLabels), dispatch = useAppDispatch();
  const [error, setError] = useState('');
  const update = async (showVocalLabels: boolean) => {
    const next = validLyricsAppearance({ ...store.getState().ui.lyricsAppearance, showVocalLabels });
    dispatch(uiActions.setLyricsAppearance(next)); setError('');
    try { await saveLyricsAppearance(next); } catch { setError('Vocal label preference could not be saved. Please retry.'); }
  };
  return <div className='vocal-label-setting'><label><span>{t("Show Performer / Background vocal labels")}</span><input aria-label={t("Show vocal labels")} type='checkbox' checked={show} onChange={e => void update(e.target.checked)} /></label>
    {error && <p role='alert'>{t(error)}<button onClick={() => void update(show)}>{t("Retry save")}</button></p>}
  </div>;
}
