import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {
    resolve: {
      alias: { '@shared': resolve('src/shared') },
    },
  },
  preload: {
    resolve: {
      alias: { '@shared': resolve('src/shared') },
    },
    // A sandboxed preload can only require `electron`; all other dependencies (e.g. zod) must be bundled.
    build: { externalizeDeps: false },
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared'),
      },
    },
    plugins: [react(), tailwindcss()],
  },
});
