import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RecoveryJournal, LEGACY_RECOVERY_KEY, RECOVERY_LIMITS } from '../src/studio/recoveryJournal.ts';
class MemoryStorage {
  map = new Map<string, string>(); fail = false;
  get length() { return this.map.size; }
  key(i: number) { return [...this.map.keys()][i] ?? null; }
  getItem(k: string) { return this.map.get(k) ?? null; }
  setItem(k: string, v: string) { if(this.fail) throw new DOMException('Full','QuotaExceededError'); this.map.set(k,v); }
  removeItem(k: string) { this.map.delete(k); }
  clear() { this.map.clear(); }
}
test('F03 separate projects survive failed commits; successful B clears only B', () => {
  const storage = new MemoryStorage(), journal = new RecoveryJournal(storage);
  journal.stage({ trackId:'A',updatedAt:10 }); const b = journal.stage({ trackId:'B',updatedAt:11 }); journal.clear(b);
  assert.deepEqual(journal.entries().map(e=>e.draft.trackId),['A']);
  journal.stage({ trackId:'B',updatedAt:12 });
  assert.deepEqual(new RecoveryJournal(storage).entries().map(e=>e.draft.trackId),['B','A']);
});
test('F03 completion of an old revision never removes a newer recovery with equal timestamp', () => {
  const journal = new RecoveryJournal(new MemoryStorage());
  const old = journal.stage({trackId:'A',updatedAt:1}); const latest = journal.stage({trackId:'A',updatedAt:1});
  journal.clear(old); assert.equal(journal.forTrack('A')[0].raw,latest.raw);
});
test('F03 quota/entry limits preserve every existing unsaved project', () => {
  const storage = new MemoryStorage(), journal = new RecoveryJournal(storage);
  for(let i=0;i<RECOVERY_LIMITS.entries;i++) journal.stage({trackId:String(i),updatedAt:i});
  assert.throws(()=>journal.stage({trackId:'overflow',updatedAt:99}),/full/);
  assert.equal(journal.entries().length,RECOVERY_LIMITS.entries);
  storage.fail=true; assert.throws(()=>journal.stage({trackId:'0',updatedAt:99}),/Full/);
  assert.equal(journal.forTrack('0')[0].draft.updatedAt,0);
});
test('F03 legacy recovery remains available until its own successful commit; malformed slots are ignored', () => {
  const storage = new MemoryStorage(), journal = new RecoveryJournal(storage);
  storage.setItem(LEGACY_RECOVERY_KEY,JSON.stringify({trackId:'A',updatedAt:1}));
  const b = journal.stage({trackId:'B',updatedAt:2});journal.clear(b);
  assert.equal(journal.forTrack('A')[0].draft.trackId,'A');
  journal.clear(journal.forTrack('A')[0]);assert.equal(storage.getItem(LEGACY_RECOVERY_KEY),null);
});
