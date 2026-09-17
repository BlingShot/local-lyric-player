declare module 'essentia.js/dist/essentia.js-core.es.js' {
  export { default } from 'essentia.js/dist/core_api';
}
declare module 'essentia.js/dist/essentia-wasm.es.js' {
  export const EssentiaWASM: any;
}

declare module 'essentia.js/dist/essentia-wasm.web.js' {
  export default function createEssentia(options: { locateFile: (file: string) => string }): Promise<any>;
}
