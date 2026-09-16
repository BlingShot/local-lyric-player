export interface VocalLayoutLine {
  id: string; groupId: string; role: 'lead' | 'background'; agent?: string;
  start: number; end?: number;
}
export interface VocalLane { groupId: string; side: 'left' | 'right'; split: boolean }
export interface VocalGridCell { row: number; rowSpan: number }

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
    return { id, lines: members, index, performer: lead.agent?.trim() ? `agent:${lead.agent.trim().split(/\s+/).sort().join(' ')}` : 'unassigned',
      start: Math.min(...members.map(line => line.start)),
      end: Math.max(...members.map(line => line.end ?? nextStart.get(line.start)!)),
    };
  }).sort((a, b) => a.start - b.start || a.index - b.index);
}

/** The first appearance assigns a performer a lane for the entire score.
 * Overlap/highlighting never changes ownership; backing vocals follow the lead.
 * With more than two performers lanes alternate, but each phrase gets its own row.
 */
export function vocalLayout(lines: readonly VocalLayoutLine[]): Map<string, VocalLane> {
  const groups = vocalGroups(lines), performers = new Map<string, 'left' | 'right'>();
  for (const group of groups) if (!performers.has(group.performer))
    performers.set(group.performer, performers.size % 2 ? 'right' : 'left');
  const split = performers.size > 1;
  const assigned = new Map(groups.map(group => [group.id, {
    groupId: group.id, side: performers.get(group.performer)!, split,
  }]));
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
  const scenes: { id: string; groups: T[][] }[] = [];
  let end = -Infinity;
  // Sorted interval components need only a sweep, not pairwise O(n²) checks.
  for (const group of vocalGroups(lines)) {
    if (!scenes.length || group.start >= end) { scenes.push({ id: group.id, groups: [] }); end = group.end; }
    else end = Math.max(end, group.end);
    scenes[scenes.length - 1].groups.push(group.lines);
  }
  return scenes;
}

/** Each vocal group occupies a separate chronological row, even during a duet.
 * Equal starts retain score order. No spanning/overlapping cells or live reflow.
 */
export function vocalSceneRows<T extends VocalLayoutLine>(members: readonly T[][], _layout: ReadonlyMap<string, VocalLane>): Map<string, VocalGridCell> {
  return new Map(vocalGroups(members.flat()).map((group, index) => [group.id, { row: index + 1, rowSpan: 1 }]));
}
