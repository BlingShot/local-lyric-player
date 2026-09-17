// Essentia 0.1.3's separate-WASM loader includes a worker code path but its
// generated environment flags are hard-coded to window. Correct only those
// flags at bundle time; retain the upstream runtime, binary and license.
const flags = 'var ENVIRONMENT_IS_WEB=true;var ENVIRONMENT_IS_WORKER=false;';
export function adaptEssentiaWorker(source) {
  if (source.split(flags).length !== 2) {
    throw new Error('Essentia loader changed: review worker compatibility before building.');
  }
  return source.replace(flags, 'var ENVIRONMENT_IS_WEB=typeof window==="object";var ENVIRONMENT_IS_WORKER=typeof self==="object"&&typeof document==="undefined";');
}
export function essentiaWorkerPlugin() {
  return {
    name: 'essentia-worker-environment',
    enforce: 'pre',
    transform(source, id) {
      if (!id.split('?')[0].replaceAll('\\', '/').endsWith('/essentia.js/dist/essentia-wasm.web.js')) return null;
      return { code: adaptEssentiaWorker(source), map: null };
    },
  };
}
