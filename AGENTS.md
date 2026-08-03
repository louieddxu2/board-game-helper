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
