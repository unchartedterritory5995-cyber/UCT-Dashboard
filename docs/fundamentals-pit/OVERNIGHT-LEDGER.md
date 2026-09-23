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

## Phase 1–9 checkpoint (23:10 ET)

**Commits so far**
- `c0e42f6a0` store + filing-level restatement ingestion
- `4f499dd47` split ledger verified against the filings
- (this) pipeline: compact store, ingest, derive, backfill, incremental, publish, snapshot archive, registry

**Decisions made (ordinary implementation):**
- **Split source:** reuse `reference_corp_actions.fetch_confirmed_splits` (Massive). Production allow-list `("massive",)`. Local runs use the named source `fixture:yahoo`, which production never accepts.
- **Split verification:** evidence windows, rounding intervals, ≥2 informative periods, and share-count corroboration. A security that fails has every split-sensitive metric withheld.
- **Restatement signals:** tag-scoped and value-aware, from SEC FS data sets (backfill) and the filing instance (incremental). Pooled tags share seeds. Scale errors (×1e3/×1e6) are quarantined.
- **Store:**
  - integer concept, filing and date keys;
  - provenance stored as accession lists; full provenance is reproduced by re-derivation (`derive.explain`, which also checks determinism);
  - filings retained only if cited by a fact or periodic.
- **Beta:** id `beta_1y_spy`, label "Beta", subtitle "1Y daily · Benchmark: SPY".
- **Snapshot archive:** every candidate source is R or U in `provider_licensing_class`, so `RETENTION_ALLOWED` is empty and the framework is dormant (OWNER DECISION).

**Measured**

| | |
|---|---|
| Golden 12 companies | 12 s, 37,609 facts, 16,363 points, 3.6 MB; re-run skips all; store hash identical |
| UCT universe | 3,503 companies, 6.79M facts, 221,574 filings, 3,958 signals, 2.76M points, **604 MB** (was 2.86 GB before compaction), **115 s** on 8 procs, 0 failures |
| Split-unverified | 386 companies locally. Expected: the local ledger fixture covers 17 tickers, so any company whose filings show a split and has no ledger row is withheld. This number must be re-measured with the Massive ledger. |
| Tests | 97 pytest passing |
| Production | untouched |
