import { t } from '../../i18n';
import { StudioSelect } from './StudioSelect';
import { useState } from 'react';
import { complete, mergeUnits, splitUnit, tokenize, type StudioProject, type VocalLine } from '../../studio/project';
import { StudioTimeInput } from './StudioTimeInput';
import { getLocalPlayer } from '../../player/runtime';
import type { ProjectIssue } from '../../studio/validation';
import { editWordTime } from '../../studio/recordWord';

export function StudioWordEditor({ project, line, commit, onError, canListen, issues }: { project: StudioProject; line: VocalLine; commit: (fn: (p: StudioProject) => StudioProject, group?: string) => void; onError: (s: string) => void; canListen: boolean; issues: ProjectIssue[] }) {
  const [selection, setSelection] = useState<string[]>([]), [splitAt, setSplitAt] = useState(1);
  const selected = line.units.find(w => w.id === project.selectedUnitId) || line.units.find(w => w.kind === 'word');
  const patch = (fn: (line: VocalLine) => VocalLine, group?: string) => { try { commit(p => ({ ...p, lines: p.lines.map(l => l.id === line.id ? fn(l) : l) }), group); } catch (e) { onError((e as Error).message); } };
  return <div className='studio-word-editor' aria-label={t("Word timing editor")}>
    <div className='studio-word-heading'><span>{t("{0} / {1} words synced", line.units.filter(w => w.kind === 'word' && complete(w)).length, line.units.filter(w => w.kind === 'word').length)}</span></div>
    <div className='studio-fragments' aria-label={t("Lyric fragments")}>{line.units.map(w => w.kind === 'separator' ? <span key={w.id} className='studio-literal'>{w.text}</span> : <button key={w.id} data-unit-id={w.id} className='studio-fragment' data-selected={selected?.id === w.id || undefined} data-pending={!complete(w) || undefined} data-multi={selection.includes(w.id) || undefined}
      aria-label={t("Select fragment {0}", w.text)} title={t("{0} · Shift-click selects a phrase; double-click auditions", complete(w) ? 'Timed' : 'Pending')} onClick={e => {
        if (e.shiftKey) { const at = line.units.findIndex(v => v.id === selected?.id), to = line.units.indexOf(w); setSelection(line.units.slice(Math.min(at, to), Math.max(at, to) + 1).filter(w => w.kind === 'word').map(w => w.id)); }
        else setSelection([w.id]);
        commit(p => ({ ...p, selectedUnitId: w.id }), 'word-selection');
      }} onDoubleClick={() => { if (canListen && w.startMs !== null) { getLocalPlayer().seek(w.startMs / 1000); getLocalPlayer().play(); } }}>{w.text}<small>{complete(w) ? '✓' : t("Pending")}</small></button>)}</div>
    <div className='studio-detail-tools'>
      <div className='studio-field'>{t("Split mode")}<StudioSelect aria-label={t("Split mode")} value={project.settings.split} onValueChange={value => commit(p => ({ ...p, settings: { ...p.settings, split: value as StudioProject['settings']['split'] } }))}>
        <option value='auto'>{t("Automatic")}</option><option value='word'>{t("Words")}</option><option value='character'>{t("Characters")}</option><option value='manual'>{t("Manual")}</option>
      </StudioSelect></div>
      <button onClick={() => { if (line.units.some(complete) && !window.confirm('Re-splitting this line clears its word timings. Undo restores them. Continue?')) return; patch(l => ({ ...l, units: tokenize(l.text, project.settings.split) })); }}>{t("Split text")}</button>
      <button disabled={selection.length < 2} onClick={() => patch(l => mergeUnits(l, selection))}>{t("Merge selected fragments")}</button>
    </div>
    {selected && <div className='studio-word-controls'>
      <strong>{selected.text}</strong><span className='studio-pending'>{complete(selected) ? t("Timed") : t("Pending")}</span>
      <label>{t("Start")}<StudioTimeInput label={t("Word start time")} value={selected.startMs} onChange={startMs => patch(l => editWordTime(l, selected.id, { startMs }), `${selected.id}:start`)} /></label>
      <label>{t("End")}<StudioTimeInput label={t("Word end time")} value={selected.endMs} onChange={endMs => patch(l => editWordTime(l, selected.id, { endMs }), `${selected.id}:end`)} /></label>
      <div className='studio-field'>{t("Performer")}<StudioSelect aria-label={t("Word Performer")} value={selected.performerId || ''} onValueChange={value => { const performerId = value || undefined; patch(l => ({ ...l, units: l.units.map(w => (selection.length ? selection : [selected.id]).includes(w.id) ? { ...w, performerId } : w) })); }}>
        <option value=''>{t("Use line Performer")}</option>{project.performers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</StudioSelect></div>
      <button disabled={!canListen || selected.startMs === null} onClick={() => { getLocalPlayer().seek(selected.startMs! / 1000); getLocalPlayer().play(); }}>{t("Listen to word")}</button>
      <button onClick={() => patch(l => ({ ...l, units: l.units.map(w => w.id === selected.id ? { ...w, startMs: null, endMs: null } : w) }))}>{t("Re-record word")}</button>
      <label>{t("Split after character")}<input aria-label={t("Syllable split position")} type='number' min={1} value={splitAt} onChange={e => setSplitAt(Number(e.target.value))} /></label>
      <button onClick={() => { const parts = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(selected.text)]; const at = parts.slice(0, splitAt).map(p => p.segment).join('').length; patch(l => splitUnit(l, selected.id, at)); }}>{t("Split syllable")}</button>
    </div>}
    {issues.filter(i => i.unitId && i.lineId === line.id).map((i, n) => <button key={n} className='studio-row-error' onClick={() => commit(p => ({ ...p, selectedUnitId: i.unitId }), 'word-selection')}>{t(i.message)}</button>)}
  </div>;
}
