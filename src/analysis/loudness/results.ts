import { integratedLoudness, loudnessRange, peakDb } from './math';
import type { LoudnessResult, LoudnessScan } from './types';

export function summarizeScans(scans: LoudnessScan[], scope: LoudnessResult['scope'], names: Record<string, string>): LoudnessResult {
  const integratedLufs = integratedLoudness(scans.flatMap(scan => scan.momentary));
  const rangeLu = loudnessRange(scans.flatMap(scan => scan.shortTerm));
  const samplePeak = Math.max(...scans.map(scan => scan.samplePeak)), truePeak = Math.max(...scans.map(scan => scan.truePeak));
  return { scope, integratedLufs, rangeLu, samplePeak, truePeak, truePeakDbtp: peakDb(truePeak),
    outcome: integratedLufs === null ? 'unmeasurable' : 'measured',
    reason: integratedLufs === null ? 'No complete 400 ms block above the −70 LUFS gate. ReplayGain is unavailable.' : rangeLu === null ? 'Loudness Range needs a complete 3-second window above the gate.' : undefined,
    replayGain: integratedLufs === null ? null : { gainDb: -18 - integratedLufs, reference: 'ReplayGain 2.0 · −18 LUFS', targetLufs: -18, peak: samplePeak, truePeak },
    ranges: scans.map(scan => ({ trackId: scan.trackId, name: names[scan.trackId], range: scan.range })),
    aggregation: 'single-track',
    engineVersion: scans[0].engineVersion, ...(scope.kind === 'track' ? { scan: scans[0] } : {}) };
}
