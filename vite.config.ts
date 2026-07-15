import { defineConfig } from 'vite';
import { iwsdkDev } from '@iwsdk/vite-plugin-dev';
import { compileUIKit } from '@iwsdk/vite-plugin-uikitml';

export default defineConfig({
  base: './',
  plugins: [
    iwsdkDev({ ai: { mode: 'agent' } }),
    compileUIKit(),
  ],
  server: {
    host: '0.0.0.0',
  },
  build: {
    target: 'esnext',
    minify: 'esbuild',
  },
});
