// Chooses which browser tests a local release runs, from the files changed since
// the last successful production deploy. Gate tests (data persistence, contracts,
// recovery, Workspace and attribute voting) always run; the layout and touch @ui
// tests are skipped only when every change stays away from the pages.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export const DEPLOY_STATE_PATH = '.wrangler/last-successful-deploy-sha';

// Paths that cannot change how a page renders or responds to touch. Anything
// else, including shared types, build and test configuration, runs every test.
const PAGE_INDEPENDENT = [
  /^worker\//,
  /^migrations\//,
  /^docs\//,
  /^imports\//,
  /^integration\//,
  /^[^/]+\.md$/,
  /^scripts\/(?!run-core-e2e\.mjs$|serve-core-test\.mjs$|prepare-core-test\.mjs$|pwa-build\.ts$|release-test-scope\.mjs$)/,
];

export const browserTestScope = (changedFiles) => {
  if (!Array.isArray(changedFiles)) return { scope: 'all', reason: 'no successful deploy to compare with' };
  const pageFiles = changedFiles.filter((file) => !PAGE_INDEPENDENT.some((pattern) => pattern.test(file)));
  if (pageFiles.length) {
    const shown = pageFiles.slice(0, 3).join(', ') + (pageFiles.length > 3 ? ` and ${pageFiles.length - 3} more` : '');
    return { scope: 'all', reason: `page-related changes: ${shown}` };
  }
  return { scope: 'gate', reason: `${changedFiles.length} changed file(s), none page-related` };
};

const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

// Committed, uncommitted and untracked changes since the last successful deploy,
// or null when that commit is unknown or not an ancestor of HEAD.
export const changedFilesSinceLastDeploy = () => {
  try {
    const recorded = readFileSync(DEPLOY_STATE_PATH, 'utf8').trim();
    if (!/^[0-9a-f]{40}$/u.test(recorded)) return null;
    git(['merge-base', '--is-ancestor', recorded, 'HEAD']);
    const lines = (text) => text.split(/\r?\n/u).filter(Boolean);
    return [...new Set([
      ...lines(git(['diff', '--name-only', recorded])),
      ...lines(git(['ls-files', '--others', '--exclude-standard'])),
    ])];
  } catch {
    return null;
  }
};
