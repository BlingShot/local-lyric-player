import { t } from '../i18n';
import { useSyncExternalStore, type ReactNode } from 'react';
import { analysisCatalog, localAnalysisAdapters } from './catalog';
import { analysisTasks, analysisTaskKey } from './tasks';
import { saveAnalysisResult } from './repository';
import { staleReasons } from './versions';
import type { AnalysisAdapter, AnalysisInput, AnalysisKind, AnalysisRecord, AnyAnalysisRecord } from './types';

export function AnalysisSection<K extends AnalysisKind>({ kind, trackId, input, record, children, blocked, adapter: providedAdapter, settings = {}, onConfigure }: {
  kind: K; trackId: string; input?: AnalysisInput; record?: AnalysisRecord<K>; children: ReactNode; blocked?: string;
  adapter?: AnalysisAdapter<K>; settings?: AnalysisRecord<K>['settings']; onConfigure?: () => void;
}) {
  const key = analysisTaskKey(trackId, kind), adapter = providedAdapter || localAnalysisAdapters[kind];
  const task = useSyncExternalStore(analysisTasks.subscribe, () => analysisTasks.get(key));
  const catalog = analysisCatalog[kind], active = task.status === 'running' || task.status === 'saving';
  const stale = record && input ? staleReasons(record.input, input.versions) : [];
  return <section className='analysis-section' aria-labelledby={`analysis-${kind}`}>
    <div className='analysis-section-heading'><div><h2 id={`analysis-${kind}`}>{t(catalog.title)}</h2></div>
      <div className='analysis-run'><span className='analysis-status'>{adapter?.execution === 'deepseek' ? t("DeepSeek") : adapter ? t("Configured locally") : catalog.status}</span>
        {onConfigure && <button onClick={onConfigure}>{adapter ? t("Settings") : t("Configure DeepSeek")}</button>}
        <button disabled={!adapter || !input || !!blocked || active} title={blocked || (!adapter ? catalog.note : undefined)} onClick={() => {
          if (adapter && input) void analysisTasks.run(key, adapter, input, settings, record => saveAnalysisResult(record as AnyAnalysisRecord),
            adapter.execution === 'deepseek' ? { provider: 'deepseek' } : undefined);
        }}>{adapter?.execution === 'deepseek' ? record ? t("Analyze again") : t("Analyze lyrics") : record ? t("Run again") : t("Run analysis")}</button>
        {task.status === 'running' && <button onClick={() => analysisTasks.cancel(key)}>{t("Cancel")}</button>}
      </div>
    </div>
    {adapter?.execution === 'deepseek' && <p className='analysis-notice'>{t("Selected lyric text is sent to DeepSeek when you analyze. Results are AI interpretations of lyrics only.")}</p>}
    {blocked && <p className='analysis-notice'>{blocked}</p>}
    {task.message && <p role={task.status === 'error' ? 'alert' : 'status'} className={task.status === 'error' ? 'analysis-warning' : 'analysis-notice'}>{t(task.message)}</p>}
    {task.status === 'running' && task.progress !== undefined && <progress aria-label={t("{0} progress", catalog.title)} value={task.progress} max={1} />}
    {stale.map(message => <p className='analysis-warning' role='status' key={t(message)}>{t(message)} {t("Results are never rerun automatically.")}</p>)}
    {children}
    {record && <details className='analysis-provenance'><summary>{t("Saved analysis details")}</summary><dl>
      <dt>{t("Algorithm")}</dt><dd>{record.algorithm.name} · {record.algorithm.version}</dd>
      {record.algorithm.standard && <><dt>{t("Standard")}</dt><dd>{record.algorithm.standard}</dd></>}
      <dt>{t("Analyzed")}</dt><dd>{new Date(record.analyzedAt).toLocaleString()}</dd>
      <dt>{t("Target settings")}</dt><dd>{Object.keys(record.settings).length ? Object.entries(record.settings).map(([name, value]) => `${name}: ${value}`).join(' · ') : t("No target settings supplied by the analyzer")}</dd>
    </dl></details>}
  </section>;
}
