export interface VocalLayoutLine {
  id: string; groupId: string; role: 'lead' | 'background'; agent?: string;
  start: number; end?: number;
}
export interface VocalLane { groupId: string; side: 'left' | 'right'; split: boolean }
const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end;

/** A backing vocal belongs to its parent, not to a separate visual column. */
export function vocalLayout(lines: readonly VocalLayoutLine[]): Map<string, VocalLane> {
  const parents = new Map<string, VocalLayoutLine>();
  for (const line of lines) if (line.role === 'lead') parents.set(line.groupId, line);
  for (const line of lines) if (!parents.has(line.groupId)) parents.set(line.groupId, line);
  const groups = [...parents.values()].map((line, index, all) => ({
    line, index, start: line.start,
    end: line.end ?? Math.min(...all.filter(other => other.start > line.start).map(other => other.start), Infinity),
    performer: line.agent?.trim().split(/\s+/).sort().join(' ') || line.groupId,
  })).sort((a, b) => a.start - b.start || a.index - b.index);
  const assigned = new Map<string, VocalLane>();
  for (const group of groups) {
    const partners = groups.filter(other => other !== group && other.performer !== group.performer && overlaps(group, other));
    const occupied = new Set(partners.map(other => assigned.get(other.line.groupId)?.side).filter(Boolean));
    const side = occupied.has('left') && !occupied.has('right') ? 'right' : 'left';
    assigned.set(group.line.groupId, { groupId: group.line.groupId, side, split: partners.length > 0 });
  }
  return new Map(lines.map(line => [line.id, assigned.get(line.groupId)!]));
}

/** Solo takes priority even when the same performer shares a duet later. */
export function activeVocalLayout(layout: ReadonlyMap<string, VocalLane>, activeIds: ReadonlySet<string>, enabled = true): Map<string, VocalLane> {
  const activeGroups = new Set([...activeIds].map(id => layout.get(id)?.groupId).filter(Boolean));
  return new Map([...layout].map(([id, lane]) => [id,
    !enabled || activeGroups.size === 1 && activeGroups.has(lane.groupId)
      ? { ...lane, side: 'left', split: false } : lane,
  ]));
}

/** Overlapping vocal groups share a row of columns rather than pushing each other offscreen. */
export function vocalScenes<T extends VocalLayoutLine>(lines: readonly T[]) {
  const grouped = new Map<string, T[]>();
  for (const line of lines) { const group = grouped.get(line.groupId) || []; group.push(line); grouped.set(line.groupId, group); }
  const groups = [...grouped.values()], parents = groups.map(group => group.find(line => line.role === 'lead') || group[0]);
  const roots = parents.map((_, index) => index);
  const root = (index: number): number => roots[index] === index ? index : (roots[index] = root(roots[index]));
  const end = (line: T) => line.end ?? Math.min(...parents.filter(other => other.start > line.start).map(other => other.start), Infinity);
  for (let a = 0; a < parents.length; a++) for (let b = a + 1; b < parents.length; b++) {
    const left = parents[a], right = parents[b];
    if (left.agent && left.agent === right.agent) continue;
    if (left.start < end(right) && right.start < end(left)) roots[root(b)] = root(a);
  }
  const scenes = new Map<number, { id: string; groups: T[][] }>();
  groups.forEach((group, index) => {
    const key = root(index), scene = scenes.get(key) || { id: parents[key].groupId, groups: [] };
    scene.groups.push(group); scenes.set(key, scene);
  });
  return [...scenes.values()];
}
