import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));

// The canonical model contract lives at ../model (repo root), shared with docs
// (MODEL.md). The app imports it via the @model alias; server.fs.allow lets the
// dev server read it from outside the app root.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@model': path.resolve(dir, '../model') },
  },
  server: {
    fs: { allow: ['..'] },
  },
  preview: { port: 4173, strictPort: true },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          r3f: [
            '@react-three/fiber',
            '@react-three/drei',
            '@react-three/postprocessing',
            'postprocessing',
          ],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
