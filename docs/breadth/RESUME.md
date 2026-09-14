# Breadth → Data Charts overhaul — RESUME

**Worktree** `C:\Users\Patrick\uct-worktrees\breadth-charts` · branch `feat/breadth-charts`
**Pushed** `7c9bb5e32` · **R1 merged to master** `cda883387` · web **SUCCESS** (deploy `e0d8731e`, 2026-09-14T00:41:31Z)

## Where the programme is

**R1 (registry unification) is DONE, merged and live.** Tasks 1–3 are individually visible in the merge
commit. C1/C2/C3 shipped earlier.

| | |
|---|---|
| Task 1 `0dd21c248` | the golden — pins the heatmap registry BEFORE the move (53 rows, 46 tiles, 16 drill keys, 5 controls + a size floor) |
| Task 2 `c68b5f9ed` | `METRIC_META`, 65 entries, additive; 21 rails |
| Task 3 `6d944b8c8` | `heatmapMetrics.js` is a thin adapter; 54 entries preserved |
| Gate | `59e1c9a76`, tree identical both ends, 1,325 files reconcile, **8 failing in 7 files / 19,498 passed** — every failure a documented baseline row owned elsewhere |
| Post-deploy | Data Charts tab 1280 + 390 → **0 errors**, CLS 0.0 · `/charts` widget 1280 renders, 390 N/A. Frames under `docs/breadth/screenshots/deploys/cda883387/` |

⛔ **The golden never moved** (D-037) and must not: regenerating it is allowed only for a deliberate
member-visible change with its own DECISIONS line.

## Next

1. ✅ **B1 done** — `GET /api/breadth-monitor/series`, dark, merged `5a0e224f4`, deploy `5582d6d4`.
   Contract `docs/breadth/api-series.md`; ruling D-041. Verified 404 in production for anonymous and paid.
2. **NEXT: V2-1**, then V2-2 … V2-5, then Phase 4 (rig thresholds) and Phase 5/6. `COVERAGE.md` maps every
   brief item to its home.
3. **V2-1's first commit must carry the `VITE_BREADTH_CHARTS_V2_ENABLED` LEDGER ROW**, in the same commit as
   the first `import.meta.env.VITE_BREADTH_CHARTS_V2_ENABLED` read. ⛔ Not before:
   `test_no_stale_build_flag_rows` asserts `declared ⊆ names_read(repo)`, so a row for a flag nothing reads
   is stale by definition. Its `Dockerfile.web` ARG/ENV already landed (`6e9c8dcaf`) and the build-arg check
   passes, so that half of D-001's precondition is done.

## Standing rules earned on this programme

- **The gate sequence** (`gates.md`): merge master → **freeze the tree** → gate → delta rule only if master
  moved during it → push the exact gated hash. ⛔ An edit during a gate voids it, by wrapper design — it
  happened here (`8a8718ec4` → `936da1aba`, 30 minutes lost). Docs written during a run go to a scratch file
  OUTSIDE the worktree.
- **Overlap is computed against the MERGE BASE**, never `origin/master..HEAD` — once master moves that range
  replays master's own commits in reverse and reports a large fake overlap.
- **The union decides the merge**; a failure changing shard is a move, not a regression.
- **Credentials never reach a log** — `docs/runbooks/rig-credential-hygiene.md`, `tools/secret_scrub.py`,
  pre-commit + pre-push hooks. A member-smoke session leaked here and was rotated (D-038).

## Off this programme, opened by it

`fix/password-change-revokes-sessions` at `C:\Users\Patrick\uct-worktrees\password-revoke`, first commit
**`dd220b2aa`** — all three password-writing paths now revoke sessions. Needs its own gate and merge.
