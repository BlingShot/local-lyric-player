import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseLrc, LRC_LIMITS } from '../src/lyrics/parseLrc.ts';
test('F04 physical lines, total events, per-line tags and expanded words are bounded before expansion', () => {
  assert.throws(()=>parseLrc('\n'.repeat(10002)+'[00:00]x'),/physical/);
  assert.throws(()=>parseLrc('[00:00]'.repeat(129)+'x'),/timestamps per line/);
  assert.throws(()=>parseLrc(('[00:00]'.repeat(100)+'\n').repeat(101)+'[00:01]x'),/events/);
  assert.throws(()=>parseLrc('[00:00]'.repeat(128)+'<00:00>x'.repeat(400)),/word nodes/);
  assert.throws(()=>parseLrc('x'.repeat(LRC_LIMITS.source+1)),/2 MB/);
});
test('F04 nonfinite, malformed and out-of-range offsets cannot poison line or word timing', () => {
  for(const offset of ['9'.repeat(400),'-'+'9'.repeat(400),'Infinity','NaN','86400001'])
    assert.throws(()=>parseLrc(`[offset:${offset}]\n[00:00]x`),/offset|range/);
  assert.throws(()=>parseLrc('[offset:-86400000]\n[00:01]x'),/range/);
  const doc=parseLrc('[offset:500]\n[00:00.100]<00:00.100>Hello<00:01.000>\n[00:02]');
  assert.equal(doc.lines[0].start,-.4); assert.equal(doc.lines[0].end,1.5);
});
test('F04 duplicate timestamps share the next distinct start without copying suffix arrays', () => {
  const source='[00:00]\n'.repeat(8000)+'[00:00]A\n[00:00]B\n[00:03]\n[00:04]C';
  const start=performance.now();const doc=parseLrc(source);
  assert.deepEqual(doc.lines.map(l=>l.end),[3,3,undefined]);
  assert.ok(performance.now()-start<3000,'bounded fixture should finish in under 3 seconds');
});
