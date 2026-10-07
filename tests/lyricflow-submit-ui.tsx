import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LyricFlowSubmit } from '../src/components/Studio/LyricFlowSubmit';
import { saveTracks } from '../src/library/database';
import { newProject, vocalLine } from '../src/studio/project';
import { savePreferences } from '../src/integrations/lyricflow/repository';
import { lyricFlowTextFingerprint } from '../src/integrations/lyricflow/adapter';
import { readUploads } from '../src/integrations/lyricflow/uploadRepository';
import type { LocalTrack } from '../src/library/importFiles';
import type { DraftDto, SubmissionDto } from '../src/integrations/lyricflow/contributionTypes';

export async function mountSubmissionTest() {
  const track: LocalTrack = { id: 'local-submit', name: 'Integration song', artist: 'Test Artist', album: 'Test Album', size: 5, lastModified: 1, duration: 10, embeddedLyricsChecked: true, audioRevision: 'audio-1', metadataRevision: 'metadata-1' };
  await saveTracks([{ track, audio: new Blob(['audio']) }]);
  await savePreferences({ enabled: false, apiOrigin: 'https://lyrics.example', siteOrigin: 'https://lyrics.example' });
  const project = newProject(track.id, 'song.wav'), line = vocalLine('Frozen original words'); line.startMs = 1000; line.endMs = 2000; project.lines = [line];
  let draft: DraftDto | undefined, submission: SubmissionDto | undefined, firstSubmit = true;
  const calls: { operation: string; input: any }[] = [], creates = new Map<string, DraftDto>(), submissions = new Map<string, SubmissionDto>();
  const connection = { configured: true, connected: true, apiOrigin: 'https://lyrics.example', siteOrigin: 'https://lyrics.example', issuer: 'https://lyrics.example/oidc', clientId: 'player', sub: 'person', displayName: 'Integration account', remembered: false };
  window.localMusicDesktop = {
    lyricflowInfo: async () => connection,
    lyricflowOpenSite: async () => {},
    lyricflowRead: async operation => operation === 'contract' ? { integrations: { lyricPlayer: { oauthContribution: true } } } : { status: 'matched', selectedTrackId: 'remote-submit', hasMore: false, reasonCodes: ['EXACT_METADATA'], candidates: [{ trackId: 'remote-submit', title: 'Integration song', artists: ['Test Artist'], album: 'Test Album', durationMs: 10000, recordingKind: 'studio', matchedBy: ['metadata'], documentId: 'document-submit', revisionId: null, lyricsState: 'missing' }] },
    lyricflowOperation: async (operation, input: any) => {
      calls.push({ operation, input: structuredClone(input) });
      if (input.owner.sub !== 'person') throw new Error('Wrong account');
      if (operation === 'context') return { trackId: 'remote-submit', documentId: 'document-submit', currentRevisionId: null, locked: [], canCreateDraft: true, canSubmit: true };
      if (operation === 'createDraft') {
        if (!creates.has(input.idempotencyKey)) { draft = { id: 'draft-submit', documentId: 'document-submit', baseRevisionId: null, version: 1, content: { schemaVersion: 1, text: { lines: [] }, sync: null, structure: [], performers: { participants: [], assignments: [] }, source: null }, fingerprint: '', savedAt: new Date().toISOString(), etag: '"draft-draft-submit-v1"' }; creates.set(input.idempotencyKey, draft); } return structuredClone(creates.get(input.idempotencyKey));
      }
      if (operation === 'draft') return structuredClone(draft);
      if (operation === 'fingerprint') return { textFingerprint: lyricFlowTextFingerprint({ ...draft!.content, text: input.text }) };
      if (operation === 'saveDraft') { if (input.etag !== draft!.etag) throw new Error('DRAFT_VERSION_CONFLICT'); draft = { ...draft!, version: 2, etag: '"draft-draft-submit-v2"', content: structuredClone(input.content), savedAt: new Date().toISOString() }; return structuredClone(draft); }
      if (operation === 'changes') return { components: ['text', 'sync', 'structure', 'performers'] };
      if (operation === 'submit') {
        const persisted = (await readUploads(track.id))[0];
        if (persisted.step !== 'submitting_unknown' || JSON.stringify(persisted.submitBody) !== JSON.stringify(input.body)) throw new Error('Request was not persisted before transmission');
        if (!submissions.has(input.idempotencyKey)) { submission = { id: 'submission-one', status: 'pending' }; submissions.set(input.idempotencyKey, submission); }
        if (firstSubmit) { firstSubmit = false; throw new Error('Simulated lost submission response'); }
        return structuredClone(submissions.get(input.idempotencyKey));
      }
      if (operation === 'status') return submission;
      if (operation === 'withdraw') { submission = { id: 'submission-one', status: 'withdrawn' }; return submission; }
      throw new Error(`Unexpected operation ${operation}`);
    },
  } as NonNullable<Window['localMusicDesktop']>;
  function Demo() { const [open, setOpen] = useState(false); return <><button onClick={() => setOpen(true)}>Open submission</button>{open && <LyricFlowSubmit project={project} track={track} durationMs={10000} onClose={() => setOpen(false)} />}</>; }
  const root = createRoot(document.getElementById('root')!); root.render(<StrictMode><Demo /></StrictMode>);
  return { calls, creates, submissions, project };
}
