import test from 'node:test';
import assert from 'node:assert/strict';
import { newDraft, pastedLines, parseStudioTime, studioTime, shiftLines, validateStudio, studioFromLyrics } from '../src/studio/model.ts';
import { exportLyrics, exportName } from '../src/studio/export.ts';
import { parseLrc } from '../src/lyrics/parseLrc.ts';
import { studioPlaybackFrame } from '../src/studio/playbackFrame.ts';

test('studio playback outlines actual timed lines and uses next start minus previous end for exclusive interludes', () => {
  const rows = [{ id: 'a', text: 'One', start: '0', end: '2' }, { id: 'b', text: 'Two', start: '15', end: '20' }];
  assert.deepEqual(studioPlaybackFrame(rows, 1, 30).activeIds, ['a']);
  const gap = studioPlaybackFrame(rows, 2, 30); assert.deepEqual(gap.activeIds, []); assert.equal(gap.interlude, 'b');
  assert.deepEqual(gap.gaps.get('b'), { start: 2, end: 15 });
  assert.equal(studioPlaybackFrame(rows, 15, 30).interlude, undefined); assert.deepEqual(studioPlaybackFrame(rows, 15, 30).activeIds, ['b']);
  rows[0].end = '5'; assert.equal(studioPlaybackFrame(rows, 8, 30).gaps.size, 0, 'exactly 10 seconds is not over 10');
  rows[0].end = ''; assert.equal(studioPlaybackFrame(rows, 8, 30).gaps.size, 0, 'automatic next-start end has no gap');
  rows[0].start = ''; assert.deepEqual(studioPlaybackFrame(rows, 1, 30).activeIds, [], 'unmarked rows are never made active');
});

test('studio paste splits CRLF into plain lines and times round safely at minute boundaries', () => {
  assert.deepEqual(pastedLines('First\r\n\r\n第二句\nLast').map(line => line.text), ['First', '第二句', 'Last']);
  assert.equal(parseStudioTime('01:02.345'), 62.345); assert.equal(parseStudioTime('120.5'), 120.5);
  for (const invalid of ['', '00:99', '-1', 'NaN', '1.2345']) assert.equal(parseStudioTime(invalid), undefined);
  assert.equal(studioTime(59.9996), '01:00.000');
  assert.equal(exportName('Artist - A song.live.flac'), 'Artist - A song.live');
});
test('studio validation locates unmarked, invalid, backwards and impossible end times', () => {
  const lines = pastedLines('A\nB\nC');
  lines[0].start = '00:02'; lines[1].start = 'bad'; lines[2].start = '00:01'; lines[2].end = '00:00';
  const issues = validateStudio(lines, 10, 'ttml');
  assert.ok(issues.some(issue => issue.lineId === lines[1].id && issue.field === 'start'));
  assert.ok(issues.some(issue => issue.lineId === lines[0].id && issue.field === 'end'));
  assert.ok(issues.some(issue => issue.lineId === lines[2].id && issue.message.includes('later than start')));
  lines[1].start = '00:04';
  assert.ok(validateStudio(lines, 10, 'ttml').some(issue => issue.lineId === lines[2].id && issue.message.includes('before the previous')));
  const blank = newDraft('song', 'song.flac');
  assert.throws(() => exportLyrics(blank, 10, 'ttml'), /add text/);
  assert.ok(validateStudio(blank.lines, 0, 'ttml').some(issue => issue.message.includes('playable audio')));
});
test('line exports round-trip real starts and explicit gaps, UTF-8 text and XML special characters', () => {
  const draft = newDraft('song', 'Song & 星.flac'); draft.lines = pastedLines('中文 <光> & "you"\n繁體 🌓\n最後一句');
  draft.lines.forEach((line, i) => line.start = studioTime(i * 3 + .123)); draft.lines[0].end = '00:02.500'; draft.lines[2].end = '00:08.000';
  assert.deepEqual(validateStudio(draft.lines, 10, 'both'), []);
  const ttml = exportLyrics(draft, 10, 'ttml');
  assert.match(ttml, /&lt;光&gt; &amp; &quot;you&quot;/); assert.match(ttml, /encoding="UTF-8"/);
  const parsed = parseLrc(exportLyrics(draft, 10, 'lrc'));
  assert.deepEqual(parsed.lines.map(line => [line.start, line.end, line.parts[0].text]), [
    [.123, 2.5, '中文 <光> & "you"'], [3.123, 6.123, '繁體 🌓'], [6.123, 8, '最後一句'],
  ]);
  assert.deepEqual(new TextDecoder().decode(new TextEncoder().encode(ttml)), ttml);
});
test('last end defaults to actual audio duration, shifts preserve unmarked times and reject negative results', () => {
  const draft = newDraft('song', 'song.wav'); draft.lines = pastedLines('A\nB');
  draft.lines[0].start = '00:01'; draft.lines[1].start = '00:05';
  assert.match(exportLyrics(draft, 8, 'ttml'), /begin="5.000s" end="8.000s"/);
  const shifted = shiftLines([...draft.lines, { id: 'new', text: 'C', start: '', end: '' }], -.5);
  assert.equal(shifted[0].start, '00:00.500'); assert.equal(shifted[2].start, ''); assert.equal(shifted[2].end, '');
  assert.throws(() => shiftLines(draft.lines, -2), /below zero/);
});
test('TTML overlaps can be retained but LRC exports cannot silently discard them or inline timing-like text', () => {
  const draft = newDraft('song', 'song.wav'); draft.lines = pastedLines('A\nB');
  draft.lines[0].start = '1'; draft.lines[0].end = '4'; draft.lines[1].start = '3';
  assert.deepEqual(validateStudio(draft.lines, 8, 'ttml'), []);
  assert.throws(() => exportLyrics(draft, 8, 'lrc'), /overlap/);
  draft.lines[0].end = '3'; draft.lines[0].text = 'Literal <00:01> text';
  assert.throws(() => exportLyrics(draft, 8, 'lrc'), /resembles LRC/);
});
test('flattening imported timed words and annotations requires explicit conversion notices', () => {
  const parsed = parseLrc('[00:01]<00:01>A<00:02>B<00:03>\n[00:04]Next');
  parsed.lines[0].role = 'background'; parsed.lines[0].annotations.push({ kind: 'translation', text: '译文' });
  const imported = studioFromLyrics(parsed, 500);
  assert.equal(imported.lines[0].text, 'AB'); assert.equal(imported.lines[0].start, '00:01.500');
  assert.equal(imported.notices.filter(note => /Word timings|Voice labels|Translations/.test(note)).length, 3);
});
