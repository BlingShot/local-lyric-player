export interface VocalLayoutLine {
  id: string; groupId: string; role: 'lead' | 'background'; agent?: string;
  start: number; end?: number;
}
export interface VocalLane { groupId: string; side: 'left' | 'right'; split: boolean }
export interface VocalGridCell { row: number; rowSpan: number }
const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end;

function vocalGroups<T extends VocalLayoutLine>(lines: readonly T[]) {
  const grouped = new Map<string, T[]>();
  for (const line of lines) {
    const group = grouped.get(line.groupId) || [];
    group.push(line); grouped.set(line.groupId, group);
  }
  const starts = [...new Set(lines.map(line => line.start))].sort((a, b) => a - b);
  const nextStart = new Map(starts.map((start, i) => [start, starts[i + 1] ?? Infinity]));
  return [...grouped].map(([id, members], index) => {
    const lead = members.find(line => line.role === 'lead') || members[0];
    return { id, lines: members, index, performer: lead.agent?.trim().split(/\s+/).sort().join(' ') || id,
      start: Math.min(...members.map(line => line.start)),
      end: Math.max(...members.map(line => line.end ?? nextStart.get(line.start)!)),
    };
  }).sort((a, b) => a.start - b.start || a.index - b.index);
}

/** A backing vocal and its annotations always occupy their parent's lane. */
export function vocalLayout(lines: readonly VocalLayoutLine[]): Map<string, VocalLane> {
  const groups = vocalGroups(lines), assigned = new Map<string, VocalLane>();
  for (const group of groups) {
    const partners = groups.filter(other => other !== group && other.performer !== group.performer && overlaps(group, other));
    const occupied = new Set(partners.map(other => assigned.get(other.id)?.side).filter(Boolean));
    const side = occupied.has('left') && !occupied.has('right') ? 'right' : 'left';
    assigned.set(group.id, { groupId: group.id, side, split: partners.length > 0 });
  }
  return new Map(lines.map(line => [line.id, assigned.get(line.groupId)!]));
}

/** Playback changes highlighting, never structural lane ownership. */
export function activeVocalLayout(layout: ReadonlyMap<string, VocalLane>, _activeIds: ReadonlySet<string>, enabled = true): Map<string, VocalLane> {
  return new Map([...layout].map(([id, lane]) => [id,
    enabled ? lane : { ...lane, side: 'left', split: false },
  ]));
}

/** Temporal overlap components; a component may contain several visual rows. */
export function vocalScenes<T extends VocalLayoutLine>(lines: readonly T[]) {
  const groups = vocalGroups(lines), roots = groups.map((_, index) => index);
  const root = (index: number): number => roots[index] === index ? index : (roots[index] = root(roots[index]));
  for (let a = 0; a < groups.length; a++) for (let b = a + 1; b < groups.length; b++) {
    if (groups[a].performer !== groups[b].performer && overlaps(groups[a], groups[b])) roots[root(b)] = root(a);
  }
  const scenes = new Map<number, { id: string; groups: T[][] }>();
  groups.forEach((group, index) => {
    const key = root(index), scene = scenes.get(key) || { id: groups[key].id, groups: [] };
    scene.groups.push(group.lines); scenes.set(key, scene);
  });
  return [...scenes.values()];
}

/**
 * Allocate rows once, in score order. A long opposite-lane phrase spans the
 * rows of its overlapping partners (A1 / B / A2), without duplicating text or
 * letting two groups occupy the same cell. Three or more voices stack safely.
 */
export function vocalSceneRows<T extends VocalLayoutLine>(members: readonly T[][], layout: ReadonlyMap<string, VocalLane>): Map<string, VocalGridCell> {
  const groups = vocalGroups(members.flat()), cells = new Map<string, VocalGridCell>();
  const side = (group: typeof groups[number]) => layout.get(group.lines[0].id)?.side || 'left';
  const next = { left: 1, right: 1 };
  for (const group of groups) {
    const partners = groups.filter(other => side(other) !== side(group) && overlaps(group, other) && cells.has(other.id));
    const partnerRow = Math.min(...partners.map(other => cells.get(other.id)!.row), Infinity);
    const row = Math.max(next[side(group)], Number.isFinite(partnerRow) ? partnerRow : 1);
    cells.set(group.id, { row, rowSpan: 1 }); next[side(group)] = row + 1;
  }
  for (const group of groups) {
    const cell = cells.get(group.id)!;
    const nextInLane = Math.min(...groups.filter(other => side(other) === side(group) && cells.get(other.id)!.row > cell.row).map(other => cells.get(other.id)!.row), Infinity);
    const partnerEnd = Math.max(cell.row, ...groups.filter(other => side(other) !== side(group) && overlaps(group, other)).map(other => cells.get(other.id)!.row));
    cell.rowSpan = Math.min(partnerEnd, nextInLane - 1) - cell.row + 1;
  }
  return cells;
}
