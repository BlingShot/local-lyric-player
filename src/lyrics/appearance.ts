export interface LyricsAppearance { font: 'spotify' | 'dm-sans' | 'arial' | 'system'; fontSize: number; lineGap: number; showVocalLabels: boolean; wordByWord: boolean; performerAlignment: boolean; translationSize: number; musicReactive?: boolean }
export const defaultLyricsAppearance: LyricsAppearance = { font: 'system', fontSize: 48, lineGap: 18, showVocalLabels: true, wordByWord: true, performerAlignment: true, translationSize: 20, musicReactive: false };
export function validLyricsAppearance(value?: Partial<LyricsAppearance>): LyricsAppearance {
  const number = (v: number | undefined, min: number, max: number, fallback: number) => Number.isFinite(v) ? Math.max(min, Math.min(max, v!)) : fallback;
  return { font: value?.font && ['spotify', 'dm-sans', 'arial', 'system'].includes(value.font) ? value.font : 'system', fontSize: number(value?.fontSize, 24, 64, 48), lineGap: number(value?.lineGap, 4, 48, 18), translationSize: number(value?.translationSize, 12, 40, 20), showVocalLabels: value?.showVocalLabels !== false, wordByWord: value?.wordByWord !== false, performerAlignment: value?.performerAlignment !== false, musicReactive: value?.musicReactive === true };
}
