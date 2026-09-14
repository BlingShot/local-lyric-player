import type { LyricsInput, LyricsInsights } from '../types';
import { ADVISORY_CATEGORIES, type AdvisoryCategory, type AdvisoryStatus } from '../advisory';

const invalid = () => new Error('DeepSeek returned an incomplete or invalid analysis. The previous result is kept. Try analyzing again.');
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, limit = 2000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) throw invalid();
  return value.trim();
}
function list(value: unknown, limit: number): unknown[] {
  if (!Array.isArray(value) || value.length > limit) throw invalid();
  return value;
}
export function parseDeepSeekInsights(content: string, source: LyricsInput): LyricsInsights {
  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch { throw invalid(); }
  const value = object(parsed);
  const parseEvidence = (value: unknown, limit: number) => list(value, limit).map(item => {
    const reference = object(item), lineId = text(reference.lineId, 12), quote = text(reference.quote, 500);
    const number = /^L([1-9]\d*)$/.exec(lineId), line = number && source.lines[Number(number[1]) - 1];
    if (!line || !line.text.includes(quote)) throw new Error('DeepSeek quoted text that does not match these lyrics. The previous result is kept. Try analyzing again.');
    return { lineId: line.id, quote };
  });
  const assessment = object(value.advisoryAssessment);
  const categories = Object.keys(ADVISORY_CATEGORIES), seen = new Set<string>();
  if (!Array.isArray(assessment.review) || assessment.review.length !== categories.length)
    throw new Error('DeepSeek did not complete all six content checks. The previous result is kept. Try analyzing again.');
  const review = assessment.review.map(item => {
    const entry = object(item), category = text(entry.category, 40), status = entry.status;
    if (!categories.includes(category) || seen.has(category) || (status !== 'clear' && status !== 'flagged' && status !== 'uncertain')) throw invalid();
    seen.add(category);
    const evidence = parseEvidence(entry.evidence, 2);
    if ((status === 'clear' && evidence.length) || (status !== 'clear' && !evidence.length)) throw invalid();
    return { category: category as AdvisoryCategory, status: status as AdvisoryStatus, reason: text(entry.reason), evidence };
  });
  const status = review.some(item => item.status === 'flagged') ? 'flagged' : review.some(item => item.status === 'uncertain') ? 'uncertain' : 'clear';
  const advisory = review.filter(item => item.status !== 'clear').map(item => ({ ...item, category: ADVISORY_CATEGORIES[item.category] }));
  return {
    interpretation: text(value.interpretation, 12000),
    themes: list(value.themes, 8).map(item => {
      const theme = object(item);
      const evidence = parseEvidence(theme.evidence, 4);
      if (!evidence.length) throw invalid();
      return { name: text(theme.name, 160), reason: text(theme.reason), evidence };
    }),
    moods: list(value.moods, 10).map(value => text(value, 100)),
    advisory, advisoryAssessment: { status, summary: text(assessment.summary), review },
    basis: 'lyrics-text-only', authorIntent: 'interpretation', advisorySource: 'ai',
  };
}
