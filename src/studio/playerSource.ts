import type { SavedLyrics } from '../lyrics/types';
import type { StudioProject } from './project';

export async function playerLyricKey(saved: SavedLyrics): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([saved.source, saved.document.format, saved.offsetMs || 0]));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
}
export function studioSourceFormat(project: StudioProject): 'lrc' | 'ttml' {
  return project.playerSource?.format === 'ttml' || project.source?.fileName.match(/\.(ttml|amll)$/i) || project.performers.length || project.lines.some(line => line.units.some(unit => unit.startMs !== null)) ? 'ttml' : 'lrc';
}
