# Agent workflow

GPT-6 Astra coordinates scope, architecture, integration, review, commits, and releases. Keep one implementation writer active at a time. Use project agents for focused retrieval, implementation, test authoring, and command execution.

- Astra handles small, clearly owned, low-risk changes directly.
- `luna_project_reader` provides evidence, uncertainty, the smallest change surface, and a recommendation when ownership or cause is unclear.
- `luna_test_author` owns test creation and repair. `ui_test_runner` runs the parent's exact commands.
- The parent integrates results, reviews the scoped diff, and creates local commits. Agents return reviewable work without commits or pushes.

## UI and interaction routing

- Treat layout as geometry, placement, clipping, visibility, and visual hierarchy. Treat focus, keyboards, state, saving, and flow as interaction behavior.
- Use browser evidence when it can distinguish success from failure. Use code evidence, behavior tests, or user intent when they answer the question better.
- Use the requested mobile viewport for mobile geometry or touch questions. Follow the focus contract for mobile keyboard preferences.
- Route a clear selector or component presentation fix to `luna_ui` once.
- Route cross-component visual diagnosis, measurement, or broad visual work to `terra_ui`.
- Treat research agents as advisors. Assign editing only when the parent selects a change.
- Honor a request to skip verification for low-risk reversible work and record the choice. Use concrete checks for persistence, security, migration, and release work.
- Keep tests and validation proportional to the changed behavior.

# Project-specific author copy rules

## Protected author-owned text

- `src/content/zh-TW.json` is the source of truth for author text and canonical UI terms.
- Preserve `author` and `terms` entries byte-for-byte unless the user requests that wording or terminology change.
- For an approved copy change, show the exact diff, update `scripts/protected-copy.sha256`, and run `npm run check:protected-copy` with the relevant checks.

## Intentional update procedure

1. Confirm the requested wording or terminology change.
2. Update the requested catalog entries and calculate the canonical SHA-256 from `JSON.stringify(JSON.parse(the final UTF-8 catalog))`.
3. Present the before/after text and run protected-copy, relevant UI, type, and build checks.

## JSON import contract

- Read `docs/rule-list-import.md` before working on record-page JSON imports.
- Use it with `src/lib/ruleDraftImport.ts` as the import contract and preserve the distinct draft, submission, and admin-export formats.

## Cloudflare release authorization

- Release through `npm run deploy` in an elevated network-capable PTY (`sandbox_permissions: require_escalated`, `tty: true`) and verify the deployed URL.
- Use the working Windows login flags `--no-use-keyring --browser=false`.
- Open the fresh OAuth URL from the active Wrangler process in the Windows default browser. Use `Start-Process` when automatic launch is unavailable.
