import { uiActions } from '../../store/slices/offlineUi';
import { t } from '../../i18n';
import { clearSync, syncDestination, LYRIC_START, LYRIC_END } from '../../studio/sync';
import { StudioSelect } from './StudioSelect';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Popover } from 'antd';
import { Link } from 'react-router-dom';
import { AppMenu } from '../AppMenu';
import { AppDropdown } from '../Menu';
import { TrackInfo } from '../LocalTracks/TrackInfo';
import { StudioPaste } from './StudioInput';
import { StudioProjectRows } from './StudioProjectRows';
import { StudioTransport } from './StudioTransport';
import { StudioInspector } from './StudioInspector';
import { StudioLivePreview } from './StudioLivePreview';
import { AUDIO_ACCEPT, isAudioFileName, trackCover } from '../../library/importFiles';
import { getLocalAudioElement, getLocalPlayer, importStudioAudio, playLocalTrack, restoreAudioFile, writeLocalLyricsCopy } from '../../player/runtime';
import { store, useAppSelector } from '../../store/store';
import { readLyrics } from '../../lyrics/repository';
import { importProjectLrc } from '../../studio/projectImportLrc';
import { useSavedLyrics } from '../../lyrics/useSavedLyrics';
import { subscribeAudioClock } from '../../lyrics/audioClock';
import { useStudioDraft } from '../../studio/useStudioDraft';
import { useWordRecording } from '../../studio/useWordRecording';
import { newProject, parseProject, shiftProject, STRUCTURES, uid, vocalLine, type StudioProject, type Section } from '../../studio/project';
import { importProjectTtml } from '../../studio/projectImport';
import { exportName, exportProjectLrc, exportProjectTtml, type LrcPolicy } from '../../studio/projectExport';
import { lineBounds, validateProject, type ProjectIssue, type TtmlMode } from '../../studio/validation';

