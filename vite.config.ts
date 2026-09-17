import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    {
      name: 'offline-resource-policy',
      transformIndexHtml() {
        // Only explicit lyric analysis can contact DeepSeek; media/assets stay local.
        const connections = command === 'serve'
          ? "'self' ws://127.0.0.1:3000 ws://localhost:3000 https://api.deepseek.com https://api.amll.dev https://raw.githubusercontent.com/amll-dev/amll-ttml-db/main/" : "'self' https://api.deepseek.com https://api.amll.dev https://raw.githubusercontent.com/amll-dev/amll-ttml-db/main/";
        const scripts = command === 'serve' ? "'self' 'unsafe-inline'" : "'self'";
        return [{
          tag: 'meta',
          attrs: {
            'http-equiv': 'Content-Security-Policy',
            content: `default-src 'self'; script-src ${scripts} 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; media-src 'self' blob:; connect-src ${connections}; object-src 'none'; frame-src 'none'; base-uri 'self'; form-action 'none'`,
          },
          injectTo: 'head-prepend',
        }];
      },
    },
  ],
  server: { host: '127.0.0.1', port: 3000, strictPort: true },
  // Prebundle the worker's parser at startup so first import never triggers an optimizer reload.
  optimizeDeps: { include: ['music-metadata'] },
  build: { outDir: 'build' },
}));
