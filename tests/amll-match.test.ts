import test from 'node:test';
import assert from 'node:assert/strict';
import { exactMetadata, selectAmllRevision } from '../src/lyrics/amllMatch.ts';
const track = { name: '瞬', artist: '郑润泽', album: '瞬' };
const current = { id: 2271785968561682, filename: '1715570295326-165106362-a7c22f4b.ttml', musicNames: ['瞬'], artistNames: ['郑润泽'], albumNames: ['瞬'], ncmMusicIds: ['2063864551'], isrcs: [], spotifyIds: [] };
test('AMLL entries without ISRC/Spotify IDs match exact metadata and choose the newer revision sharing a recording ID', () => {
  const older = { ...current, id: 8685727149514673, filename: '1711500730636-165106362-ac54097b.ttml' };
  assert.equal(selectAmllRevision([older, current], track), current);
});
test('different or ambiguous recordings are not merged just because the title and artist match', () => {
  assert.equal(selectAmllRevision([current, { ...current, id: 2, ncmMusicIds: ['other-recording'] }], track), undefined);
  assert.equal(selectAmllRevision([{ ...current, ncmMusicIds: [] }, { ...current, id: 2, ncmMusicIds: [] }], track), undefined);
});
test('recording edition labels and missing artists cannot accidentally match', () => {
  assert.equal(exactMetadata(current, '瞬 (Live)', track.artist), false);
  assert.equal(exactMetadata(current, track.name, ''), false);
  assert.equal(exactMetadata(current, track.name, 'Different artist'), false);
  assert.equal(selectAmllRevision([current], { ...track, name: 'Missing song' }), undefined);
});
test('album metadata disambiguates recordings before choosing a revision', () => {
  assert.equal(selectAmllRevision([current, { ...current, id: 2, albumNames: ['Live'], ncmMusicIds: ['live-recording'] }], track), current);
});
