# Global workflow rules for small UI adjustments

## Simple UI adjustment workflow

When a request is limited to visual layout, spacing, sizing, alignment, responsive behavior, or styling, treat it as a small UI adjustment unless it also changes data, business logic, accessibility behavior, or an API contract.

1. Before editing, write down the smallest concrete acceptance criteria and the relevant states to verify. For example: desktop and mobile, empty and long values, or the affected input modes. Do not begin by adding tests or by changing multiple unrelated layout mechanisms.
2. Prefer one minimal CSS/layout solution first. Do not introduce DOM measurement, `useLayoutEffect`, extra React state, or cross-component refactors until a browser check shows that CSS alone cannot satisfy the acceptance criteria.
3. Treat each iteration as a hypothesis, not as progress by itself. Record what the previous attempt was expected to change, what actually failed, and the likely cause before making the next edit. Do not respond to an incorrect result by blindly adding another compensating override.
4. Verify the final result in the browser at the relevant viewport sizes and interaction states. Source-text regex checks are not a substitute for rendered layout verification. When a check fails, inspect computed styles, the cascade, intrinsic sizing, viewport constraints, and component structure before changing the implementation. If browser verification is unavailable, state that limitation and use the narrowest relevant automated check instead.
5. Add or change tests only for a stable behavior contract. Do not add a new test for every intermediate CSS hypothesis, and do not assert exact CSS declaration text unless that declaration is itself an intentional policy contract.
6. Keep verification proportional to the change:
   - CSS-only: browser check plus the project build when practical; do not run the full test suite, release gate, core E2E suite, or type-check unless the change touches their relevant boundary or the user requests it.
   - UI TypeScript/TSX: browser check plus focused tests; run type-check when TypeScript code was changed.
   - Data, worker, API, auth, or release changes: follow the broader project test requirements.
7. If two consecutive focused attempts do not satisfy the acceptance criteria, stop layering overrides. Re-evaluate the layout model and replace the approach or ask for clarification rather than continuing an unbounded patch-test loop.
8. Keep iterative corrections as one cohesive working-tree change and commit only after the final behavior has been verified. Before committing, summarize the exact files being committed and exclude unrelated generated or untracked files.

# Project-specific author copy rules

## Protected author-owned text

- `src/content/zh-TW.json` is the single source of truth for author-written paragraphs and canonical UI terms.
- The entries under `author` were written by the site author. Do not rewrite, shorten, expand, translate, polish, or relocate their meaning unless the user explicitly requests that exact text change.
- The entries under `terms` are canonical interface labels. Do not replace them with synonyms unless the user explicitly requests the terminology change.
- Layout work, component refactors, privacy updates, and feature work must preserve protected copy byte-for-byte.
- `scripts/protected-copy.sha256` may be updated only after an explicit author request to change protected copy. Before updating it, show or summarize the exact protected-text diff.
- Never modify `scripts/check-protected-copy.mjs` or its callers to bypass a protected-copy failure.

## Intentional update procedure

1. Confirm that the user explicitly requested the protected wording or terminology change.
2. Change only the requested entries in `src/content/zh-TW.json`.
3. Present the exact before/after wording in the handoff.
4. Update `scripts/protected-copy.sha256` to the SHA-256 calculated from `JSON.stringify(JSON.parse(the final UTF-8 catalog))`.
5. Run `npm run check:protected-copy`, relevant UI tests, type-check, and build.

## JSON import contract

- Before producing, editing, or diagnosing record-page JSON imports, read `docs/rule-list-import.md`.
- `docs/rule-list-import.md` is the human- and AI-facing contract; `src/lib/ruleDraftImport.ts` is the runtime validator.
- Keep the record-page draft JSON format separate from the `/api/submissions` request envelope and the admin review export format.

## Cloudflare release authorization

- The verified Windows release path is `npm run deploy`, which first checks the existing Wrangler login and only starts OAuth when it is invalid.
- Do not use `wrangler login --use-keyring` in this workspace. The Windows keyring package installation is blocked in the managed environment; the working login flags are `--no-use-keyring --browser=false`.
- When running Cloudflare login, migration, or deployment from Codex, invoke the command with an elevated network-capable PTY (`sandbox_permissions: require_escalated`, `tty: true`). A normal sandbox can start the local callback listener but fails the HTTPS token exchange with `EACCES`.
- The OAuth URL must be generated by the currently running Wrangler process and opened in the user's Windows default browser while that same process remains alive. Never reuse an URL from an earlier attempt or start a second login process.
- If automatic browser launch is blocked, use Windows `Start-Process` with the fresh URL and the same elevated permission; do not substitute the in-app browser.
- After the callback reports `Successfully logged in.`, run the existing release command and verify the deployed URL. Do not claim deployment succeeded from a local build alone.
