export interface ContentV1 {
  schemaVersion: 1;
  text: { lines: { lineId: string; order: number; text: string; kind: 'vocal' | 'blank' | 'note'; sourceLineId?: string }[] };
  sync: { textFingerprint: string; reference: { trackId: string; source: 'unknown' | 'client' | 'catalog' | 'server'; externalId: string | null; durationMs: number | null; offsetMs: number }; timings: { lineId: string; startMs: number | null; endMs: number | null; endSource: 'manual' | 'derived' | 'unknown' }[] } | null;
  structure: { lineId: string; section: 'verse' | 'chorus' | 'pre-chorus' | 'post-chorus' | 'bridge' | 'intro' | 'outro' | 'refrain' | 'interlude' | 'instrumental' | 'hook' | 'other' }[];
  performers: { participants: { id: string; name: string }[]; assignments: { lineId: string; performerIds: string[]; ranges?: { start: number; end: number; performerIds: string[] }[] }[] };
  source: { documentId: string; revisionId: string; textFingerprint: string; lineIds: string[] } | null;
}
export interface LyricFlowRevision { id: string; documentId: string; content: ContentV1; components: Record<string, unknown>; publishedAt: string; provenance: unknown }
export interface LyricFlowSourceV1 { formatVersion: 1; provider: 'lyricflow'; apiOrigin: string; trackId: string; documentId: string; revisionId: string; fetchedAt: number; snapshot: LyricFlowRevision }
export interface LyricFlowCandidate { trackId: string; title: string; artists: string[]; album: string | null; durationMs: number | null; recordingKind: string; matchedBy: string[]; documentId: string | null; revisionId: string | null; lyricsState: 'missing' | 'text_only' | 'line_partial' | 'line_complete' }
export interface LyricFlowResolve { status: 'matched' | 'candidates' | 'not_found'; selectedTrackId: string | null; reasonCodes: string[]; hasMore: boolean; candidates: LyricFlowCandidate[] }
export interface LyricFlowLink {
  apiOrigin: string; localTrackId: string; trackId: string; documentId: string; revisionId: string; matchedBy: string[]; userConfirmed: boolean;
  audioRevision?: string; metadataRevision?: string; metadataFingerprint: string; baseSnapshot: LyricFlowRevision; lineMap: Record<string, string>;
}
export interface LyricFlowPreferences { enabled: boolean; apiOrigin: string; siteOrigin: string }
