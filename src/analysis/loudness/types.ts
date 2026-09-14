import type { AudioAnalysisMetadata } from '../../library/analysisMetadata';
import type { AnalysisRecord } from '../types';

export type LoudnessKind = 'loudness';
export type LoudnessRecord = AnalysisRecord<LoudnessKind>;
export interface LoudnessRange {
  kind: 'full-track'; start: 0; end: number; sampleRate: number; channels: number; frames: number;
  mix: 'original-channels'; resampler: 'none';
}
export interface LoudnessScan {
  trackId: string; range: LoudnessRange; sourceMetadata: AudioAnalysisMetadata; engineVersion: string;
  // Complete 400 ms / 3 s windows, 100 ms hop. Complete windows only; no trailing zero padding.
  momentary: number[]; shortTerm: number[];
  engineRaw: { integratedLufs: number; rangeLu: number };
  samplePeak: number; truePeak: number;
}
export interface LoudnessResult {
  scope: { kind: 'track'; trackIds: string[] };
  integratedLufs: number | null; rangeLu: number | null; samplePeak: number; truePeak: number; truePeakDbtp: number | null;
  replayGain: { gainDb: number; reference: 'ReplayGain 2.0 · −18 LUFS'; targetLufs: -18; peak: number; truePeak: number } | null;
  outcome: 'measured' | 'unmeasurable'; reason?: string;
  ranges: { trackId: string; name: string; range: LoudnessRange }[];
  aggregation: 'single-track';
  engineVersion: string;
  // Preserve measurement blocks separately from playback state.
  scan?: LoudnessScan;
}
export interface LoudnessWorkerRequest {
  id: string; trackId: string; channels: Float32Array[]; range: LoudnessRange; sourceMetadata: AudioAnalysisMetadata;
}
export type LoudnessWorkerResponse = { id: string; trackId: string } & ({ scan: LoudnessScan } | { error: string });
