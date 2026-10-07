import type { StudioProject } from '../../studio/project.ts';
import type { ContentV1, LyricFlowRevision } from './types.ts';

export interface LyricFlowConfiguration { apiOrigin: string; siteOrigin: string; issuer: string; clientId: string }
export interface LyricFlowOwner { issuer: string; sub: string; clientId: string }
export interface LyricFlowConnectionInfo extends Partial<LyricFlowConfiguration> { configured: boolean; connected: boolean; sub?: string; displayName?: string; remembered: boolean }
export type LyricFlowOperation = 'context' | 'createDraft' | 'draft' | 'saveDraft' | 'fingerprint' | 'changes' | 'submit' | 'status' | 'withdraw';
export type Component = 'text' | 'sync' | 'structure' | 'performers';
export interface DraftDto { id: string; documentId: string; baseRevisionId: string | null; version: number; content: ContentV1; fingerprint: string; savedAt: string; etag: string }
export interface ContributionContext { trackId: string; documentId: string | null; currentRevisionId: string | null; locked: Component[]; canCreateDraft: boolean; canSubmit: boolean }
export interface SubmissionDto { id: string; status: 'pending' | 'approved' | 'rejected' | 'conflicted' | 'withdrawn'; documentId?: string; resultRevisionId?: string | null; decision?: unknown }
export interface Provenance { source: 'own_transcription' | 'licensed' | 'public_domain' | 'unknown'; declaration: string; displayRestriction: 'none' | 'attribution_required' | 'limited' }
export interface LyricFlowUpload extends LyricFlowOwner {
  taskId: string; localTrackId: string; apiOrigin: string; targetTrackId: string; targetDocumentId: string;
  audioRevision?: string; metadataRevision?: string; metadataFingerprint: string;
  projectSnapshot: StudioProject; projectSnapshotHash: string; durationMs: number | null; baseRevisionId: string | null; baseSnapshot: LyricFlowRevision | null;
  lineMap: Record<string, string>; content: ContentV1; components: Component[];
  step: 'prepared' | 'creating' | 'draft' | 'saving' | 'saved' | 'submitting_unknown' | SubmissionDto['status'];
  idempotencyKeys: { create: string; submit: string; withdraw: string }; createBody: { documentId: string };
  draftId?: string; draftVersion?: number; etag?: string; savedAt?: string; submissionId?: string;
  saveBody?: { content: ContentV1 }; submitBody?: { expectedDraftVersion: number; components: Component[]; provenance: Provenance };
  updatedAt: number; decision?: unknown; paused?: boolean;
}
