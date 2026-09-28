import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { offlineShell } from './scripts/pwa-build';

export default defineConfig({
  plugins: [react(), cloudflare(), offlineShell()],
});
