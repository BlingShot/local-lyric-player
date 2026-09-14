export interface NormalizationSettings {
  enabled: boolean; mode: 'track'; preampDb: number; preventClipping: boolean; ceilingDbtp: number;
}
export const defaultNormalization: NormalizationSettings = { enabled: false, mode: 'track', preampDb: 0, preventClipping: true, ceilingDbtp: -1 };
export function validNormalization(value?: Partial<NormalizationSettings>): NormalizationSettings {
  const clamp = (n: number | undefined, min: number, max: number, fallback: number) => Number.isFinite(n) ? Math.max(min, Math.min(max, n!)) : fallback;
  return { enabled: value?.enabled === true, mode: 'track',
    preampDb: clamp(value?.preampDb, -12, 12, 0), preventClipping: value?.preventClipping !== false,
    ceilingDbtp: clamp(value?.ceilingDbtp, -6, 0, -1) };
}
export function normalizationGain(settings: NormalizationSettings, measured?: { gainDb: number; truePeak: number }) {
  if (!settings.enabled || !measured || !Number.isFinite(measured.gainDb) || !Number.isFinite(measured.truePeak) || measured.truePeak <= 0)
    return { db: 0, linear: 1, limited: false };
  const requested = measured.gainDb + settings.preampDb;
  const ceiling = settings.ceilingDbtp - 20 * Math.log10(measured.truePeak);
  // Static peak-aware gain, not a compressor/limiter. Never consider the volume
  // slider as extra headroom: turning the slider up must remain safe.
  const db = settings.preventClipping ? Math.min(requested, ceiling) : requested;
  return { db, linear: 10 ** (db / 20), limited: db < requested - .001 };
}
