import test from 'node:test';
import assert from 'node:assert/strict';
import { newProject, vocalLine } from '../src/studio/project.ts';
import { projectToContentV1 } from '../src/integrations/lyricflow/contributionAdapter.ts';
import { revisionToStudioProject } from '../src/integrations/lyricflow/adapter.ts';
import type { ContentV1, LyricFlowSourceV1 } from '../src/integrations/lyricflow/types.ts';

function source(): LyricFlowSourceV1 {
  const content: ContentV1 = { schemaVersion: 1, text: { lines: [{ lineId: 'a', order: 0, text: '  Sing 😀 again ', kind: 'vocal' }, { lineId: 'blank', order: 1, text: '', kind: 'blank' }, { lineId: 'note', order: 2, text: 'repeat', kind: 'note' }, { lineId: 'b', order: 3, text: '  Sing 😀 again ', kind: 'vocal' }] },
    sync: { textFingerprint: 'a'.repeat(64), reference: { trackId: 'remote', source: 'catalog', externalId: null, durationMs: 10000, offsetMs: 100 }, timings: [{ lineId: 'a', startMs: 1000, endMs: 2000, endSource: 'derived' }, { lineId: 'b', startMs: 3000, endMs: null, endSource: 'unknown' }] },
    structure: [{ lineId: 'a', section: 'post-chorus' }], performers: { participants: [{ id: 'p', name: 'One' }, { id: 'q', name: 'Two' }], assignments: [{ lineId: 'a', performerIds: ['p', 'q'], ranges: [{ start: 7, end: 9, performerIds: ['q'] }] }] }, source: null };
  return { provider: 'lyricflow', formatVersion: 1, apiOrigin: 'https://lyrics.example', trackId: 'remote', documentId: 'document', revisionId: 'revision', fetchedAt: 1, snapshot: { id: 'revision', documentId: 'document', content, components: {}, provenance: null, publishedAt: '2026-10-07T00:00:00Z' } };
}
test('sync-only round trip preserves remote identities, repeated chorus, blank/note, unsupported sections and UTF-16 performer ranges', () => {
  const original = source(), project = revisionToStudioProject(original, 'local', 'song.wav');
  project.lines[0].startMs = 1200;
  const result = projectToContentV1(project, { trackId: 'remote', durationMs: 10000, baseline: original.snapshot.content, components: ['sync'] });
  assert.deepEqual(result.blockingIssues, []);
  for (const component of ['text', 'structure', 'performers'] as const) assert.deepEqual(result.content[component], original.snapshot.content[component]);
  assert.deepEqual(result.lineMap, { a: 'a', b: 'b' });
  assert.equal(result.content.sync?.reference.offsetMs, 0);
  assert.equal(result.content.sync?.timings[0].startMs, 1200);
  assert.equal(result.content.sync?.timings[0].endMs, 2100);
  assert.equal(result.content.sync?.timings[0].endSource, 'derived');
  assert.equal(result.content.sync?.timings[1].startMs, 3100);
  assert.equal(result.content.sync?.timings[1].endMs, null);
});
test('sync-only refuses unmatched IDs or changed text instead of matching repeated text by position', () => {
  const original = source(), project = revisionToStudioProject(original, 'local', 'song.wav');
  project.lines[0].text = 'changed'; project.lines[0].units = [];
  const result = projectToContentV1(project, { trackId: 'remote', durationMs: 10000, baseline: original.snapshot.content, components: ['sync'] });
  assert.ok(result.blockingIssues.some(issue => issue.code === 'TEXT_ALIGNMENT_REQUIRED'));
});
test('word, background, annotations and styling losses are explicit and the original project is untouched', () => {
  const project = newProject('local', 'audio.wav'), lead = vocalLine('hello 😀');
  lead.startMs = 1000; lead.endMs = 2000; lead.units[0].startMs = 1000;
  lead.annotations = [{ id: 'tr', targetId: lead.id, text: '你好', kind: 'translation', language: 'zh' }, { id: 'ro', targetId: lead.id, text: 'hello', kind: 'romanization', language: 'en' }];
  project.lines = [lead, vocalLine('backing', 'background', lead.id)];
  project.performers = [{ id: 'p', name: 'Singer', type: 'person', color: '#ffffff', align: 'left' }];
  const before = structuredClone(project), result = projectToContentV1(project, { trackId: 'remote', durationMs: 10000 });
  assert.deepEqual(project, before); assert.equal(result.content.text.lines.length, 1);
  assert.deepEqual(new Set(result.losses.map(issue => issue.code)), new Set(['WORD_TIMING_OMITTED', 'BACKGROUND_RELATION_UNSUPPORTED', 'TRANSLATION_NOT_SUBMITTED', 'ROMANIZATION_UNSUPPORTED', 'STYLE_LOCAL_ONLY']));
});
test('unit performer ranges use UTF-16 indices, retain spaces, and never introduce word timings', () => {
  const project = newProject('local', 'audio.wav');
  const line = vocalLine('😀 Sing'); line.performerId = 'p'; line.units = [{ id: 'u', text: '😀 ', kind: 'word', startMs: null, endMs: null, performerId: 'q' }, { id: 'v', text: 'Sing', kind: 'word', startMs: null, endMs: null }];
  project.lines = [line]; project.performers = ['p', 'q'].map(id => ({ id, name: id, type: 'person', color: '#ffffff', align: 'auto' }));
  const result = projectToContentV1(project, { trackId: 'remote', durationMs: null });
  assert.deepEqual(result.blockingIssues, []);
  assert.deepEqual(result.content.performers.assignments[0].ranges, [{ start: 0, end: 3, performerIds: ['q'] }]);
  assert.equal(result.content.sync?.timings[0].startMs, null);
  assert.equal(result.content.sync?.reference.source, 'unknown');
  assert.ok(result.warnings.some(issue => issue.code === 'UNTIMED_LINE'));
});
test('all-component edits block unsupported multi-person replacement and invalid timing', () => {
  const original = source(), project = revisionToStudioProject(original, 'local', 'audio.wav');
  project.lines[0].endMs = 12000;
  const result = projectToContentV1(project, { trackId: 'remote', durationMs: 10000, baseline: original.snapshot.content });
  assert.ok(result.blockingIssues.some(issue => issue.code === 'PERFORMER_ALIGNMENT_REQUIRED'));
  assert.ok(result.blockingIssues.some(issue => issue.code === 'TIMING_OUT_OF_RANGE'));
});
test('text edits and reordering preserve remote IDs and non-vocal records', () => {
  const original = source(), project = revisionToStudioProject(original, 'local', 'audio.wav');
  project.lines.reverse(); project.lines[0].text = 'Changed repeated chorus';
  const result = projectToContentV1(project, { trackId: 'remote', durationMs: 10000, baseline: original.snapshot.content, components: ['text', 'sync'] });
  assert.deepEqual(result.content.text.lines.map(line => line.lineId), ['b', 'blank', 'note', 'a']);
  assert.equal(result.content.text.lines[0].text, 'Changed repeated chorus');
  assert.deepEqual(result.content.text.lines.map(line => line.order), [0, 1, 2, 3]);
});
