export interface LyricsAppearance { font: 'spotify' | 'dm-sans' | 'arial' | 'system'; fontSize: number; lineGap: number; showVocalLabels: boolean }
export const defaultLyricsAppearance: LyricsAppearance = { font: 'system', fontSize: 48, lineGap: 18, showVocalLabels: true };
export function validLyricsAppearance(value?: Partial<LyricsAppearance>): LyricsAppearance {
  return { font: value?.font && ['spotify', 'dm-sans', 'arial', 'system'].includes(value.font) ? value.font : 'system',
    fontSize: Number.isFinite(value?.fontSize) ? Math.max(24, Math.min(64, value!.fontSize!)) : 48,
    lineGap: Number.isFinite(value?.lineGap) ? Math.max(4, Math.min(48, value!.lineGap!)) : 18,
    showVocalLabels: value?.showVocalLabels !== false };
}
