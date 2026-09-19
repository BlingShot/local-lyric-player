import test from 'node:test';
import assert from 'node:assert/strict';
import { completedInterludeDots, interludePresentation, INTERLUDE_EXIT_SECONDS } from '../src/lyrics/interludeProgress.ts';
import { rapidWord, wordVisualProgress } from '../src/lyrics/wordVisual.ts';
import { LYRIC_IMAGE_THEMES, parseLyricImageTheme, lyricImageSelection } from '../src/lyrics/lyricImage.ts';
import { parseAmllIndex, exactMetadata, selectAmllRevision } from '../src/lyrics/amllMatch.ts';
import { normalizeTranslation, translationPrompt } from '../src/lyrics/translate.ts';
import { validLyricsAppearance } from '../src/lyrics/appearance.ts';
import { newProject, parseProject } from '../src/studio/project.ts';
import type { LyricLine } from '../src/lyrics/types.ts';

test('interlude completes its dots, fades out, then reclaims space after its boundary', () => {
  const start = 10, end = 20, finished = end + INTERLUDE_EXIT_SECONDS;
  assert.equal(interludePresentation(start, end, 9).space, 0);
  assert.equal(interludePresentation(start, end, start).space, 0);
  assert.equal(interludePresentation(start, end, 11).space, 1);

  // Do not hide or collapse before the final dot has had time to light.
  const beforeEnd = interludePresentation(start, end, end - .01);
  assert.equal(beforeEnd.phase, 'visible');
  assert.equal(beforeEnd.space, 1);
  assert.equal(beforeEnd.opacity, 1);
  assert.equal(completedInterludeDots(start, end, end - .01), 2);
  const boundary = interludePresentation(start, end, end);
  assert.equal(boundary.phase, 'visible');
  assert.equal(boundary.space, 1);
  assert.equal(boundary.opacity, 1);
  assert.equal(completedInterludeDots(start, end, end), 3);

  // Ink fades while the row retains its height, rather than being squeezed out.
  const earlyTime = end + INTERLUDE_EXIT_SECONDS * .25;
  const early = interludePresentation(start, end, earlyTime);
  assert.equal(early.phase, 'leaving');
  assert.equal(early.space, 1);
  assert.ok(early.opacity > 0 && early.opacity < 1);
  const late = interludePresentation(start, end, end + INTERLUDE_EXIT_SECONDS * .8);
  assert.equal(late.opacity, 0);
  assert.ok(late.space > 0 && late.space < 1);

  const snapshots = Array.from({ length: 65 }, (_, i) =>
    interludePresentation(start, end, end + INTERLUDE_EXIT_SECONDS * i / 64));
  for (const snapshot of snapshots) {
    assert.ok(snapshot.space >= 0 && snapshot.space <= 1);
    assert.ok(snapshot.opacity >= 0 && snapshot.opacity <= 1);
  }
  for (let i = 1; i < snapshots.length; i++) {
    assert.ok(snapshots[i].space <= snapshots[i - 1].space + 1e-9);
    assert.ok(snapshots[i].opacity <= snapshots[i - 1].opacity + 1e-9);
  }
  assert.equal(interludePresentation(start, end, finished).phase, 'hidden');
  assert.equal(interludePresentation(start, end, finished).space, 0);
  assert.equal(interludePresentation(start, end, finished).opacity, 0);
  assert.equal(interludePresentation(start, end, 21).space, 0);
  assert.deepEqual(interludePresentation(start, end, earlyTime), early, 'paused clock must not drift');
  assert.equal(interludePresentation(start, end, NaN).space, 0);
});
test('reduced motion and backwards seeks have deterministic interlude presentation', () => {
  assert.equal(interludePresentation(10, 20, 15, true).opacity, 1);
  assert.equal(interludePresentation(10, 20, 20, true).space, 0);
  const after = interludePresentation(10, 20, 25); const before = interludePresentation(10, 20, 15);
  assert.equal(after.phase, 'hidden'); assert.equal(before.phase, 'visible');
});
test('Chinese short characters retain timed sweep, English rapid fragments retain smoothing', () => {
  const chinese = { text: '你', start: 1, end: 1.1 }, english = { ...chinese, text: 'a' };
  assert.equal(rapidWord(chinese), false); assert.equal(rapidWord(english), true);
  assert.ok(Math.abs(wordVisualProgress(chinese, 1.05)! - .5) < 1e-8);
  assert.equal(wordVisualProgress(chinese, .99), 0);
  assert.equal(wordVisualProgress(chinese, 1.11), 1);
});
test('image selection snapshots previous/current/next including intro, outro, duet and empty input', () => {
  const lines: LyricLine[] = Array.from({ length: 5 }, (_, i) => ({ id: String(i), groupId: String(i), start: i * 10 + 5, end: i * 10 + 10, role: 'lead', parts: [{ text: String(i) }], annotations: [] }));
  assert.deepEqual(lyricImageSelection(lines, 27), ['1', '2', '3']);
  assert.deepEqual(lyricImageSelection(lines, 31), ['1', '2', '3']);
  assert.deepEqual(lyricImageSelection(lines, 0), ['0', '1']);
  assert.deepEqual(lyricImageSelection(lines, 99), ['3', '4']);
  assert.deepEqual(lyricImageSelection([], 20), []);
  lines[1] = { ...lines[1], start: 25, end: 28, role: 'background' };
  assert.deepEqual(lyricImageSelection(lines, 26), ['1', '2', '3']);
});
test('seven theme presets round-trip; custom themes reject scripts, URLs, invalid colours and oversized input', () => {
  assert.equal(LYRIC_IMAGE_THEMES.length, 7);
  for (const theme of LYRIC_IMAGE_THEMES) assert.equal(parseLyricImageTheme(JSON.stringify({ version: 1, ...theme })).text, theme.text);
  const base = { version: 1, ...LYRIC_IMAGE_THEMES[0] };
  for (const override of [{ background: ['url(https://example.com)', '#000000'] }, { text: 'red' }, { name: '' }, { background: ['#000000'] }, { version: 2 }]) assert.throws(() => parseLyricImageTheme(JSON.stringify({ ...base, ...override })));
  assert.throws(() => parseLyricImageTheme(' '.repeat(16385)));
});
test('literary Chinese translation normalization replaces both commas but leaves English punctuation intact', () => {
  assert.equal(normalizeTranslation('风起， 星落,  你仍在', 'zh-CN'), '风起 星落 你仍在');
  assert.equal(normalizeTranslation('Stay, my love.', 'en'), 'Stay, my love.');
  assert.match(translationPrompt('zh-CN'), /literary/); assert.match(translationPrompt('zh-CN'), /Never merge, omit/);
});
test('new translation preference preserves legacy defaults and persists an explicit false', () => {
  assert.equal(validLyricsAppearance().showTranslations, true);
  assert.equal(validLyricsAppearance({ showTranslations: false }).showTranslations, false);
});
const indexRow = { rawLyricFile: '1768754400682-123-abc.ttml', metadata: [['musicName', ['Example']], ['artists', ['B', 'A']], ['album', ['Album']], ['isrc', ['XX123']], ['spotifyId', ['AbC']], ['ttmlAuthorGithubLogin', ['Author']]] };
test('official AMLL JSONL metadata schema maps all required matching fields', () => {
  const [entry] = parseAmllIndex(JSON.stringify(indexRow));
  assert.deepEqual(entry.artistNames, ['B', 'A']); assert.deepEqual(entry.isrcs, ['XX123']); assert.deepEqual(entry.authorUsernames, ['Author']);
  assert.equal(exactMetadata(entry, 'Example', 'A / B'), true);
  assert.equal(exactMetadata(entry, 'Example (Live)', 'A / B'), false);
  assert.equal(exactMetadata(entry, 'Example', 'A / C'), false);
  assert.equal(selectAmllRevision([entry], { name: 'Example', artist: 'A / B' }), entry);
});
test('repository index rejects malformed rows, traversal and corrupt metadata instead of treating partial data as complete', () => {
  for (const value of [{ ...indexRow, rawLyricFile: '../bad.ttml' }, { ...indexRow, metadata: [['musicName', 'Example']] }, { ...indexRow, metadata: null }]) assert.throws(() => parseAmllIndex(JSON.stringify(value)));
  assert.throws(() => parseAmllIndex(JSON.stringify(indexRow) + '\n{broken'));
});
test('Studio source marker is optional for existing drafts, validated for imported drafts', () => {
  const project = newProject('fixture', 'fixture.wav'); assert.equal(parseProject(JSON.stringify(project)).playerSource, undefined);
  project.playerSource = { key: 'a'.repeat(64), format: 'ttml' }; assert.deepEqual(parseProject(JSON.stringify(project)).playerSource, project.playerSource);
  assert.throws(() => parseProject(JSON.stringify({ ...project, playerSource: { key: 'bad', format: 'xml' } })));
});
