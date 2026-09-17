import test from 'node:test';
import assert from 'node:assert/strict';
import { lyricDebugSnapshot } from '../src/lyrics/debugSnapshot.ts';
import type { SavedLyrics, LyricLine } from '../src/lyrics/types.ts';
const line = (id: string, start: number, end: number, agent: string, role: 'lead' | 'background' = 'lead'): LyricLine => ({ id, groupId: id, start, end, agent, role,
  parts: [{ text: '春', start, end: start + 1 }, { text: '风', start: start + 1, end }], annotations: [{ text: 'Spring', kind: 'translation' }] });
const saved: SavedLyrics = { trackId: 'song', fileName: 'song.ttml', source: '', parserVersion: 4, savedAt: 1, origin: 'amll', offsetMs: 500,
  document: { format: 'ttml', timing: 'word', agents: { A: 'Alice', B: 'Bob' }, notices: [], lines: [line('a', 10, 14, 'A'), line('b', 10, 14, 'B'), line('bg', 11, 13, 'A', 'background'), line('c', 30, 34, 'B')] } };
const appearance = { performerAlignment: true, wordByWord: true, showTranslations: true };
test('lyrics debug follows offset clock, concurrent performers, background vocals and exact word timestamps', () => {
  const snapshot = lyricDebugSnapshot(saved, 12, 40, appearance);
  assert.equal(snapshot.source, 'AMLL TTML'); assert.equal(snapshot.lyricTime, 11.5); assert.equal(snapshot.current?.id, 'a');
  assert.equal(snapshot.overlap?.active, true); assert.equal(snapshot.overlap?.duplicateStart, true); assert.equal(snapshot.activeCount, 3);
  assert.equal(snapshot.activeLines?.find(line => line.id === 'bg')?.vocal, 'Background Vocal');
  assert.equal(snapshot.current?.currentWords[0].text, '风'); assert.equal(snapshot.current?.wordTimestamps[0].start, 10);
  assert.notDeepEqual(snapshot.activeLines?.[0].layout, snapshot.activeLines?.[1].layout);
});
test('source attribution, translation off and final interlude suppression match the viewer', () => {
  for (const [origin, format, expected] of [['amll', 'ttml', 'AMLL TTML'], ['file', 'ttml', 'Local TTML'], ['file', 'lrc', 'LRC'], ['embedded', 'lrc', 'Embedded']] as const) {
    const result = lyricDebugSnapshot({ ...saved, origin, document: { ...saved.document, format } }, 40, 40, { ...appearance, showTranslations: false });
    assert.equal(result.source, expected); assert.equal(result.translation?.visible, false); assert.equal(result.interlude?.phase, 'none');
  }
  assert.equal(lyricDebugSnapshot(saved, 22, 40, appearance).interlude?.phase, 'visible');
  assert.equal(lyricDebugSnapshot(undefined, 0, 0, appearance).source, 'None');
});
