import type { StudioProject } from './project.ts';

export interface VoiceCursor { lineId: string; unitId: string }
export interface RecordingVoice {
  id: string; performerId?: string; role: 'lead' | 'background'; layer: number; words: VoiceCursor[];
}

/** A voice keeps its own word order, including inline agents and backing layers. */
export function recordingVoices(project: StudioProject): RecordingVoice[] {
  const voices = new Map<string, RecordingVoice>(), layers = new Map<string, number>();
  const leadLayers = new Map<string, { start: number; end: number }[][]>();
  const performers = new Map(project.lines.map(line => [line.id, line.performerId]));
  for (const line of project.lines) {
    const ownLayers = new Map<string, number>();
    for (const word of line.units) {
      if (word.kind !== 'word') continue;
      const performerId = word.performerId ?? line.performerId ?? performers.get(line.parentId || '');
      let layer = 0;
      if (line.role === 'background') {
        const parent = JSON.stringify([line.parentId, performerId]);
        if (!ownLayers.has(parent)) {
          ownLayers.set(parent, layers.get(parent) || 0);
          layers.set(parent, (layers.get(parent) || 0) + 1);
        }
        layer = ownLayers.get(parent)!;
      } else {
        const key = performerId || '';
        if (!ownLayers.has(key)) {
          const starts = line.units.flatMap(unit => unit.startMs === null ? [] : [unit.startMs]);
          const ends = line.units.flatMap(unit => unit.endMs === null ? [] : [unit.endMs]);
          const start = line.startMs ?? Math.min(...starts), end = line.endMs ?? Math.max(...ends);
          if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
            const occupied = leadLayers.get(key) || [];
            let available = occupied.findIndex(intervals => intervals.every(interval => end <= interval.start || start >= interval.end));
            if (available < 0) { available = occupied.length; occupied.push([]); }
            occupied[available].push({ start, end }); leadLayers.set(key, occupied); ownLayers.set(key, available);
          } else ownLayers.set(key, 0);
        }
        layer = ownLayers.get(key)!;
      }
      const id = JSON.stringify([line.role, performerId, layer]);
      let voice = voices.get(id);
      if (!voice) { voice = { id, performerId, role: line.role, layer, words: [] }; voices.set(id, voice); }
      voice.words.push({ lineId: line.id, unitId: word.id });
    }
  }
  return [...voices.values()];
}

export function adjacentVoiceWord(project: StudioProject, lineId: string, unitId: string, direction: -1 | 1): VoiceCursor | undefined {
  const voice = recordingVoices(project).find(voice => voice.words.some(word => word.lineId === lineId && word.unitId === unitId));
  const index = voice?.words.findIndex(word => word.lineId === lineId && word.unitId === unitId) ?? -1;
  return index < 0 ? undefined : voice?.words[index + direction];
}

/** Start an independent voice at the playhead, not at the first word of the song. */
export function voiceCursorAt(project: StudioProject, voice: RecordingVoice, timeMs: number): VoiceCursor | undefined {
  const lines = new Map(project.lines.map(line => [line.id, line]));
  const words = voice.words.map(cursor => ({ cursor, line: lines.get(cursor.lineId), word: lines.get(cursor.lineId)?.units.find(word => word.id === cursor.unitId) }));
  const active = words.find(({ word }) => word?.startMs != null && word.endMs != null && word.startMs <= timeMs && word.endMs > timeMs);
  if (active) return active.cursor;
  const currentLine = words.find(({ line }) => line?.startMs != null && line.startMs <= timeMs && (line.endMs == null || line.endMs > timeMs))?.line;
  if (currentLine) {
    const candidate = words.find(({ cursor, word }) => cursor.lineId === currentLine.id && word && (word.endMs === null || word.endMs > timeMs));
    if (candidate) return candidate.cursor;
  }
  const future = words.find(({ word }) => word?.startMs != null && word.startMs >= timeMs);
  if (future) return future.cursor;
  return words.find(({ word }) => word && (word.startMs === null || word.endMs === null))?.cursor;
}
