/** Keep a timed backing voice beside its parent, even when it starts after another lead. */
export function groupVocalLines<T extends { id: string; role: 'lead' | 'background' }>(lines: readonly T[], groupId: (line: T) => string | undefined): T[] {
  const leads = new Set(lines.filter(line => line.role === 'lead').map(groupId));
  const children = new Map<string, T[]>();
  for (const line of lines) {
    const group = groupId(line);
    if (line.role !== 'background' || !group || !leads.has(group)) continue;
    const siblings = children.get(group) || []; siblings.push(line); children.set(group, siblings);
  }
  return lines.flatMap(line => {
    const group = groupId(line);
    if (line.role === 'background' && group && leads.has(group)) return [];
    const backing = line.role === 'lead' && group ? children.get(group) || [] : [];
    if (line.role === 'lead' && group) children.delete(group);
    return [line, ...backing];
  });
}
