# Historical Fundamentals — overnight build ledger (2026-09-22 → 23)

Durable handoff ledger, updated after every coherent phase. The newest entry is at the bottom.

## Standing facts

- **Worktree:** `C:\w\fund`. It is a fresh path, not a symlink; its `app/node_modules` is a real copy.
- **Branch:** `feat/historical-fundamentals`. Local only; never pushed.
- **Prohibited tonight:** deploy, merge to master, production DB/R2/env writes, backfill, Main Trading, Breadth V2, intraday.
- **Harness cache:** SEC documents cached under the session scratchpad. The bulk ZIPs (companyfacts 1.41 GB, submissions 1.56 GB, fetched 2026-09-22) are local-only.

## Phase 0 — state (22:40 ET)

| | |
|---|---|
| origin/master at start | `a0adf6a9f` (moved 7 commits since the POC base `85b3a3355`) |
| origin/production | `d2e08e04b` |
| branch before merge | `d6a02be34` (POC foundation) |
| merged origin/master | `1303a2244`. Clean: every branch file is new, so there are no conflicts. |
| main checkout | `C:\Users\blake\projects\UCT-Dashboard` on `feat/app-themes`, 37 dirty paths belonging to another session. **Not touched.** |
| Breadth V2 | worktrees `C:/rem` (`breadth/v2-durable-runner` @ `7051ce02b`), `C:/b2`, `C:/w/bcorr`, `C:/w/bmrg`. **Not touched.** Runner status not probed; probing it would need Railway access. |
| production | untouched |
