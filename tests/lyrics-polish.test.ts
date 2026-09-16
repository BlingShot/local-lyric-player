import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vocalLayout, activeVocalLayout } from '../src/lyrics/vocalLayout.ts';
import { wordVisualProgress } from '../src/lyrics/wordVisual.ts';
import { partProgress } from '../src/lyrics/timeline.ts';
import { completedInterludeDots } from '../src/lyrics/interludeProgress.ts';
import { sustainedGlow } from '../src/lyrics/sustained.ts';
import { newProject, vocalLine } from '../src/studio/project.ts';
import { recordingVoices, voiceCursorAt } from '../src/studio/recordingVoices.ts';
import { recordWord } from '../src/studio/recordWord.ts';

test('duets split; backgrounds follow their parent; a later solo singer stays left', () => {
  const rows = [
    { id: 'a', groupId: 'a', agent: 'A', role: 'lead' as const, start: 10, end: 20 },
    { id: 'abg', groupId: 'a', agent: 'B', role: 'background' as const, start: 11, end: 19 },
    { id: 'b', groupId: 'b', agent: 'B', role: 'lead' as const, start: 10, end: 20 },
    { id: 'bbg', groupId: 'b', agent: 'A', role: 'background' as const, start: 11, end: 19 },
    { id: 'solo', groupId: 'solo', agent: 'B', role: 'lead' as const, start: 30, end: 40 },
  ];
  const layout = vocalLayout(rows), duet = activeVocalLayout(layout, new Set(['a', 'abg', 'b', 'bbg']));
  assert.equal(duet.get('a')?.side, 'left'); assert.equal(duet.get('b')?.side, 'right');
  assert.deepEqual(duet.get('abg'), duet.get('a')); assert.deepEqual(duet.get('bbg'), duet.get('b'));
  assert.equal(layout.get('solo')?.split, false); assert.equal(layout.get('solo')?.side, 'left');
  assert.equal(activeVocalLayout(layout, new Set(['b'])).get('b')?.side, 'right');
  assert.ok([...activeVocalLayout(layout, new Set(['a','b']), false).values()].every(lane => lane.side === 'left' && !lane.split));
});
test('adjacent phrases are not falsely classified as simultaneous', () => {
  const layout = vocalLayout([{ id: 'a', groupId:'a', role:'lead', agent:'A', start:0,end:10 }, { id:'b',groupId:'b',role:'lead',agent:'B',start:10,end:20 }]);
  assert.ok([...layout.values()].every(lane => !lane.split && lane.side === 'left'));
});
test('short words ease after their actual start without changing original timing', () => {
  const part = { text: 'fast', start: 10, end: 10.04 };
  assert.equal(wordVisualProgress(part, 9.99), 0);
  assert.equal(wordVisualProgress(part, 10), 0);
  assert.equal(partProgress(part, 10.05), 1);
  assert.ok(wordVisualProgress(part, 10.05)! > 0 && wordVisualProgress(part, 10.05)! < 1);
  assert.equal(wordVisualProgress(part, 10.2), 1);
  assert.deepEqual(part, { text: 'fast', start: 10, end: 10.04 });
});
test('30-second breaks advance only at 10, 20, and 30 seconds, including seeks', () => {
  for (const [time, count] of [[0,0],[9.999,0],[10,1],[19.999,1],[20,2],[29.999,2],[30,3],[5,0],[25,2]]) assert.equal(completedInterludeDots(0,30,time),count);
  assert.equal(completedInterludeDots(10,10,12),0);
});
test('sustained glow has continuous zero-strength edges and no future-word glow', () => {
  const part = { text: 'light', start: 1, end: 4 };
  assert.equal(sustainedGlow(part, 1),0); assert.equal(sustainedGlow(part,4),0);
  assert.ok(sustainedGlow(part,1.001) < .001 && sustainedGlow(part,3.999) < .001);
  assert.ok(sustainedGlow(part,2) > .5);
  assert.equal(sustainedGlow({ text:'short',start:1,end:1.1 },1.05),0);
});
test('parallel voice recording preserves every interval and advances each lane', () => {
  let project = newProject('test','test.wav');
  const a = vocalLine('Alpha one'), b = vocalLine('Beta two'), bg = vocalLine('Echo ah','background',a.id), next = vocalLine('Alpha next');
  a.performerId='A'; b.performerId='B'; bg.performerId='A'; next.performerId='A';
  project = { ...project, lines:[a,b,bg,next], selectedId:a.id };
  const voices = recordingVoices(project); assert.equal(voices.length,3);
  for (const line of [a,b,bg]) {
    const words=line.units.filter(w=>w.kind==='word');
    project=recordWord(project,line.id,words[0].id,1000,1400);
    project=recordWord(project,line.id,words[1].id,1400,1800);
  }
  assert.ok(project.lines.slice(0,3).every(line=>line.units.filter(w=>w.kind==='word').every(w=>w.startMs!==null && w.endMs!==null)));
  const aVoice=recordingVoices(project).find(voice=>voice.performerId==='A' && voice.role==='lead')!;
  assert.equal(voiceCursorAt(project,aVoice,2000)?.lineId,next.id);
});
test('known overlapping takes of the same performer get separate recording lanes', () => {
  const p=newProject('test','test.wav'),a=vocalLine('First'),b=vocalLine('Second');
  for(const line of [a,b]) { line.performerId='A';line.startMs=1000;line.endMs=2000; }
  assert.equal(recordingVoices({...p,lines:[a,b]}).length,2);
});
