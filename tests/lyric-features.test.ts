import assert from 'node:assert/strict';
import test from 'node:test';
import { sustainedGlow } from '../src/lyrics/sustained.ts';
import { interludeBefore } from '../src/lyrics/interludes.ts';
import { parseTranslations } from '../src/lyrics/translate.ts';
import { serializeLyrics } from '../src/lyrics/serialize.ts';
import type { LyricDocument } from '../src/lyrics/types.ts';

const document: LyricDocument = { format: 'ttml', timing: 'mixed', agents: { v1: 'Alice', v2: 'Bob' }, notices: [], lines: [
  { id: 'lead', groupId: 'lead', start: 12, end: 15, role: 'lead', agent: 'v1', parts: [{ text: 'Hello', start: 12, end: 14 }, { text: ' world' }], annotations: [{ kind: 'translation', language: 'zh-CN', text: '\u4f60\u597d' }] },
  { id: 'bg', groupId: 'lead', start: 14, end: 18, role: 'background', agent: 'v2', parts: [{ text: 'light', start: 16, end: 18 }], annotations: [{ kind: 'translation', language: 'zh-CN', text: '\u5149' }] },
  { id: 'next', groupId: 'next', start: 30, end: 35, role: 'lead', parts: [{ text: 'Next' }], annotations: [] },
] };
test('sustained glow never starts early, including the real delayed background word', () => {
  const word = { text: 'light', start: 223.432, end: 224.615 };
  assert.equal(sustainedGlow(word, 221.839), 0);
  assert.equal(sustainedGlow({ text: 'long', start: 5, end: 8 }, 4), 0);
  assert.ok(sustainedGlow({ text: 'long', start: 5, end: 8 }, 6) > .9);
  assert.equal(sustainedGlow({ text: 'long', start: 5, end: 8 }, 8), 0);
  assert.equal(sustainedGlow({ text: 'short', start: 5, end: 5.3 }, 5.1), 0);
});
test('interludes cover intro, all overlapping voices, and outro without changing lyrics', () => {
  const before = JSON.stringify(document), gaps = interludeBefore(document, 45);
  assert.deepEqual([...gaps.values()], [{ start: 0, end: 12, kind: 'intro' }, { start: 18, end: 30, kind: 'middle' }, { start: 35, end: 45, kind: 'outro' }]);
  assert.equal(JSON.stringify(document), before);
  assert.equal(interludeBefore({ ...document, lines: [] }, 40).size, 0);
});
test('AI mapping refuses missing, duplicate, invented, and empty voice translations', () => {
  assert.deepEqual([...parseTranslations('{"lines":[{"id":"L2","text":"B"},{"id":"L1","text":"A"}]}', ['L1', 'L2'])], [['L2', 'B'], ['L1', 'A']]);
  for (const lines of [[{ id: 'L1', text: 'A' }], [{ id: 'L1', text: 'A' }, { id: 'L1', text: 'B' }], [{ id: 'L1', text: '' }, { id: 'L2', text: 'B' }]]) assert.throws(() => parseTranslations(JSON.stringify({ lines }), ['L1', 'L2']));
});
test('TTML translation writer keeps independent background bounds and mixed timing', () => {
  const source = serializeLyrics(document, 45, { name: 'A & B', artist: 'Alice' });
  assert.ok(source.includes('begin="12.000s" end="18.000s"'));
  assert.ok(source.includes('ttm:role="x-lead" begin="12.000s" end="15.000s"'));
  assert.ok(source.includes('ttm:role="x-bg" begin="14.000s" end="18.000s"'));
  assert.ok(source.includes('begin="16.000s" end="18.000s">light'));
  assert.ok(source.includes('<span> world</span>'));
  assert.equal((source.match(/ttm:role="x-translation"/g) || []).length, 2);
  assert.ok(source.includes('A &amp; B'));
});
