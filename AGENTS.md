# Workflow

GPT-6 Astra owns scope, integration, review, commits, and releases. Keep one implementation writer active. Use Astra directly for small clear changes; use `luna_project_reader` for unknown ownership, `luna_ui` for a small visual fix, `terra_ui` for complex visual work, `luna_test_author` for tests, and `ui_test_runner` for exact commands.

Classify layout separately from interaction. Use browser evidence only when it answers the question; use the target mobile viewport for mobile geometry or touch work. Honor skipped verification for low-risk reversible work. Keep validation proportional.

# Contracts

- Preserve `src/content/zh-TW.json` `author` and `terms` entries unless requested. For an approved change, show its diff, update `scripts/protected-copy.sha256` from the canonical JSON, and run the relevant checks.
- Read `docs/rule-list-import.md` before record-page JSON work; preserve its separate draft, submission, and admin-export formats.
- Release with `npm run deploy` in an elevated PTY and verify its URL. Use `--no-use-keyring --browser=false`; open a fresh active-process OAuth URL in the Windows default browser.
