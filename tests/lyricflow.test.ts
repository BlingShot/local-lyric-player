import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseLyricFlowSource, revisionToPlayerDocument, revisionToStudioProject, validateContentV1, validateRevision } from '../src/integrations/lyricflow/adapter.ts';
import type { LyricFlowSourceV1 } from '../src/integrations/lyricflow/types.ts';

function source(): LyricFlowSourceV1 {
  const result: LyricFlowSourceV1 = { formatVersion: 1, provider: 'lyricflow', apiOrigin: 'https://lyrics.example', trackId: 'recording-a', documentId: 'document-a', revisionId: 'revision-a', fetchedAt: 123,
    snapshot: { id: 'revision-a', documentId: 'document-a', publishedAt: '2026-10-07T00:00:00.000Z', components: { text: { contentState: 'complete', verificationState: 'unverified' }, sync: { contentState: 'complete', verificationState: 'unverified' } }, provenance: { source: 'own_transcription' }, content: {
      schemaVersion: 1, text: { lines: [{ lineId: 'later', order: 2, text: '  Again 😀 ', kind: 'vocal' }, { lineId: 'blank', order: 1, text: '', kind: 'blank' }, { lineId: 'first', order: 0, text: '  Again 😀 ', kind: 'vocal' }] },
      sync: { textFingerprint: 'fingerprint', reference: { trackId: 'recording-a', source: 'client', externalId: null, durationMs: 10000, offsetMs: 250 }, timings: [{ lineId: 'first', startMs: 1000, endMs: null, endSource: 'unknown' }, { lineId: 'later', startMs: 3000, endMs: 6000, endSource: 'manual' }] },
      structure: [{ lineId: 'first', section: 'verse' }, { lineId: 'later', section: 'hook' }], performers: { participants: [{ id: 'a', name: 'Singer A' }, { id: 'b', name: 'Singer B' }], assignments: [{ lineId: 'first', performerIds: ['a', 'b'], ranges: [{ start: 8, end: 10, performerIds: ['b'] }] }] }, source: null,
    } } };
  const canonical = '{"lines":[{"kind":"vocal","lineId":"first","order":0,"text":"  Again 😀 "},{"kind":"blank","lineId":"blank","order":1,"text":""},{"kind":"vocal","lineId":"later","order":2,"text":"  Again 😀 "}],"schemaVersion":1}';
  result.snapshot.content.sync!.textFingerprint = createHash('sha256').update(canonical).digest('hex'); return result;
}
test('LyricFlow import retains identities, whitespace, source baseline and UTF-16 performer ranges', () => {
  const input = source(), player = revisionToPlayerDocument(input.snapshot, 10000), project = revisionToStudioProject(input, 'local', 'audio');
  assert.equal(player.format, 'lyricflow-json'); assert.equal(player.timing, 'line');
  assert.deepEqual(player.lines.map(line => [line.id, line.start, line.end]), [['first', 1.25, undefined], ['later', 3.25, 6.25]]);
  assert.equal(player.lines[0].parts.map(part => part.text).join(''), '  Again 😀 ');
  assert.deepEqual(player.lines[0].parts.find(part => part.agent === 'b'), { text: '😀', agent: 'b' });
  assert.deepEqual(project.lines.map(line => [line.id, line.startMs, line.endMs]), [['first', 1250, null], ['later', 3250, 6250]]);
  assert.deepEqual(project.lyricflow?.baseSnapshot, input.snapshot); assert.deepEqual(project.lyricflow?.lineMap, { first: 'first', later: 'later' });
  assert.equal(project.lyricflow?.timeBasis, 'recording'); assert.equal(project.sections.length, 1);
  assert.equal(input.snapshot.content.sync!.timings[0].startMs, 1000);
});
test('text-only and partial lyrics stay editable without fabricated playback timestamps', () => {
  const input = source(); input.snapshot.content.sync!.timings[0].startMs = null;
  assert.throws(() => revisionToPlayerDocument(input.snapshot, 10000), /not fully timed/);
  assert.equal(revisionToStudioProject(input, 'local', 'audio').lines[0].startMs, null);
  input.snapshot.content.sync = null;
  assert.throws(() => revisionToPlayerDocument(input.snapshot, 10000), /not fully timed/);
  assert.ok(revisionToStudioProject(input, 'local', 'audio').lines.every(line => line.startMs === null && line.endMs === null));
});
test('unknown versions, fractional times, duplicate IDs, wrong revisions and other recording timing are rejected', () => {
  const mutations = [
    (s: any) => { s.formatVersion = 2; }, (s: any) => { s.snapshot.content.schemaVersion = 2; },
    (s: any) => { s.snapshot.content.sync.timings[0].startMs = 1.5; },
    (s: any) => { s.snapshot.content.text.lines[0].lineId = 'first'; },
    (s: any) => { s.snapshot.id = 'another-revision'; },
    (s: any) => { s.snapshot.documentId = 'another-document'; },
    (s: any) => { s.snapshot.content.sync.reference.trackId = 'another-recording'; },
    (s: any) => { s.snapshot.content.performers.assignments[0].ranges[0].end = 100; },
  ];
  for (const mutate of mutations) { const input = source(); mutate(input); assert.throws(() => parseLyricFlowSource(JSON.stringify(input))); }
  assert.throws(() => validateRevision(source().snapshot, 'revision-b'));
  assert.throws(() => validateContentV1({ ...source().snapshot.content, unknown: true }));
});
test('recording offset is applied once and incompatible audio bounds never get clipped', () => {
  const input = source(); assert.throws(() => revisionToPlayerDocument(input.snapshot, 5000), /does not fit/);
  input.snapshot.content.sync!.reference.offsetMs = -2000;
  assert.throws(() => revisionToPlayerDocument(input.snapshot, 10000), /does not fit/);
  input.snapshot.content.text.lines = []; input.snapshot.content.sync = null; input.snapshot.content.structure = []; input.snapshot.content.performers.assignments = [];
  assert.throws(() => revisionToPlayerDocument(input.snapshot, 10000), /no vocal lyrics/);
});
test('unreviewed timing dependencies and schema budgets cannot become automatic playback', () => {
  const input = source(); input.snapshot.content.sync!.textFingerprint = 'mismatched';
  assert.throws(() => revisionToPlayerDocument(input.snapshot, 10000), /needs review/);
  const review = source(); review.snapshot.components.sync = { contentState: 'complete', verificationState: 'needs_review' };
  assert.throws(() => revisionToPlayerDocument(review.snapshot, 10000), /needs review/);
  const longLine = source(); longLine.snapshot.content.text.lines[0].text = 'x'.repeat(4001);
  assert.throws(() => validateContentV1(longLine.snapshot.content));
  const manyLines = source(); manyLines.snapshot.content.text.lines = Array.from({ length: 2001 }, (_, order) => ({ lineId: `line-${order}`, order, text: '', kind: 'blank' }));
  assert.throws(() => validateContentV1(manyLines.snapshot.content));
});
