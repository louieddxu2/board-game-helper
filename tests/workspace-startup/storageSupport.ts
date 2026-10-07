import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { build } from 'vite';
import type { } from './storageFixture';

export const startStorageFixture = async (suite: string): Promise<{ origin: string; close: () => Promise<void> }> => {
  const directory = resolve('test-results', `workspace-storage-${suite}-${process.pid}`);
  await build({ configFile: false, logLevel: 'error', build: { emptyOutDir: false, outDir: directory, lib: { entry: resolve('tests/workspace-startup/storageFixture.ts'), name: 'WorkspaceStorageFixture', formats: ['iife'], fileName: () => 'fixture.js' } } });
  const server = createServer(async (request, response) => {
    if (request.url === '/fixture.js') { response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }); response.end(await readFile(resolve(directory, 'fixture.js'))); }
    else { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(`<!doctype html><html><head><meta charset="utf-8"></head><body>${request.url === '/probe' ? '<script src="/fixture.js"></script>' : ''}</body></html>`); }
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing server');
  return { origin: `http://127.0.0.1:${address.port}`, close: async () => { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); } };
};
