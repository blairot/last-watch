import { defineConfig } from 'vitest/config';

// Balance simulator: `npm run sim`. Not part of `npm test`.
export default defineConfig({
  test: { include: ['scripts/**/*.sim.ts'], environment: 'node', testTimeout: 600000 },
});
