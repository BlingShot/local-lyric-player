import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newProject, vocalLine } from '../src/studio/project.ts';
import { recordingVoices } from '../src/studio/recordingVoices.ts';
import { recordWord, previousWord } from '../src/studio/recordWord.ts';
import { studioTimeline, studioTimelineFrame, studioFollowTarget } from '../src/studio/playbackFrame.ts';
import { LYRIC_END } from '../src/studio/sync.ts';

test('overlapping singers advance and return within their own voice', () => {
  const project = newProject('duet', 'duet.wav');
  project.lines = ['A first', 'B first', 'A next', 'B next'].map((text, i) => ({ ...vocalLine(text), performerId: i % 2 ? 'bob' : 'alice' }));
  const a = project.lines[0], b = project.lines[1], aNext = project.lines[2];
  const word = a.units.filter(word => word.kind === 'word').at(-1)!;
  let next = recordWord(project, a.id, word.id, 1000, 1600);
  assert.equal(next.selectedId, aNext.id);
  assert.deepEqual(next.lines[1], b);
  next = previousWord(next);
  assert.equal(next.selectedId, a.id);
  assert.equal(next.selectedUnitId, word.id);
  const bWord = b.units[0];
  next = recordWord(next, b.id, bWord.id, 1100, 1800);
  assert.deepEqual(next.lines[0].units.find(unit => unit.id === word.id), { ...word, startMs: 1000, endMs: 1600 });
  assert.deepEqual(next.lines[1].units[0], { ...bWord, startMs: 1100, endMs: 1800 });
});

test('backing layers stay independent and continue under the next lead parent', () => {
  const project = newProject('backing', 'backing.wav');
  const a = { ...vocalLine('Main one'), performerId: 'lead' }, b = { ...vocalLine('Main two'), performerId: 'lead' };
  const bg = (parentId: string, text: string) => ({ ...vocalLine(text, 'background', parentId), performerId: 'backing' });
  project.lines = [a, bg(a.id, 'Ah'), bg(a.id, 'Oh'), b, bg(b.id, 'Again'), bg(b.id, 'Echo')];
  const voices = recordingVoices(project);
  assert.equal(voices.length, 3);
  assert.deepEqual(voices[1].words.map(word => word.lineId), [project.lines[1].id, project.lines[4].id]);
  assert.deepEqual(voices[2].words.map(word => word.lineId), [project.lines[2].id, project.lines[5].id]);
  const next = recordWord(project, project.lines[1].id, project.lines[1].units[0].id, 100, 900);
  assert.equal(next.selectedId, project.lines[4].id);
});

test('inline word performers also get independent recording cursors', () => {
  const project = newProject('inline', 'inline.wav'), line = vocalLine('One Two Three');
  line.performerId = 'a'; line.units.find(word => word.text === 'Two')!.performerId = 'b';
  project.lines = [line];
  assert.equal(recordingVoices(project).length, 2);
  const next = recordWord(project, line.id, line.units[0].id, 100, 400);
  assert.equal(next.selectedUnitId, line.units.find(word => word.text === 'Three')!.id);
});

test('End of Lyric takes focus at its timestamp, and releases it on backward seeking', () => {
  const timeline = studioTimeline([{ id: 'last', text: 'Last', start: '1', end: '5' }], 10, 5);
  assert.deepEqual(studioTimelineFrame(timeline, 4.999).activeIds, ['last']);
  assert.deepEqual(studioTimelineFrame(timeline, 5).activeIds, [LYRIC_END]);
  assert.equal(studioFollowTarget(timeline, 9), LYRIC_END);
  assert.deepEqual(studioTimelineFrame(timeline, 2).activeIds, ['last']);
  assert.deepEqual(studioTimelineFrame(timeline, -1).activeIds, []);
});
