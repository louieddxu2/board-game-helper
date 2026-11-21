import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';

// Isolate the old in-memory scoring path. Both variants use today's HTTP
// middleware, receipt validation, schema and fixture setup.
export const adjacentCostVariant = {
  name: 'adjacent-ranking-cost',
  setup(build) {
    build.onLoad({ filter: /[\\/]attributeOnlineScoring\.ts$/ }, ({ path }) => ({
      contents: execFileSync('git', ['show', '58a4b46:worker/workflows/attributeOnlineScoring.ts'], { encoding: 'utf8' }),
      loader: 'ts',
      resolveDir: dirname(path),
    }));
  },
};
