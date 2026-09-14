import { t } from '../../i18n';
import { useSyncExternalStore } from 'react';
import { formatTime, type LocalTrack } from '../../library/importFiles';
import type { AnalysisInput, AnyAnalysisRecord } from '../types';
import type { AudioTask } from '../audio/types';
import { audioAnalysisQueue, audioTaskActive } from '../audio/queue';
import { loudnessCurrent } from './repository';
import type { LoudnessKind, LoudnessRecord } from './types';

const number = (n: number | null | undefined, unit: string) => `${n === null || n === undefined ? '—' : n.toFixed(1)} ${unit}`;
function Metric({ title, value, unit }: { title: string; value: number | null | undefined | '−∞'; unit: string }) {
  return <div><span>{title}</span><strong>{value === '−∞' ? value : value == null ? '—' : value.toFixed(1)} <small>{unit}</small></strong></div>;
}
const statusNames = { queued: 'Waiting', decoding: 'Decoding', analyzing: 'Analyzing', cancelling: 'Cancelling', saving: 'Saving', complete: 'Complete', failed: 'Failed', cancelled: 'Cancelled' };
function ScanControls({ kind, input, record, savedTask, blocked }: { kind: LoudnessKind; input?: AnalysisInput; record?: LoudnessRecord; savedTask?: AudioTask; blocked?: string }) {
  const id = input?.track.id || record?.trackId || savedTask?.trackId || '';
  const live = useSyncExternalStore(audioAnalysisQueue.subscribe, () => audioAnalysisQueue.get(id, kind));
  const task = live || savedTask, active = audioTaskActive(live), interrupted = !live && audioTaskActive(savedTask);
  const title = 'track loudness';
  return <><div className='analysis-section-heading'><h2>{t("ReplayGain & Loudness")}</h2><div className='analysis-heading-actions'>
    <button disabled={!input || !!blocked || active} onClick={() => input && audioAnalysisQueue.enqueue(input, kind)}>{t("Analyze")}{' '}{title}</button>
    {record && <button aria-label={t("Force reanalyze {0}", title)} disabled={!input || !!blocked || active} onClick={() => input && audioAnalysisQueue.enqueue(input, kind, true)}>{t("Force reanalyze")}</button>}
    {active && !['saving', 'cancelling'].includes(live!.status) && <button onClick={() => audioAnalysisQueue.cancel(id, kind)}>{t("Cancel")}</button>}
    <span className='analysis-status'>{interrupted ? t("Interrupted") : task ? t(statusNames[task.status]) : record ? t("Complete") : t("Not analyzed")}</span>
  </div></div>
    {task && <p role={task.status === 'failed' ? 'alert' : 'status'} className='analysis-notice'>{interrupted ? t("The previous scan was interrupted. Run it again to continue.") : t(task.message)}</p>}
    {blocked && <p className='analysis-warning'>{blocked}</p>}
  </>;
}
function Measurement({ record, tracks }: { record?: LoudnessRecord; tracks: LocalTrack[] }) {
  const r = record?.result, stale = record && !loudnessCurrent(record, tracks);
  return <>
    <div className='analysis-metrics loudness-metrics'>
      <Metric title={t("Integrated Loudness")} value={r?.integratedLufs} unit='LUFS' />
      <Metric title={t("Loudness Range")} value={r?.rangeLu} unit='LU' />
      <Metric title={t("True Peak")} value={r?.truePeak === 0 ? '−∞' : r?.truePeakDbtp} unit='dBTP' />
      <Metric title={t("Track Gain")} value={r?.replayGain?.gainDb} unit='dB' />
    </div>
    {stale && <p className='analysis-warning'>{t("Audio or analysis settings changed. Reanalyze before using this result for playback.")}</p>}
    {r?.reason && <p className='analysis-notice'>{r.reason}</p>}
    {record && <details className='analysis-provenance'><summary>{t("Measurement details")}</summary><dl>
      <dt>{t("Source")}</dt><dd>{t("Calculated from local audio ·")}{' '}{new Date(record.analyzedAt).toLocaleString()}</dd>
      <dt>{t("Engine")}</dt><dd>{record.algorithm.name} · {record.algorithm.version}</dd>
      <dt>{t("Sample peak")}</dt><dd>{r!.samplePeak === 0 ? t("−∞ dBFS") : number(20 * Math.log10(r!.samplePeak), 'dBFS')} · {r!.samplePeak.toFixed(6)} {t("linear")}</dd>
      <dt>{t("True peak")}</dt><dd>{r!.truePeak.toFixed(6)} {t("linear · 4× FIR interpolation, ITU-R BS.1770 Annex 2")}</dd>
      <dt>{t("ReplayGain")}</dt><dd>{t("ReplayGain 2.0 · −18 LUFS reference · unmodified raw gain. Preamp and clipping prevention are separate playback settings.")}</dd>
      <dt>{t("Scope")}</dt><dd>{t("Full track")}</dd>
      <dt>{t("Analyzed files")}</dt><dd><ul>{r!.ranges.map(item => <li key={item.trackId}>{tracks.find(t => t.id === item.trackId)?.name || item.name} · {formatTime(item.range.end)} · {item.range.channels} {t("ch ·")}{' '}{item.range.sampleRate.toLocaleString('en')} {t("Hz")}</li>)}</ul></dd>
      <dt>{t("Parameters")}</dt><dd>{Object.entries(record.settings).map(([key, value]) => `${key}: ${value}`).join(' · ')}</dd>
    </dl></details>}
  </>;
}
export function LoudnessAnalysis({ tracks, input, records, tasks = [], blocked }: {
  track: LocalTrack; tracks: LocalTrack[]; input?: AnalysisInput; records?: AnyAnalysisRecord[]; tasks?: AudioTask[]; blocked?: string;
}) {
  const single = records?.find(r => r.kind === 'loudness');
  return <section id='analysis-loudness' className='analysis-section analysis-loudness' aria-label={t("ReplayGain and loudness analysis")}>
    <ScanControls kind='loudness' input={input} record={single} savedTask={tasks.find(t => t.kind === 'loudness')} blocked={blocked} />
    <Measurement record={single} tracks={tracks} />
  </section>;
}
