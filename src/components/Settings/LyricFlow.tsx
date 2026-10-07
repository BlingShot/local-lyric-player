import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { t } from '../../i18n';
import { useAppDispatch, useAppSelector } from '../../store/store';
import { uiActions } from '../../store/slices/offlineUi';
import { readLyrics } from '../../lyrics/repository';
import type { SavedLyrics } from '../../lyrics/types';
import { readStudioDraft } from '../../studio/repository';
import type { LocalTrack } from '../../library/importFiles';
import { revisionToStudioProject, revisionToPlayerDocument } from '../../integrations/lyricflow/adapter';
import { normalizeApiOrigin, resolveRecording } from '../../integrations/lyricflow/client';
import { applySource, downloadSource } from '../../integrations/lyricflow/resolve';
import { readPreferences, savePreferences, readLink, saveImportedStudioProject } from '../../integrations/lyricflow/repository';
import type { LyricFlowCandidate, LyricFlowLink, LyricFlowPreferences, LyricFlowSourceV1 } from '../../integrations/lyricflow/types';
import { LyricFlowConnection } from './LyricFlowConnection';

export function LyricFlowSettings() {
  const [preferences, setPreferences] = useState<LyricFlowPreferences>({ enabled: false, apiOrigin: '', siteOrigin: '' });
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [candidates, setCandidates] = useState<LyricFlowCandidate[]>([]), [preview, setPreview] = useState<{ track: LocalTrack; candidate: LyricFlowCandidate; source: LyricFlowSourceV1; before?: SavedLyrics; link?: LyricFlowLink }>();
  const track = useAppSelector(state => state.library.tracks.find(item => item.id === state.player.currentId));
  const controller = useRef<AbortController | null>(null), dispatch = useAppDispatch(), navigate = useNavigate();
  useEffect(() => { let active = true; void readPreferences().then(value => { if (active) { setPreferences(value); setReady(true); } }).catch(error => { if (active) setError(error.message); }); return () => { active = false; controller.current?.abort(); }; }, []);
  useEffect(() => { controller.current?.abort(); setCandidates([]); setPreview(undefined); setNotice(''); setBusy(false); }, [track?.id, track?.audioRevision, track?.metadataRevision]);
  const run = async (action: (signal: AbortSignal) => Promise<void>) => {
    controller.current?.abort(); const request = new AbortController(); controller.current = request; setBusy(true); setError(''); setNotice('');
    try { await action(request.signal); } catch (error) { if (!request.signal.aborted) setError(error instanceof Error ? error.message : 'LyricFlow request failed.'); }
    finally { if (controller.current === request) { controller.current = null; setBusy(false); } }
  };
  const search = () => run(async signal => {
    if (!track) return; setPreview(undefined); setCandidates([]);
    const result = await resolveRecording(preferences.apiOrigin, track, signal); signal.throwIfAborted(); setCandidates(result.candidates);
    setNotice(result.status === 'not_found' ? 'No matching recording found on LyricFlow.' : result.hasMore ? 'More recordings are available. Refine the song metadata or visit LyricFlow to confirm the recording.' : 'Choose the recording after checking artist, album and duration.');
  });
  const choose = (candidate: LyricFlowCandidate) => run(async signal => {
    if (!track) return;
    const [before, link] = await Promise.all([readLyrics(track.id), readLink(normalizeApiOrigin(preferences.apiOrigin), track.id)]); signal.throwIfAborted();
    const source = await downloadSource(preferences.apiOrigin, candidate, signal); signal.throwIfAborted(); setPreview({ track: structuredClone(track), candidate, source, before, link });
  });
  let playbackIssue = '';
  if (preview) { try { if (!track?.duration) throw new Error('Measure the audio duration before applying LyricFlow lyrics.'); revisionToPlayerDocument(preview.source.snapshot, Math.round(track.duration * 1000)); } catch (error) { playbackIssue = (error as Error).message; } }
  return <section className='lyricflow-settings'><h3>LyricFlow</h3>
    <p>{t('Lookup sends the current song title, artist, album, duration and existing recording IDs to LyricFlow. Audio stays on this device.')}</p>
    <label>{t('LyricFlow API origin')}<input type='url' value={preferences.apiOrigin} disabled={!ready || busy} placeholder='https://lyricflow.example' onChange={event => { setPreferences(value => ({ ...value, apiOrigin: event.target.value })); setPreview(undefined); setCandidates([]); }} /></label>
    <label>{t('LyricFlow website origin')}<input type='url' value={preferences.siteOrigin} disabled={!ready || busy} placeholder='https://lyricflow.example' onChange={event => setPreferences(value => ({ ...value, siteOrigin: event.target.value }))} /></label>
    <label><input type='checkbox' checked={preferences.enabled} disabled={!ready || busy} onChange={event => setPreferences(value => ({ ...value, enabled: event.target.checked }))} />{t('Automatically fill missing lyrics from LyricFlow')}</label>
    <button disabled={!ready || busy} onClick={() => void run(async () => { setPreferences(await savePreferences(preferences)); setNotice('LyricFlow preferences saved.'); })}>{t('Save settings')}</button>
    <p>{track?.name || t('Play a song to search LyricFlow.')}</p>
    <button disabled={!ready || busy || !track || !preferences.apiOrigin} onClick={() => void search()}>{t('Find other lyric sources')}</button>
    {candidates.length > 0 && <ul>{candidates.map(candidate => <li key={candidate.trackId}><button disabled={busy || !candidate.revisionId} onClick={() => void choose(candidate)}>{candidate.title} · {candidate.artists.join(', ')} · {candidate.album || '—'} · {candidate.durationMs === null ? '—' : `${(candidate.durationMs / 1000).toFixed(1)}s`} · {t(candidate.lyricsState)}</button></li>)}</ul>}
    {preview && track && <div><p>{t('Published revision')}: {preview.source.revisionId}</p><div className='lyric-translation-preview'>{preview.source.snapshot.content.text.lines.slice().sort((a, b) => a.order - b.order).map(line => <p key={line.lineId} style={{ whiteSpace: 'pre-wrap' }}>{line.text || '\u00a0'}</p>)}</div>
      {preview.link && preview.link.revisionId !== preview.source.revisionId && <p>{t('A new LyricFlow revision is available. Review it before applying.')}</p>}
      {playbackIssue && <p>{t(playbackIssue)}</p>}
      <p>{t('Apply keeps the previous lyric source and its timing offset. The new source starts with zero user offset.')}</p>
      <button disabled={busy || !!playbackIssue} onClick={() => void run(async signal => { await applySource(preview.source, preview.track, preview.candidate.matchedBy, true, preview.before, signal, Promise.resolve(preview.link)); signal.throwIfAborted(); setNotice('LyricFlow lyrics saved for offline playback.'); setPreview(undefined); })}>{t('Confirm recording and apply lyrics')}</button>
      <button disabled={busy} onClick={() => void run(async signal => {
        const project = revisionToStudioProject(preview.source, preview.track.id, preview.track.name), previous = await readStudioDraft(preview.track.id); signal.throwIfAborted();
        await saveImportedStudioProject(project, preview.track, previous, signal); signal.throwIfAborted(); dispatch(uiActions.setSettingsOpen(false)); navigate('/studio?trackId=' + encodeURIComponent(preview.track.id));
      })}>{t('Back up current draft and open in Studio')}</button>
    </div>}
    {notice && <p role='status'>{t(notice)}</p>}{error && <p role='alert'>{t(error)}</p>}
    <LyricFlowConnection />
  </section>;
}
