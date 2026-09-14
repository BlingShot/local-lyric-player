import type { AlgorithmInfo, AnalysisRecord } from '../types';
import type { AudioAnalysisKind } from './types';

export const ESSENTIA_JS_VERSION = '0.1.3';
export const AUDIO_ANALYSIS_RATE = 44100;
export const BPM_PARAMETERS = { maxTempo: 208, method: 'multifeature', minTempo: 40 } as const;
export const KEY_PARAMETERS = { averageDetuningCorrection: true, frameSize: 4096, hopSize: 4096, hpcpSize: 12,
  maxFrequency: 3500, maximumSpectralPeaks: 60, minFrequency: 25, pcpThreshold: .2, profileType: 'bgate',
  sampleRate: AUDIO_ANALYSIS_RATE, spectralPeaksThreshold: .0001, tuningFrequency: 440, weightType: 'cosine', windowType: 'hann' } as const;
export const audioAlgorithm = (kind: AudioAnalysisKind): AlgorithmInfo => ({ id: `essentia-${kind}-v1`,
  name: kind === 'bpm' ? 'RhythmExtractor2013' : 'KeyExtractor', version: ESSENTIA_JS_VERSION });
export const audioSettings = (kind: AudioAnalysisKind): AnalysisRecord['settings'] => ({
  ...(kind === 'bpm' ? BPM_PARAMETERS : KEY_PARAMETERS), sampleRate: AUDIO_ANALYSIS_RATE,
  range: 'full-track', mix: 'stereo-average-or-mono', preprocessingVersion: 1, reliabilityRulesVersion: 1,
});
export const MAX_AUDIO_FILE_BYTES = 160 * 1024 * 1024;
export const MAX_DECODED_BYTES = 192 * 1024 * 1024;
export const MAX_AUDIO_DURATION = 15 * 60;
