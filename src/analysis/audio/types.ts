import type { AudioAnalysisMetadata } from '../../library/analysisMetadata';

export type AudioAnalysisKind = 'bpm' | 'key';
export type AudioJobKind = AudioAnalysisKind | 'loudness';
export interface AudioRange {
  kind: 'full-track'; start: 0; end: number;
  sourceSampleRate: number; decodedSampleRate: number; analysisSampleRate: number;
  sourceChannels: number; decodedFrames: number; analysisFrames: number;
  mix: 'mono' | 'stereo-average'; resampler: 'none' | 'Web Audio OfflineAudioContext';
}
interface AudioResultBase {
  outcome: 'estimated' | 'unreliable'; reason?: string;
  range: AudioRange; sourceMetadata: AudioAnalysisMetadata; engineVersion: string;
}
export interface BpmResult extends AudioResultBase {
  raw: { bpm: number; ticks: number[]; confidence?: number; estimates: number[]; bpmIntervals: number[] } | null;
}
export interface KeyResult extends AudioResultBase {
  raw: { tonic: string; mode: 'major' | 'minor'; strength: number } | null;
}
export type AudioTaskStatus = 'queued' | 'decoding' | 'analyzing' | 'cancelling' | 'saving' | 'complete' | 'failed' | 'cancelled';
export interface AudioTask {
  id: string; trackId: string; kind: AudioJobKind; status: AudioTaskStatus; message: string; updatedAt: number;
}
export interface AudioWorkerRequest {
  id: string; trackId: string; kind: AudioAnalysisKind; pcm: Float32Array; range: AudioRange; sourceMetadata: AudioAnalysisMetadata;
}
export type AudioWorkerResponse = { id: string; trackId: string; kind: AudioAnalysisKind } & (
  { result: BpmResult | KeyResult } | { error: string }
);

