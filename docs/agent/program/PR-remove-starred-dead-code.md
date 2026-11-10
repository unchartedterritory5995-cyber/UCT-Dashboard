# PR: delete the dead starred / "Remove starred" code (owner: the feature stays removed)

Branch `agent/pl/remove-starred-dead-code`. This branch carries `agent/pl/exec-heldout12` (merged in at 4d9b87d8b9) because both
PRs edit the status doc. Merge it after that PR, or re-run the recount after a rebase.

## Why it was dead
- The per-row star was intentionally removed in 72482c8400 (the columnar redesign: star-as-flag).
- Nothing has called `toggleStar` since then, so `starred` was always empty and the list-menu row "Remove starred (N)"
  (guarded by `getStarredSyms(id).length > 0`) could never render.

## Dependency check (grep of app/src, docs, CLAUDE.md)
- `toggleStar`: only its definition.
- `getStarredSyms` and `handleRemoveStarred`: only each other and the menu row.
- `setStarred`: only those functions.
- After the deletion, `useFlagged().remove` (alias `removeFlagged`) had no caller, so the alias was dropped.
- `isLinkedList`, `mutateMine` and `ctxItemDanger` are still used elsewhere.
- Tests: `agentGuideHeldOutControls.test.js` already lists "Remove starred" as WITHDRAWN. No test drives the row.
- Docs fixed:
  - CLAUDE.md (the "Star selection + bulk remove" line and the context-menu list);
  - CHARTS_COVERAGE_MATRIX.md C3-080 code cell;
  - one comment example in `agent/guide/targets.js`.

## Status doc
- C3-080 is NOT IN PRODUCT. It is now NOT ON /CHARTS, marked "(was IMPLEMENTED / UNVERIFIED)", and listed in "Denominator".
- Recounted by `docs/agent/program/recount-c3080.mjs`:
  - in scope 484 -> 483, excluded 19 -> 20;
  - IMPL / UNVERIFIED 64 -> 63;
  - VERIFIED 233 of 483, 48.2%.

## Results
- **Command (from `app/`):** `npx vitest run src/pages/Watchlists src/agent/agentGuideHeldOutControls.test.js src/agent/guide`
  (under the suite lock), on 5fed0561f1 plus the removal.
- **Totals:** `Test Files 1 failed | 19 passed (20)` / `Tests 1 failed | 154 passed (155)`.
- **The 1 failure** is `Watchlists.entitykeys.test.jsx` "fields absent (flag off)", which is already red on master. Its
  received render hash is `3a6e9485ef7d…` both on master (run separately) and with the removal, so the rendered page is
  unchanged.
- **Lint (`eslint src/pages/Watchlists.jsx`):** 24 problems on master, 23 after. The `toggleStar` no-unused-vars error is gone
  and nothing new appears. (The commit message of 074b73fcae says "24 before and after"; that is wrong, and 23 is correct.)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