type ExportFormat = 'word' | 'line' | 'lrc' | 'both';
interface Download { name: string; url: string }
export function StudioWorkspace({ trackId, changeTrack, seed }: { trackId: string; changeTrack: (id: string, seed?: StudioProject) => void; seed?: StudioProject }) {
  const track = useAppSelector(state => state.library.tracks.find(item => item.id === trackId));
  const audioName = track?.fileName || track?.name || seed?.audioName || '';
  const edit = useStudioDraft(trackId, audioName, seed), { draft, commit, select } = edit;
  const savedLyrics = useSavedLyrics(track?.id, track?.embeddedLyricsChecked), autoImport = useRef(false), initialMetadata = useRef(false);
  const duration = useAppSelector(s => s.player.currentId === trackId ? s.player.duration : 0), currentId = useAppSelector(s => s.player.currentId);
  const canUseAudio = currentId === trackId && duration > 0 && !track?.unavailable;
  const [writeCopy, setWriteCopy] = useState(false), [exportError, setExportError] = useState('');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [paste, setPaste] = useState(false), [infoOpen, setInfoOpen] = useState(false);
  const [preview, setPreview] = useState<StudioProject>(), [downloads, setDownloads] = useState<Download[]>([]), [exportOpen, setExportOpen] = useState<ExportFormat>();
  const [validation, setValidation] = useState<TtmlMode>(), [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [target, setTarget] = useState<'player' | 'amll'>('player'), [lrcPolicy, setLrcPolicy] = useState<LrcPolicy>({ voices: 'lead', annotations: 'omit' });
  const [shiftOpen, setShiftOpen] = useState(false), [shift, setShift] = useState('0'), [scope, setScope] = useState<'all' | 'line' | 'word'>('all');
  const [loop, setLoop] = useState(false);
  const [surface, setSurface] = useState<'lrc' | 'ttml'>('lrc');
  const timingMode = surface === 'lrc' ? 'line' : draft?.settings.mode || 'line';
  const region = useRef<HTMLDivElement>(null), audioInput = useRef<HTMLInputElement>(null), lyricInput = useRef<HTMLInputElement>(null), projectInput = useRef<HTMLInputElement>(null), urls = useRef<string[]>([]);
  const closeDownloads = () => {
    const released = new Set(downloads.map(file => file.url));
    released.forEach(url => URL.revokeObjectURL(url));
    urls.current = urls.current.filter(url => !released.has(url)); setDownloads([]);
  };
  const recording = useWordRecording(edit, canUseAudio, paste || !!preview || !!exportOpen || !!downloads.length || infoOpen || shiftOpen, setMessage, timingMode);
  useEffect(() => () => urls.current.forEach(url => URL.revokeObjectURL(url)), []);
  useEffect(() => { if (track && !track.unavailable && getLocalPlayer().getState().currentId !== track.id) { playLocalTrack(track.id); getLocalPlayer().pause(); } }, [track?.id, track?.unavailable]);
  useEffect(() => {
    if (!draft || initialMetadata.current || !track) return; initialMetadata.current = true;
    if (!draft.metadataInitialized && !draft.metadata.title && !draft.metadata.artist && !draft.metadata.album && !edit.canUndo) commit(p => ({ ...p, metadataInitialized: true, metadata: { ...p.metadata, title: track.name || '', artist: track.artist || '', album: track.album || '' } }));
  }, [draft, track]);
  const importSaved = (saved: NonNullable<typeof savedLyrics.saved>) => {
    const p = saved.document.format === 'ttml' ? importProjectTtml(saved.source, trackId, saved.fileName) : importProjectLrc(saved.source, trackId, audioName);
    return saved.offsetMs ? shiftProject(p, saved.offsetMs, 'all') : p;
  };
  useEffect(() => {
    if (autoImport.current || !draft || !track) return;
    if (draft.lines.some(l => l.text || l.startMs !== null || l.endMs !== null)) { autoImport.current = true; return; }
    if (savedLyrics.loading || savedLyrics.error || !savedLyrics.saved && !track.embeddedLyricsChecked) return;
    autoImport.current = true;
    if (savedLyrics.saved) { try { const p = importSaved(savedLyrics.saved); if (p.source?.notices.length) setPreview(p); else commit(v => ({ ...p, audioName, metadata: { ...v.metadata, ...p.metadata, title: p.metadata.title || v.metadata.title } })); } catch (e) { setMessage((e as Error).message); } }
  }, [draft, track, savedLyrics.loading, savedLyrics.error, savedLyrics.saved]);
  useEffect(() => {
    if (!loop || !canUseAudio || !draft) return;
    const line = draft.lines.find(l => l.id === draft.selectedId); if (!line) return;
    const b = lineBounds(draft, line, duration * 1000); if (b.start === null || b.end === null) return;
    return subscribeAudioClock(clock => { const audio = getLocalAudioElement(); if (!audio.paused && clock.time * 1000 >= b.end!) getLocalPlayer().seek(Math.max(0, b.start! - draft.settings.preRollMs) / 1000); });
  }, [loop, canUseAudio, draft?.selectedId, draft?.lines, draft?.settings.preRollMs, duration]);
  const focusIssue = (issue: ProjectIssue) => {
    if (issue.unitId || issue.sectionId) setSurface('ttml');
    if (issue.lineId) { select(issue.lineId); if (issue.unitId) commit(p => ({ ...p, selectedUnitId: issue.unitId, settings: { ...p.settings, mode: 'word' } }), 'word-selection'); }
    requestAnimationFrame(() => {
      const element = issue.sectionId ? document.querySelector<HTMLElement>(`[data-section-id="${CSS.escape(issue.sectionId)}"]`) : region.current?.querySelector<HTMLElement>(`[data-line-id="${CSS.escape(issue.lineId || '')}"]`);
      const details = element?.closest('details'); if (details) details.open = true;
      element?.scrollIntoView({ block: 'nearest' });
    });
  };
  const issues = useMemo(() => draft && validation ? validateProject(draft, Math.round(duration * 1000), validation) : [], [draft, duration, validation]);
  const chooseAudio = async (file?: File) => {
    if (!file || busy) return; if (edit.error) { setMessage('Save or export your project before changing audio.'); return; }
    if (!isAudioFileName(file.name) || !file.size) { setMessage('Choose a supported local audio file.'); return; }
    setBusy(true);
    try {
      const restoring = track?.unavailable && file.name === (track.fileName || track.name) && file.size === (track.originalSize ?? track.size);
      const id = restoring ? await restoreAudioFile(track!.id, file) ? track!.id : undefined : await importStudioAudio(file);
      if (id) { getLocalPlayer().pause(); changeTrack(id, trackId === 'untitled' ? edit.current.current : undefined); }
      else setMessage('Audio could not be saved.');
    } finally { setBusy(false); }

  };
  const importFile = async (file?: File) => {
    if (!file || busy) return; setBusy(true);
    try {
      if (file.size > 8_000_000) throw new Error('File exceeds 8 MB.');
      const bytes = new Uint8Array(await file.arrayBuffer()), encoding = bytes[0] === 255 && bytes[1] === 254 ? 'utf-16le' : bytes[0] === 254 && bytes[1] === 255 ? 'utf-16be' : 'utf-8';
      const source = new TextDecoder(encoding, { fatal: true }).decode(bytes);
      const imported = /\.json$/i.test(file.name) ? parseProject(source) : /\.(ttml|amll)$/i.test(file.name) ? importProjectTtml(source, trackId, file.name) : importProjectLrc(source, trackId, audioName);
      setPreview(imported); if (/\.(ttml|amll|json)$/i.test(file.name)) setSurface('ttml');
    } catch (e) { setMessage((e as Error).message); } finally { setBusy(false); }
  };
  const download = (file: Download) => { const a = document.createElement('a'); a.href = file.url; a.download = file.name; document.body.append(a); a.click(); a.remove(); };
  const makeFile = (name: string, source: string, type: string) => { const url = URL.createObjectURL(new Blob([source], { type })); urls.current.push(url); return { name, url }; };
  const exportFiles = async (format: ExportFormat, confirmed = false) => {
    const p = edit.current.current; if (!p) return;
    const mode = format === 'both' ? p.settings.mode : format === 'word' ? 'word' : 'line';
    setValidation(mode);
    const check = validateProject(p, Math.round(duration * 1000), mode), errors = check.filter(i => i.severity === 'error');
    if (errors.length) { focusIssue(errors[0]); setExportOpen(undefined); return; }
    if (!confirmed) { setExportError(''); setExportOpen(format); return; }
    setBusy(true);
    try {
      if (writeCopy) {
        const source = format === 'lrc' ? exportProjectLrc(p, Math.round(duration * 1000), lrcPolicy) : exportProjectTtml(p, Math.round(duration * 1000), mode, target);
        const blob = await writeLocalLyricsCopy(trackId, source), url = URL.createObjectURL(blob);
        urls.current.push(url); setDownloads([{ name: audioName, url }]); setExportOpen(undefined); setValidation(undefined);
        setMessage('Lyrics written to the saved audio copy. The original file is unchanged.');
        return;
      }
      const name = exportName(audioName || p.audioName), files: Download[] = [];
      if (format !== 'lrc') files.push(makeFile(`${name}.ttml`, exportProjectTtml(p, Math.round(duration * 1000), mode, target), 'application/ttml+xml;charset=utf-8'));
      if (format === 'lrc' || format === 'both') files.push(makeFile(`${name}.lrc`, exportProjectLrc(p, Math.round(duration * 1000), lrcPolicy), 'text/plain;charset=utf-8'));
      setDownloads(files); setExportOpen(undefined); setValidation(undefined); files.forEach(download);
    } catch (e) { setMessage((e as Error).message); setExportError((e as Error).message); } finally { setBusy(false); }
  };
  const listen = (id: string) => { const p = edit.current.current, line = p?.lines.find(l => l.id === id); if (!p || !line) return; const b = lineBounds(p, line, duration * 1000); if (b.start !== null) { getLocalPlayer().seek(Math.max(0, b.start - p.settings.preRollMs) / 1000); getLocalPlayer().play(); } };
  const selectedLine = draft?.lines.find(l => l.id === draft.selectedId);
  const selectedWord = selectedLine?.units.find(w => w.id === draft?.selectedUnitId) || selectedLine?.units.find(w => w.kind === 'word');
  const destinationId = draft ? syncDestination(draft, 1) : undefined;
  const destination = destinationId === LYRIC_END ? t('End of Lyric') : draft?.lines.find(l => l.id === destinationId)?.text || t('Add lyrics to begin');
  return <div className='offline-app studio-page' data-local-file-drop data-studio-format={surface} onDragOver={e => { e.preventDefault(); e.stopPropagation(); }} onDrop={e => { e.preventDefault(); e.stopPropagation(); const file = e.dataTransfer.files[0]; if (file) /\.(ttml|amll|lrc|json)$/i.test(file.name) ? void importFile(file) : void chooseAudio(file); }}>
    <header className='studio-header'><div className='studio-brand'><AppMenu /><div className='studio-heading'><h1>{t("Lyric Studio")}</h1></div></div>
      <div className='studio-song' aria-label={t("Studio song")}>{track ? <><img src={trackCover(track)} alt='' /><div><strong>{track.name}</strong><span>{track.artist || t("Local audio")}</span></div><button className='studio-song-info' onClick={() => setInfoOpen(true)} aria-label={t("Track info")}>ⓘ</button></> : <button onClick={() => audioInput.current?.click()}>{t("Choose audio")}</button>}</div>
      <div className='studio-header-actions'><button onClick={() => store.dispatch(uiActions.setSettingsOpen(true))}>{t('Settings')}</button><Link to='/'>{t("Back to player")}</Link><AppDropdown trigger={['click']} menu={{ items: [{ key: 'lrc', label: t("Write LRC to song copy") }, { key: 'word', label: t("Write word TTML to song copy") }, { key: 'line', label: t("Write line TTML to song copy") }], onClick: ({ key }) => { setWriteCopy(true); void exportFiles(key as ExportFormat); } }}><button title={t("Save lyrics inside the library audio copy")} disabled={!draft || busy || !track || track.unavailable}>{t("Write to song ▾")}</button></AppDropdown><AppDropdown trigger={['click']} menu={{ items: [{ key: 'word', label: t("Export word TTML") }, { key: 'line', label: t("Export line TTML") }, { key: 'lrc', label: t("Export LRC") }, { key: 'both', label: t("Export both") }], onClick: ({ key }) => { setWriteCopy(false); void exportFiles(key as ExportFormat); } }}><button className='white-button' disabled={!draft || busy}>{t("Export ▾")}</button></AppDropdown></div>
      <input hidden type='file' ref={audioInput} accept={AUDIO_ACCEPT} aria-label={t("Choose studio audio")} onChange={e => { void chooseAudio(e.target.files?.[0]); e.target.value = ''; }} />
      <input hidden type='file' ref={lyricInput} accept='.lrc,.ttml,.amll' aria-label={t("Choose studio lyrics")} onChange={e => { void importFile(e.target.files?.[0]); e.target.value = ''; }} />
      <input hidden type='file' ref={projectInput} accept='.json' aria-label={t("Choose studio project")} onChange={e => { void importFile(e.target.files?.[0]); e.target.value = ''; }} />
    </header>
    <main className='studio-main' aria-label={t("Lyric Studio")}>
      <div className='studio-format-bar'><div className='studio-format-tabs' role='group' aria-label={t("Studio format")}>
        <button aria-pressed={surface === 'lrc'} onClick={() => { recording.cancel(); setSurface('lrc'); }}>{t("LRC")}</button>
        <button aria-pressed={surface === 'ttml'} onClick={() => { recording.cancel(); setSurface('ttml'); }}>{t("TTML Studio")}</button>
      </div><span className='studio-save-status' role='status'>{t(edit.status)}</span></div>
      <div className='studio-tools'><div><button disabled={!draft} onClick={() => setPaste(true)}>{t("Paste lyrics")}</button><button disabled={!draft} onClick={() => lyricInput.current?.click()}>{t("Import LRC / TTML")}</button>
        <button disabled={!draft} onClick={() => audioInput.current?.click()}>{t("Choose audio")}</button>
        <AppDropdown trigger={['click']} menu={{ items: [{ key: 'load', label: t("Load song lyrics"), disabled: !track }, { key: 'save', label: t("Save project file") }, { key: 'restore', label: t("Restore project") }, { type: 'divider' }, { key: 'clear', label: t("Clear project"), danger: true }], onClick: async ({ key }) => {
          if (key === 'load') { try { const saved = await readLyrics(trackId); if (saved) setPreview(importSaved(saved)); else setMessage('No saved song lyrics.'); } catch (e) { setMessage((e as Error).message); } }
          if (key === 'save' && draft) download(makeFile(`${exportName(audioName || draft.audioName)}.lyric-studio.json`, JSON.stringify(draft, null, 2), 'application/json;charset=utf-8'));
          if (key === 'restore') projectInput.current?.click();
          if (key === 'clear') { recording.cancel(); autoImport.current = true; commit(p => newProject(p.trackId, p.audioName)); setSelectedIds([]); }
        } }}><button disabled={!draft}>{t("Project ▾")}</button></AppDropdown>
      </div></div>
      <div className='studio-sync-tools'>
        {surface === 'ttml' && <div className='studio-mode'>{t("Timing")}<StudioSelect aria-label={t("Timing mode")} value={timingMode} onValueChange={value => { recording.cancel(); commit(p => ({ ...p, settings: { ...p.settings, mode: value as TtmlMode } })); }}><option value='line'>{t("Line by line")}</option><option value='word'>{t("Word by word")}</option></StudioSelect></div>}
        {timingMode === 'word' ? <button className='white-button studio-mark' disabled={!canUseAudio} onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); recording.begin(); }} onPointerUp={() => recording.end()} onPointerCancel={recording.cancel}>{recording.recording ? t("Recording… release to finish") : t("Hold to record word · T")}</button> : <button className='white-button studio-mark' disabled={!canUseAudio} onClick={() => recording.markLine(1)}>{t("Mark next line ↓")}</button>}
        <button disabled={!draft} onClick={() => { recording.cancel(); commit(p => clearSync(p)); setValidation(undefined); }}>{t("Clear sync")}</button>
        <button disabled={!edit.canUndo} onClick={() => { recording.cancel(); edit.undo(); }}>{t("Undo")}</button><button disabled={!edit.canRedo} onClick={() => { recording.cancel(); edit.redo(); }}>{t("Redo")}</button>
        <Popover title={t("Shift timing")} trigger='click' open={shiftOpen} onOpenChange={setShiftOpen} content={<div className='studio-shift'><StudioSelect aria-label={t("Shift scope")} value={scope} onValueChange={value => setScope(value as typeof scope)}><option value='all'>{t("Whole song")}</option><option value='line'>{t("Selected lines")}</option><option value='word'>{t("Current word")}</option></StudioSelect><label>{t("Seconds")}<input type='number' step='.001' aria-label={t("Shift all times in seconds")} value={shift} onChange={e => setShift(e.target.value)} /></label><button onClick={() => { try { if (!shift.trim()) throw new Error('Enter an offset.'); commit(p => shiftProject(p, Math.round(Number(shift) * 1000), scope, selectedIds)); setShiftOpen(false); } catch (e) { setMessage((e as Error).message); } }}>{t("Apply shift")}</button></div>}><button>{t("Shift timing")}</button></Popover>
      </div>
      {timingMode === 'word' && recording.voices.length > 1 && <div className='studio-voice-recorders' role='group' aria-label={t('Parallel voice recording')}>
        {recording.voices.slice(0, 9).map((voice, index) => {
          const name = draft?.performers.find(performer => performer.id === voice.performerId)?.name || t('No Performer');
          const label = `${name} / ${t(voice.role === 'background' ? 'Background vocals' : 'Lead')}${voice.layer ? ` ${voice.layer + 1}` : ''}`;
          const active = voice.words.some(word => recording.activeWordIds.includes(word.unitId));
          return <button key={voice.id} data-voice-key={index + 1} aria-label={t('Record voice {0}', label)} aria-pressed={active} disabled={!canUseAudio || voice.completed}
            onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); recording.begin(`pointer:${voice.id}`, voice.id); }}
            onPointerUp={() => recording.end(`pointer:${voice.id}`)} onPointerCancel={recording.cancel}>
            <kbd>{index + 1}</kbd><span className='studio-voice-name'>{label}</span>
            <strong className='studio-voice-next' data-voice-next={index + 1} title={voice.lineText}>{voice.completed ? t('Voice complete') : voice.wordText || t('Select a singing fragment first.')}</strong>
            <span className='studio-voice-state'>{t(active ? 'Recording… release to finish' : voice.completed ? 'Select a fragment to restart' : 'Next word')}</span>
          </button>;
        })}
        <small>{t('Hold 1-9 to record voices independently; T records the selected voice.')}</small>
      </div>}
      <div className='studio-sync-context' title={timingMode === 'word' ? selectedWord?.text : destination}><span>{t(timingMode === 'word' ? "Recording target" : "Next ↓")}</span><strong>{timingMode === 'word' ? selectedWord?.text || t('Select a singing fragment first.') : destination}</strong></div>
      <div className='studio-audition-tools studio-sync-tools' role='group' aria-label={t("Audition tools")}><span className='studio-tool-label'>{t("Audition")}</span>
        <label><input type='checkbox' aria-label={t("Loop current line")} checked={loop} onChange={e => setLoop(e.target.checked)} />{t("Loop line")}</label><button disabled={!canUseAudio} onClick={() => draft && listen(draft.selectedId)}>{t("Listen to current line")}</button>
        <div className='studio-field'>{t("Pre-roll")}<StudioSelect aria-label={t("Pre-roll")} value={draft?.settings.preRollMs || 0} onValueChange={value => commit(p => ({ ...p, settings: { ...p.settings, preRollMs: Number(value) } }))}>{[0, 500, 800, 1500, 2000].map(n => <option key={n} value={n}>{n / 1000}{t("s")}</option>)}</StudioSelect></div>
        {timingMode === 'word' && <label><input type='checkbox' aria-label={t("Word arrow shortcuts")} checked={draft?.settings.wordArrowKeys === true} onChange={e => commit(p => ({ ...p, settings: { ...p.settings, wordArrowKeys: e.target.checked } }))} />{t("← / → word sync")}</label>}
      </div>
      <details className='studio-help-disclosure'><summary>{t("Shortcuts & timing help")}</summary><p className='studio-help'>{t("↑ / ↓ move to the previous / next line and record its start. After Clear sync the first press records the first line. Hold T to record a word; optionally use → to hold/release and ← to select the previous word. End of Lyric records the end boundary. Ctrl+Z / Ctrl+Shift+Z undo / redo. Shortcuts pause while editing text. Times follow the original audio timeline at every playback speed. Automatic line ends use the next start or audio end; adjust them to preserve pauses.")}</p></details>
      {edit.error && <p className='studio-warning' role='alert'>{t(edit.error)}<button onClick={edit.retry}>{t("Retry draft save")}</button></p>}
      {savedLyrics.error && <p className='studio-warning'>{t(savedLyrics.error)}<button onClick={savedLyrics.reload}>{t("Retry song lyrics")}</button></p>}
      {message && <p className='studio-message' role='status'>{t(message)}</p>}
      {!!issues.filter(i => i.severity === 'error').length && <div className='studio-warning studio-issues' role='alert'><strong>{t("Export needs attention")}</strong>{issues.filter(i => i.severity === 'error').map((i, n) => <button key={n} onClick={() => focusIssue(i)}>{i.lineId === LYRIC_START ? t("Start of the Lyric") + ": " : i.lineId === LYRIC_END ? t("End of Lyric") + ": " : i.lineId ? t("Line {0}: ", draft!.lines.findIndex(l => l.id === i.lineId) + 1) : ''}{i.unitId ? `${draft!.lines.flatMap(l => l.units).find(w => w.id === i.unitId)?.text} — ` : ''}{t(i.message)}</button>)}{validation === 'word' && <button onClick={() => exportFiles('line')}>{t("Use line TTML instead")}</button>}</div>}
      {draft ? <>{surface === 'ttml' && <StudioInspector project={draft} commit={commit} selectedIds={selectedIds} />}<div className='studio-editor-layout'><StudioProjectRows recordingWordIds={recording.activeWordIds} syncTarget={recording.syncTarget} clearSyncTarget={recording.clearSyncTarget} advanced={surface === 'ttml'} draft={draft} duration={duration} issues={issues} commit={commit} select={select} listen={listen} canListen={canUseAudio} region={region} onError={setMessage} selectedIds={selectedIds} setSelectedIds={setSelectedIds} />{surface === 'ttml' && draft.settings.preview && <StudioLivePreview syncTarget={recording.syncTarget} recordingWordIds={recording.activeWordIds} project={draft} durationMs={Math.round(duration * 1000)} enabled={canUseAudio} />}</div></> : <div className='studio-empty'>{t("Loading your draft…")}</div>}
    </main>
    <StudioTransport trackId={trackId} />
    {infoOpen && track && <TrackInfo track={track} close={() => setInfoOpen(false)} chooseAudio={() => { setInfoOpen(false); audioInput.current?.click(); }} />}
    {paste && <StudioPaste close={() => setPaste(false)} apply={(rows, append) => {
      commit(p => { const lines: StudioProject['lines'] = [], sections: Section[] = []; let current: Section | undefined;
        for (const row of rows) { const tag = row.text.trim().replace(/^#/, '').toUpperCase() as Section['tag']; if (row.text.trim().startsWith('#') && STRUCTURES.includes(tag)) { current = { id: uid('s'), tag, lineIds: [], startMs: null, endMs: null }; sections.push(current); } else { const line = vocalLine(row.text); lines.push(line); current?.lineIds.push(line.id); } }
        const retain = append && p.lines.some(l => l.text || l.startMs !== null); if (lines.length + (retain ? p.lines.length : 0) > 5000) throw new Error('Use at most 5,000 lines.');
        return { ...p, lines: [...(retain ? p.lines : []), ...lines], sections: [...(retain ? p.sections : []), ...sections], boundaries: retain ? p.boundaries : { startMs: null, endMs: null }, selectedId: retain ? lines[0]?.id || '' : LYRIC_START }; }); setPaste(false); setValidation(undefined);
    }} />}
    <Modal open={!!preview} title={t("Import into Lyric Studio")} onCancel={() => setPreview(undefined)} footer={null}><p>{preview?.lines.length} {t("vocal lines. Supported word times, Performers, background vocals and annotations are retained. Undo restores your current project.")}</p>{preview?.source?.notices.map((n, i) => <p key={i}>{n}</p>)}<p className='studio-import-sample'>{preview?.lines.slice(0, 3).map(l => l.text).join('\n')}</p><button className='white-button' onClick={() => { if (preview) commit(p => ({ ...preview, trackId: p.trackId, audioName: p.audioName || preview.audioName })); setPreview(undefined); setValidation(undefined); setSelectedIds([]); autoImport.current = true; }}>{t("Use imported project")}</button></Modal>
    <Modal open={!!exportOpen} title={t(writeCopy ? "Write to saved audio copy" : "Export compatibility")} onCancel={() => setExportOpen(undefined)} footer={null}>
      {exportError && <p className='studio-warning' role='alert'>{t(exportError)}</p>}
      {writeCopy && <p>{t("Writes lyrics into the player's saved FLAC, MP3 or WAV copy. The original file is unchanged. You can download the updated audio after saving.")}</p>}
      {exportOpen !== 'lrc' && <>{draft?.boundaries && <p>{t('Export title markers use localMusic TTML metadata; other players may ignore them.')}</p>}<div className='studio-field'>{t("TTML target")}<StudioSelect aria-label={t("TTML target")} value={target} onValueChange={value => setTarget(value as typeof target)}><option value='player'>{t("This player · AMLL community vocabulary")}</option><option value='amll'>{t("AMLL 1.0.1 · split Performer phrases / background lines")}</option></StudioSelect></div><p>{t("This player retains inline Performers and layered vocals. AMLL conversion splits them into independent paragraphs; background roles become ordinary vocal lines and annotations stay on the first phrase. Whitespace normalization in AMLL is outside this editor. Apple official delivery and other players are unverified.")}</p></>}
      {issues.filter(i => i.severity === 'warning').map((i, n) => <p key={n}>{t(i.message)}</p>)}
      {(exportOpen === 'lrc' || exportOpen === 'both') && <><p>{t("LRC stores line starts. Word ends, Performer IDs, section tags, vocal roles and overlap endings are simplified; the full project is unchanged. Choose how to handle vocals and annotations:")}</p><div className='studio-field'>{t("Vocals")}<StudioSelect aria-label={t("LRC vocals")} value={lrcPolicy.voices} onValueChange={value => setLrcPolicy(p => ({ ...p, voices: value as LrcPolicy['voices'] }))}><option value='lead'>{t("Lead lines only")}</option><option value='all'>{t("All vocals as separate timed lines")}</option></StudioSelect></div><div className='studio-field'>{t("Translation / romanization")}<StudioSelect aria-label={t("LRC annotations")} value={lrcPolicy.annotations} onValueChange={value => setLrcPolicy(p => ({ ...p, annotations: value as LrcPolicy['annotations'] }))}><option value='omit'>{t("Omit")}</option><option value='append'>{t("Append to each lyric line")}</option></StudioSelect></div></>}
      <button className='white-button' disabled={busy} onClick={() => exportOpen && void exportFiles(exportOpen, true)}>{t(busy ? 'Saving…' : writeCopy ? 'Write lyrics' : 'Confirm and download')}</button>
    </Modal>
    <Modal open={!!downloads.length} title={t(writeCopy ? 'Audio copy ready' : 'Lyrics ready')} onCancel={closeDownloads} footer={null}><p>{t(writeCopy ? 'Lyrics written to the saved audio copy. The original file is unchanged.' : 'Independent UTF-8 lyric files. Your audio is unchanged.')}</p><div className='studio-downloads'>{downloads.map(file => <a key={file.url} className='white-button' href={file.url} download={file.name}>{t("Download")}{' '}{file.name}</a>)}</div></Modal>
  </div>;
}
