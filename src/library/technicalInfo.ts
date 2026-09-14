import type { LocalTrack } from './importFiles.ts';
export const technicalFields = ['bitrate', 'sampleRate', 'bitsPerSample'] as const;
export type TechnicalField = typeof technicalFields[number];
export const technicalLabels = { bitrate: 'Bitrate', sampleRate: 'Sample rate', bitsPerSample: 'Bit depth' };
export function technicalValue(track: LocalTrack, field: TechnicalField) {
  const value = track.analysisMetadata?.[field];
  if (value === undefined || !Number.isFinite(value) || value <= 0) return '—';
  if (field === 'bitrate') return `${Math.round(value / 1000)} kbps`;
  if (field === 'sampleRate') return `${Number((value / 1000).toFixed(3))} kHz`;
  return `${value} bit`;
}
