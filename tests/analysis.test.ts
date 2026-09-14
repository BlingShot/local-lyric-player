import test from 'node:test';
import assert from 'node:assert/strict';
import { AnalysisTasks } from '../src/analysis/tasks.ts';
import { audioVersion, fingerprint, staleReasons } from '../src/analysis/versions.ts';
import type { AnalysisInput, LocalAnalysisAdapter, LyricsInsights, AnyAnalysisRecord } from '../src/analysis/types.ts';
import { parseLrc } from '../src/lyrics/parseLrc.ts';
import { interludeBefore } from '../src/lyrics/interludes.ts';

const input: AnalysisInput = { track: { id: 'a', name: 'Same title', size: 10, lastModified: 1 },
  versions: { audio: { a: 'rev-a', b: 'rev-b' }, metadata: 'meta', lyrics: { kind: 'studio', fingerprint: 'text' } },
  lyrics: { kind: 'studio', fingerprint: 'text', label: 'Draft', lines: [{ id: 'line1', text: 'A light in the dark' }] },
  readAudio: async () => new Blob(['test']) };
const algorithm = { id: 'unit-test-only', name: 'Unit fixture', version: '1' };
const bpm: LocalAnalysisAdapter<'bpm-key'> = { execution: 'local', kind: 'bpm-key', algorithm, run: async () => ({ bpm: 120 }) };

test('analysis versions distinguish stable IDs, replaced audio, lyric source/text and missing album participants', async () => {
  assert.notEqual(audioVersion(input.track), audioVersion({ ...input.track, id: 'b' }));
  assert.notEqual(audioVersion({ ...input.track, audioRevision: 'old' }), audioVersion({ ...input.track, audioRevision: 'new' }));
  assert.equal(await fingerprint(['A', 'B']), await fingerprint(['A', 'B']));
  assert.notEqual(await fingerprint(['A', 'B']), await fingerprint(['A', 'C']));
  assert.deepEqual(staleReasons(input.versions, input.versions), []);
  assert.equal(staleReasons(input.versions, { audio: { a: 'rev-a' }, lyrics: { kind: 'imported', fingerprint: 'text' }, metadata: 'changed' }).length, 3);
});
test('local tasks preserve independent states, capture algorithm/settings and save only after completion', async () => {
  const tasks = new AnalysisTasks(), saved: AnyAnalysisRecord[] = [];
  await tasks.run('bpm', { ...bpm, run: async (_, context) => { assert.equal(context.settings.target, -18); context.progress({ message: 'Reading' }); assert.equal(tasks.get('bpm').progress, undefined); return { bpm: 120 }; } }, input, { target: -18 }, async result => { saved.push(result); });
  assert.equal(tasks.get('bpm').status, 'complete'); assert.equal(tasks.get('other').status, 'idle');
  assert.deepEqual(saved[0].input, { audio: { a: 'rev-a' } }); assert.deepEqual(saved[0].algorithm, algorithm);
  assert.deepEqual(saved[0].settings, { target: -18 }); assert.ok(saved[0].analyzedAt > 0);
});
test('cancelled adapters cannot save late results and rerun errors retain the prior saved output', async () => {
  const tasks = new AnalysisTasks(), saved: AnyAnalysisRecord[] = [];
  let finish!: (value: { bpm: number }) => void;
  const run = tasks.run('bpm', { ...bpm, run: async (_, { signal }) => { assert.equal(signal.aborted, false); return new Promise(resolve => { finish = resolve; }); } }, input, {}, async result => { saved.push(result); });
  tasks.cancel('bpm'); finish({ bpm: 99 }); await run;
  assert.equal(tasks.get('bpm').status, 'cancelled'); assert.equal(saved.length, 0);
  await tasks.run('bpm', bpm, input, {}, async result => { saved.push(result); });
  await tasks.run('bpm', { ...bpm, run: async () => { throw new Error('Decoder failed'); } }, input, {}, async result => { saved.push(result); });
  assert.equal(tasks.get('bpm').status, 'error'); assert.match(tasks.get('bpm').message, /Decoder failed/); assert.equal(saved.length, 1);
  await tasks.run('bpm', bpm, input, {}, async () => { throw new Error('Storage full'); });
  assert.equal(tasks.get('bpm').status, 'error'); assert.match(tasks.get('bpm').message, /Storage full/);
});
test('lyrics require actual text and original evidence; remote adapters are rejected', async () => {
  const tasks = new AnalysisTasks(); let calls = 0, saves = 0;
  const result: LyricsInsights = { interpretation: 'A possible reading', themes: [{ name: 'Hope', reason: 'The contrast', evidence: [{ lineId: 'line1', quote: 'invented quote' }] }], moods: [], advisory: [], basis: 'lyrics-text-only', authorIntent: 'interpretation', advisorySource: 'ai' };
  const adapter: LocalAnalysisAdapter<'lyrics'> = { kind: 'lyrics', execution: 'local', algorithm, run: async () => { calls++; return result; } };
  await tasks.run('lyrics', adapter, { ...input, lyrics: undefined }, {}, async () => { saves++; });
  assert.equal(calls, 0); assert.match(tasks.get('lyrics').message, /Import or edit lyrics/);
  await tasks.run('lyrics', adapter, input, {}, async () => { saves++; });
  assert.equal(saves, 0); assert.match(tasks.get('lyrics').message, /actual selected lyrics/);
  result.themes[0].evidence[0].quote = 'light';
  await tasks.run('lyrics', adapter, input, {}, async () => { saves++; }); assert.equal(saves, 1);
  await assert.rejects(tasks.run('cloud', { ...adapter, execution: 'remote' as 'local' }, input, {}, async () => {}), /local analyzers/);
});
test('loudness captures only the selected song and rejects album or mismatched scopes', async () => {
  const tasks = new AnalysisTasks(); let saved: AnyAnalysisRecord | undefined;
  const scope = { kind: 'track' as const, trackIds: ['a'] };
  const adapter: LocalAnalysisAdapter<'loudness'> = { kind: 'loudness', execution: 'local', algorithm, run: async () => ({ scope, integratedLufs: -16 }) };
  await tasks.run('track', adapter, input, { targetLufs: -18 }, async result => { saved = result; });
  assert.deepEqual(saved?.input.audio, { a: 'rev-a' });
  assert.equal(staleReasons(saved!.input, { audio: { a: 'replaced' } }).length, 1);
  for (const invalid of [{ kind: 'album', trackIds: ['a', 'b'] }, { kind: 'track', trackIds: ['b'] }]) {
    await tasks.run('invalid', { ...adapter, run: async () => ({ scope: invalid }) }, input, {}, async () => { throw new Error('Should not save'); });
    assert.equal(tasks.get('invalid').status, 'error');
  }
});
test('interlude marks only gaps strictly over ten seconds without changing line timing or overlapping voices', () => {
  const lyrics = parseLrc('[00:00]First\n[00:10]Second\n[00:20.001]Third');
  const before = structuredClone(lyrics); assert.deepEqual([...interludeBefore(lyrics)], []); assert.deepEqual(lyrics, before);
  const overlap = { ...lyrics, format: 'ttml' as const, lines: [{ ...lyrics.lines[0], end: 30 }, { ...lyrics.lines[1], start: 12, end: 15 }, { ...lyrics.lines[2], start: 42, end: 45 }] };
  assert.deepEqual([...interludeBefore(overlap)], [['lrc-2', { start: 30, end: 42 }]]);
  const explicit = parseLrc('[00:00]First\n[00:02]\n[00:15]Second');
  assert.deepEqual([...interludeBefore(explicit)], [['lrc-2', { start: 2, end: 15 }]]);
});
