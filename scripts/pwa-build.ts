import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

/** Publish one complete shell per build; a failed install leaves the previous shell active. */
export const offlineShell = (): Plugin => ({
  name: 'offline-shell',
  apply: 'build',
  writeBundle(options, bundle) {
    if (!options.dir || !bundle['index.html']) return;
    const directory = resolve(options.dir);
    const assets = Object.keys(bundle).filter((name) => name.startsWith('assets/')).sort().map((name) => `/${name}`);
    const source = readFileSync(resolve(directory, 'sw.js'), 'utf8');
    const indexDigest = createHash('sha256').update(readFileSync(resolve(directory, 'index.html'))).digest('hex');
    const hash = createHash('sha256').update(source).update(JSON.stringify(assets));
    for (const name of ['index.html', 'standalone-mode.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png']) hash.update(readFileSync(resolve(directory, name)));
    writeFileSync(resolve(directory, 'sw.js'), source
      .replace('__BUILD_ID__', hash.digest('hex').slice(0, 16))
      .replace('__INDEX_SHA256__', indexDigest)
      .replace('/* BUILD_ASSETS */ []', JSON.stringify(assets)));
  },
});
