import { t } from '../../i18n';
import { StudioSelect } from './StudioSelect';
import { Fragment, useEffect, useRef, useState, type RefObject } from 'react';
import { AppDropdown } from '../Menu';
import { editText, msText, splitUnit, uid, vocalLine, type StudioProject, type VocalLine } from '../../studio/project';
import { assignPerformer, deleteLine, mergeLine, splitLine } from '../../studio/operations';
import { lineBounds, type ProjectIssue } from '../../studio/validation';
import { StudioTimeInput } from './StudioTimeInput';
import { StudioSyncTime } from './StudioSyncTime';
import { StudioIcon } from './StudioIcon';
import { clearSync, setBoundary, LYRIC_START, LYRIC_END } from '../../studio/sync';
import { getLocalPlayer } from '../../player/runtime';
import { StudioWordEditor } from './StudioWordEditor';
import { useProjectPlayback } from '../../studio/useProjectPlayback';
import { useLyricFollow } from '../../lyrics/useLyricFollow';

interface Props {
  advanced?: boolean;
  draft: StudioProject; duration: number; issues: ProjectIssue[]; canListen: boolean;
  commit: (change: (draft: StudioProject) => StudioProject, group?: string) => void;
  select: (id: string) => void; listen: (id: string) => void; onError: (message: string) => void;
  region: RefObject<HTMLDivElement | null>; selectedIds: string[]; setSelectedIds: (ids: string[]) => void;
}
export function StudioProjectRows({ draft, duration, issues, commit, select, listen, canListen, region, onError, selectedIds, setSelectedIds, advanced = true }: Props) {
  const ranges = useRef(new Map<string, [number, number]>());
  const [expanded, setExpanded] = useState<string[]>([]);
  const [backgrounds, setBackgrounds] = useState<string[]>([]);
  const [wordPanelOpen, setWordPanelOpen] = useState(true);
  useEffect(() => { if (issues.some(issue => issue.unitId && issue.lineId === draft.selectedId)) setWordPanelOpen(true); }, [issues, draft.selectedId]);
  const { gaps, focusId } = useProjectPlayback(draft, duration, canListen, region);
  const follow = useLyricFollow(focusId || draft.selectedId, `${draft.settings.mode}:${advanced}`, true, draft.trackId);
  const previousSelection = useRef(draft.selectedId);
  useEffect(() => {
    const previous = previousSelection.current; previousSelection.current = draft.selectedId;
    if (previous === draft.selectedId) return;
    // Loading a different project resumes following; ordinary editing does not.
    if (!draft.lines.some(line => line.id === previous)) { follow.resume(); return; }
    follow.browse();
    const root = region.current, row = root?.querySelector<HTMLElement>(`[data-line-id="${CSS.escape(draft.selectedId)}"]`);
    if (!root || !row || row.contains(document.activeElement)) return;
    const box = row.getBoundingClientRect(), viewport = root.getBoundingClientRect();
    const delta = box.top < viewport.top + 48 ? box.top - viewport.top - 48 : box.bottom > viewport.bottom ? box.bottom - viewport.bottom : 0;
    if (delta) root.scrollBy({ top: delta, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }, [draft.selectedId, region]);
  const patchLine = (line: VocalLine, fn: (l: VocalLine) => VocalLine, group?: string) => commit(p => ({ ...p, lines: p.lines.map(l => l.id === line.id ? fn(l) : l) }), group);
  const rows = (line: VocalLine, index: number) => {
    const errors = issues.filter(i => i.lineId === line.id && i.severity === 'error'), selected = draft.selectedId === line.id;
    const b = lineBounds(draft, line, duration * 1000), section = draft.sections.find(s => s.lineIds.includes(line.id));
    return <Fragment key={line.id}>
      {gaps.has(line.id) && <div className='studio-interlude' data-gap-id={line.id} data-interlude-id={`gap:${line.id}`} aria-label={t("Studio instrumental break")}>♪</div>}
      {section?.lineIds[0] === line.id && <div className='studio-section-label'>#{section.tag}</div>}
      <div className='studio-row studio-sync-row' data-line-id={line.id} data-selected={selected || undefined} data-error={!!errors.length || undefined} data-background={line.role === 'background' || undefined} onFocusCapture={e => { if (!(e.target instanceof Element && e.target.closest("button"))) select(line.id); }} onClick={e => { if (e.shiftKey) { const at = draft.lines.findIndex(l => l.id === draft.selectedId); setSelectedIds(draft.lines.slice(Math.min(at, index), Math.max(at, index) + 1).map(l => l.id)); } select(line.id); }}>
        <button className='studio-sync-clear' aria-label={t(line.role === 'background' ? "Remove background line {0}" : "Clear sync line {0}", index + 1)} title={t(line.role === 'background' ? "Remove line" : "Clear sync")} onClick={e => { e.stopPropagation(); commit(p => line.role === 'background' ? deleteLine(p, line.id) : clearSync(p, line.id)); }}><StudioIcon kind='close' /></button>
        <StudioSyncTime label={t("Start time line {0}", index + 1)} value={line.startMs} invalid={errors.some(i => i.field === 'start')} change={startMs => patchLine(line, l => ({ ...l, startMs }), `${line.id}:start`)} />
        <button className='studio-sync-listen' aria-label={t("Listen to line {0}", index + 1)} disabled={!canListen || b.start === null} onClick={() => listen(line.id)}><StudioIcon kind='play' /></button>
        <textarea className='studio-line-text' data-field='text' ref={node => { if (node) { node.style.height = 'auto'; node.style.height = `${node.scrollHeight}px`; } }} aria-label={t("Lyrics line {0}", index + 1)} rows={1} value={line.text} maxLength={20000} placeholder={line.role === 'background' ? t("Background vocal…") : t("Write a lyric line…")}
          onSelect={e => ranges.current.set(line.id, [e.currentTarget.selectionStart, e.currentTarget.selectionEnd])}
          onChange={e => patchLine(line, l => editText(l, e.target.value, draft.settings.split), `${line.id}:text`)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); const at = e.currentTarget.selectionStart; commit(p => splitLine(p, line.id, at)); } }} />
        <div className='studio-row-actions' onClick={e => e.stopPropagation()}>
          <button className='studio-annotation-toggle' aria-label={t("Translation / romanization line {0}", index + 1)} aria-expanded={expanded.includes(line.id)} aria-controls={`annotations-${line.id}`} title={t("Translation / romanization")} onClick={() => setExpanded(v => v.includes(line.id) ? v.filter(id => id !== line.id) : [...v, line.id])}>{t("Translation")}{line.annotations.some(a => a.text) && <span aria-hidden='true'> ·</span>}</button>
          <AppDropdown trigger={['click']} menu={{ items: [{ key: 'annotations', label: t("Translation / romanization") }, { key: 'add', label: t("Add line below") }, { key: 'split', label: t("Split at cursor") }, { key: 'merge', label: t("Merge with next") }, { key: 'up', label: t("Move line up"), disabled: index === 0 || line.role === 'background' }, { key: 'remove', label: t("Remove line"), danger: true }], onClick: ({ key }) => {
            if (key === 'annotations') { setExpanded(v => v.includes(line.id) ? v : [...v, line.id]); return; }
            if (key === 'split') { commit(p => splitLine(p, line.id, ranges.current.get(line.id)?.[0] ?? line.text.length)); return; }
            if (key === 'merge') { commit(p => mergeLine(p, line.id)); return; }
            if (key === 'remove') { commit(p => deleteLine(p, line.id)); return; }
            if (key === 'up') { commit(p => { const lines = [...p.lines], before = lines.slice(0, index).reverse().find(l => l.role === 'lead'); if (!before) return p; const moving = lines.filter(l => l.id === line.id || l.parentId === line.id), rest = lines.filter(l => !moving.includes(l)); rest.splice(rest.indexOf(before), 0, ...moving); return { ...p, lines: rest, sections: p.sections.map(s => ({ ...s, lineIds: rest.filter(l => s.lineIds.includes(l.id)).map(l => l.id) })) }; }); return; }
            if (draft.lines.length >= 5000) { onError('Use at most 5,000 lines.'); return; }
            commit(p => { const added = vocalLine('', line.role, line.parentId), lines = [...p.lines]; lines.splice(index + 1, 0, added); return { ...p, lines, selectedId: added.id }; });
          } }}><button aria-label={t("Actions for line {0}", index + 1)}>⋯</button></AppDropdown>
        </div>
        {selected && <label className='studio-sync-end'>{t("End")}<StudioTimeInput field='end' label={t("End time line {0}", index + 1)} value={line.endMs} placeholder={msText(b.end) || t("Auto")} invalid={errors.some(i => i.field === 'end')} onChange={endMs => patchLine(line, l => ({ ...l, endMs }), `${line.id}:end`)} /></label>}
        {advanced && (selected || selectedIds.includes(line.id) || line.role === 'background') && <div className='studio-line-options' onClick={e => e.stopPropagation()}>
          <label><input type='checkbox' aria-label={t("Batch select line {0}", index + 1)} checked={selectedIds.includes(line.id)} onChange={e => setSelectedIds(e.target.checked ? [...selectedIds, line.id] : selectedIds.filter(id => id !== line.id))} />{t("Select")}</label>
          <StudioSelect aria-label={t("Performer line {0}", index + 1)} value={line.performerId || ''} onValueChange={value => commit(p => assignPerformer(p, [line.id], value || undefined))}><option value=''>{t("No Performer")}</option>{draft.performers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</StudioSelect>
          {line.role === 'lead' && <button onClick={() => { if (draft.lines.length >= 5000) return; const bg = vocalLine('', 'background', line.id); commit(p => ({ ...p, lines: [...p.lines.slice(0, index + 1), bg, ...p.lines.slice(index + 1)], selectedId: bg.id })); setBackgrounds(v => v.includes(line.id) ? v : [...v, line.id]); }}>{t("＋ Background vocal")}</button>}
        </div>}
        {!!errors.length && <p className='studio-row-error'>{errors.filter(i => !i.unitId).map(i => t(i.message)).join(' ')}</p>}
      </div>
      {advanced && selected && draft.settings.mode === 'word' && <details className='studio-detail studio-word-panel' open={wordPanelOpen}>
        <summary onClick={e => { e.preventDefault(); e.currentTarget.focus({ preventScroll: true }); setWordPanelOpen(value => !value); }}><span>{t("Word timing")}</span><span>{t(wordPanelOpen ? "Collapse" : "Expand")}</span></summary>
        <div className='studio-word-panel-body'>
        <button onClick={() => { const range = ranges.current.get(line.id); if (!range || range[0] === range[1]) { onError('Select a phrase in the lyric text first.'); return; } try { let updated = line; for (const at of [range[1], range[0]]) { let offset = 0; for (const w of updated.units) { if (at > offset && at < offset + w.text.length) { updated = splitUnit(updated, w.id, at - offset); break; } offset += w.text.length; } } patchLine(line, () => updated); } catch (e) { onError((e as Error).message); } }}>{t("Create boundaries from text selection")}</button>
        <StudioWordEditor key={line.id} project={draft} line={line} commit={commit} onError={onError} canListen={canListen} issues={issues} />
      </div></details>}
      {expanded.includes(line.id) && <div id={`annotations-${line.id}`} className='studio-detail studio-annotations'>
        <div className='studio-annotation-heading'><strong>{t(line.role === 'background' ? "Background translation / romanization" : "Translation / romanization")}</strong><button onClick={() => setExpanded(v => v.filter(id => id !== line.id))}>{t("Hide details")}</button></div>
        {(['translation', 'romanization'] as const).map(kind => { const a = line.annotations.find(a => a.kind === kind); const set = (value: { text?: string; language?: string }) => patchLine(line, l => ({ ...l, annotations: a ? l.annotations.map(item => item.id === a.id ? { ...item, ...value } : item) : [...l.annotations, { id: uid('a'), targetId: line.id, kind, language: '', text: '', ...value }] }), `${line.id}:${kind}`); return <div key={kind}><label>{t(kind)}<input aria-label={t("{0} line {1}", kind, index + 1)} value={a?.text || ''} onChange={e => set({ text: e.target.value })} /></label><label>{t("Language")}<input aria-label={t("{0} language line {1}", kind, index + 1)} placeholder={t("BCP-47, e.g. zh-Hans")} value={a?.language || ''} onChange={e => set({ language: e.target.value })} /></label></div>; })}
        {line.annotations.filter((a, i, all) => all.findIndex(v => v.kind === a.kind) !== i).map(a => <label key={a.id}>{t(a.kind)} · {a.language}<input value={a.text} aria-label={t("Additional annotation {0}", a.id)} onChange={e => patchLine(line, l => ({ ...l, annotations: l.annotations.map(v => v.id === a.id ? { ...v, text: e.target.value } : v) }))} /></label>)}
        <button onClick={() => patchLine(line, l => ({ ...l, startMs: null, endMs: null, units: l.units.map(w => ({ ...w, startMs: null, endMs: null })) }))}>{t("Re-record line")}</button>
      </div>}
    </Fragment>;
  };
  const boundary = (id: string, label: string) => {
    const value = (id === LYRIC_START ? draft.boundaries?.startMs : draft.boundaries?.endMs) ?? null;
    return <div className='studio-row studio-sync-row studio-boundary' data-line-id={id} data-selected={draft.selectedId === id || undefined} onFocusCapture={e => { if (!(e.target instanceof Element && e.target.closest("button"))) select(id); }} onClick={() => select(id)}>
      <button className='studio-sync-clear' title={t("Clear sync")} aria-label={t("Clear {0}", label)} onClick={() => commit(p => clearSync(p, id))}><StudioIcon kind='close' /></button>
      <StudioSyncTime value={value} label={label} invalid={issues.some(i => i.lineId === id)} change={v => commit(p => setBoundary(p, id, v))} />
      <button className='studio-sync-listen' aria-label={t("Listen to {0}", label)} disabled={!canListen || value === null} onClick={() => { getLocalPlayer().seek(value! / 1000); getLocalPlayer().play(); }}><StudioIcon kind='play' /></button>
      <button className='studio-boundary-label' aria-pressed={draft.selectedId === id} onClick={() => select(id)}>{label}</button>
    </div>;
  };
  return <div className='studio-editor-panel'><div className='studio-editor-caption'><span>{t("Lyrics & timing")}</span>{canListen && <button aria-pressed={follow.following} onClick={follow.following ? follow.browse : follow.resume}>{t(follow.following ? "Following playback" : "Follow playback")}</button>}</div><div className='studio-rows' ref={node => { region.current = node; follow.viewport.current = node; }} role='region' aria-label={t("Lyric editor")}
    onWheel={follow.browse} onTouchStart={follow.browse} onPointerDown={follow.browse}
    onFocusCapture={e => { if ((e.target as HTMLElement).matches('input, textarea, [role="combobox"]')) follow.browse(); }}>
    <div className='studio-editor-lines'>
    {draft.lines.filter(l => l.role === 'lead').map(line => <Fragment key={line.id}>{rows(line, draft.lines.indexOf(line))}
      {draft.lines.some(l => l.parentId === line.id) && <details className='studio-backgrounds' open={backgrounds.includes(line.id) || draft.lines.some(l => l.parentId === line.id && l.id === draft.selectedId)}><summary onClick={e => { e.preventDefault(); const selectedChild = draft.lines.some(l => l.parentId === line.id && l.id === draft.selectedId); const open = backgrounds.includes(line.id) || selectedChild; setBackgrounds(v => open ? v.filter(id => id !== line.id) : [...v, line.id]); if (open && selectedChild) select(line.id); }}>{t("Background vocals (")}{draft.lines.filter(l => l.parentId === line.id).length})</summary>{draft.lines.filter(l => l.parentId === line.id).map(bg => rows(bg, draft.lines.indexOf(bg)))}</details>}
    </Fragment>)}
    {boundary(LYRIC_END, t('End of Lyric'))}
    <button className='studio-add-line' disabled={draft.lines.length >= 5000} onClick={() => commit(p => { const line = vocalLine(); return { ...p, lines: [...p.lines, line], selectedId: line.id }; })}>{t("＋ Add line")}</button>
    </div>
  </div>{!follow.following && <button className='studio-follow-button studio-sync-resume' onClick={follow.resume}>{t("Back to sync")}</button>}</div>;
}
