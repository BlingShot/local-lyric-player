import { t } from '../../i18n';
import { retryListeningSave, useListeningTime } from '../../player/listening';
const duration = (ms: number) => { const seconds = Math.floor(ms / 1000); return t('{0}h {1}m {2}s', Math.floor(seconds / 3600), Math.floor(seconds % 3600 / 60), seconds % 60); };
export function ListeningTimeSettings() {
  const totals = useListeningTime();
  return <section><h3>{t("Listening time")}</h3><div className='listening-totals'>
    <div><span>{t("Today")}</span><strong aria-label={t("Today listening time")}>{duration(totals.todayMs)}</strong></div>
    <div><span>{t("All time")}</span><strong aria-label={t("Total listening time")}>{duration(totals.totalMs)}</strong></div>
  </div><p>{t("Actual playback time, excluding pauses, seeking and buffering. Playback speed does not multiply listening time.")}</p>
    {totals.error && <p role='alert'>{t(totals.error)}<button onClick={retryListeningSave}>{t("Retry")}</button></p>}
  </section>;
}
