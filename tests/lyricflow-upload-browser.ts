import { saveTracks, patchExistingTracks } from '../src/library/database';
import { metadataFingerprint } from '../src/integrations/lyricflow/repository';
import { persistUpload, saveRemoteDraft, submitUpload, refreshUpload } from '../src/integrations/lyricflow/contribution';
import { readUploads } from '../src/integrations/lyricflow/uploadRepository';
import { newProject } from '../src/studio/project';
import type { DraftDto, LyricFlowUpload } from '../src/integrations/lyricflow/contributionTypes';
import type { LocalTrack } from '../src/library/importFiles';
import type { ContentV1 } from '../src/integrations/lyricflow/types';

const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const rejected = async (promise: Promise<unknown>, pattern: RegExp) => { try { await promise; throw new Error('Expected rejection'); } catch (error) { assert(pattern.test(String(error)), `Wrong failure: ${error}`); } };
const empty = (): ContentV1 => ({ schemaVersion: 1, text: { lines: [] }, sync: null, structure: [], performers: { participants: [], assignments: [] }, source: null });
const owner = { issuer: 'https://lyrics.example/oidc', sub: 'account-a', clientId: 'player' };
const components = ['text', 'sync', 'structure', 'performers'] as const;

export async function runLyricFlowUploadBrowserTests() {
  const checks: string[] = [], calls: { operation: string; input: any }[] = [];
  let draft: DraftDto, loseSave: 'before' | 'after' | undefined, loseCreate = false, loseSubmit = false, wrongId = false, duplicateChanges = false, otherOwner = false;
  window.localMusicDesktop = { lyricflowOperation: async (operation: string, input: Record<string, any>) => {
    calls.push({ operation, input: structuredClone(input) });
    assert(Object.keys(input.owner).sort().join(',') === 'clientId,issuer,sub', 'The owner envelope contains unrelated private project data.');
    if (otherOwner || input.owner.sub !== owner.sub) throw new Error('This upload belongs to a different LyricFlow account.');
    if (operation === 'createDraft') { if (loseCreate) { loseCreate = false; throw new Error('Create response lost'); } return structuredClone(draft); }
    if (operation === 'draft') return structuredClone(wrongId ? { ...draft, id: 'other-draft', etag: `"draft-other-draft-v${draft.version}"` } : draft);
    if (operation === 'fingerprint') return { textFingerprint: 'a'.repeat(64) };
    if (operation === 'saveDraft') {
      if (loseSave === 'before') { loseSave = undefined; throw new Error('Save request lost'); }
      assert(input.etag === draft.etag, 'A save used the wrong precondition.');
      draft = { ...draft, version: draft.version + 1, etag: `"draft-${draft.id}-v${draft.version + 1}"`, content: structuredClone(input.content) };
      if (loseSave === 'after') { loseSave = undefined; throw new Error('Save response lost'); }
      return structuredClone(draft);
    }
    if (operation === 'changes') return { components: duplicateChanges ? ['text', 'text', 'structure', 'performers'] : [...components] };
    if (operation === 'submit') { if (loseSubmit) { loseSubmit = false; throw new Error('Submission response lost'); } return { id: 'submission', status: 'pending' }; }
    if (operation === 'status') return { id: 'submission', documentId: 'doc', status: 'approved', resultRevisionId: 'published', decision: null };
    if (operation === 'withdraw') return { id: 'submission', status: 'withdrawn' };
    throw new Error('Unexpected upload operation');
  } } as unknown as NonNullable<Window['localMusicDesktop']>;
  let next = 0;
  const prepare = async () => {
    calls.length = 0; loseSave = undefined; loseCreate = false; loseSubmit = false; wrongId = false; duplicateChanges = false; otherOwner = false;
    const track: LocalTrack = { id: `upload-track-${++next}`, name: 'Song', artist: 'Artist', album: 'Album', duration: 10, size: 5, lastModified: 1, audioRevision: 'audio-1', metadataRevision: 'metadata-1' };
    await saveTracks([{ track, audio: new Blob(['audio']) }]);
    const content = empty(); content.text.lines = [{ lineId: 'stable-line', order: 0, text: ' Frozen words ', kind: 'vocal' }];
    content.sync = { textFingerprint: '', reference: { trackId: 'remote', source: 'client', externalId: null, durationMs: 10000, offsetMs: 0 }, timings: [{ lineId: 'stable-line', startMs: 1000, endMs: null, endSource: 'unknown' }] };
    const initial: LyricFlowUpload = { ...owner, taskId: crypto.randomUUID(), localTrackId: track.id, apiOrigin: 'https://lyrics.example', targetTrackId: 'remote', targetDocumentId: 'doc',
      audioRevision: track.audioRevision, metadataRevision: track.metadataRevision, metadataFingerprint: metadataFingerprint(track), projectSnapshot: newProject(track.id, 'Song'), projectSnapshotHash: 'frozen', durationMs: 10000, baseRevisionId: null, baseSnapshot: null, lineMap: { 'stable-line': 'stable-line' }, content, components: [...components], step: 'prepared', createBody: { documentId: 'doc' }, idempotencyKeys: { create: crypto.randomUUID(), submit: crypto.randomUUID(), withdraw: crypto.randomUUID() }, updatedAt: Date.now() };
    draft = { id: 'draft-id', documentId: 'doc', baseRevisionId: null, version: 1, etag: '"draft-draft-id-v1"', fingerprint: 'f'.repeat(64), savedAt: '2026-10-07T10:00:00Z', content: empty() };
    const task = await persistUpload(initial);
    initial.content.text.lines[0].text = 'Mutable editor changed';
    assert(task.content.text.lines[0].text === ' Frozen words ', 'Persisted operation shares mutable editor state.');
    return { task, track };
  };
  let prepared = await prepare(); loseSave = 'before';
  await rejected(saveRemoteDraft(prepared.task), /Save request lost/);
  const frozen = (await readUploads(prepared.track.id))[0];
  assert(frozen.step === 'saving' && frozen.saveBody?.content.sync?.textFingerprint === 'a'.repeat(64), 'Exact save payload was not persisted before sending.');
  let saved = await saveRemoteDraft(frozen);
  const puts = calls.filter(call => call.operation === 'saveDraft');
  assert(saved.step === 'saved' && saved.draftVersion === 2 && puts.length === 2 && JSON.stringify(puts[0].input) === JSON.stringify(puts[1].input), 'Unsent save could not resume with its original payload/precondition.');
  checks.push('unsent saves resume using frozen content, original line IDs and exact ETag');

  prepared = await prepare(); loseSave = 'after'; saved = await saveRemoteDraft(prepared.task);
  assert(saved.step === 'saved' && calls.filter(call => call.operation === 'saveDraft').length === 1, 'Lost save response caused another write.');
  checks.push('committed save with a lost response recovers by version and exact content');

  prepared = await prepare(); loseCreate = true;
  await rejected(saveRemoteDraft(prepared.task), /Create response lost/);
  saved = await saveRemoteDraft((await readUploads(prepared.track.id))[0]);
  const creates = calls.filter(call => call.operation === 'createDraft');
  assert(saved.step === 'saved' && creates.length === 2 && creates[0].input.idempotencyKey === creates[1].input.idempotencyKey, 'Create recovery replaced its idempotency key.');
  checks.push('lost create response retains its original idempotency key');

  prepared = await prepare(); draft.baseRevisionId = 'newer-revision';
  await rejected(saveRemoteDraft(prepared.task), /Published lyrics changed/);
  assert(!calls.some(call => call.operation === 'saveDraft'), 'A changed publication baseline was overwritten.');
  prepared = await prepare(); wrongId = true;
  await rejected(saveRemoteDraft(prepared.task), /invalid saved draft/);
  assert(!calls.some(call => call.operation === 'saveDraft'), 'Mismatched returned draft ID was trusted.');
  prepared = await prepare(); duplicateChanges = true;
  await rejected(saveRemoteDraft(prepared.task), /confirmed component selection/);
  checks.push('changed baselines, wrong draft identity and duplicate component responses block submission');

  prepared = await prepare(); saved = await saveRemoteDraft(prepared.task); loseSubmit = true;
  const provenance = { source: 'own_transcription' as const, declaration: 'Original frozen declaration', displayRestriction: 'none' as const };
  await rejected(submitUpload(saved, provenance), /Submission response lost/);
  provenance.declaration = 'Changed after clicking submit';
  const unknown = (await readUploads(prepared.track.id))[0];
  assert(unknown.step === 'submitting_unknown', 'Unknown commit state was lost.');
  let pending = await submitUpload(unknown, provenance);
  const submits = calls.filter(call => call.operation === 'submit');
  assert(pending.step === 'pending' && submits.length === 2 && JSON.stringify(submits[0].input) === JSON.stringify(submits[1].input), 'Submission retry regenerated the request or key.');
  otherOwner = true;
  await rejected(refreshUpload(pending), /different LyricFlow account/);
  otherOwner = false; pending = (await readUploads(prepared.track.id))[0];
  const approved = await refreshUpload(pending);
  assert(approved.step === 'approved', 'Approved status was not persisted.');
  checks.push('unknown submissions preserve provenance and keys; another account cannot resume them');

  for (const change of ['metadata', 'audio'] as const) {
    prepared = await prepare(); saved = await saveRemoteDraft(prepared.task);
    await patchExistingTracks([{ id: prepared.track.id, patch: change === 'metadata' ? { name: 'Other song' } : { audioRevision: 'audio-2', size: 9 }, ...(change === 'audio' ? { audio: new Blob(['new audio']) } : {}) }]);
    const before = calls.length;
    await rejected(submitUpload(saved, { source: 'unknown', declaration: 'Unknown source', displayRestriction: 'none' }), /song changed/);
    assert(calls.length === before, 'A changed local recording was submitted.');
  }
  prepared = await prepare(); await persistUpload(prepared.task);
  await rejected(persistUpload(prepared.task), /another window/);
  checks.push('audio/metadata changes and stale concurrent task writes are rejected atomically');
  return checks;
}
