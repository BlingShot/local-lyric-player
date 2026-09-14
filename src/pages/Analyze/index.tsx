import { t } from '../../i18n';
import { AppSelect } from '../../components/Menu';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '../../store/store';
import { uiActions } from '../../store/slices/offlineUi';
import { trackCover, type LocalTrack } from '../../library/importFiles';
import { useAnalysisData } from '../../analysis/useAnalysisData';
import { AnalysisSection } from '../../analysis/AnalysisSection';
import { LyricsInsightsCards } from '../../analysis/LyricsInsightsCards';
import { LoudnessAnalysis } from '../../analysis/loudness/LoudnessAnalysis';
import { AudioAnalysis } from '../../analysis/audio/AudioAnalysis';
import { staleReasons } from '../../analysis/versions';
import type { LyricsInput } from '../../analysis/types';
import { createDeepSeekAdapter, DEEPSEEK_PROMPT_VERSION } from '../../analysis/deepseek/client';
import { updateDeepSeekConfig, useDeepSeekConfig, useDeepSeekConfigStatus, type DeepSeekConfig } from '../../analysis/deepseek/config';

function TrackAnalysis({ track, tracks }: { track: LocalTrack; tracks: LocalTrack[] }) {
  const dispatch = useAppDispatch(), deepSeek = useDeepSeekConfig();
  const configStatus = useDeepSeekConfigStatus();
  const [languageSaving, setLanguageSaving] = useState(false), [languageError, setLanguageError] = useState('');
  const changeLanguage = async (language: string) => {
    setLanguageSaving(true); setLanguageError('');
    try { await updateDeepSeekConfig({ ...deepSeek, language: language as DeepSeekConfig['language'] }); }
    catch (error) { setLanguageError(error instanceof Error ? error.message : 'Could not save analysis language.'); }
    finally { setLanguageSaving(false); }
  };
  const lyricsAdapter = useMemo(() => deepSeek.apiKey ? createDeepSeekAdapter(deepSeek) : undefined, [deepSeek]);
  const { data, error, refresh } = useAnalysisData(track, tracks);
  const [sourceKind, setSourceKind] = useState<LyricsInput['kind']>();
  const source = data?.sources.lyrics.find(item => item.kind === sourceKind) || data?.sources.lyrics[0];
  const input = data?.sources.input(source), records = data?.saved.records;
  const lyrics = records?.find(record => record.kind === 'lyrics');
  const audioBlocked = track.unavailable ? 'This audio copy is unavailable. Restore the original file from your library before analyzing.' : undefined;
  return <div className='analysis-page'>
    <header className='analysis-header'><img src={trackCover(track)} alt='' /><div><Link to='/collection/tracks'>{t("Back to library")}</Link><p className='analysis-eyebrow'>{t("Analyze")}</p>
      <h1>{track.name}</h1><p>{track.artist || t("Unknown artist")}</p></div></header>
    {error && <p role='alert' className='analysis-warning'>{t(error)} <button onClick={refresh}>{t("Retry")}</button></p>}
    {!data && !error && <p role='status'>{t("Reading local inputs…")}</p>}
    <AnalysisSection kind='lyrics' trackId={track.id} input={error ? undefined : input} record={lyrics}
      adapter={lyricsAdapter} settings={{ model: deepSeek.model, language: deepSeek.language, promptVersion: DEEPSEEK_PROMPT_VERSION, thinking: false }}
      onConfigure={() => dispatch(uiActions.setSettingsOpen(true))}
      blocked={data && !source ? 'No lyrics for this song. Import or edit lyrics in Lyric Studio first.' : undefined}>
      <div className='analysis-source-picker'>{source ? <div className='app-select-field'>{t("Lyric source")}<AppSelect label={t("Lyric source")} value={source.kind} onChange={value => setSourceKind(value as LyricsInput['kind'])} options={data?.sources.lyrics.map(item => ({ value: item.kind, label: t(item.label) })) || []} /></div> : null}
        <div className='app-select-field'>{t("Analysis language")}<AppSelect label={t("Analysis language")} value={deepSeek.language} disabled={!configStatus.ready || languageSaving} onChange={value => void changeLanguage(value)} options={[{ value: 'auto', label: t('Auto detect from lyrics') }, { value: 'en', label: 'English' }, { value: 'zh', label: '简体中文' }]} /></div>
        <Link to={`/studio?trackId=${encodeURIComponent(track.id)}`}>{source ? t("Open lyrics in Studio") : t("Import or edit lyrics")}</Link></div>
      {languageError && <p className='analysis-warning' role='alert'>{t(languageError)}</p>}
      <LyricsInsightsCards key={source?.kind || 'empty'} result={lyrics?.result} source={source} stale={!!(lyrics && input && staleReasons(lyrics.input, input.versions).length)} />
    </AnalysisSection>
    <AudioAnalysis track={track} input={error ? undefined : input} records={records} corrections={data?.saved.corrections} tasks={data?.saved.audioTasks} blocked={audioBlocked}>
    <LoudnessAnalysis track={track} tracks={tracks} input={error ? undefined : input} records={records} tasks={data?.saved.audioTasks} blocked={audioBlocked} />
    </AudioAnalysis>
  </div>;
}

export function AnalyzePage() {
  const { trackId } = useParams();
  const tracks = useAppSelector(state => state.library.tracks), ready = useAppSelector(state => state.library.ready);
  const track = tracks.find(item => item.id === trackId);
  if (!ready) return <div className='analysis-page' role='status'>{t("Opening your local library…")}</div>;
  if (!track) return <div className='analysis-page'><h1>{t("Song unavailable")}</h1><p>{t("This song is no longer in your library. Analysis is linked to its record, not its title.")}</p><Link to='/collection/tracks'>{t("Back to library")}</Link></div>;
  return <TrackAnalysis key={track.id} track={track} tracks={tracks} />;
}
