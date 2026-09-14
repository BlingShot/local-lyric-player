import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newProject, vocalLine, shiftProject, parseProject } from '../src/studio/project.ts';
import { clearSync, markSync, setBoundary, LYRIC_START, LYRIC_END } from '../src/studio/sync.ts';
import { lineBounds, validateProject } from '../src/studio/validation.ts';
import { exportProjectLrc, exportProjectTtml } from '../src/studio/projectExport.ts';
import { importProjectLrc } from '../src/studio/projectImportLrc.ts';

const fixture = () => { const p = newProject('stable-song', 'Song.flac'); p.lines = [vocalLine("Don't stop!"), vocalLine('春天 & 光')]; p.selectedId = p.lines[0].id; return p; };
test('both arrows move first and record the destination, with an internal before-first cursor', () => {
  const p = fixture(); let n = markSync(p, 5100, 1);
  assert.equal(n.lines[1].startMs, 5100); assert.equal(n.selectedId, p.lines[1].id);
  n = markSync(n, 10230, -1); assert.equal(n.lines[0].startMs, 10230); assert.equal(n.selectedId, p.lines[0].id);
  n = markSync(n, 4800, -1); assert.equal(n.selectedId, p.lines[0].id); assert.equal(n.lines[0].startMs, 4800);
  assert.equal(markSync(clearSync(p), 100, 1).lines[0].startMs, 100);
  assert.equal(p.lines[0].startMs, null); assert.equal(markSync(p, NaN, 1), p);
});
test('clear sync retains text, identities, performers and annotations; old immutable snapshot is recoverable', () => {
  const p = fixture(); p.lines[0].startMs = 3000; p.lines[0].endMs = 9000;
  p.lines[0].units[0].startMs = 3200; p.lines[0].units[0].endMs = 6000;
  p.performers = [{ id:'singer', name:'Singer', type:'person',color:'#1ed760',align:'auto' }]; p.lines[0].performerId='singer';
  p.lines[0].annotations = [{id:'tr',targetId:p.lines[0].id,kind:'translation',language:'zh-Hans',text:'别停'}];
  p.lines.push({...vocalLine('Ah', 'background',p.lines[0].id),startMs:4000,endMs:7000});
  p.sections=[{id:'verse',tag:'VERSE',lineIds:[p.lines[0].id],startMs:3000,endMs:9000}];
  const n = clearSync(p); assert.equal(n.selectedId, LYRIC_START); assert.deepEqual(n.boundaries,{startMs:null,endMs:null});
  assert.deepEqual(n.lines.map(l=>[l.id,l.text,l.performerId,l.parentId,l.annotations]),p.lines.map(l=>[l.id,l.text,l.performerId,l.parentId,l.annotations]));
  assert.ok(n.lines.every(l=>l.startMs===null && l.endMs===null && l.units.every(w=>w.startMs===null&&w.endMs===null)));
  assert.equal(n.sections[0].startMs,null); assert.equal(p.lines[0].startMs,3000);
  assert.equal(clearSync(p,p.lines[0].id).lines[2].startMs,null);
});
test('optional legacy start and End marker preserve full line timing in exports', () => {
  let p=clearSync(fixture()); p=markSync(p,2200,1); p=markSync(p,5500,1);
  assert.ok(validateProject(p,20000,'line').some(i=>i.lineId===LYRIC_END));
  p=markSync(p,9200,1); assert.equal(p.selectedId,LYRIC_END);
  assert.equal(lineBounds(p,p.lines[1],20000).end,9200); assert.deepEqual(validateProject(p,20000,'line'),[]);
  const xml=exportProjectTtml(p,20000,'line'); assert.ok(xml.includes('localMusic:lyricEndMs')); assert.ok(!xml.includes('lyricStartMs')); assert.ok(xml.includes('&amp;'));
  const lrc=exportProjectLrc(p,20000,{voices:'lead',annotations:'omit'});assert.ok(lrc.includes('[00:09.200]'));assert.ok(!lrc.includes('Start of the Lyric'));
  assert.deepEqual(importProjectLrc(lrc,p.trackId,p.audioName).boundaries,p.boundaries);
  assert.ok(validateProject(p,20000,'word').some(i=>i.unitId));
  const shifted=shiftProject(p,500,'all');assert.equal(shifted.boundaries.startMs,null);assert.equal(shifted.boundaries.endMs,9700);
  assert.deepEqual(parseProject(JSON.stringify(p)).boundaries,p.boundaries);
  assert.ok(validateProject(setBoundary(p,LYRIC_END,4000),20000,'line').some(i=>i.lineId===p.lines[1].id));
});
test('LRC marker import honors offset and does not confuse an internal pause with Start',()=>{
  const p=importProjectLrc('[offset:100]\n[00:01.000]\n[00:02.000]Hello\n[00:03.000]\n[00:04.000]Again\n[00:05.000]','x','x.wav');
  assert.deepEqual(p.boundaries,{startMs:900,endMs:4900});assert.equal(p.lines[0].endMs,2900);
  assert.deepEqual(importProjectLrc('[00:02.000]Hello\n[00:03.000]\n[00:04.000]Again\n[00:05.000]','x','x.wav').boundaries,{startMs:null,endMs:5000});
});

