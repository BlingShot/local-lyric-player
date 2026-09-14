import type { TrackRecord } from '../library/database';
import type { AudioTask, BpmResult, KeyResult } from './audio/types';
import type { LoudnessResult } from './loudness/types';
import type { AdvisoryCategory, AdvisoryStatus } from './advisory';
export type { LoudnessResult } from './loudness/types';

export type AnalysisKind = 'lyrics' | 'bpm-key' | 'bpm' | 'key' | 'loudness' | 'metadata';
export interface LyricsInput {
  kind: 'imported' | 'studio'; label: string; fingerprint: string;
  lines: { id: string; text: string; start?: number }[];
}
export interface InputVersions {
  lyrics?: { kind: LyricsInput['kind']; fingerprint: string };
  audio?: Record<string, string>;
  metadata?: string;
}
export interface AlgorithmInfo { id: string; name: string; version: string; standard?: string }
export interface LyricEvidence { lineId: string; quote: string }
export interface LyricsInsights {
  interpretation: string;
  themes: { name: string; reason: string; evidence: LyricEvidence[] }[];
  moods: string[];
  advisory: { category: string; reason: string; status?: AdvisoryStatus; evidence?: LyricEvidence[] }[];
  advisoryAssessment?: {
    status: AdvisoryStatus; summary: string;
    review?: { category: AdvisoryCategory; status: AdvisoryStatus; reason: string; evidence: LyricEvidence[] }[];
  };
  basis: 'lyrics-text-only'; authorIntent: 'interpretation'; advisorySource: 'ai';
}
export interface BpmKeyResult {
  bpm?: number; tonic?: string; mode?: 'major' | 'minor';
  strength?: { name: string; value: number; scale: string };
}
export type MetadataField = 'name' | 'artist' | 'album' | 'albumArtist' | 'trackNumber' | 'discNumber' | 'releaseDate' | 'cover';
export interface MetadataSuggestion {
  id: string; field: MetadataField; existing: string | number | null; suggested: string | number | null;
  source: { kind: 'embedded-tag' | 'local-library' | 'local-file'; label: string };
}
export interface MetadataResult { suggestions: MetadataSuggestion[] }
export interface AnalysisResults { lyrics: LyricsInsights; 'bpm-key': BpmKeyResult; bpm: BpmResult; key: KeyResult; loudness: LoudnessResult; metadata: MetadataResult }
export interface AnalysisRecord<K extends AnalysisKind = AnalysisKind> {
  schemaVersion: 1; trackId: string; kind: K; analyzedAt: number;
  input: InputVersions; algorithm: AlgorithmInfo; settings: Record<string, string | number | boolean>;
  result: AnalysisResults[K];
  task?: Pick<AudioTask, 'id' | 'status'>;
}
export type AnyAnalysisRecord = { [K in AnalysisKind]: AnalysisRecord<K> }[AnalysisKind];
export interface AnalysisCorrections {
  trackId: string; updatedAt: number;
  bpmKey?: { bpm?: number; tonic?: string; mode?: 'major' | 'minor'; multiplier?: .5 | 1 | 2 };
  bpm?: { value: number; source: 'manual' | 'half' | 'double'; sourceVersion: string; updatedAt: number };
  key?: { tonic: string; mode: 'major' | 'minor'; sourceVersion: string; updatedAt: number };
  acceptedMetadata?: { suggestionId: string; field: MetadataField; value: string | number | null; source: MetadataSuggestion['source'] }[];
}
export interface AnalysisInput {
  track: TrackRecord; lyrics?: LyricsInput; versions: InputVersions;
  audioScope?: LoudnessResult['scope'];
  // Load audio only on an explicit run; the Analyze page never decodes audio just by opening.
  readAudio: (trackId?: string) => Promise<Blob>;
}
export interface AnalysisProgress { message: string; fraction?: number }
export interface AnalysisAdapter<K extends AnalysisKind> {
  kind: K; execution: 'local' | 'deepseek'; algorithm: AlgorithmInfo;
  run(input: AnalysisInput, context: { signal: AbortSignal; settings: Readonly<AnalysisRecord<K>['settings']>; progress: (progress: AnalysisProgress) => void }): Promise<AnalysisResults[K]>;
}
export interface LocalAnalysisAdapter<K extends AnalysisKind> extends AnalysisAdapter<K> { execution: 'local' }
// Contract only. External providers are deliberately absent from the local adapter registry.
export interface ExternalMetadataProvider {
  id: string;
  propose(track: TrackRecord, context: { signal: AbortSignal; explicitNetworkConsent: true }): Promise<MetadataResult>;
}
