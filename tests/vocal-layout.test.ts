import assert from 'node:assert/strict';
import { test } from 'node:test';
import { vocalLayout, vocalScenes, vocalSceneRows, activeVocalLayout, type VocalLayoutLine } from '../src/lyrics/vocalLayout.ts';
const line = (id: string, agent: string, start: number, end: number): VocalLayoutLine => ({ id, groupId: id, role: 'lead', agent, start, end });

test('F07 a duet has identical geometry through 0/1/2/1/0 active voices and backwards seeks', () => {
  const lines = [line('a', 'A', 0, 3), line('b', 'B', 1, 5)], layout = vocalLayout(lines);
  for (const ids of [[], ['a'], ['a', 'b'], ['b'], [], ['b'], ['a', 'b'], ['a']])
    assert.deepEqual([...activeVocalLayout(layout, new Set(ids))], [...layout]);
  assert.equal(layout.get('b')?.side, 'right');
  assert.ok([...activeVocalLayout(layout, new Set(['b']), false).values()].every(l => l.side === 'left' && !l.split));
});
test('F07 chained overlap uses a spanning partner, not colliding or moving lyrics', () => {
  const lines = [line('a1', 'A', 0, 3), line('b', 'B', 2, 5), line('a2', 'A', 4, 7)];
  const layout = vocalLayout(lines), scenes = vocalScenes(lines);
  assert.equal(scenes.length, 1);
  const cells = vocalSceneRows(scenes[0].groups, layout);
  assert.deepEqual(cells.get('a1'), { row: 1, rowSpan: 1 });
  assert.deepEqual(cells.get('a2'), { row: 2, rowSpan: 1 });
  assert.deepEqual(cells.get('b'), { row: 1, rowSpan: 2 });
});
test('F07 backgrounds extend their parent scene and never acquire an independent column', () => {
  const bg = { ...line('bg', 'B', 2, 8), role: 'background' as const, groupId: 'a' };
  const lines = [line('a', 'A', 0, 3), bg, line('b', 'B', 5, 7), line('solo', 'B', 8, 10)];
  const layout = vocalLayout(lines), scenes = vocalScenes(lines);
  assert.deepEqual(layout.get('bg'), layout.get('a'));
  assert.equal(scenes.length, 2);
  assert.equal(layout.get('solo')?.split, false);
});
test('F07 three simultaneous singers use distinct cells and retain every group', () => {
  const lines = [line('a', 'A', 1, 4), line('b', 'B', 1, 4), line('c', 'C', 1, 4)];
  const layout = vocalLayout(lines), scene = vocalScenes(lines)[0], cells = vocalSceneRows(scene.groups, layout);
  const occupied = new Set<string>();
  for (const l of lines) {
    const cell = cells.get(l.id)!;
    for (let row = cell.row; row < cell.row + cell.rowSpan; row++) {
      const key = `${layout.get(l.id)!.side}:${row}`;
      assert.ok(!occupied.has(key)); occupied.add(key);
    }
  }
  assert.equal(cells.size, 3);
});