import { editWordTime, previousWord, recordWord } from '../src/studio/recordWord.ts';
import { groupVocalLines } from '../src/lyrics/visualOrder.ts';
import { deleteLine } from '../src/studio/operations.ts';
test('final word updates obsolete bounds and advances to the next lead, skipping its harmony',()=>{
 const p=fixture(), l=p.lines[0], words=l.units.filter(w=>w.kind==='word'); l.startMs=1000;l.endMs=2000;
 words[0].startMs=1000;words[0].endMs=1500;
 const bg={...vocalLine('Ah','background',l.id),startMs:1500,endMs:4000};p.lines.splice(1,0,bg);
 const q=recordWord(p,l.id,words.at(-1).id,2000,4500);
 assert.equal(q.lines[0].endMs,4500);assert.equal(q.lines[0].units.find(w=>w.id===words.at(-1).id).endMs,4500);
 assert.equal(q.selectedId,p.lines[2].id);assert.equal(q.selectedUnitId,p.lines[2].units.find(w=>w.kind==='word').id);
 assert.deepEqual(q.lines[1],bg);assert.equal(l.endMs,2000);
 assert.equal(validateProject(q,10000,'word').some(i=>i.message.includes('outside its vocal line')&&i.lineId===l.id),false);
 const gone=deleteLine(q,bg.id);assert.equal(gone.lines.some(v=>v.id===bg.id),false);assert.equal(gone.lines[0].id,l.id);
});
test('editing a final word extends the vocal envelope without moving other words or explicit pauses',()=>{
 const p=fixture(), l=p.lines[0], words=l.units.filter(w=>w.kind==='word');l.startMs=1000;l.endMs=2000;
 const q=editWordTime(l,words.at(-1).id,{startMs:1800,endMs:4500});
 assert.equal(lineBounds({...p,lines:[q]},q,10000).end,4500);assert.equal(q.units[0],l.units[0]);assert.equal(l.endMs,2000);
 assert.equal(editWordTime(q,words.at(-1).id,{endMs:4000}).endMs,4500);
 assert.equal(editWordTime(q,words[0].id,{startMs:500}).startMs,500);
 assert.equal(editWordTime(q,words.at(-1).id,{endMs:null}).endMs,4500);
});
test('returning from the first word crosses to the previous lead without selecting backing vocals',()=>{
 const p=fixture(), first=p.lines[0], next=p.lines[1];p.lines.splice(1,0,vocalLine('echo','background',first.id));
 p.selectedId=next.id;p.selectedUnitId=next.units[0].id;
 const q=previousWord(p);assert.equal(q.selectedId,first.id);assert.equal(q.selectedUnitId,first.units.filter(w=>w.kind==='word').at(-1).id);
 assert.deepEqual(q.lines,p.lines);
});
test('late overlapping backing vocals stay beside their parent in presentation only',()=>{
 const lead={id:'lead',role:'lead' as const,groupId:'group'}, next={id:'next',role:'lead' as const,groupId:'next'}, bg={id:'bg',role:'background' as const,groupId:'group'};
 const input=[lead,next,bg], order=groupVocalLines(input,l=>l.groupId);
 assert.deepEqual(order,[lead,bg,next]);assert.deepEqual(input,[lead,next,bg]);
 const extra={...lead,id:'duet'};assert.deepEqual(groupVocalLines([...input,extra],l=>l.groupId),[lead,bg,next,extra]);
});
