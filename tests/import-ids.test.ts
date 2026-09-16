import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ImportIds } from '../src/studio/importIds.ts';
import { decodeId } from '../src/studio/projectExport.ts';

test('F09 raw XML IDs are not assumed to be this editor encoding', () => {
  const ids = new ImportIds(['a', 'id_61', 'id_6A', 'id_c0af']);
  for (const id of ['a', 'id_61', 'id_6A', 'id_c0af']) assert.equal(ids.reference(id), id);
});
test('F09 encoded collisions preserve distinct references and reserve derived identities', () => {
  const ids = new ImportIds(['id_61', 'a', 'a~l', 'id_6a', 'id_6A'], decodeId);
  assert.equal(ids.reference('a'), 'a');
  assert.notEqual(ids.reference('id_61'), 'a');
  assert.notEqual(ids.reference('id_6a'), ids.reference('id_6A'));
  assert.notEqual(ids.allocate('a~l'), ids.reference('a~l'));
  assert.equal(ids.reference('id_61'), ids.reference('id_61'));
});
test('F09 malformed UTF-8 is not decoded to replacement characters', () => {
  for (const raw of ['id_c0af', 'id_ff', 'id_edA080', 'id_e282']) assert.equal(decodeId(raw), raw);
  assert.equal(decodeId('id_6A'), 'j');
  assert.equal(decodeId('id_612062'), 'a b');
});
