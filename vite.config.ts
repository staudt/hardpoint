/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// GitHub Pages serves the site from /<repo>/. Override with BASE_PATH if needed.
const base = process.env.BASE_PATH ?? '/hardpoint/';

export default defineConfig(({ command, isPreview }) => ({
  // Dev server runs at '/', builds and `vite preview` use the Pages path.
  base: command === 'serve' && !isPreview ? '/' : base,
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
  },
  server: { port: 5173 },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
}));
