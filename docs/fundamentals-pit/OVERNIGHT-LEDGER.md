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

## Phase 10–16 checkpoint (23:30 ET)

- `06a736a5e` pipeline, compact store, canonical registry
- `d61d8a055` series API, dark unless `FUNDAMENTALS_PIT_ENABLED=1`, behind `require_bars_access`, `Cache-Control: private` + ETag
- `88f275060` `fund:` source through the ONE engine (binder branch, no second pane/legend/MA system)
- `3ac3ddc19` Indicators → Fundamentals library + unit-aware formatting

## Phase 17–20 — real ChartWidget acceptance (23:30 → 00:25 ET)

**Harness.** `app/fundamentals-harness.html` (commit `c6bf86bf3`) mounts the real ChartWidget → StockChart → engine. It answers every `/api/*` from files exported, and git-ignored, from the scratch store plus a read-only `bars.db`, and refuses preference writes. Driven with headless Chrome over CDP, using an isolated profile in the scratchpad, because the Chrome extension was not connected. `__fund.audit()` is an INDEPENDENT oracle: it re-derives every plotted value from the raw artifact and raw bars without importing the engine's as-of code.

**Defects found and fixed**

| Commit | Defect | Evidence |
|---|---|---|
| `cb4fb9a67` | **Pane readouts pinned by layout slot, not by where the series drew** (PRE-EXISTING, shared). An all-NaN own-pane host gets a layout slot but no renderer pane, so every readout below it lands one pane off. JPM Net Margin was captioned "Gross Margin". | Reproduced with NO fundamentals: `sym:ZZZZ` above `sym:SPY` drew SPY under a "ZZZZ" caption. Fix asks the renderer by identity (`engine/paneReadoutPlacement.js`). Layout heights untouched. |
| `fbcc22531` | MA of a fundamental printed `27.62`, not `27.6%` | SMA 20 of Net Margin = independent SMA at 1,581/1,581 points; the unit now follows `domainBehavior: 'inherit'` |
| `5d881446f` | Source picker showed `revenue_q`; rows lacked methodology | Now "Revenue (Quarterly)"; Beta row reads "1Y daily · Benchmark: SPY" |
| `8ce0fd356` | **Series stepped back to an older period** when the newest TTM stopped being computable (DERIVATION v2) | TSLA 2025-04-23 re-emitted the 2024-09-30 TTM; 31,551 points / 1,993 of 3,503 companies in v1, **0 in v2** |
| `2a4a7446c` | Earnings-release lag undisclosed | NVDA Q2 FY24: 8-K 2023-08-23 vs 10-Q 2023-08-28. Every filing-sourced metric's `limitations` now says so, and the row tooltip shows it. |

