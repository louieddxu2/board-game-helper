# Test quality review — 2026-07-30

Scope: tests changed or added for cache/catalog permissions, offline synchronization, privacy retention, import validation, authentication and CORS. Framework: Vitest. The complete 143-test suite passed once; the 42 changed/boundary tests then passed twice more with `--retry=0 --reporter=verbose`. Longest reviewed test was 66 ms.

| File | Severity | Finding and action |
|---|---|---|
| `src/lib/api.test.ts` | low | Public and editor catalogs now assert different counts while proving both use the same local cache; existing stale-while-revalidate and no-bypass assertions remain specific. |
| `src/lib/pendingSync.test.ts` | low | Network and IndexedDB are mocked only at boundaries. Tests assert partial failure preservation and concurrent single-flight behavior; added exact submit count so a skipped failed item cannot pass silently. |
| `src/lib/ruleDraftImport.test.ts` | low | Covers valid normalization, incompatible format, incomplete existing-game identity, invalid URL, malformed JSON, exact max, max+1 and byte limit. |
| `worker/retention.test.ts` | low | Specific SQL, timestamp binding and execution are asserted; scheduling composition is additionally guarded by the single-cron source check. |
| `worker/auth.test.ts` | low | Positive public routes and negative private/export boundaries are both explicit. |
| `worker/cors.test.ts` | low | Covers trusted mutation origin, unrelated-origin rejection, and the full-export regression. |

## Readability

Setup is local and behavior-relevant; parameterized invalid-import cases avoid conditional test logic. No mystery fixtures were introduced.

## Reliability

No real network, filesystem or D1 service is used. No sleep-based synchronization or shared mutable database state. Three consecutive runs were green.

## Diagnostic value

Assertions compare concrete routes, counts, cache calls, SQL and error messages. Each test has one behavioral reason to fail.

## Design

Pure import validation is separated from file-input UI. Offline orchestration mocks only API/local-storage/search-cache boundaries. D1 source rules are enforced by `scripts/check-d1-boundary.mjs` rather than repeated fragile source assertions in each test.

## AI-generated risks

All imports resolve and the full suite/type-check prove API signatures. Browser locators will be verified separately against the real rendered app. Generic domains appear only where an intentionally valid or invalid URL is the input under test.

## Coverage

The meaningful boundaries added in review were exact 20 vs. 21 rules, 64 KB + 1, malformed JSON, ordinary-user vs. editor counts, offline partial failure, and export public/private classification. Tag merge still relies on route/type/build verification and browser confirmation; its SQL is an admin-only, transactional D1 batch.

## Mutation testing

No mutation runner is installed in this repository, so no mutation score is reported and no production dependency was added solely for this change. The equivalent recurring regression risks in this scope are instead automated as the existing D1/cache boundary build gate (no `fresh`/`force`, no public full export, no ordinary-user account activity query, no catalog/table bypass).
