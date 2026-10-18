# Workflow

GPT-6 Astra owns scope, integration, review, commits, and releases. Keep one implementation writer active. Use Astra directly for small clear changes; use `luna_project_reader` for unknown ownership, `luna_ui` for a small visual fix, `terra_ui` for complex visual work, `luna_test_author` for tests, and `ui_test_runner` for exact commands.

Classify layout separately from interaction. Use browser evidence only when it answers the question; use the target mobile viewport for mobile geometry or touch work. Honor skipped verification for low-risk reversible work. Keep validation proportional.

涉及滑動、切頁或彈窗的測試，應驗證畫面可操作後的首次原生輸入立即且只生效一次，不以額外等待或重試掩蓋漏點。發生漏點時先追蹤事件傳遞、命中目標與狀態清理，修正時保留滑動、縮放、長按與取消的防誤觸。

修改 OAuth 或其他前後端契約時，至少以實際前端設定／請求連接實際後端驗證做回歸測試；第三方 mock 不得補出該請求與權限未保證的欄位，並須涵蓋拒絕與重試邊界。分開回報模擬測試、正式站健康檢查與真實第三方驗收；Drive 範例見 `docs/google-drive-backup/snapshot-v3.md`。

# Contracts

- Keep maintained source, styles, tests, and scripts within 600 lines per file. Split by responsibility; data, historical migrations, dependency locks, and generated artifacts retain their formats. Run `npm run check:file-size` to verify.
- Preserve `src/content/zh-TW.json` `author` and `terms` entries unless requested. For an approved change, show its diff, update `scripts/protected-copy.sha256` from the canonical JSON, and run the relevant checks.
- Read `docs/rule-list-import.md` before record-page JSON work; preserve its separate draft, submission, and admin-export formats.
- Release with `npm run deploy` in an elevated PTY and verify its URL. Use `--no-use-keyring --browser=false`; open a fresh active-process OAuth URL in the Windows default browser.
