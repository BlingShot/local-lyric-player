import { t } from '../../i18n';
import { AppSelect } from '../../components/Menu';
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { Modal } from 'antd';
import type { AnalysisCorrections, AnalysisInput, AnyAnalysisRecord } from '../types';
import type { LocalTrack } from '../../library/importFiles';
import { formatTime } from '../../library/importFiles';
import { audioAnalysisQueue, audioTaskActive } from './queue';
import { audioCacheMatches, saveAudioCorrection, type AudioRecord } from './repository';
import type { AudioAnalysisKind, AudioTask, BpmResult, KeyResult } from './types';

const tonics = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const prettyKey = (tonic: string, mode: string) => `${tonic.replace('#', '♯').replace('b', '♭')} ${mode}`;
const keySelect = (tonic?: string) => ({ Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#' }[tonic || ''] || tonic || '');
const statusNames = { queued: 'Waiting', decoding: 'Decoding', analyzing: 'Analyzing', cancelling: 'Cancelling', saving: 'Saving', complete: 'Complete', failed: 'Failed', cancelled: 'Cancelled' };

function AudioCard({ kind, input, record, corrections, savedTask, blocked }: {
  kind: AudioAnalysisKind; input?: AnalysisInput; record?: AudioRecord; corrections?: AnalysisCorrections; savedTask?: AudioTask; blocked?: string;
}) {
  const trackId = input?.track.id || record?.trackId || savedTask?.trackId || '';
  const live = useSyncExternalStore(audioAnalysisQueue.subscribe, () => audioAnalysisQueue.get(trackId, kind));
  const interrupted = !live && audioTaskActive(savedTask);
  const task = live || savedTask, active = audioTaskActive(live);
  const [editing, setEditing] = useState(false), [number, setNumber] = useState(''), [tonic, setTonic] = useState(''), [mode, setMode] = useState('');
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const originalBpm = kind === 'bpm' && record?.result.outcome === 'estimated' ? (record.result as BpmResult).raw?.bpm : undefined;
  const originalKey = kind === 'key' && record?.result.outcome === 'estimated' ? (record.result as KeyResult).raw : undefined;
  const correction = corrections?.[kind];
  const effectiveBpm = corrections?.bpm?.value ?? originalBpm;
  const effectiveKey = corrections?.key || originalKey;
  const version = input?.versions.audio?.[trackId] || '';
  const stale = !!(record && input && !audioCacheMatches(record, input, kind));
  const correct = async (value: AnalysisCorrections[AudioAnalysisKind] | undefined) => {
    if (!input) return;
    setSaving(true); setError('');
    try { await saveAudioCorrection(trackId, kind, value); setEditing(false); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'The correction could not be saved.'); }
    finally { setSaving(false); }
  };
  const multiply = (factor: .5 | 2) => {
    if (effectiveBpm === undefined || effectiveBpm * factor < 1 || effectiveBpm * factor > 1000) return;
    void correct({ value: effectiveBpm * factor, source: factor === .5 ? 'half' : 'double', sourceVersion: version, updatedAt: Date.now() });
  };
  return <section className='analysis-audio-card' aria-label={t("{0} analysis", kind === 'bpm' ? 'BPM' : 'Key')}>
    <div className='analysis-audio-card-heading'><h3>{kind === 'bpm' ? t("BPM") : t("Key")}</h3><span className='analysis-status'>
      {interrupted ? t("Interrupted") : task ? t(statusNames[task.status]) : record ? t("Complete") : t("Not analyzed")}</span></div>
    <div className='analysis-audio-value'>{kind === 'bpm' ? effectiveBpm?.toFixed(1) || (record ? 'Unable to determine reliably' : 'Not analyzed')
      : effectiveKey ? prettyKey(effectiveKey.tonic, effectiveKey.mode) : record ? t("Unable to determine reliably") : t("Not analyzed")}</div>
    <p className='analysis-audio-label'>{correction ? t("User correction") : kind === 'bpm' ? t("Estimated tempo · BPM") : t("Estimated full-track key")}</p>
    {correction && <p>{t("Algorithm original:")}{' '}{kind === 'bpm' ? originalBpm?.toFixed(1) || t("Unable to determine reliably")
      : originalKey ? prettyKey(originalKey.tonic, originalKey.mode) : t("Unable to determine reliably")}</p>}
    {kind === 'bpm' && record && (record.result as BpmResult).raw?.confidence !== undefined && <p>{t("Beat confidence (raw score):")}{(record.result as BpmResult).raw!.confidence!.toFixed(3)}</p>}
    {kind === 'key' && (record?.result as KeyResult | undefined)?.raw && <p>{t("Key-profile match strength:")}{(record!.result as KeyResult).raw!.strength.toFixed(3)}</p>}
    {record?.result.reason && <p className='analysis-notice'>{record.result.reason}</p>}
    <div className='analysis-audio-actions'>
      <button disabled={!input || !!blocked || active} onClick={() => input && audioAnalysisQueue.enqueue(input, kind)}>{t("Analyze")}{' '}{kind === 'bpm' ? t("BPM") : t("Key")}</button>
      {record && <button disabled={!input || !!blocked || active} onClick={() => input && audioAnalysisQueue.enqueue(input, kind, true)}>{t("Force reanalyze")}</button>}
      {active && !['saving', 'cancelling'].includes(live!.status) && <button onClick={() => audioAnalysisQueue.cancel(trackId, kind)}>{t("Cancel")}</button>}
    </div>
    {(task || interrupted) && <p role={task?.status === 'failed' ? 'alert' : 'status'} className='analysis-notice'>{interrupted ? t("The previous task was interrupted when the player closed. Run it again to continue.") : t(task?.message || '')}</p>}
    {blocked && <p className='analysis-warning'>{blocked}</p>}
    {(stale || correction && correction.sourceVersion !== version) && <p className='analysis-warning'>{t("The audio or analysis parameters changed. Review the saved result and corrections, or analyze again.")}</p>}
    <div className='analysis-audio-corrections'>
      {kind === 'bpm' && <><button disabled={effectiveBpm === undefined || saving} onClick={() => multiply(.5)}>÷2</button><button disabled={effectiveBpm === undefined || saving} onClick={() => multiply(2)}>×2</button></>}
      <button disabled={!input || saving} onClick={() => {
        setError(''); setNumber(effectiveBpm?.toFixed(1) || ''); setTonic(keySelect(effectiveKey?.tonic)); setMode(effectiveKey?.mode || ''); setEditing(true);
      }}>{t("Edit")}{' '}{kind === 'bpm' ? t("BPM") : t("Key")}</button>
      <button disabled={!correction || saving} onClick={() => void correct(undefined)}>{t("Reset to original")}</button>
    </div>
    {error && !editing && <p role='alert' className='analysis-warning'>{t(error)}</p>}
    {record && <details className='analysis-provenance'><summary>{t("Analysis details")}</summary><dl>
      <dt>{t("Algorithm")}</dt><dd>{record.algorithm.name} {t("· Essentia.js")}{' '}{record.algorithm.version} {t("· Essentia")}{' '}{record.result.engineVersion}</dd>
      <dt>{t("Scope")}</dt><dd>{t("Full track ·")}{' '}{formatTime(record.result.range.start)}–{formatTime(record.result.range.end)}</dd>
      <dt>{t("Audio")}</dt><dd>{record.result.range.sourceChannels} {t("channels · decoded")}{' '}{record.result.range.decodedSampleRate.toLocaleString('en')} {t("Hz → mono")}{' '}{record.result.range.analysisSampleRate.toLocaleString('en')} {t("Hz")}</dd>
      <dt>{t("Resampling")}</dt><dd>{record.result.range.resampler} · {record.result.range.decodedFrames} → {record.result.range.analysisFrames} {t("frames")}</dd>
      {kind === 'bpm' && <><dt>{t("Beat positions")}</dt><dd>{(record.result as BpmResult).raw?.ticks.length ?? 0} {t("detected beats saved in seconds")}</dd></>}
      <dt>{t("Parameters")}</dt><dd>{Object.entries(record.settings).map(([key, value]) => `${key}: ${value}`).join(' · ')}</dd>
      <dt>{t("Analyzed")}</dt><dd>{new Date(record.analyzedAt).toLocaleString()}</dd>
    </dl></details>}
    <Modal title={t("Edit {0}", kind === 'bpm' ? 'BPM' : 'Key')} open={editing} onCancel={() => !saving && setEditing(false)} footer={null}>
      <form className='analysis-correction-form' onSubmit={event => {
        event.preventDefault();
        if (kind === 'bpm') {
          const value = Number(number);
          if (!number.trim() || !Number.isFinite(value) || value < 1 || value > 1000) { setError('Enter a BPM between 1 and 1000.'); return; }
          void correct({ value, source: 'manual', sourceVersion: version, updatedAt: Date.now() });
        } else {
          if (!tonics.includes(tonic) || !['major', 'minor'].includes(mode)) { setError('Choose a tonic and a major or minor mode.'); return; }
          void correct({ tonic, mode: mode as 'major' | 'minor', sourceVersion: version, updatedAt: Date.now() });
        }
      }}>
        {kind === 'bpm' ? <label>{t("BPM")}<input aria-label={t("Manual BPM")} type='number' min='1' max='1000' step='0.1' value={number} onChange={event => setNumber(event.target.value)} /></label>
          : <><div className='app-select-field'>{t("Tonic")}<AppSelect label={t("Manual tonic")} value={tonic} onChange={setTonic} options={[{ value: '', label: t("Choose tonic") }, ...tonics.map(value => ({ value, label: value.replace('#', '♯') }))]} /></div>
            <div className='app-select-field'>{t("Mode")}<AppSelect label={t("Manual mode")} value={mode} onChange={setMode} options={[{ value: '', label: t("Choose mode") }, { value: 'major', label: t("Major") }, { value: 'minor', label: t("Minor") }]} /></div></>}
        {error && <p role='alert'>{t(error)}</p>}<button className='white-button' disabled={saving} type='submit'>{saving ? t("Saving…") : t("Save correction")}</button>
      </form>
    </Modal>
  </section>;
}

export function AudioAnalysis({ track, input, records, corrections, tasks = [], blocked, children }: {
  track: LocalTrack; input?: AnalysisInput; records?: AnyAnalysisRecord[]; corrections?: AnalysisCorrections; tasks?: AudioTask[]; blocked?: string; children?: ReactNode;
}) {
  const bpm = records?.find(record => record.kind === 'bpm'), key = records?.find(record => record.kind === 'key');
  const latest = [bpm, key].filter(record => record && input && record.input.audio?.[track.id] === input.versions.audio?.[track.id])
    .sort((a, b) => b!.analyzedAt - a!.analyzedAt)[0];
  const metadata = latest?.result.sourceMetadata || track.analysisMetadata;
  const tags = metadata?.tags;
  return <section className='analysis-section analysis-audio-section' aria-label={t("Audio analysis")}>
    <div className='analysis-section-heading'><div><h2>{t("Audio analysis")}</h2></div>
      <button disabled={!input || !!blocked} onClick={() => { if (input) { audioAnalysisQueue.enqueue(input, 'bpm'); audioAnalysisQueue.enqueue(input, 'key'); } }}>{t("Analyze BPM & Key")}</button></div>
    <div className='analysis-audio-grid'>{(['bpm', 'key'] as const).map(kind => <AudioCard key={kind} kind={kind} input={input} record={kind === 'bpm' ? bpm : key}
      corrections={corrections} savedTask={tasks.find(task => task.kind === kind)} blocked={blocked} />)}</div>
    <details className='analysis-provenance'><summary>{t("Embedded file tags")}</summary>
      {tags ? <dl><dt>{t("BPM tag")}</dt><dd>{tags.bpm ?? t("Not tagged")}</dd><dt>{t("Key tag")}</dt><dd>{tags.key || t("Not tagged")}</dd>
        <dt>{t("ReplayGain Track Gain")}</dt><dd>{tags.trackGainDb === undefined ? t("Not tagged") : t("{0} dB", tags.trackGainDb)}</dd>
        <dt>{t("ReplayGain Album Gain")}</dt><dd>{tags.albumGainDb === undefined ? t("Not tagged") : t("{0} dB", tags.albumGainDb)}</dd>
        <dt>{t("Track / Album peak tags")}</dt><dd>{tags.trackPeak ?? t("Not tagged")} / {tags.albumPeak ?? t("Not tagged")} {t("(linear)")}</dd></dl>
        : <p>{t("Tags from older library records will be read when you analyze the audio.")}</p>}
      <p>{t("Source: existing file tags. These values are separate from this player's analysis and do not change playback gain.")}</p>
    </details>
    {children}
    <footer className='analysis-credit'><span>{t("BPM & Key · ")}</span><a href='https://essentia.upf.edu/' target='_blank' rel='noopener noreferrer'>{t("Powered by Essentia")}</a></footer>
  </section>;
}
