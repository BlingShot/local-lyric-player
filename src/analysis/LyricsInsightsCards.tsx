import { t } from '../i18n';
import { useRef, useState } from 'react';
import type { LyricsInput, LyricsInsights, LyricEvidence } from './types';
import { ADVISORY_CATEGORIES } from './advisory';

function ExpandableText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  return <><p className={!expanded && text.length > 220 ? 'analysis-clamped' : ''}>{text}</p>{text.length > 220 && <button className='analysis-text-button' onClick={() => setExpanded(value => !value)} aria-expanded={expanded}>{expanded ? t("Show less") : t("Expand")}</button>}</>;
}

function Themes({ themes, locate }: { themes: LyricsInsights['themes']; locate: (evidence: LyricEvidence) => void }) {
  const [expanded, setExpanded] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  if (!themes.length) return <div className='analysis-card-content'><p>{t("No themes supplied by the analyzer.")}</p></div>;
  const visible = expanded ? themes : themes.slice(0, 2);
  return <><div className='analysis-card-content' ref={body}><ul className={expanded ? 'analysis-theme-list' : 'analysis-theme-list analysis-theme-preview'}>
    {visible.map((theme, index) => {
      const unique = theme.evidence.filter((item, i, all) => all.findIndex(other => other.quote === item.quote) === i);
      return <li key={index}><strong>{theme.name}</strong>
        {expanded ? <ExpandableText text={theme.reason} /> : <p>{theme.reason}</p>}
        {(expanded ? unique : unique.slice(0, 1)).map((evidence, i) => <button key={i} className='analysis-evidence' onClick={() => locate(evidence)}>“{evidence.quote}”</button>)}
      </li>;
    })}
  </ul></div><div className='analysis-card-footer'><button className='analysis-text-button' onClick={() => {
    setExpanded(value => !value);
    if (body.current) body.current.scrollTop = 0;
  }} aria-expanded={expanded}>
    {expanded ? t("Show less") : themes.length > 2 ? t("Show all {0} themes", themes.length) : t("Expand themes")}
  </button></div></>;
}

function ContentAdvisory({ result, locate }: { result: LyricsInsights; locate: (evidence: LyricEvidence) => void }) {
  const assessment = result.advisoryAssessment;
  const categories = Object.keys(ADVISORY_CATEGORIES);
  const review = assessment?.review;
  const complete = !!review && review.length === categories.length && new Set(review.map(item => item.category)).size === categories.length
    && review.every(item => categories.includes(item.category) && ['clear', 'flagged', 'uncertain'].includes(item.status));
  const notices = complete ? review.filter(item => item.status !== 'clear').map(item => ({ ...item, category: ADVISORY_CATEGORIES[item.category] })) : result.advisory;
  const status = complete ? review.some(item => item.status === 'flagged') ? 'flagged' : review.some(item => item.status === 'uncertain') ? 'uncertain' : 'clear'
    : notices.length ? 'flagged' : 'unreviewed';
  return <><p className={`analysis-advisory-status is-${status}`}>
    {status === 'clear' ? t("All clear") : status === 'flagged' ? t("Content notice") : status === 'uncertain' ? t("Needs context") : t("Content review unavailable")}
  </p>
    {assessment && <ExpandableText text={assessment.summary} />}
    {!complete && <p>{t("This saved result has no complete category review. Analyze again to update it.")}</p>}
    {!!notices.length && <ul>{notices.map((item, index) => <li key={index}>
      <strong>{item.category}{item.status === 'uncertain' ? t(" · Needs context") : ''}</strong><ExpandableText text={item.reason} />
      {item.evidence?.map((evidence, i) => <button key={i} className='analysis-evidence' onClick={() => locate(evidence)}>“{evidence.quote}”</button>)}
    </li>)}</ul>}
    {complete && <details className='analysis-content-review'><summary>{review.length} {t("categories reviewed")}</summary>
      <ul>{review.map(item => <li key={item.category}><strong>{ADVISORY_CATEGORIES[item.category]}</strong>
        <p>{item.status === 'clear' ? t("No concerns found") : item.status === 'flagged' ? t("Content notice") : t("Needs context")} · {item.reason}</p>
      </li>)}</ul>
    </details>}
  </>;
}

export function LyricsInsightsCards({ result, source, stale }: { result?: LyricsInsights; source?: LyricsInput; stale: boolean }) {
  const lyrics = useRef<HTMLDetailsElement>(null), [selected, setSelected] = useState(''), [notice, setNotice] = useState('');
  const locate = (evidence: LyricEvidence) => {
    const line = source?.lines.find(line => line.id === evidence.lineId && line.text.includes(evidence.quote));
    if (stale || !line || !evidence.quote.trim()) { setNotice('This evidence no longer matches the selected lyrics. Update the analysis to locate it.'); return; }
    setNotice(''); setSelected(line.id);
    if (lyrics.current) lyrics.current.open = true;
    requestAnimationFrame(() => {
      const element = lyrics.current?.querySelector<HTMLElement>(`[data-evidence-line="${CSS.escape(line.id)}"]`);
      element?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
      element?.focus({ preventScroll: true });
    });
  };
  return <>
    <div className='analysis-insights-grid'>
      <article className='analysis-card analysis-meaning'><h3>{t("Meaning")}</h3>
        <div className='analysis-card-content'>{result ? <ExpandableText text={result.interpretation} /> : <p>{t("Not analyzed yet.")}</p>}</div></article>
      <article className='analysis-card analysis-themes'><h3>{t("Themes")}</h3>
        {result ? <Themes key={source?.fingerprint} themes={result.themes} locate={locate} /> : <div className='analysis-card-content'><p>{t("Not analyzed yet.")}</p></div>}</article>
      <div className='analysis-insights-side'>
        <article className='analysis-card analysis-moods'><h3 title={t("Emotions expressed in the lyrics, not audio analysis")}>{t("Moods")}</h3>
          <div className='analysis-card-content'>{result ? result.moods.length ? <ul className='analysis-tags'>{result.moods.map((mood, index) => <li key={index}>{mood}</li>)}</ul> : <p>{t("No mood labels supplied.")}</p> : <p>{t("Not analyzed yet.")}</p>}</div></article>
        <article className='analysis-card analysis-advisory'><h3 title={t("AI assessment, not an official content rating")}>{t("Content Advisory")}</h3>
          <div className='analysis-card-content'>{result ? <ContentAdvisory result={result} locate={locate} /> : <p>{t("Not analyzed yet.")}</p>}</div></article>
      </div>
    </div>
    {notice && <p role='status' className='analysis-warning'>{notice}</p>}
    {source && <details className='analysis-lyrics-source' ref={lyrics}><summary>{t("Lyrics used ·")}{' '}{source.lines.length} {t("lines")}</summary>
      <ol>{source.lines.map(line => <li key={line.id} data-evidence-line={line.id} tabIndex={-1} className={selected === line.id ? 'analysis-evidence-selected' : ''}>{line.text}</li>)}</ol>
    </details>}
  </>;
}
