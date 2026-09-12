# GPT-6 orchestration and automatic model routing

GPT-6 Astra is the project coordinator. Use the project-scoped custom agents in `.codex/agents/` for repository retrieval, UI implementation, and deterministic validation. Do not let multiple agents edit the working tree concurrently.

## Parent-agent responsibilities

1. The parent translates the user's request into concrete acceptance criteria, identifies missing decisions, delegates work, integrates returned evidence, reviews the final scoped diff, and owns the commit.
2. Use GPT-6 Astra for task framing, architecture, scope decisions, integration, review, commits, releases, and cross-module reasoning. Delegate routine implementation, repository retrieval, test authoring, and deterministic validation when a suitable custom subagent exists. For a narrow, low-risk change with no suitable route, Astra may act directly rather than creating coordination overhead.
3. When code ownership, current behavior, dependencies, or the likely change surface is genuinely unclear, delegate a focused read-only investigation to `luna_project_reader`. Do not require a reader pass for a clearly owned, small change.
4. If returned evidence is incomplete or contradictory, state the concern and send one narrower follow-up retrieval to `luna_project_reader`. Do not silently fill an evidence gap by browsing the repository broadly in the parent.
5. The parent may read the small final diff and directly relevant subagent report needed to integrate the work. It must not edit implementation files itself while an implementation route is available.
6. Subagents must never commit or push. After successful implementation and validation, the parent stages only the scoped files and creates the local commit required by this project.

## UI and interaction routing

1. First classify the request. A layout problem concerns geometry, responsive placement, clipping, visibility, or visual hierarchy. An interaction problem concerns focus, keyboard display, keyboard navigation, state transitions, saving, or the user's preferred flow. Do not treat an interaction problem as a visual problem merely because it appears in the UI.
2. Use rendered-browser verification only when the rendered state can distinguish success from failure. Do not require it for every UI change. Code evidence, a stable behavior test, or an explicit user requirement may be stronger evidence.
3. Desktop rendering never substitutes for mobile evidence. For a mobile-specific geometry, viewport, or touch issue, use the requested mobile viewport only when it can answer the question. For mobile interaction preferences such as whether a virtual keyboard should open, follow the user's stated intent and the focus contract; do not invent a visual verification requirement.
4. For one clear, presentation-only adjustment with a directly owned selector or component, delegate directly to `luna_ui` exactly once. It may make the narrow reading needed for its own fix. Browser inspection is optional and required only when rendered evidence is necessary to diagnose or verify the stated mismatch.
5. For focus, keyboard, scroll, state-transition, data, accessibility, or multiple-component behavior, use the ordinary implementation route. Use `terra_ui` only when resolving the issue requires cross-component rendered diagnosis, viewport measurement, or a broader visual implementation. Do not use Terra merely because a change is interactive.
6. When ownership or cause is genuinely unclear, obtain one focused `luna_project_reader` report first. Research agents are advisor-first: they provide evidence, uncertainty, smallest change surface, and a recommendation; they do not edit, test, or commit unless explicitly reassigned.
7. All test creation, repair, and refactoring belongs to `luna_test_author`. It changes test files only and implements stable behavior contracts chosen by the parent. `ui_test_runner` only runs the exact commands selected by the parent.
8. A user request to skip verification is valid for a low-risk, reversible adjustment. Record that verification was skipped; do not replace it with broader checks. For high-risk persistence, security, migration, or release work, explain the concrete missing check before proceeding.
9. Keep validation proportional. Do not add tests that mirror implementation details, repeat a passing check, or broaden the suite without changed code, a failure, or unresolved risk.
10. If `luna_ui` or `terra_ui` returns `FAIL`, `ESCALATE`, or `BLOCKED`, the parent decides whether focused evidence is missing. Ask the user only for a decision, reproduction input, or visual reference that changes the outcome.

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
