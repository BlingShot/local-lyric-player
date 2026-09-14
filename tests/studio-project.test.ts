import test from 'node:test';
import assert from 'node:assert/strict';
import { complete, editText, graphemes, mergeUnits, migrateDraft, newProject, parseProject, removePerformer, shiftProject, splitUnit, tokenize, uid, vocalLine } from '../src/studio/project.ts';
import { exportProjectLrc, exportProjectTtml } from '../src/studio/projectExport.ts';
import { parseTtmlMillis } from '../src/studio/projectImport.ts';
import { validateProject } from '../src/studio/validation.ts';
import { assignPerformer, deleteLine, mergeLine, splitLine } from '../src/studio/operations.ts';

test('splitting preserves contractions, punctuation, CJK mixed text, spacing and grapheme clusters', () => {
  for (const text of ["  Don't stop, I'M here!  ", '你，好 world! 音乐', 'e\u0301 👨‍👩‍👧‍👦 🇨🇳 क्‍ष']) for (const mode of ['auto', 'word', 'character', 'manual'] as const) {
    const units = tokenize(text, mode); assert.equal(units.map(u => u.text).join(''), text); assert.ok(units.every(u => u.startMs === null && u.endMs === null));
  }
  assert.equal(tokenize("Don't I'M").filter(u => u.kind === 'word').length, 2);
  assert.equal(tokenize('中文AB').filter(u => u.kind === 'word').length, 3);
  assert.equal(graphemes('e\u0301👨‍👩‍👧‍👦🇨🇳').length, 3);
  const line = vocalLine('e\u0301clair'); assert.throws(() => splitUnit(line, line.units[0].id, 1), /complete visible/);
});
test('text edits retain unaffected manual syllables and mark only changed units pending', () => {
  let line = vocalLine('Singing softly now'); line = splitUnit(line, line.units[0].id, 4);
  line.units = line.units.map((w, i) => w.kind === 'word' ? { ...w, startMs: 100 + i * 500, endMs: 400 + i * 500 } : w);
  const edited = editText(line, 'Singing very softly now');
  for (const w of line.units.filter(w => w.kind === 'word')) assert.ok(edited.units.some(n => n.id === w.id && n.startMs === w.startMs && n.endMs === w.endMs));
  assert.ok(edited.units.some(w => w.text === 'very' && !complete(w)));
  assert.equal(edited.text, edited.units.map(w => w.text).join(''));
});
test('merging never fills a recorded pause; continuous syllables can keep their outer bounds', () => {
  let line = vocalLine('singing'); line = splitUnit(line, line.units[0].id, 4);
  line.units[0].startMs = 1000; line.units[0].endMs = 1500; line.units[1].startMs = 1800; line.units[1].endMs = 2200;
  assert.equal(mergeUnits(line, line.units.map(w => w.id)).units[0].startMs, null);
  line.units[1].startMs = 1500;
  assert.deepEqual([mergeUnits(line, line.units.map(w => w.id)).units[0].startMs, mergeUnits(line, line.units.map(w => w.id)).units[0].endMs], [1000, 2200]);
});
test('v2 project storage uses integer milliseconds; legacy drafts migrate without inventing word timing', () => {
  const p = migrateDraft({ trackId: 'a', audioName: 'song.flac', updatedAt: 1, selectedId: 'line', lines: [{ id: 'line', text: 'AB', start: '1.25', end: '3' }] });
  assert.equal(p.lines[0].startMs, 1250); assert.equal(p.lines[0].units[0].startMs, null);
  assert.deepEqual(parseProject(JSON.stringify(p)), JSON.parse(JSON.stringify(p)));
  assert.throws(() => parseProject('{"version":3}'), /unsupported/);
});
test('word export blocks incomplete words with locations; XML escaping and actual gaps are retained', () => {
  const p = newProject('a', 'song.flac'); p.lines = [vocalLine('A & <light>')]; p.lines[0].startMs = 1000; p.lines[0].endMs = 6000;
  const errors = validateProject(p, 10000, 'word').filter(i => i.severity === 'error'); assert.ok(errors.some(i => i.unitId === p.lines[0].units[0].id));
  assert.throws(() => exportProjectTtml(p, 10000, 'word'), /pending/);
  p.lines[0].units.filter(w => w.kind === 'word').forEach((w, i) => { w.startMs = 1000 + i * 2500; w.endMs = 1400 + i * 2500; });
  const xml = exportProjectTtml(p, 10000, 'word'); assert.match(xml, /begin="1.000s" end="1.400s"/); assert.match(xml, /begin="3.500s" end="3.900s"/); assert.match(xml, /&amp;/); assert.match(xml, /&lt;light&gt;/);
  p.lines[0].units[0].endMs = 1000; assert.ok(validateProject(p, 10000, 'word').some(i => /later/.test(i.message)));
});
test('multiple Performers, groups, overlapping background voices, deleting and reassigning references', () => {
  let p = newProject('a', 'song.flac'); p.performers = ['A', 'B', 'C', 'Together'].map((name, i) => ({ id: `v${i}`, name, type: i === 3 ? 'group' : 'person', color: '#1ed760', align: 'auto' }));
  const lead = vocalLine('hello'), bg = vocalLine('harmony', 'background', lead.id); p.lines = [lead, bg];
  p.lines.forEach(l => { l.startMs = 1000; l.endMs = 4000; l.units[0].startMs = 1200; l.units[0].endMs = 3900; });
  p = assignPerformer(p, [lead.id], 'v0'); p = assignPerformer(p, [bg.id], 'v1');
  assert.equal(validateProject(p, 10000, 'word').filter(i => i.severity === 'error').length, 0);
  const xml = exportProjectTtml(p, 10000, 'word'); assert.match(xml, /ttm:role="x-bg"/); assert.match(xml, /type="group"/);
  p = removePerformer(p, 'v1', 'v3'); assert.equal(p.lines[1].performerId, 'v3'); assert.ok(!p.performers.some(a => a.id === 'v1'));
  p = removePerformer(p, 'v3', null); assert.equal(p.lines[1].performerId, undefined);
});
test('line structural edits preserve annotations and section IDs; offset scope leaves pending words pending', () => {
  let p = newProject('a', 'song.flac'); const l = vocalLine('Hello world'); l.annotations = [{ id: uid('a'), targetId: l.id, kind: 'translation', text: '你好', language: 'zh' }];
  p.lines = [l]; p.selectedId = l.id; p.sections = [{ id: 's1', tag: 'CHORUS', lineIds: [l.id], startMs: null, endMs: null }];
  p = splitLine(p, l.id, 6); assert.equal(p.sections[0].lineIds.length, 2); assert.equal(p.lines[0].annotations[0].targetId, l.id);
  p = mergeLine(p, l.id); assert.equal(p.lines[0].text, 'Hello world'); assert.equal(p.lines[0].annotations[0].text, '你好');
  p.lines[0].startMs = 1000; p = shiftProject(p, 500, 'all'); assert.equal(p.lines[0].startMs, 1500); assert.equal(p.lines[0].units[0].startMs, null);
  assert.throws(() => shiftProject(p, -2000, 'all'), /below zero/);
  p = deleteLine(p, l.id); assert.equal(p.sections.length, 0);
});
test('validator distinguishes normal cross-voice overlap from invalid references, IDs and XML characters', () => {
  const p = newProject('a', 'song.flac'); p.lines = [vocalLine('A'), vocalLine('B')]; p.lines[0].startMs = 4000; p.lines[0].endMs = 6000; p.lines[1].startMs = 2000; p.lines[1].endMs = 5000;
  assert.equal(validateProject(p, 10000, 'line').filter(i => i.severity === 'error').length, 0);
  p.lines[1].performerId = 'missing'; p.lines[1].units[0].id = p.lines[0].units[0].id; p.metadata.title = 'Bad\u0001';
  const issues = validateProject(p, 10000, 'line'); assert.ok(issues.some(i => /Performer reference/.test(i.message))); assert.ok(issues.some(i => /Duplicate/.test(i.message))); assert.ok(issues.some(i => /XML/.test(i.message)));
});
test('explicit LRC policies omit advanced data without modifying the full project', () => {
  const p = newProject('a', 'song.flac'), lead = vocalLine('Hello'), bg = vocalLine('oh', 'background', lead.id);
  lead.startMs = 1000; lead.endMs = 2000; bg.startMs = 1500; bg.endMs = 4000; lead.annotations = [{ id: 'a', targetId: lead.id, kind: 'translation', text: '你好', language: 'zh' }]; p.lines = [lead, bg];
  const before = JSON.stringify(p); assert.equal(exportProjectLrc(p, 10000, { voices: 'lead', annotations: 'omit' }), '[00:01.000]Hello\n[00:02.000]\n');
  assert.match(exportProjectLrc(p, 10000, { voices: 'all', annotations: 'append' }), /Hello \/ 你好/); assert.equal(JSON.stringify(p), before);
});
test('TTML time parser supports declared media formats and rejects unsupported clocks', () => {
  for (const [input, expected] of [['01:02.345', 62345], ['01:02:03.456', 3723456], ['1200ms', 1200], ['1.5s', 1500], ['2m', 120000], ['.5s', null], ['00:00:01:12', null], ['1f', null], ['1t', null]] as const) if (expected === null) assert.throws(() => parseTtmlMillis(input)); else assert.equal(parseTtmlMillis(input), expected);
});
