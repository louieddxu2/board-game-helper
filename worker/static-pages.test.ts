// @vitest-environment node
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { expect, test, vi } from 'vitest';
import { app } from './index';
import type { Env } from './env';

test.each(['wrangler.jsonc', 'wrangler.production.jsonc', 'wrangler.core-test.jsonc'])(
  '%s serves page HTML through static assets without invoking the Worker', filename => {
    const { config, error } = ts.parseConfigFileTextToJson(filename, readFileSync(filename, 'utf8'));
    expect(error).toBeUndefined();
    expect(config.assets.not_found_handling).toBe('single-page-application');
    expect(config.assets.run_worker_first).toEqual(['/api/*']);
    expect(config.assets.binding).toBeUndefined();
  },
);

test.each(['/games/shipyard', '/games/missing/', '/games/%E8%88%B9%E5%BB%A0'])(
  '%s has no dynamic page handler or access to service bindings', async pathname => {
    // Static assets own page requests. Even a request sent directly to the
    // Worker must not trigger a second game lookup, session read, or cache write.
    const bindingAccess = vi.fn((_target, property) => {
      throw new Error(`Unexpected page binding access: ${String(property)}`);
    });
    const env = new Proxy({} as Env, { get: bindingAccess });
    const response = await app.fetch(new Request(`https://rules.example${pathname}`), env);
    expect(response.status).toBe(404);
    expect(bindingAccess).not.toHaveBeenCalled();
  },
);
