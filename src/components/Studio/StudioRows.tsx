import { t } from '../../i18n';
import { AppDropdown } from '../Menu';
import { Fragment, useEffect, useRef, type RefObject } from 'react';

import { defaultEnd, newLine, studioTime, type StudioDraft, type StudioIssue } from '../../studio/model';
import { useStudioPlayback } from '../../studio/useStudioPlayback';

interface Props {
  draft: StudioDraft; duration: number; issues: StudioIssue[]; canListen: boolean;
  commit: (change: (draft: StudioDraft) => StudioDraft, group?: string) => void;
  select: (id: string) => void; listen: (id: string) => void;
  onError: (message: string) => void;
  region: RefObject<HTMLDivElement | null>;
}
export function StudioRows({ draft, duration, issues, commit, select, listen, canListen, region, onError }: Props) {
  const inputs = useRef(new Map<string, HTMLTextAreaElement>());
  const playback = useStudioPlayback(draft, duration, canListen);
  const playbackTarget = playback.interlude ? `gap:${playback.interlude}` : playback.activeIds[0];
  useEffect(() => {
    const container = region.current;
    if (!container || !playbackTarget || container.contains(document.activeElement)) return;
    const row = [...container.querySelectorAll<HTMLElement>('[data-playback-id]')].find(element => element.dataset.playbackId === playbackTarget);
    if (row) container.scrollTo({ top: Math.max(0, row.offsetTop - container.clientHeight * .35), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }, [playbackTarget, region]);
  const split = (id: string, insertion = '\n') => {
    const input = inputs.current.get(id);
    const added = insertion.replace(/\r\n?/g, '\n').split('\n').length - 1;
    if (draft.lines.length + added > 5000) { onError('This would exceed 5,000 lyric lines. Split the work into smaller drafts.'); return; }
    let nextId = '';
    commit(previous => {
      const index = previous.lines.findIndex(line => line.id === id), line = previous.lines[index];
      const at = input?.selectionStart ?? line.text.length, until = input?.selectionEnd ?? at;
      const parts = (line.text.slice(0, at) + insertion.replace(/\r\n?/g, '\n') + line.text.slice(until)).split('\n');
      const rows = parts.map((text, n) => ({ ...newLine(text), ...(n === 0 ? { id, start: line.start } : {}), end: n === parts.length - 1 ? line.end : '' }));
      nextId = rows[Math.min(1, rows.length - 1)].id;
      return { ...previous, lines: [...previous.lines.slice(0, index), ...rows, ...previous.lines.slice(index + 1)], selectedId: nextId };
    });
    requestAnimationFrame(() => { const next = inputs.current.get(nextId); next?.focus(); next?.setSelectionRange(0, 0); });
  };
  return <div className='studio-rows' ref={region} role='region' aria-label={t("Lyric editor")}>
    <div className='studio-row-head' aria-hidden='true'><span>#</span><span>{t("Start")}</span><span>{t("Lyrics")}</span><span>{t("End")}</span><span /></div>
    {draft.lines.map((line, index) => {
      const errors = issues.filter(issue => issue.lineId === line.id);
      const end = defaultEnd(draft.lines, index, duration);
      const patch = (key: 'text' | 'start' | 'end', value: string) => commit(previous => ({ ...previous, lines: previous.lines.map(item => item.id === line.id ? { ...item, [key]: value } : item) }), `${line.id}:${key}`);
      return <Fragment key={line.id}>{playback.gaps.has(line.id) && <div className='studio-interlude' data-playback-id={`gap:${line.id}`} data-playing={playback.interlude === line.id || undefined} aria-label={t("Studio instrumental break")}>♪</div>}
      <div className='studio-row' data-line-id={line.id} data-playback-id={line.id} data-playing={playback.activeIds.includes(line.id) || undefined} data-selected={draft.selectedId === line.id || undefined} data-error={!!errors.length || undefined}
        onFocusCapture={() => select(line.id)}>
        <button className='studio-row-number' aria-label={t("Select line {0}", index + 1)} aria-pressed={draft.selectedId === line.id} onClick={() => select(line.id)}>{index + 1}</button>
        <input className='studio-time' data-field='start' aria-label={t("Start time line {0}", index + 1)} placeholder={t("Not marked")} value={line.start} maxLength={16}
          aria-invalid={errors.some(issue => issue.field === 'start')} onChange={event => patch('start', event.target.value)} />
        <textarea className='studio-line-text' data-field='text' ref={node => { if (node) { inputs.current.set(line.id, node); node.style.height = 'auto'; node.style.height = `${node.scrollHeight}px`; } else inputs.current.delete(line.id); }}
          aria-label={t("Lyrics line {0}", index + 1)} rows={1} value={line.text} placeholder={t("Write a lyric line…")} maxLength={20000}
          aria-invalid={errors.some(issue => issue.field === 'text')} onChange={event => patch('text', event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); split(line.id); } }}
          onPaste={event => { const text = event.clipboardData.getData('text'); if (/[\r\n]/.test(text)) { event.preventDefault(); split(line.id, text); } }} />
        <input className='studio-time studio-end' data-field='end' aria-label={t("End time line {0}", index + 1)} value={line.end} maxLength={16}
          placeholder={end === undefined ? t("Auto") : studioTime(end)} title={t("Automatic end: {0}. Leave blank to use the next start time or audio end.", end === undefined ? 'not available yet' : studioTime(end))}
          aria-invalid={errors.some(issue => issue.field === 'end')} onChange={event => patch('end', event.target.value)} />
        <div className='studio-row-actions'>
          <button className='studio-listen' aria-label={t("Listen to line {0}", index + 1)} title={t("Listen from this line")} disabled={!canListen || !line.start.trim()} onClick={() => listen(line.id)}>▶</button>
          <AppDropdown trigger={['click']} destroyOnHidden menu={{ items: [
            { key: 'add', label: t("Add line below"), disabled: draft.lines.length >= 5000 },
            { key: 'split', label: t("Split at cursor"), disabled: draft.lines.length >= 5000 },
            { key: 'merge', label: t("Merge with next"), disabled: index + 1 === draft.lines.length },
            { key: 'remove', label: t("Remove line"), danger: true },
          ], onClick: ({ key }) => {
            if (key === 'split') { split(line.id); return; }
            commit(previous => {
              const rows = [...previous.lines], at = rows.findIndex(item => item.id === line.id);
              let selectedId = line.id;
              if (key === 'add') { const next = newLine(); rows.splice(at + 1, 0, next); selectedId = next.id; }
              if (key === 'remove') { rows.splice(at, 1); selectedId = rows[Math.min(at, rows.length - 1)]?.id || ''; }
              if (key === 'merge' && rows[at + 1]) {
                const next = rows[at + 1], before = rows[at].text;
                rows.splice(at, 2, { ...rows[at], text: `${before}${before && next.text && !/\s$/.test(before) && !/^\s/.test(next.text) ? ' ' : ''}${next.text}`, end: next.end });
              }
              return { ...previous, lines: rows, selectedId };
            });
          } }}><button aria-label={t("Actions for line {0}", index + 1)} title={t("Line actions")}>⋯</button></AppDropdown>
        </div>
        {!!errors.length && <p className='studio-row-error' role='alert'>{errors.map(issue => issue.message).join(' ')}</p>}
      </div></Fragment>;
    })}
    {!draft.lines.length && <p className='studio-empty'>{t("Paste your lyrics or add a line to begin.")}</p>}
    <button className='studio-add-line' disabled={draft.lines.length >= 5000} onClick={() => commit(previous => {
      const line = newLine(); return { ...previous, lines: [...previous.lines, line], selectedId: line.id };
    })}>{t("＋ Add line")}</button>
  </div>;
}
