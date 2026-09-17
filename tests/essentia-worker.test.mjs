import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { adaptEssentiaWorker, essentiaWorkerPlugin } from '../scripts/essentia-worker-plugin.mjs';

const source = await readFile(new URL('../node_modules/essentia.js/dist/essentia-wasm.web.js', import.meta.url), 'utf8');
const binary = await readFile(new URL('../node_modules/essentia.js/dist/essentia-wasm.web.wasm', import.meta.url));

test('separate-WASM loader initializes the real engine without document or window', async () => {
  const scope = vm.createContext({ console, setTimeout, clearTimeout,
    self: { location: { href: 'https://local.invalid/assets/analysis.worker.js' } },
    importScripts() { throw new Error('Module workers cannot use importScripts.'); },
  });
  new vm.Script(adaptEssentiaWorker(source)).runInContext(scope);
  assert.equal(vm.runInContext('typeof document', scope), 'undefined');
  assert.equal(vm.runInContext('typeof window', scope), 'undefined');
  const engine = await scope.EssentiaWASM({ wasmBinary: binary, locateFile: () => 'local.wasm' });
  const vector = engine.arrayToVector(new Float32Array([0.1, 0.2, 0.3]));
  try { assert.equal(vector.size(), 3); assert.ok(Math.abs(vector.get(1) - 0.2) < 1e-6); }
  finally { vector.delete(); }
});

test('worker adaptation is pinned, fails closed on upstream changes, and ignores other modules', () => {
  assert.throws(() => adaptEssentiaWorker('changed upstream loader'), /loader changed/);
  assert.equal(essentiaWorkerPlugin().transform(source, '/src/unrelated.js'), null);
  assert.match(essentiaWorkerPlugin().transform(source, 'C:\\node_modules\\essentia.js\\dist\\essentia-wasm.web.js').code,
    /ENVIRONMENT_IS_WORKER=typeof self/);
});
