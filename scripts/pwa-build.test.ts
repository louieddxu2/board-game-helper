// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { offlineShell } from './pwa-build';

describe('production offline shell build', () => {
  it('includes all emitted client assets and changes the shell version with the build', () => {
    const directory = mkdtempSync(join(tmpdir(), 'workspace-pwa-'));
    try {
      const source = readFileSync('public/sw.js', 'utf8');
      for (const name of ['index.html', 'standalone-mode.js', 'manifest.webmanifest']) writeFileSync(join(directory, name), name);
      mkdirSync(join(directory, 'icons'));
      for (const name of ['icon.svg', 'icon-192.png', 'icon-512.png']) writeFileSync(join(directory, 'icons', name), name);
      const writeBundle = offlineShell().writeBundle as (options: { dir: string }, bundle: Record<string, unknown>) => void;
      const build = (chunk: string) => {
        writeFileSync(join(directory, 'sw.js'), source);
        writeBundle({ dir: directory }, { 'index.html': {}, 'assets/main-a.js': {}, [chunk]: {}, 'assets/importer-b.js': {}, 'assets/style-c.css': {} });
        return readFileSync(join(directory, 'sw.js'), 'utf8');
      };
      const first = build('assets/WorkspacePage-first.js');
      expect(first).toContain('"/assets/WorkspacePage-first.js"');
      expect(first).toContain('"/assets/importer-b.js"');
      expect(first).toContain('"/assets/style-c.css"');
      expect(first).not.toContain('__BUILD_ID__');
      const same = build('assets/WorkspacePage-first.js');
      expect(first).toBe(same);
      const changed = build('assets/WorkspacePage-second.js');
      expect(changed.split('\n')[0]).not.toBe(first.split('\n')[0]);
      writeFileSync(join(directory, 'icons/icon.svg'), 'updated icon');
      const iconChanged = build('assets/WorkspacePage-second.js');
      expect(iconChanged.split('\n')[0]).not.toBe(changed.split('\n')[0]);
      // The Cloudflare worker build has no client HTML and must not rewrite this file.
      writeBundle({ dir: directory }, { 'worker.js': {} });
      expect(readFileSync(join(directory, 'sw.js'), 'utf8')).toBe(iconChanged);
    } finally {
      if (!directory.startsWith(join(tmpdir(), 'workspace-pwa-'))) throw new Error('Unexpected fixture directory');
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
