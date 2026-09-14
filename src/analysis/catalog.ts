import type { AnalysisKind, LocalAnalysisAdapter } from './types';

export const analysisKinds: AnalysisKind[] = ['lyrics', 'bpm-key', 'bpm', 'key', 'loudness', 'metadata'];
export const analysisCatalog = {
  lyrics: { title: 'Lyrics Insights', status: 'Not configured', note: 'Configure your DeepSeek API key in Settings.' },
  'bpm-key': { title: 'BPM & Key', status: 'Planned', note: 'Local audio analysis is not implemented yet.' },
  bpm: { title: 'BPM', status: 'Local', note: 'RhythmExtractor2013 · Full track' },
  key: { title: 'Key', status: 'Local', note: 'KeyExtractor · Full track' },
  loudness: { title: 'ReplayGain & Loudness', status: 'Local', note: 'EBU R128 · True peak · ReplayGain 2.0' },
  metadata: { title: 'Metadata', status: 'Not configured', note: 'No local metadata enricher is configured. Existing values are shown below.' },
} as const;
type Adapters = { [K in AnalysisKind]?: LocalAnalysisAdapter<K> };
// Local engines only. DeepSeek is a separate, explicit user action in Lyrics Insights.
export const localAnalysisAdapters: Adapters = {};
