import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the build works from a GitHub Pages project subpath.
  base: './',
  server: { host: '127.0.0.1', port: 5173 },
  build: { chunkSizeWarningLimit: 2000 },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
