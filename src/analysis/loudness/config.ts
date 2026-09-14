import type { AlgorithmInfo } from '../types';

export const LOUDNESS_PCM_LIMIT = 128 * 1024 * 1024;
export const loudnessAlgorithm: AlgorithmInfo = {
  id: 'local-r128-rg2-v2', name: 'Local R128 + ITU true peak + ReplayGain 2.0',
  version: '2.0.0', standard: 'EBU R128 / Tech 3342; ITU-R BS.1770 Annex 2; ReplayGain 2.0',
};
export const loudnessSettings = {
  range: 'full-track', channels: 'original-mono-or-stereo', sampleRate: 'original', normalizeInput: false,
  hopSeconds: .1, incompleteWindows: 'excluded', absoluteGateLufs: -70, integratedRelativeGateLu: -10,
  rangeRelativeGateLu: -20, rangePercentiles: '10,95; nearest rank',
  truePeakMethod: 'ITU-R BS.1770-5 Annex 2, 48-tap 4-phase FIR', oversampling: 4,
  targetLufs: -18, filterPrecision: 'float64-cascaded-biquads', measurementVersion: 2,
} as const;
