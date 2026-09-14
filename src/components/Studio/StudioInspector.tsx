import { t } from '../../i18n';
import { StudioSelect } from './StudioSelect';
import { VocalLabelsToggle } from '../Lyrics/VocalLabelsToggle';
import { useState } from 'react';
import { Modal } from 'antd';
import { removePerformer, STRUCTURES, uid, type StudioProject, type Section } from '../../studio/project';
import { assignPerformer } from '../../studio/operations';
import { StudioTimeInput } from './StudioTimeInput';

export function StudioInspector({ project, commit, selectedIds }: { project: StudioProject; commit: (fn: (p: StudioProject) => StudioProject, group?: string) => void; selectedIds: string[] }) {
  const [removeId, setRemoveId] = useState(''), [replacement, setReplacement] = useState('');
  const [tag, setTag] = useState<Section['tag']>('VERSE');
  const ids = selectedIds.length ? selectedIds : [project.selectedId];
  const refs = project.lines.filter(l => l.performerId === removeId || l.units.some(w => w.performerId === removeId));
  return <div className='studio-inspector'>
    <details><summary>{t("Performers (")}{project.performers.length})</summary>
      {project.performers.map((p, index) => <div className='studio-performer' key={p.id}>
        <input aria-label={t("Performer {0} name", index + 1)} value={p.name} onChange={e => commit(v => ({ ...v, performers: v.performers.map(a => a.id === p.id ? { ...a, name: e.target.value } : a) }), `${p.id}:name`)} />
        <StudioSelect aria-label={t("Performer {0} type", index + 1)} value={p.type} onValueChange={value => commit(v => ({ ...v, performers: v.performers.map(a => a.id === p.id ? { ...a, type: value as 'person' | 'group' } : a) }))}><option value='person'>{t("Person")}</option><option value='group'>{t("Group")}</option></StudioSelect>
        <input aria-label={t("Performer {0} color", index + 1)} type='color' value={p.color} onChange={e => commit(v => ({ ...v, performers: v.performers.map(a => a.id === p.id ? { ...a, color: e.target.value } : a) }), `${p.id}:color`)} />
        <StudioSelect aria-label={t("Performer {0} alignment", index + 1)} value={p.align} onValueChange={value => commit(v => ({ ...v, performers: v.performers.map(a => a.id === p.id ? { ...a, align: value as typeof p.align } : a) }))}>{['auto', 'left', 'right', 'center'].map(v => <option key={v} value={v}>{t(v)}</option>)}</StudioSelect>
        <button aria-label={t("Move Performer {0} up", index + 1)} disabled={!index} onClick={() => commit(v => { const performers = [...v.performers]; [performers[index - 1], performers[index]] = [performers[index], performers[index - 1]]; return { ...v, performers }; })}>↑</button>
        <button onClick={() => { setRemoveId(p.id); setReplacement(''); }}>{t("Delete")}{' '}{p.name || t("Performer")}</button>
      </div>)}
      <button onClick={() => commit(p => ({ ...p, performers: [...p.performers, { id: uid('v'), name: `Performer ${p.performers.length + 1}`, type: 'person', color: '#1ed760', align: 'auto' }] }))}>{t("＋ Add Performer")}</button>
      <div className='studio-field'>{t("Assign")}{' '}{ids.length} {t("selected line(s)")}<StudioSelect aria-label={t("Batch Performer")} value='' onValueChange={value => commit(p => assignPerformer(p, ids, value === '__clear' ? undefined : value))}><option value='' disabled>{t("Choose Performer…")}</option><option value='__clear'>{t("Clear association")}</option>{project.performers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</StudioSelect></div>
      <button onClick={() => { const at = project.lines.findIndex(l => l.id === project.selectedId); if (at > 0) commit(p => assignPerformer(p, ids, p.lines[at - 1].performerId)); }}>{t("Use previous line")}</button>
      <div className='studio-field'>{t("Apply current Performer to section")}<StudioSelect aria-label={t("Apply Performer to section")} value='' onValueChange={value => { const section = project.sections.find(s => s.id === value); if (section) commit(p => assignPerformer(p, section.lineIds, p.lines.find(l => l.id === p.selectedId)?.performerId)); }}><option value='' disabled>{t("Choose section…")}</option>{project.sections.map(s => <option key={s.id} value={s.id}>#{s.tag} · {project.lines.find(l => l.id === s.lineIds[0])?.text.slice(0, 22) || t("Instrumental")}</option>)}</StudioSelect></div>
    </details>
    <details><summary>{t("Song structure (")}{project.sections.length})</summary>
      <div className='studio-detail-tools'><StudioSelect aria-label={t("Structure tag")} value={tag} onValueChange={value => setTag(value as Section['tag'])}>{STRUCTURES.map(t => <option key={t} value={t}>#{t}</option>)}</StudioSelect>
        <button onClick={() => commit(p => { const lineIds = p.lines.filter(l => ids.includes(l.id) && l.role === 'lead').map(l => l.id); return { ...p, sections: [...p.sections.map(s => ({ ...s, lineIds: s.lineIds.filter(id => !lineIds.includes(id)) })).filter(s => s.lineIds.length || s.tag === 'INSTRUMENTAL'), { id: uid('s'), tag, lineIds, startMs: null, endMs: null }] }; })}>{t("Section from selected lines")}</button>
        <button onClick={() => commit(p => ({ ...p, sections: [...p.sections, { id: uid('s'), tag: 'INSTRUMENTAL', lineIds: [], startMs: null, endMs: null }] }))}>{t("＋ Instrumental range")}</button></div>
      {project.sections.map(s => <div className='studio-section' key={s.id} data-section-id={s.id}><strong>#{s.tag}</strong><span>{s.lineIds.length ? t("{0} lines", s.lineIds.length) : t("No sung words")}</span>
        <StudioTimeInput label={t("Section {0} start", s.id)} value={s.startMs} placeholder={s.lineIds.length ? t("From lines") : t("Start")} onChange={startMs => commit(p => ({ ...p, sections: p.sections.map(v => v.id === s.id ? { ...v, startMs } : v) }))} />
        <StudioTimeInput label={t("Section {0} end", s.id)} value={s.endMs} placeholder={s.lineIds.length ? t("From lines") : t("End")} onChange={endMs => commit(p => ({ ...p, sections: p.sections.map(v => v.id === s.id ? { ...v, endMs } : v) }))} />
        <button onClick={() => commit(p => ({ ...p, sections: p.sections.filter(v => v.id !== s.id) }))}>{t("Remove section")}</button></div>)}
    </details>
    <details><summary>{t("Metadata & preview")}</summary><div className='studio-metadata'>
      {(['title', 'artist', 'album', 'language'] as const).map(key => <label key={key}>{t(key)}<input aria-label={t("Lyric {0}", key)} value={project.metadata[key]} onChange={e => commit(p => ({ ...p, metadata: { ...p.metadata, [key]: e.target.value } }), `meta:${key}`)} /></label>)}
      {(['preview', 'colors', 'alignment'] as const).map(key => <label key={key}><input type='checkbox' checked={project.settings[key]} onChange={e => commit(p => ({ ...p, settings: { ...p.settings, [key]: e.target.checked } }))} />{t(key)}</label>)}
      <VocalLabelsToggle />
    </div></details>
    <Modal open={!!removeId} title={t("Delete Performer")} onCancel={() => setRemoveId('')} footer={null}>
      <p>{refs.length} {t("lyric lines reference this Performer. Choose a replacement or explicitly clear these associations.")}</p>
      <StudioSelect aria-label={t("Replacement Performer")} value={replacement} onValueChange={value => setReplacement(value)}><option value=''>{t("Clear associations")}</option>{project.performers.filter(p => p.id !== removeId).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</StudioSelect>
      <button className='white-button' onClick={() => { commit(p => removePerformer(p, removeId, replacement || null)); setRemoveId(''); }}>{t("Confirm reassignment and delete")}</button>
    </Modal>
  </div>;
}
