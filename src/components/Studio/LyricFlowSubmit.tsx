import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from 'antd';
import '../../integrations/lyricflow/styles.css';
import { t } from '../../i18n';
import type { LocalTrack } from '../../library/importFiles';
import type { StudioProject } from '../../studio/project';
import { saveStudioDraft } from '../../studio/repository';
import { metadataFingerprint, readPreferences } from '../../integrations/lyricflow/repository';
import { publicRequest, readRevision, resolveRecording } from '../../integrations/lyricflow/client';
import { projectToContentV1 } from '../../integrations/lyricflow/contributionAdapter';
import { contributionRequest, persistUpload, refreshUpload, saveRemoteDraft, submitUpload, uploadOwner } from '../../integrations/lyricflow/contribution';
import { readUploads } from '../../integrations/lyricflow/uploadRepository';
import type { ContentV1, LyricFlowCandidate, LyricFlowRevision } from '../../integrations/lyricflow/types';
import type { Component, ContributionContext, LyricFlowConnectionInfo, LyricFlowUpload, Provenance } from '../../integrations/lyricflow/contributionTypes';

const components: Component[] = ['text', 'sync', 'structure', 'performers'];
const uploadStatus: Record<LyricFlowUpload['step'], string> = { prepared: 'Snapshot saved', creating: 'Creating private draft…', draft: 'Private draft created', saving: 'Saving private draft…', saved: 'Private draft saved', submitting_unknown: 'Submission result not confirmed', pending: 'Submitted, awaiting review', approved: 'Approved', rejected: 'Rejected', conflicted: 'Published lyrics changed; alignment required', withdrawn: 'Withdrawn' };
function ContentPreview({ content }: { content: ContentV1 }) {
  const people = new Map(content.performers.participants.map(person => [person.id, person.name]));
  return <div style={{ maxHeight: 280, overflow: 'auto' }}><table style={{ width: '100%', textAlign: 'left' }}><thead><tr><th>{t('Lyrics')}</th><th>{t('Start / end (ms)')}</th><th>{t('Section / performers')}</th></tr></thead><tbody>
    {[...content.text.lines].sort((a, b) => a.order - b.order).map(line => {
      const timing = content.sync?.timings.find(item => item.lineId === line.lineId), assignment = content.performers.assignments.find(item => item.lineId === line.lineId), offset = content.sync?.reference.offsetMs || 0;
      return <tr key={line.lineId}><td style={{ whiteSpace: 'pre-wrap' }}>{line.text || '—'}</td><td>{timing?.startMs == null ? '—' : timing.startMs + offset} / {timing?.endMs == null ? '—' : timing.endMs + offset}</td><td>{content.structure.find(item => item.lineId === line.lineId)?.section}<br />{assignment?.performerIds.map(id => people.get(id)).join(', ')}{assignment?.ranges?.map((range, index) => <div key={index}>{line.text.slice(range.start, range.end)}: {range.performerIds.map(id => people.get(id)).join(', ')}</div>)}</td></tr>;
    })}
  </tbody></table></div>;
}
function ContentComparison({ baseline, content }: { baseline: ContentV1 | null; content: ContentV1 }) {
  const counts = (value: ContentV1 | null) => [value?.text.lines.length || 0, value?.sync?.timings.filter(line => line.startMs !== null).length || 0, value?.structure.length || 0, value?.performers.assignments.length || 0];
  const before = counts(baseline), after = counts(content);
  return <><table style={{ width: '100%', marginBlock: 12, textAlign: 'left' }}><thead><tr><th>{t('Content')}</th><th>{t('Published version')}</th><th>{t('Submission copy')}</th></tr></thead><tbody>{['Original lines', 'Timed lines', 'Section tags', 'Performer assignments'].map((name, i) => <tr key={name}><th>{t(name)}</th><td>{before[i]}</td><td>{after[i]}</td></tr>)}</tbody></table>
    <details><summary>{t('Compare published and submitted lyrics')}</summary>{baseline && <><h4>{t('Published version')}</h4><ContentPreview content={baseline} /></>}<h4>{t('Submission copy')}</h4><ContentPreview content={content} /></details></>;
}
export function LyricFlowSubmit({ project, track, durationMs, onClose }: { project: StudioProject; track: LocalTrack; durationMs: number | null; onClose: () => void }) {
  const [snapshot] = useState(() => structuredClone(project));
  const [info, setInfo] = useState<LyricFlowConnectionInfo>(), [origin, setOrigin] = useState('');
  const [candidates, setCandidates] = useState<LyricFlowCandidate[]>([]), [target, setTarget] = useState<LyricFlowCandidate>();
  const [baseline, setBaseline] = useState<LyricFlowRevision | null>(null), [selected, setSelected] = useState<Component[]>(snapshot.lyricflow ? ['sync'] : components);
  const [step, setStep] = useState(0), [sameRecording, setSameRecording] = useState(false), [lossesAccepted, setLossesAccepted] = useState(false);
  const [task, setTask] = useState<LyricFlowUpload>(), [previous, setPrevious] = useState<LyricFlowUpload[]>([]);
  const [source, setSource] = useState<Provenance['source'] | ''>(''), [declaration, setDeclaration] = useState(''), [restriction, setRestriction] = useState<Provenance['displayRestriction']>('none');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const alive = useRef(true), running = useRef(false), abort = useRef(new AbortController());
  const report = useMemo(() => target ? projectToContentV1(snapshot, { trackId: target.trackId, durationMs, baseline: baseline?.content, components: selected }) : undefined, [snapshot, target, durationMs, baseline, selected]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; abort.current.abort(); }; }, []);
  const run = async (fn: () => Promise<void>) => {
    if (running.current) return; running.current = true; setBusy(true); setError('');
    try { await fn(); } catch (e) { if (alive.current) { setError((e as Error).message); const saved = await readUploads(track.id).catch(() => []); setPrevious(saved); if (task) setTask(saved.find(item => item.taskId === task.taskId) || task); } }
    finally { running.current = false; if (alive.current) setBusy(false); }
  };
  useEffect(() => {
    let live = true; const controller = new AbortController(); abort.current = controller; setBusy(true);
    void (async () => {
      await saveStudioDraft(snapshot);
      const preferences = await readPreferences(), connection = await window.localMusicDesktop?.lyricflowInfo?.(), saved = await readUploads(track.id);
      if (!live) return;
      setInfo(connection); setPrevious(saved);
      const apiOrigin = preferences.apiOrigin || connection?.apiOrigin;
      if (!apiOrigin) throw new Error('Configure LyricFlow in Settings first.'); setOrigin(apiOrigin);
      const contract = await publicRequest(apiOrigin, 'contract', {}, controller.signal);
      if (!contract.integrations?.lyricPlayer?.oauthContribution) throw new Error('This LyricFlow server has not enabled contributions.');
      const matches = await resolveRecording(apiOrigin, track, controller.signal);
      if (!live) return; setCandidates(matches.candidates);
      if (!matches.candidates.length) setMessage('No corresponding recording was found. Create it on LyricFlow, then return to this local project.');
    })().catch(e => { if (live) setError(e.message); }).finally(() => { if (live) setBusy(false); });
    return () => { live = false; controller.abort(); };
  }, []);
  const choose = (candidate: LyricFlowCandidate) => void run(async () => {
    const revision = candidate.revisionId ? await readRevision(origin, candidate, abort.current.signal) : null;
    if (!alive.current) return; setTarget(candidate); setBaseline(revision); setSameRecording(false); setLossesAccepted(false); setTask(undefined);
  });
  const connectedOwner = async () => {
    const connection = await window.localMusicDesktop?.lyricflowInfo();
    if (!connection || connection.apiOrigin !== origin) throw new Error('Connect to the same LyricFlow server in Settings first.'); setInfo(connection); return uploadOwner(connection);
  };
  const prepare = () => void run(async () => {
    if (!target || !report || !sameRecording || report.blockingIssues.length || report.losses.length && !lossesAccepted) return;
    const owner = await connectedOwner();
    const context = await contributionRequest<ContributionContext>(owner, 'context', { id: target.trackId });
    if (context.trackId !== target.trackId || !context.documentId || !context.canCreateDraft || !context.canSubmit) throw new Error('This recording is not available for contribution. Open LyricFlow to check it.');
    if (context.currentRevisionId !== (baseline?.id || null) || target.documentId && target.documentId !== context.documentId) throw new Error('Published lyrics changed. Select the recording again to review the new baseline.');
    if (selected.some(component => context.locked.includes(component))) throw new Error('A selected component is protected. Review component permissions on LyricFlow.');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(snapshot)));
    const created: LyricFlowUpload = { ...owner, taskId: crypto.randomUUID(), localTrackId: track.id, apiOrigin: origin, targetTrackId: target.trackId, targetDocumentId: context.documentId,
      audioRevision: track.audioRevision, metadataRevision: track.metadataRevision, metadataFingerprint: metadataFingerprint(track),
      projectSnapshot: snapshot, projectSnapshotHash: [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, '0')).join(''), durationMs,
      baseRevisionId: baseline?.id || null, baseSnapshot: baseline, lineMap: report.lineMap, content: report.content, components: selected,
      step: 'prepared', idempotencyKeys: { create: crypto.randomUUID(), submit: crypto.randomUUID(), withdraw: crypto.randomUUID() }, createBody: { documentId: context.documentId }, updatedAt: Date.now() };
    const persisted = await persistUpload(created); setTask(persisted); setStep(2);
    try { setTask(await saveRemoteDraft(persisted)); }
    catch (e) { setTask((await readUploads(track.id)).find(item => item.taskId === created.taskId) || persisted); throw e; }
  });
  const resume = (value: LyricFlowUpload) => void run(async () => {
    const owner = await connectedOwner();
    if (['issuer', 'sub', 'clientId'].some(key => owner[key as keyof typeof owner] !== value[key as keyof typeof owner]) || value.apiOrigin !== origin) throw new Error('This upload belongs to a different LyricFlow account.');
    setTask(value); setStep(2);
    if (value.submissionId) setTask(await refreshUpload(value));
    else if (value.step !== 'submitting_unknown') setTask(await saveRemoteDraft(value));
  });
  const send = () => void run(async () => {
    if (!task || !source && task.step !== 'submitting_unknown') return;
    try { setTask(await submitUpload(task, source ? { source, declaration, displayRestriction: restriction } : undefined)); }
    catch (e) { setTask((await readUploads(track.id)).find(value => value.taskId === task.taskId) || task); throw e; }
  });
  return <Modal open onCancel={onClose} footer={null} title={t('Submit to LyricFlow')} width={760} destroyOnHidden>
    <div className='lyricflow-submit'>
      <p>{t('Only the frozen project version shown here will be submitted. Your local project remains editable.')}</p>
      <p>{t('Frozen version')}: {new Date((task?.projectSnapshot || snapshot).updatedAt).toLocaleString()}</p>
      <ol aria-label={t('Submission steps')}><li aria-current={step === 0 ? 'step' : undefined}>{t('Select recording')}</li><li aria-current={step === 1 ? 'step' : undefined}>{t('Review content')}</li><li aria-current={step === 2 ? 'step' : undefined}>{t('Source and submission')}</li></ol>
      {step === 0 && <>
        <p>{t('Local recording')}: {track.name} · {track.artist} · {track.album} · {durationMs === null ? '—' : `${durationMs / 1000}s`}</p>
        {candidates.map(candidate => <button key={candidate.trackId} disabled={busy} aria-pressed={target?.trackId === candidate.trackId} onClick={() => choose(candidate)} style={{ display: 'block', width: '100%', textAlign: 'left', marginBlock: 8 }}>{candidate.title} · {candidate.artists.join(', ')} · {candidate.album} · {candidate.durationMs === null ? '—' : `${candidate.durationMs / 1000}s`}<br />{candidate.recordingKind} · {candidate.matchedBy.join(', ')}</button>)}
        {target && <><label><input type='checkbox' checked={sameRecording} onChange={e => setSameRecording(e.target.checked)} />{t('This is the same recording')}</label><p>{t('Published revision')}: {baseline?.id || t('No published lyrics')}</p><button disabled={!sameRecording || busy} onClick={() => setStep(1)}>{t('Continue')}</button></>}
        {previous.length > 0 && <details><summary>{t('Saved upload tasks')}</summary>{previous.map(value => <p key={value.taskId}>{new Date(value.updatedAt).toLocaleString()} · {t(uploadStatus[value.step])} <button disabled={busy} onClick={() => resume(value)}>{t('Resume saved snapshot')}</button></p>)}</details>}
      </>}
      {step === 1 && report && <>
        <label>{t('Contribution content')}<select aria-label={t('Contribution content')} value={selected.length === 1 ? 'sync' : 'all'} onChange={e => { setSelected(e.target.value === 'sync' ? ['sync'] : components); setLossesAccepted(false); }}><option value='all'>{t('Original text, line timing, sections and performers')}</option><option value='sync'>{t('Line timing only; preserve other remote components')}</option></select></label>
        <p>{t('Submitted components')}: {selected.join(', ')} · {report.content.text.lines.length} {t('lines')}</p>
        <p>{t('Current Studio times are submitted with zero additional offset.')}</p>
        {[...report.losses, ...report.warnings, ...report.blockingIssues].map((issue, index) => <p key={index} role={report.blockingIssues.includes(issue) ? 'alert' : undefined}>{t(issue.message)} {issue.lineId ? `(${issue.lineId})` : ''}</p>)}
        <ContentComparison baseline={baseline?.content || null} content={report.content} />
        {report.losses.length > 0 && <label><input type='checkbox' checked={lossesAccepted} onChange={e => setLossesAccepted(e.target.checked)} />{t('I confirm these omissions for this independent line-level copy.')}</label>}
        <div><button disabled={busy} onClick={() => setStep(0)}>{t('Back')}</button><button disabled={busy || !!report.blockingIssues.length || !!report.losses.length && !lossesAccepted} onClick={prepare}>{t('Save private draft for review')}</button></div>
      </>}
      {step === 2 && task && <>
        <p role='status' aria-live='polite'>{t(uploadStatus[task.step])}</p><p>{t('Account')}: {info?.displayName || task.sub}</p>
        <p>{t('Saved version')}: {task.draftVersion || '—'} · {task.savedAt ? new Date(task.savedAt).toLocaleString() : '—'}</p>
        <p>{t('Submitted components')}: {task.components.join(', ')}</p>
        <ContentComparison baseline={task.baseSnapshot?.content || null} content={task.content} />
        {task.step === 'saved' && <>
          <label>{t('Source')}<select aria-label={t('Source')} value={source} onChange={e => setSource(e.target.value as typeof source)}><option value=''>{t('Choose a source')}</option><option value='own_transcription'>{t('Own transcription')}</option><option value='licensed'>{t('Licensed')}</option><option value='public_domain'>{t('Public domain')}</option><option value='unknown'>{t('Unknown')}</option></select></label>
          <label style={{ display: 'block' }}>{t('Source declaration')}<textarea value={declaration} maxLength={2000} onChange={e => setDeclaration(e.target.value)} rows={3} style={{ display: 'block', width: '100%' }} /></label>
          <label>{t('Display restriction')}<select aria-label={t('Display restriction')} value={restriction} onChange={e => setRestriction(e.target.value as typeof restriction)}><option value='none'>{t('None')}</option><option value='attribution_required'>{t('Attribution required')}</option><option value='limited'>{t('Limited; cannot publish')}</option></select></label>
          <button disabled={busy || !source || !declaration.trim() || restriction === 'limited'} onClick={send}>{t('Submit for review')}</button>
        </>}
        {task.step === 'submitting_unknown' && <><p>{t('The submission result is not confirmed. Retry the saved operation.')}</p><button disabled={busy} onClick={send}>{t('Recover submission result')}</button></>}
        {!task.submissionId && !['saved', 'submitting_unknown'].includes(task.step) && <button disabled={busy} onClick={() => resume(task)}>{t('Resume saved snapshot')}</button>}
        {task.submissionId && <><p>{t('Submission ID')}: {task.submissionId}</p><button disabled={busy || !navigator.onLine} onClick={() => void run(async () => setTask(await refreshUpload(task)))}>{t('Refresh status')}</button>{task.step === 'pending' && <button disabled={busy} onClick={() => void run(async () => setTask(await refreshUpload(task, true)))}>{t('Withdraw submission')}</button>}{task.decision != null && <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(task.decision, null, 2)}</pre>}</>}
        <button disabled={busy} onClick={() => { setStep(0); setTask(undefined); }}>{t('Prepare another snapshot')}</button>
      </>}
      {message && <p>{t(message)}</p>}{busy && <p role='status' aria-live='polite'>{t('Working…')}</p>}{error && <p role='alert'>{t(error)}</p>}
      <button disabled={!window.localMusicDesktop?.lyricflowOpenSite} onClick={() => void run(async () => window.localMusicDesktop?.lyricflowOpenSite(target ? { trackId: target.trackId } : {}))}>{t('Open LyricFlow')}</button>
    </div>
  </Modal>;
}
