import { changedComponents } from './contributionAdapter';
import { saveUpload } from './uploadRepository';
import { validateContentV1 } from './adapter';
import type { Component, DraftDto, LyricFlowConnectionInfo, LyricFlowOperation, LyricFlowOwner, LyricFlowUpload, Provenance, SubmissionDto } from './contributionTypes';

export const uploadOwner = (info: LyricFlowConnectionInfo): LyricFlowOwner => {
  if (!info.connected || !info.sub || !info.issuer || !info.clientId) throw new Error('Connect to LyricFlow in Settings first.');
  return { issuer: info.issuer, sub: info.sub, clientId: info.clientId };
};
export async function contributionRequest<T>(owner: LyricFlowOwner, operation: LyricFlowOperation, input: Record<string, unknown>): Promise<T> {
  const bridge = window.localMusicDesktop;
  if (!bridge?.lyricflowOperation) throw new Error('LyricFlow contributions require the desktop app.');
  return bridge.lyricflowOperation(operation, { ...input, owner: { issuer: owner.issuer, sub: owner.sub, clientId: owner.clientId } }) as Promise<T>;
}
const equal = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, i) => equal(value, b[i]));
  if (a && b && typeof a === 'object' && typeof b === 'object') { const aa = a as Record<string, unknown>, bb = b as Record<string, unknown>; return Object.keys(aa).length === Object.keys(bb).length && Object.keys(aa).every(key => Object.hasOwn(bb, key) && equal(aa[key], bb[key])); }
  return false;
};
export async function persistUpload(task: LyricFlowUpload): Promise<LyricFlowUpload> {
  const saved = structuredClone({ ...task, updatedAt: Math.max(Date.now(), task.updatedAt + 1) }); await saveUpload(saved, task.updatedAt); return saved;
}
function validateDraft(value: DraftDto, task: LyricFlowUpload): DraftDto {
  if (!value || value.documentId !== task.targetDocumentId || typeof value.id !== 'string' || !value.id || task.draftId && value.id !== task.draftId || !Number.isSafeInteger(value.version) || value.version < 1 || value.etag !== `"draft-${value.id}-v${value.version}"` || !Number.isFinite(Date.parse(value.savedAt))) throw new Error('LyricFlow returned an invalid saved draft.');
  validateContentV1(value.content); return value;
}
export async function saveRemoteDraft(input: LyricFlowUpload): Promise<LyricFlowUpload> {
  let task = structuredClone(input);
  if (!['prepared', 'creating', 'draft', 'saving', 'saved'].includes(task.step)) throw new Error('This snapshot has already been submitted. Refresh its saved submission status.');
  if (!task.draftId) {
    task = await persistUpload({ ...task, step: 'creating' });
    const draft = validateDraft(await contributionRequest<DraftDto>(task, 'createDraft', { ...task.createBody, idempotencyKey: task.idempotencyKeys.create }), task);
    task = await persistUpload({ ...task, draftId: draft.id, draftVersion: draft.version, etag: draft.etag, step: 'draft' });
    if (draft.baseRevisionId !== task.baseRevisionId) throw new Error('Published lyrics changed. Compare the new baseline and prepare a new snapshot.');
  }
  const current = validateDraft(await contributionRequest<DraftDto>(task, 'draft', { id: task.draftId }), task);
  if (current.baseRevisionId !== task.baseRevisionId) throw new Error('Published lyrics changed. Compare the new baseline and prepare a new snapshot.');
  let saved = current, shouldSave = false;
  if (task.step === 'saved') {
    if (!task.saveBody || current.version !== task.draftVersion || !equal(current.content, task.saveBody.content)) throw new Error('The remote draft differs from the frozen snapshot. Compare it before preparing another upload.');
  } else if (task.step === 'saving') {
    if (!task.saveBody) throw new Error('The frozen save request is missing. Prepare a new snapshot.');
    if (current.version === task.draftVersion && current.etag === task.etag) shouldSave = true;
    else if (current.version !== task.draftVersion! + 1 || !equal(current.content, task.saveBody.content)) throw new Error('The remote draft differs from the frozen snapshot. Compare it before preparing another upload.');
  } else {
    if (current.version !== task.draftVersion || current.etag !== task.etag) throw new Error('The remote draft version changed. Your local snapshot is preserved.');
    const content = structuredClone(task.content);
    if (content.sync) {
      const fingerprint = await contributionRequest<{ textFingerprint: string }>(task, 'fingerprint', { id: task.draftId, text: content.text });
      if (!/^[a-f0-9]{64}$/.test(fingerprint.textFingerprint)) throw new Error('LyricFlow returned an invalid text fingerprint.');
      content.sync.textFingerprint = fingerprint.textFingerprint;
    }
    task = await persistUpload({ ...task, content, saveBody: { content }, step: 'saving' });
    shouldSave = true;
  }
  if (shouldSave) {
    // Persist/check the same request before an explicit retry; never rebuild it from the editor.
    task = await persistUpload(task);
    const content = task.saveBody!.content;
    try { saved = validateDraft(await contributionRequest<DraftDto>(task, 'saveDraft', { id: task.draftId, etag: task.etag, content }), task); }
    catch (error) {
      const recovered = validateDraft(await contributionRequest<DraftDto>(task, 'draft', { id: task.draftId }), task);
      if (recovered.version !== task.draftVersion! + 1 || recovered.baseRevisionId !== task.baseRevisionId || !equal(recovered.content, content)) throw error; saved = recovered;
    }
    if (saved.version !== task.draftVersion! + 1 || saved.baseRevisionId !== task.baseRevisionId) throw new Error('The remote draft version changed. Your local snapshot is preserved.');
  }
  if (!equal(saved.content, task.saveBody?.content)) throw new Error('The server saved different content. Review the draft before submitting.');
  const changes = await contributionRequest<{ components: Component[] }>(task, 'changes', { id: task.draftId });
  const expected = changedComponents(task.baseSnapshot?.content || null, saved.content);
  if (!Array.isArray(changes.components) || new Set(changes.components).size !== changes.components.length || changes.components.length !== expected.length || changes.components.some(c => !expected.includes(c)) || changes.components.some(c => !task.components.includes(c))) throw new Error('The server reports changes outside the confirmed component selection. Review the draft again.');
  if (!changes.components.length) throw new Error('There are no changes to submit.');
  return persistUpload({ ...task, step: 'saved', content: saved.content, draftVersion: saved.version, etag: saved.etag, savedAt: saved.savedAt, components: changes.components, paused: false });
}
export async function submitUpload(input: LyricFlowUpload, provenance?: Provenance): Promise<LyricFlowUpload> {
  if (!input.draftId || !input.draftVersion || !['saved', 'submitting_unknown'].includes(input.step)) throw new Error('Save and review the frozen draft before submitting.');
  if (!input.submitBody && !provenance) throw new Error('Choose the source and provide a declaration.');
  const task = await persistUpload({ ...input, step: 'submitting_unknown', submitBody: input.submitBody || { expectedDraftVersion: input.draftVersion, components: input.components, provenance: provenance! } });
  const result = await contributionRequest<SubmissionDto>(task, 'submit', { id: task.draftId, body: task.submitBody, idempotencyKey: task.idempotencyKeys.submit });
  if (!result || typeof result.id !== 'string' || !result.id || result.status !== 'pending') throw new Error('The submission result is not confirmed. Retry the saved operation.');
  return persistUpload({ ...task, step: 'pending', submissionId: result.id });
}
export async function refreshUpload(input: LyricFlowUpload, withdraw = false): Promise<LyricFlowUpload> {
  if (!input.submissionId) throw new Error('No confirmed submission is available.');
  const task = await persistUpload(input);
  const result = await contributionRequest<SubmissionDto>(task, withdraw ? 'withdraw' : 'status', { id: task.submissionId, ...(withdraw ? { idempotencyKey: task.idempotencyKeys.withdraw } : {}) });
  if (!result || result.id !== task.submissionId || !['pending', 'approved', 'rejected', 'conflicted', 'withdrawn'].includes(result.status) || withdraw && result.status !== 'withdrawn' || !withdraw && result.documentId !== task.targetDocumentId) throw new Error('LyricFlow returned an invalid submission status.');
  return persistUpload({ ...task, step: result.status, decision: result.decision });
}