**Acceptance (all through the member's door: Chart Settings → Indicators → Fundamentals)**
- Browse-add Revenue (Quarterly) → own pane, step, `$109.42B` legend and axis.
- Search-add "p/e" → P/E (TTM), line, `38.87x`.
- Search-add "beta" → Beta.
- Catalogue off and 403 → neutral notice, no rows.
- A symbol with no fundamentals → nothing drawn and no misplaced caption.
- `mergeChartSettings` round-trip keeps every fund instance, presentation and MA source.
- No preference write left the page (`__fund.blocked()` empty).
- **Oracle:** 198/198 comparable series exact (AAPL/NVDA/JPM/TSLA × D/W/M/60/5; CAT/CAVA/CELH × D/W). 0 pre-effective values. The 10 "not plotted" are JPM gross margin and FCF yield, which JPM genuinely lacks. CAT/CAVA/CELH have no local M/60/5 bars.
- **Temporal golden:**
  - Accepted after 17:30 → next session: CAVA Tue 18:08 → Wed; NVDA Fri 19:36 → Mon.
  - 60m transition at the first bar ENDING after `public_at` (AAPL 06:01 → the 06:00–07:00 bar).
  - IPO: CAVA plots nothing from IPO 2023-06-15 until the 10-Q of 2023-08-16; TTM starts at the FY2023 10-K, with nothing synthesized.
  - Split: NVDA EPS is already post-split before 2024-06-10 (0.371, not 3.71).
- **Provenance:** `explain_cli` gives facts with accession, form, acceptance time and public time. `--sample 300` → **300/300 reproduce**.

**Performance** (scratch store, local)
- Serving: warm 2–6 ms. Cold, one series: ~14 ms.
- Cold, all 25 series incl. Beta: 31–589 ms. The 589 ms is AAPL Beta over 33 years of closes.
- Artifact per company: p50 38 KB raw / 8 KB gzip; p95 82 KB / 18 KB; max 94 KB.
- **Beta dominates payload:** AAPL 8,267 daily points, 410 KB raw / 89 KB gzip, fetched only when Beta is charted. A `[t,v]` encoding would cut it to 61 KB gzip (follow-up).
- Chart: as-of projection 0.3–0.6 ms per 1,600 bars (even against 8,267 Beta points), memoized per bar set.

**Known, NOT fixed (documented)**
- **Over-broad restatement invalidation.** A restated comparative first seen in a later 10-Q invalidates an older overlapping FY fact that was already on the new basis. That leaves TSLA without TTM for Q1–Q3 2025. About 2% of TTM transitions since 2020 skip ≥1 quarter (445–699 companies per metric); some of those are legitimate. This is a knowledge-layer rule change; it needs a design pass, not an overnight patch.
- **No on-chart "no data" state for an own-pane fundamental.** The readout is correctly hidden, but the member sees nothing on the chart. The Indicators list still shows the instance.
- `/api/ticker-logo` `<img>` requests are not fetch and go to the vite proxy (ECONNREFUSED, since nothing runs on :8000). This is harmless.

## Phase 22 — final gate (00:30 ET)

| Gate | Result |
|---|---|
| Master movement | `a0adf6a9f` → `ecdfef01e`: one Screener-shell commit, no shared files. `git merge-tree` clean. |
| `vitest src/components src/testing` vs baseline `a0adf6a9f` | Branch 13,776 tests (+43), 33 failing. Baseline 13,733, 33 failing. **0 new failures.** The failure MESSAGES were diffed too: 32/33 identical. The one difference (`controlDoorCensus` door eight, 15 vs 14 callers) was this branch's harness, now ledgered (`abaec17f4`). The remaining gap is master's own 14-vs-13. |
| Pre-existing failures | Missing `@codemirror/*` in a copied `node_modules` (editor suites), Layout suites, corpus-dependent census/measure suites, `dailyFirstPaintIncidental` CASE A, `reachable`, `stockChartWiring` z-order suffix, `memberPaneGate`. All fail identically on the baseline. |
| pytest `tests/fundamentals_pit` + Screener suites | **535 passed**, 1 skipped (the `SCREEN_BACKTEST_ENABLED` flag) |
| `import api.main` | OK. Two PIT routes mounted, dark unless enabled. |
| `vite build` | **Passes** (19 s) after `npm ci` in THIS worktree; its copied `node_modules` lacked `@discord/embedded-app-sdk` and `@codemirror/*`. The harness is absent from `dist/`. |
| Lint delta (22 changed frontend files) | +1: `react-refresh/only-export-components` in the new harness, the same single error `scanHarness.jsx` carries |
| Control-byte scan | Every changed file clean at every commit |
| TDZ | New StockChart references are read inside callbacks (`chipPaneHostRef`, `rendererPaneIndexOf`). The real StockChart rendered in the full suite and the harness. |
| Production | **Untouched.** No push, no deploy, no env / DB / R2 write, Main Trading and Breadth untouched. |

## 2026-09-23 — controlled production rollout: STOPPED SAFELY at Phase 13

**Shipped (dark):**
- `d4e0217b6`: 23 feature commits, fast-forwarded onto master `578d73b9e`.
- `c7bddc046`: never log HTTP request URLs.

Both went out after the Breadth V2 corrected run reported DONE (100%, 0 failed; the runner is branch-pinned, has a never-matching watch pattern and was untouched throughout). The master deploy gate and the promotion passed. Web, worker and bars-api are on `c7bddc046`. `FUNDAMENTALS_PIT_*`: 0 variables on web or worker.

**Pre-merge fixes:**
- lint → 0 attributable;
- pane-caption StockChart rail, mutation-checked;
- derivation v3: an underivable newest period is a GAP (and the client parser kept dropping gaps; fixed);
- Beta precomputed on the worker (589 ms → 9–15 ms; 113 MB);
- fair-access bulk fetch, `--listed`, fail-loud Massive ledger;
- deploy-gate flag declarations;
- deep-link ledger row.

**Gates:** zero attributable failures against fresh master. Frontend: 24,159 tests. Backend: like-for-like subset, 229 vs 230.

**Production data (worker, isolated, NOT served, NOT published):**

| | |
|---|---|
| Store | `/data/fundamentals_pit.db`, schema v3 |
| Golden ingest (12 companies, FS 2022Q1, Massive ledger) | **17,122/17,122 identical** to accepted golden |
| Universe (`--listed`, 70 FS quarters) | 7,088 companies, 0 ingest/derive failures, 10.43M facts, 357,127 filings, 196,994 signals, 4.72M points (386,730 gaps), 1.16 GB, 26 min. Integrity: 0 null/non-finite/future/duplicate, 0 period regressions. Provenance 300/300. |

**⛔ STOP — wrong data, not missing data.**
- **Where:** golden re-run after the full FS history.
- **Scale:** 17,065 identical; 44 value→gap (acceptable); 13 changed values. All changed values are reproducible with no look-ahead, BUT CELH `net_income_ttm` @2022-08-09 went 18.41M (coherent ytd_roll) → **15.23M = sum_of_4 mixing ORIGINAL Q3-2021 / 9M-2021 (`NetIncomeLossAvailableToCommonStockholdersBasic`) with the RESTATED FY2021**.
- **Mechanism:**
  1. The Q2-22 10-Q's own prior-year comparatives carry restatement_axis signals (FS 2022Q3), which rejects ytd_roll.
  2. The sum_of_4 fallback takes 2021 quarters from a pooled tag.
  3. That tag's tag-scoped signal only arrives 2022-11-09.
- **Exposure (upper bound):** 7,359 sum_of_4 TTM points / 1,438 companies in a restated window, plus the ratios built on them.
- **Fix direction (needs a design pass):** sum_of_4 must refuse, i.e. GAP, when any quarter tile's value predates a restatement signal covering that period on ANY tag in the primitive's pool.

**Not done (by the stop):** R2 publish, flag enable, scheduler deploy. The scheduler, drain fix and flag row are local commit `6feee3530`, unpushed.

**Other findings:**
- The Massive `apiKey` is written into INFO logs by httpx. Fixed in `c7bddc046`; the one job log was redacted. The key value appeared in session output; rotation is an owner decision.
- Web logs show earnings AI analysis failing with "credit balance too low" (unrelated).
