import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { execFileSync } from 'node:child_process';
import { offlineShell } from './scripts/pwa-build';

const appVersion = (() => {
  try {
    const revision = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8' }).trim();
    const modified = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim();
    return `${revision}${modified ? '+dev' : ''}`;
  } catch { return '未知版本'; }
})();

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  plugins: [react(), cloudflare(), offlineShell()],
});
