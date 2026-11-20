import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { 'cloudflare:workers': fileURLToPath(new URL('./worker/testing/cloudflareWorkersStub.ts', import.meta.url)) } },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'worker/**/*.test.ts', 'scripts/**/*.test.ts', 'scripts/**/*.test.mjs', 'integration/**/*.test.ts'],
  },
});
