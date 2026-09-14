export type RepeatMode = 'off' | 'all' | 'one';

export function shuffled<T>(items: readonly T[], random = Math.random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Search at most one queue traversal, even when every file has failed.
export function adjacentTrack(
  queue: readonly string[], current: string | null, direction: 1 | -1,
  wrap: boolean, failed: ReadonlySet<string> = new Set(),
): string | null {
  const start = current === null ? (direction === 1 ? -1 : queue.length) : queue.indexOf(current);
  for (let step = 1; step <= queue.length; step++) {
    let index = start + direction * step;
    if (index < 0 || index >= queue.length) {
      if (!wrap) return null;
      index = ((index % queue.length) + queue.length) % queue.length;
    }
    if (!failed.has(queue[index])) return queue[index];
  }
  return null;
}
