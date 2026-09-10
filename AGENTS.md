# GPT-6 orchestration and automatic model routing

GPT-6 Astra is the project coordinator. Use the project-scoped custom agents in `.codex/agents/` for repository retrieval, UI implementation, and deterministic validation. Do not let multiple agents edit the working tree concurrently.

## Parent-agent responsibilities

1. The parent translates the user's request into concrete acceptance criteria, identifies missing decisions, delegates work, integrates returned evidence, reviews the final scoped diff, and owns the commit.
2. Do not use GPT-6 Astra for broad repository searches, routine file reading, implementation, browser operation, test execution, type-checking, or builds when a custom subagent can do that work.
3. When code ownership, current behavior, dependencies, or the likely change surface is unclear, delegate a focused read-only investigation to `luna_project_reader`. Give it specific questions rather than asking it to understand the whole repository.
4. If returned evidence is incomplete or contradictory, state the concern and send one narrower follow-up retrieval to `luna_project_reader`. Do not silently fill an evidence gap by browsing the repository broadly in the parent.
5. The parent may read the small final diff and directly relevant subagent report needed to integrate the work. It must not edit implementation files itself while an implementation route is available.
6. Subagents must never commit or push. After successful implementation and validation, the parent stages only the scoped files and creates the local commit required by this project.

## UI routing

1. Trigger this routing automatically whenever the user requests a change to layout, spacing, sizing, alignment, typography, color, visibility, responsive behavior, or other rendered presentation. The user does not need to name an agent.
2. First write concrete visual acceptance criteria and identify the viewport and interaction states that matter.
3. For one clear visual adjustment that does not change data, business logic, accessibility behavior, or an API contract, delegate directly to `luna_ui` exactly once. It may perform the narrow reading needed for its own fix; do not add a separate reader pass unless ownership or cause is unclear.
4. For an unclear change surface, first use `luna_project_reader`, then pass its evidence and the acceptance criteria to `luna_ui`. For an originally ambiguous request, multiple interacting components, or substantial product/design judgment, ask the user for the missing decision when necessary, then route implementation to `terra_ui`.
5. After an implementation agent returns `PASS`, delegate only the narrow deterministic checks relevant to its changed files to `ui_test_runner`. The implementation agent and parent must not rerun those checks.
6. If `luna_ui` returns `FAIL` or `ESCALATE`, or its post-fix checks fail, delegate the same acceptance criteria and all evidence to `terra_ui` exactly once. Do not ask Luna to try another implementation workaround.
7. If `terra_ui` returns `FAIL` or `ESCALATE`, or its post-fix checks fail, the parent reviews the evidence, raises the unresolved concern, and either requests one focused retrieval from `luna_project_reader` or stops for the user's decision. GPT-6 Astra must not become a third implementation loop.
8. If any agent returns `BLOCKED`, stop and ask the user only for the missing decision, reproduction input, or visual reference.
9. A UI implementation agent may report success only after rendered browser verification. Tests that inspect CSS source text or regex matches do not prove visual success.
10. `ui_test_runner` may run tests, type-checks, or builds selected by the parent, but it must never edit code, update snapshots, fix failures, commit, or push.
11. Add tests only after rendered behavior passes, and only for a stable behavior contract. For a reversible, low-impact presentation change, do not add tests that merely mirror implementation details.
12. Keep validation proportional to the changed files. Once narrow checks pass, do not broaden or repeat them unless new edits, failures, or unresolved evidence justify it.

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
