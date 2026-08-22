# Screener Wave 5 — Patterns + Darkpool + Flow Aggregates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thirteen new snapshot columns from three local/bridged sources — the 85-detector pattern engine, the darkpool block-print store, and a new flow-worker options aggregate — then (a separate ship) the governed manifest bump that makes 40 columns formula-sayable (28 Wave-2 promotions + 12 Wave-5 declarations).

**Architecture:** TWO-STAGE SHIP (ruling D1). **Stage A — the data plane**: schema columns, two web-local join producers (`pattern_join`, `darkpool_agg`), one flow-worker aggregate job delivering a small JSON via R2 (`data_sync`), a web-side reader + pull job, and the builder wiring. Ships first, runs ONE night. **Stage B — the vocabulary**: the closedTable manifest bump, corpus cases, and FILTERS/columnDefs for the new columns. Ships only after Stage A's receipts check, so no member ever sees a formula vocabulary pointing at a NULL universe (map 4 R8: the first-night `answered=0, not_computable≈universe` UX is designed-honest but avoidable entirely by sequencing). A prerequisite task (P0) clears the pre-existing conformance-gate backlog so Stage B's gate runs green for Wave-5's own reasons.

**Tech Stack:** FastAPI + SQLite (screener.db, patterns.db, darkpool.db web-local; flow.db on the flow-worker) · R2 via `api/services/data_sync.py` · APScheduler on both pods · the frozen AST interpreter's closedTable manifest · pytest + vitest.

**Spec:** `docs/superpowers/specs/2026-08-21-screener-deep-work-design.md` §2.3 (columns), §2.4 (manifest), §10 Wave 5 row (ship gate: "receipts; flow job verified on worker artifacts, not logs"). Surface maps with measured line numbers: `.superpowers/sdd/wave5-maps/1-pattern-engine.md` … `4-manifest-bump.md` — **read the map section for any file you touch**; line numbers there are measured, not remembered.

## Recorded supersessions (deliberate, not drift — state them where they apply)

1. **"50-detector engine" is superseded by the measured 85** (map 1 §5). Copy and cap sizing assume ~85 ids.
2. **Spec §2.4's "Wave 2's 26" is superseded by the measured 35 excluded / 28 promotable** (map 4 §8). Stage B promotes 28; the 7 TEXT columns stay excluded forever (the accdis rule).
3. **CLAUDE.md's "flow-worker deploys are manual, no GitHub trigger" is superseded** by `api/flow_worker_main.py:5-19` (2026-07-17, newer) + MEMORY.md: the flow-worker IS GitHub-triggered on narrow watch paths (ruling D10). Every flow-touching push deploys the pod and bounces the OPRA WS (~15-60s permanent tape gap) — ship strictly outside Mon-Fri 9:15-16:20 ET; the pre-push hook enforces it.
4. **`pattern_expectancy_r` joins `regime_bucket='unknown'`** (ruling D3), superseding §2.3's "current regime bucket": every scan-written detection carries `regime='unknown'` (no production `build_context` caller passes a hint — map 1 §4), so the classifier's vocabulary matches zero stats rows. Regime-blind is the honest join; threading `regime_hint` is future work and would not backfill.
5. **`pattern_engine_dir` ships as a NUMBER (+1/-1/0), not the store's TEXT** (ruling D4): declaring the raw `bullish|bearish|neutral` TEXT as a `num` scalar would re-mint the live accdis defect (map 4 §6). The reader owns the encoding; NULL means no active detection.
6. **The 03:00 build must not wait for darkpool's T+1 flat-file ingest** (map 2 risk 2): `dp_notional_1d` describes the newest session *as the nightly per-ticker ingest saw it* — the 11:45-ET flat-file backfill lands after the snapshot and is documented in the column description, not chased.

## Global Constraints

- **One writer per column / derive, never restate:** the signature DPL constants come from `api/services/signature/rules.py` via `fetch_dp_levels` (never retyped — map 2 §4a vs the wrong chart-zones clusterer); flow direction math is IMPORTED from `api.flow_summary` (`_f`, `_to_cp`, `_side`, and the C/P×side rules — shared module, NOT partner-owned); the pattern "active" WHERE clause copies the `/scan` reader shape verbatim (map 1 §6); tf spellings derive from `registry_defs.LEDGER_TF_FOR`/`BARS_TF_FOR` wherever both stores are touched.
- **Honest-None:** a ticker absent from a source map gets NULL columns and a `sources` census entry — never a fabricated zero. `dp_* = NULL` is three-way ambiguous by construction (no ≥$4M blocks / sub-floor prints only / never polled — map 2 risk 1) and the column descriptions say so.
- **Partner-owned files — NO edits:** `app/src/pages/OptionsFlow.jsx`, `api/schwab_router.py`, `api/live_massive_router.py`, `api/massive_ws_worker.py`, `api/massive_processor.py`. New flow code lives in NEW modules beside them.
- **Tests never touch real data roots.** `SCREENER_DB_PATH`, `PATTERN_DB_PATH`, `FLOW_DB_PATH`, and `RAILWAY_VOLUME_MOUNT_PATH` pinned to tmp paths BEFORE the module import — `api/darkpool_db.py` runs `init_db()` at import (map 2 §1), so the canonical idiom is `tests/test_signature_darkpool_levels.py:7-10` (env first, import second). `C:\data` is real on this box.
- **Never `git add -A`** — the branch takes concurrent commits. Frontend suite from `app/` with `--pool=threads --execArgv=--no-warnings`; 2 pre-existing red files (sourcesAreText, weekAnchor/CalendarWidget.weekIntent) + FuturesStrip console noise are not this wave's.
- **Flag defaults match a bare local run:** `FLOW_OPT_AGG_ENABLED` defaults `"0"` (the alpha_gold ship-dark precedent); the web pull job defaults ON like its Wave-2 siblings but no-ops harmlessly when R2 is unconfigured (`data_sync` never raises, returns None).
- **as_of family: `snapshot_date` for ALL thirteen columns** (ruling D11). Every source here is a JOIN whose own data ages independently of the bar series (detections up to 7 days old, T-1 flow ledger, block prints); `bars_asof` would claim "the newest bar the maths saw," which is false. No test can catch a wrong choice (map 4 R4) — this constraint is the authority.
- **Stage B moves NO bar digests** (ruling D15): scalar corpus cases are never digested (`tools/ast_conformance.py:122-126`; E-1's own commit `2568cfe59` did not touch `conformance_log.json`). The only `--check` work in this plan is P0's backlog. Anyone "deliberately re-recording" the bar oracle for the scalar bump is doing the wrong thing loudly.

## Known traps (cite by number in task briefs)

- **K1 — M/D/YYYY lexicographic trap:** `darkpool_trades.date` and `flow.CreatedDate` are unpadded TEXT. `ORDER BY date` / `MAX(date)` / `BETWEEN` are wrong by construction (`darkpool_db.py:398-406`, `flow_db.py:277-279`). Day windows = `SELECT DISTINCT` + Python-parse-sort (`parse_date_to_sortable` / `_resolve_dates` precedents), newest N.
- **K2 — CronTrigger UTC default:** a CronTrigger built without an explicit `timezone=ZoneInfo("America/New_York")` runs on server-local UTC even inside an ET-zoned scheduler — bit the flow-worker twice (`flow_worker_main.py:332-334, 393-395`).
- **K3 — blank-Side honesty:** unclassified flow prints (`Side` blank until the REST side-heal) are directionless by honesty. `opt_bull_pct_1d`'s denominator is CLASSIFIED premium only; the drop-filters mirror `compute_top_conviction` so one authority owns direction math.
- **K4 — no `detected_at` index on `pattern_detections`** (and no prune; legacy table hit 2.37M rows): the pattern join is ONE bulk query for the whole universe riding `idx_pd_status`, never a per-ticker loop.
- **K5 — `levels_json` null trio:** `entry`/`stop`/`target_primary` MAY each be null (map 1 §2). "Best detection" requires non-null entry AND stop; dist derivations null-guard again at the builder.
- **K6 — `_builder_bar_dated_columns` census blindness** (map 4 R4): the as-of family census reads only `technicals.py`+`candles.py`, so nothing forces Wave-5 columns' family — the Global Constraint above is the only authority. State `snapshot_date` in every task that declares.
- **K7 — `strftime("%-I...")` is Linux-only** (`darkpool_massive_ingest.py:298`): any test that reaches `_print_to_row` crashes on Windows. Wave-5 tests seed `darkpool_trades` rows DIRECTLY (INSERT), never through the ingest helpers.
- **K8 — the flow-worker watch-path skip:** a NEW file is not in the Railway watch paths — a push touching only it does NOT deploy the pod (`flow_worker_main.py:413-420`). Task A4 adds the module to the pre-push hook's `FLOW_WATCHED`; the Stage-A ship gate adds it to the Railway dashboard list (pod-only setting).
- **K9 — darkpool aggregate is READ-ONLY:** any INSERT into `darkpool_trades` moves the `(row_count,max_id)` cache signature and triggers multi-million-row aggregator rebuilds (map 2 §5). Never record results into darkpool.db.
- **K10 — the conformance gate is red TODAY** (map 4 §4): 22 corpus cases from commits `cb81c15d4`/`22c96a2f1`/`6e44c8b01` were never recorded. P0 clears it with its OWN provenance entry; Stage B never absorbs the backlog.

## Deliberate absences (recorded so absence reads as decision)

- `fcb_signal_recency` — measurement-gated stretch stays OUT (a universe FCB sweep ≈ 4,000-7,000 proxied multi-MB flow streams, unmeasured — map 2 §6).
- GEX walls (live Schwab, ~20s/symbol, not snapshot-honest) and after-hours columns (live lane) — excluded per spec §2.3.
- ETFs in the opt_* aggregates — flow rows for SPY/QQQ/XL* live under `source='indexes'` (map 3 §2); scope is `source='stocks'` only, stated in the column descriptions.

---

### Task P0: clear the conformance-digest backlog (prerequisite; parallel-safe with all of Stage A)

**Files:**
- Modify: `tests/fixtures/ast/conformance_log.json` (via the recorder, never by hand)
- Modify: `docs/runbooks/ast-conformance-gate.md` (one stale literal)

**Interfaces:** none — this is bookkeeping owed by three EARLIER commits, sequenced here so Stage B's gate is green for Wave-5 reasons only (K10).

- [ ] **Step 1: measure the red.** `python tools/ast_conformance.py --check` → expect EXACTLY 22 findings, all `NOT IN THE FROZEN LOG` (the pure-math block from `cb81c15d4`, `sum`/`dev` from `22c96a2f1`, `adx_trend_strength` from `6e44c8b01`), and ZERO `DIGEST MOVED`. **If any DIGEST MOVED appears, STOP and report — that is a different, worse fact this task must not paper over.**
- [ ] **Step 2: record.** `python tools/ast_conformance.py --record --force`. The tool refuses on lane disagreement/vacuity by itself; capture its printed reconciliation line (`N MOVED [...], N added, N removed` — expect `0 MOVED, 22 added, 0 removed`).
- [ ] **Step 3: provenance.** Append the new entry to the log's `rerecorded` list (the human-appended half of "deliberate"): `{"at_head": "<HEAD sha>", "why": "backlog: 22 corpus cases added without recording by cb81c15d4 (pure-math), 22c96a2f1 (sum/dev), 6e44c8b01 (adx_trend_strength) — recorded here, NOT a Wave 5 change", "what_moved": "0 moved, 22 added, 0 removed", "proof": "<the tool's reconciliation line verbatim>"}` — matching the four existing entries' shape.
- [ ] **Step 4: runbook literal.** In `docs/runbooks/ast-conformance-gate.md`, fix the stale "31 declared entries" totality row to read the measured bar floor (70) — the same count-beside-list defect the runbook's own row warns about.
- [ ] **Step 5: verify GREEN** — `python tools/ast_conformance.py --check` → `OK`, and `python -m pytest tests/test_ast_conformance.py tests/test_ast_scalars.py -q` green.
- [ ] **Step 6: Commit**

```bash
git add tests/fixtures/ast/conformance_log.json docs/runbooks/ast-conformance-gate.md
git commit -m "ast: record the 22-case conformance backlog under its own provenance — three commits' debt, named"
```

---

### Task A0: pod recon — CONTROLLER-HELD (before A2/A3/A4 freeze constants)

Not an implementer task. The controller reads, read-only, and appends findings to the ledger; A2/A3/A4's dispatches carry them:

- [ ] Web pod (`railway ssh` → `/opt/venv/bin/python`): `/data/patterns.db` — `SELECT COUNT(*) FROM pattern_detections`, `SELECT COUNT(*) FROM pattern_detections WHERE tf='D' AND status IN ('forming','ready','triggered') AND detected_at >= strftime('%s','now')-604800`, `SELECT regime_bucket, COUNT(*) FROM pattern_stats WHERE tf='D' GROUP BY 1` (does the `('D','unknown')` join have rows at all?).
- [ ] Web pod: darkpool — `GET /api/darkpool/stats` numbers (total_rows/trading_days/tickers/db_size_mb/latest_date) + `railway variables --service web --kv | grep DARKPOOL` (which of the four writers is armed; the flat-file flag's state decides nothing but must be RECORDED — supersession #6).
- [ ] Flow-worker: `railway variables -s flow-worker --kv` — confirm `DATA_SYNC_*` present (the R2 write rail A4 assumes; `flow_backup.py` implies it, never assume), and the service's exact name for CLI targeting.
- [ ] Record all findings in the ledger. **If patterns.db's 7-day active count is zero or pattern_stats ('D','unknown') is empty, A2 still ships (NULL columns are honest) — but the receipt expectations in A8 change; note it.**

---

### Task A1: schema — 13 columns, type sets, manifest exclusions, pins

**Files:**
- Modify: `api/services/screener/snapshot_db.py`
- Modify: `app/src/components/chart/engine/ast/closedTable.json` (`_scalars_excluded` only)
- Modify: `tests/test_ast_scalars.py` (two pinned literals), `app/src/components/chart/engine/ast/freshness.test.js` (one)
- Test: `tests/test_screener_wave5_schema.py` (new)

**Interfaces:**
- Produces: 13 new names in `snapshot_db.COLUMNS`, consumed by every later task. `init_db()`'s PRAGMA-diff ALTER path widens existing DBs on first boot — no migration script (map 4 §8 tail).

- [ ] **Step 1:** append to `COLUMNS` (after the `insider_cluster_days` events block, before `# meta`):

```python
    # patterns + flow (Wave 5)
    "pattern_engine_ids", "pattern_engine_conf", "pattern_engine_dir",
    "pattern_entry_dist_pct", "pattern_stop_dist_pct", "pattern_expectancy_r",
    "dp_notional_1d", "dp_prints_1d", "dp_notional_5d", "dp_level_dist_pct",
    "opt_net_premium_1d", "opt_bull_pct_1d", "opt_net_premium_5d",
```

Type sets: `_TEXT` gains `"pattern_engine_ids"` (comma-joined list — Wave 5); `_INT` gains `"pattern_engine_dir", "dp_prints_1d"`. Everything else REAL by default.

- [ ] **Step 2:** `_scalars_excluded` gains 13 reason strings (≥20 chars each — `freshness.test.js:73`). Twelve say the Wave-5 form of the Wave-2 sentence (e.g. `"a Wave 5 screener column, not yet promoted to a scalar -- Stage B of the Wave 5 plan declares it after the first nightly fill"`); `pattern_engine_ids` copies the `patterns` precedent (`"a comma-joined LIST, not a scalar -- same reason as patterns. Also a Wave 5 column, permanently excluded"`).
- [ ] **Step 3: pins move (Stage-A arithmetic — the partition stays total):** `tests/test_ast_scalars.py:163` `138`→`151`; `:174` `(54, 84)`→`(54, 97)`; `freshness.test.js:70` `84`→`97`. Declared counts (54 everywhere) do NOT move in Stage A.
- [ ] **Step 4:** `tests/test_screener_wave5_schema.py` mirrors `test_screener_wave2_schema.py`'s shape: the 13 names present in COLUMNS; type-set membership (`pattern_engine_ids` TEXT, `pattern_engine_dir`/`dp_prints_1d` INT); `init_db()` on a tmp `SCREENER_DB_PATH` creates all 151; the ALTER path widens a pre-Wave-5 db (create with COLUMNS[:-13] via a monkeypatched list, re-init, assert columns added).
- [ ] **Step 5: GREEN** — `python -m pytest tests/test_screener_wave5_schema.py tests/test_ast_scalars.py -v` and from `app/`: `npx vitest run src/components/chart/engine/ast/freshness.test.js --pool=threads --execArgv=--no-warnings`.
- [ ] **Step 6: Commit** — `git add api/services/screener/snapshot_db.py app/src/components/chart/engine/ast/closedTable.json tests/test_ast_scalars.py app/src/components/chart/engine/ast/freshness.test.js tests/test_screener_wave5_schema.py` → `"screener: 13 Wave-5 columns + manifest exclusions (138 -> 151)"`.

---

### Task A2: `pattern_join.py` — the engine's nightly join (web-local)

**Files:**
- Create: `api/services/screener/pattern_join.py`
- Test: `tests/test_screener_wave5_patterns.py` (new)

**Interfaces:**
- Produces: `read_pattern_fields(targets, failures=None) -> {TICKER: {...}}` emitting per ticker (when an active detection exists): `pattern_engine_ids` (comma-joined DISTINCT ids, confidence-desc, capped 10 — supersession #1), `pattern_engine_conf` (max confidence, 0-100), `pattern_engine_dir` (+1 bullish / -1 bearish / 0 neutral — the READER owns the encoding, ruling D4), `pattern_expectancy_r` (from `pattern_stats` at `(best.pattern_id, 'D', 'unknown')` — ruling D3), plus two NON-COLUMN carrier keys `pattern_entry_px`, `pattern_stop_px` (the best detection's levels; Task A6's builder derivation consumes them — carriers are deliberately named so they can never collide with a snapshot column).
- "Best detection" = highest confidence with non-null `entry` AND `stop` in levels_json; tie → newest `detected_at` (ruling D5, K5). "Active" = the `/scan` shape VERBATIM: `status IN ('forming','ready','triggered') AND tf='D' AND detected_at >= now-7*86400` — no confidence floor (D5).
- ONE bulk query (K4), `sqlite3.Row`, `contextlib.closing`; `PATTERN_DB_PATH`-respecting via `pattern_db.get_connection()`; `{}` + `_note(failures, "pattern_join", ...)` on any failure; expectancy read is a SECOND single bulk query over the distinct best pattern_ids (`SELECT pattern_id, expectancy_R FROM pattern_stats WHERE tf='D' AND regime_bucket='unknown'`).

- [ ] **Step 1: failing tests.** Seed a tmp patterns.db via `pattern_db` itself (env `PATTERN_DB_PATH` before import; `memory.store_detection`-shaped INSERTs are fine done directly). Cases: (1) a ticker with two active detections → ids joined confidence-desc, conf = max, dir/dist-carriers from the best-with-levels; (2) a detection whose levels lack `stop` is skipped for "best" but still counted in ids; (3) `status='expired'` and `detected_at` 8 days old both excluded; (4) tf='5' excluded; (5) direction encoding: bullish→1, bearish→-1, neutral→0; (6) expectancy present when a `pattern_stats ('D','unknown')` row exists, ABSENT otherwise (never 0.0); (7) >10 active ids capped at 10; (8) missing/empty db → `{}` + failures census; (9) an uncovered target ticker absent from the result.
- [ ] **Step 2: RED → implement.** Module docstring must state: the `/scan` WHERE-shape citation (map 1 §6), the 0-100 scale + the tier split vs the cheap `patterns` column (D6 — five key strings overlap by design), the D3 regime-blind supersession AND that `expectancy_R` is SYNTHETIC (hit-rate at an assumed 2R-win/1R-loss — `memory.py:376-379`), the D4 encoding table, and `snapshot_date` as the as-of family (K6).
- [ ] **Step 3: GREEN** — `python -m pytest tests/test_screener_wave5_patterns.py -v`.
- [ ] **Step 4: Commit** — the module + test → `"screener: pattern-engine join — active 7-day detections, regime-blind expectancy, dir as a number"`.

---

### Task A3: `darkpool_agg.py` — block-print aggregates + DPL distance (web-local)

**Files:**
- Create: `api/services/screener/darkpool_agg.py`
- Test: `tests/test_screener_wave5_darkpool.py` (new)

**Interfaces:**
- Produces: `read_darkpool_fields(targets, failures=None) -> {TICKER: {...}}` emitting, ONLY for tickers with ≥1 qualifying print in-window (D7): `dp_notional_1d`, `dp_prints_1d` (newest session), `dp_notional_5d` (5 newest sessions), and `dp_level_dist_pct` (min over `fetch_dp_levels(sym)["levels"]` of `abs(close_price - level["price"]) / close_price * 100`, ruling D8) — which needs the caller to pass closes: signature is `read_darkpool_fields(targets, closes=None, failures=None)` where `closes` is `{TICKER: last_close}` (Task A6 supplies it from the previous snapshot rows in ONE query — see A6).
- Windows: the DISTINCT-date Python-sorted idiom EXACTLY (K1) — copy `resolve_universe`'s query shape (`darkpool_massive_ingest.py:222-240`) with `COUNT(*)` added; 1d = newest date, 5d = 5 newest. READ-ONLY (K9). DPL candidates bounded FIRST by the distinct-tickers-in-window set intersected with targets (D8 — never loop 3,685); `fetch_dp_levels` returning `datesCovered==0`/no levels → no `dp_level_dist_pct` key.
- Column semantics stated in the docstring: sums are of ≥$4M off-exchange prints 07:00-19:00 ET (the ingest floor — map 2 §1), coverage is the ~560-base+150-self-ranked ingest set NOT the universe, NULL is three-way ambiguous, and the 1d number can miss T+1 flat-file rows (supersession #6).

- [ ] **Step 1: failing tests.** Env pins BEFORE import (`RAILWAY_VOLUME_MOUNT_PATH` → tmp; the canonical idiom); seed `darkpool_trades` by direct INSERT (K7 — never `_print_to_row`). Cases: (1) two sessions of prints → 1d counts only the newest date, 5d spans both; (2) date ordering is parse-sorted not lexicographic (seed `9/9/2026` and `10/1/2026` — the lexicographic bug would pick the wrong "newest"); (3) a ticker with prints only 6 sessions ago → absent from 1d keys but... (both windows share the 5-newest-dates cut; a ticker absent from those dates is absent entirely — assert absence); (4) `dp_level_dist_pct` = min-distance vs a monkeypatched `fetch_dp_levels` (patch `api.services.signature.darkpool_levels.fetch_dp_levels` — the module-attr seam), absent when levels empty; (5) closes=None → aggregate columns still emitted, `dp_level_dist_pct` absent for all; (6) empty db → `{}` + census; (7) READ-ONLY: after a full read, `darkpool_trades` row count unchanged and no new tables (`sqlite_master` diff).
- [ ] **Step 2: RED → implement** (`darkpool_db.get_conn()` per call, its own idiom; `parse_date_to_sortable` imported from `darkpool_db`, never re-derived).
- [ ] **Step 3: GREEN** — `python -m pytest tests/test_screener_wave5_darkpool.py tests/test_signature_darkpool_levels.py -v`.
- [ ] **Step 4: Commit** → `"screener: darkpool block aggregates + signature-DPL distance — trading-day windows, read-only"`.

---

### Task A4: the flow-worker aggregate job (`api/flow_opt_aggregate.py`)

**Files:**
- Create: `api/flow_opt_aggregate.py`
- Modify: `api/flow_worker_main.py` (one registration block inside `_start_flow_schedulers`, after the alpha_gold block)
- Modify: `tools/git-hooks/pre-push` (`FLOW_WATCHED` gains `api/flow_opt_aggregate.py` — K8)
- Test: `tests/test_flow_opt_aggregate.py` (new) + extend `tests/test_flow_worker_schedulers.py` (one registration case, mirroring `test_flow_worker_registers_flatfiles`)

**Interfaces:**
- Produces: `run_aggregate() -> dict` (receipt) — ONE bounded pass: `SELECT DISTINCT CreatedDate FROM flow WHERE source='stocks'` → Python-sort (K1) → 5 newest dates → ONE `GROUP BY Symbol`-shaped scan (`WHERE source='stocks' AND CreatedDate IN (?,?,?,?,?)` riding `idx_flow_created_symbol`) streamed through the D9 direction math; per ticker: `opt_net_premium_1d`, `opt_bull_pct_1d` (newest date only), `opt_net_premium_5d` (all five). Direction/premium/drop rules IMPORTED from `api.flow_summary` (`_f`, `_to_cp`, `_side`, `_color`) and the C/P×side/ML-drop/RED-drop/lottery/arb rules mirrored by CALLING a small extracted helper if import-shape allows, else transcribed WITH a module comment naming `compute_top_conviction` as the authority and a test pinning agreement on a shared fixture (the implementer reads `flow_summary` first and picks the least-restating wiring; agreement-test is mandatory either way). `opt_bull_pct_1d` denominator = classified premium only (K3).
- Artifact: `{"as_of": "<ISO date of newest CreatedDate>", "days": [...5 dates ISO...], "rows": {SYM: {"opt_net_premium_1d": ..., "opt_bull_pct_1d": ..., "opt_net_premium_5d": ...}}, "census": {"rows_scanned": n, "rows_classified": n, "tickers": n}}` → `data_sync.put_bytes("screener/opt_flow_agg.json", ...)` + a local mirror at `/data/flow_opt_agg.json` via the tmp-write-`os.replace` idiom (`flow_summary._persist_board` precedent). `put_bytes` False → receipt records `r2: "failed"` (never raises).
- Registration (copy the alpha_gold block shape EXACTLY — env flag `FLOW_OPT_AGG_ENABLED` default `"0"`, `CronTrigger(hour=2, minute=35, timezone=ZoneInfo("America/New_York"))` (K2), `id="flow_opt_aggregate"`, `max_instances=1`, `coalesce=True`, try/except around the block, log lines for both armed and dark states). The in-block comment notes the watch-path situation: this module IS being added to `FLOW_WATCHED` + (at ship) the Railway list.

- [ ] **Step 1: failing tests.** Tmp `FLOW_DB_PATH`; seed the `flow` table with TEXT rows (the real ALL-TEXT shape incl. `$1,234,567` premiums). Cases: (1) net premium = bull − bear per the direction table (C+A bull, P+A bear, C+BB sweep bear, P+BB sweep bull); (2) blank-Side rows excluded from numerator AND denominator (K3); (3) `ML/`-type and RED-color dropped; (4) 1d cuts the NEWEST parsed date even when lexicographically smaller (K1 fixture: `9/9/2026` vs `10/1/2026`); (5) 5d spans exactly the 5 newest; (6) `source='indexes'` rows invisible; (7) receipt census arithmetic; (8) the artifact JSON round-trips with `as_of` + all three keys per ticker; (9) `data_sync.put_bytes` monkeypatched False → receipt `r2:"failed"`, local mirror still written; (10) the agreement test vs `compute_top_conviction` on one shared fixture (same rows → same per-ticker net sign and bull%).
- [ ] **Step 2: RED → implement** (module docstring: scope stocks-only stated; the aggregation belongs where flow.db lives; the 02:35 slot trails the 02:30 backup deliberately — different files, idle tape).
- [ ] **Step 3:** the `flow_worker_main.py` registration + the `tests/test_flow_worker_schedulers.py` case (armed → job id present; dark → absent) + the `FLOW_WATCHED` line in `tools/git-hooks/pre-push`.
- [ ] **Step 4: GREEN** — `python -m pytest tests/test_flow_opt_aggregate.py tests/test_flow_worker_schedulers.py tests/test_flow_summary.py -v`.
- [ ] **Step 5: Commit** — all four files → `"flow-worker: nightly per-ticker options aggregate -> R2 (dark; screener Wave 5)"`.

---

### Task A5: web-side reader + pull job (`opt_flow.py`)

**Files:**
- Create: `api/services/screener/opt_flow.py`
- Modify: `api/main.py` (`register_screener_jobs` — one pull-job block beside the 02:45/02:50 siblings)
- Test: `tests/test_screener_wave5_optflow.py` (new) + extend `tests/test_screener_wave2_jobs.py`'s AST case to include `screener_opt_flow_pull`

**Interfaces:**
- Produces: `run_pull() -> dict` — `data_sync.get_bytes("screener/opt_flow_agg.json")` → validate (`isinstance dict`, `rows` dict, ticker floor `_MIN_TICKERS = 25` — an aggregate with 12 names is a failed scan, not a quiet market) → atomic local artifact write (`SCREENER_OPTFLOW_ARTIFACT` env → `$DATA_DIR/screener_opt_flow.json`); a short/absent R2 object REFUSES and preserves the prior artifact (the finviz `_MIN_ROWS` contract, byte-for-byte). `read_opt_flow_fields(targets, failures=None)` — the finviz per-column-presence clone: guarded subscript assigns for the three columns, `_STALE_DAYS = 3` counted-but-served, `isinstance` guard, `{}`-plus-census on missing.
- Job: `_run_opt_flow_pull` at **02:55 ET**, id `screener_opt_flow_pull`, gate `SCREENER_OPTFLOW_PULL_ENABLED` default `"1"` (reads nothing external when R2 unconfigured — `get_bytes` returns None → refusal path; harmless locally), logging the receipt like its siblings.

- [ ] **Step 1: failing tests** — mirror `tests/test_screener_wave2_finviz.py`'s reader half: healthy / missing R2 (monkeypatch `data_sync.get_bytes`) / short (< floor) refuses + preserves prior / stale counted / per-column presence / JSON-null artifact guard. Jobs: the AST registration case + the OFF-flag case.
- [ ] **Step 2: RED → implement → GREEN** — `python -m pytest tests/test_screener_wave5_optflow.py tests/test_screener_wave2_jobs.py -v`.
- [ ] **Step 3: Commit** → `"screener: opt-flow artifact pull + reader — R2 drop, refuse-short, per-column presence"`.

---

### Task A6: builder wiring — three readers, the pattern derivations, the 17-source rail

**Files:**
- Modify: `api/services/screener/snapshot_builder.py`
- Modify: `tests/test_screener_fundamentals_bulk.py` (`_source_key_sets` 14 → 17; the pin moves)
- Test: `tests/test_screener_wave5_wiring.py` (new)

**Interfaces:**
- Consumes A2/A3/A5's readers. `run_build` additions, beside the six Wave-2 `_read_market_source` lines: `pattern_map = _read_market_source("pattern_join", pattern_join.read_pattern_fields, targets, sources)`; `optflow_map = _read_market_source("opt_flow", opt_flow.read_opt_flow_fields, targets, sources)`; darkpool needs closes — build `prev_closes = {r["ticker"]: r["price"] for r in <ONE SELECT ticker, price FROM screener_rows>}` (previous night's close — the honest available anchor at read time; ONE query, documented) and call `dp_map = _read_market_source("darkpool_agg", lambda t, f: darkpool_agg.read_darkpool_fields(t, closes=prev_closes, failures=f), targets, sources)` — read `_read_market_source`'s real signature first; if it invokes `reader(targets, failures)`, the lambda above is the exact wrap; adapt to reality and note any divergence.
- `market_row` merge gains `**pattern_map.get(T, {}), **dp_map.get(T, {}), **optflow_map.get(T, {})`. The two carrier keys (`pattern_entry_px`/`pattern_stop_px`) ride `market_row` into `build_row` — where `row = {c: None ...}` + the `if k in row` merge DROPS them from the row by construction, so `build_row` must read them from the `market_row` PARAMETER (not the row) in a new derivation block beside `pt_upside_pct`:

```python
    # Pure derivations, single writers: distance to the best active pattern
    # detection's entry/stop (pattern_join supplies the raw levels as CARRIER
    # keys that are deliberately not columns; K5 — either may be absent).
    # Distances are vs THIS row's price; both factors must be positive.
    _pe = (market_row or {}).get("pattern_entry_px")
    _ps = (market_row or {}).get("pattern_stop_px")
    price = row.get("price")
    if _pe is not None and price is not None and _pe > 0 and price > 0:
        row["pattern_entry_dist_pct"] = round((_pe / price - 1) * 100, 2)
    if _ps is not None and price is not None and _ps > 0 and price > 0:
        row["pattern_stop_dist_pct"] = round((_ps / price - 1) * 100, 2)
```

(NOTE: `price` is set earlier in `build_row` by the merge/technicals path — the implementer verifies against the real `pt_upside_pct` block directly above and mirrors its access pattern.)
- The 17-source rail: `_source_key_sets` gains pattern_join / darkpool_agg / opt_flow entries obtained by RUNNING each reader against seeded tmp stores (the established derivation); the `len(sets) == 14` pin becomes `== 17`. Disjointness holds by construction (carrier keys belong only to pattern_join — assert they appear in ITS key set and never as columns).

- [ ] **Step 1: failing tests** — the brief's wiring shape mirrored from `test_screener_wave2_wiring.py`: 2-ticker universe, each reader called ONCE; dist derivations (entry above price → positive, stop below → negative, absent carriers → NULL columns); a raising darkpool reader degrades + census (the `_read_market_source` contract); carrier keys never land in the persisted row.
- [ ] **Step 2: RED → implement → GREEN** — `python -m pytest tests/test_screener_wave5_wiring.py tests/test_screener_builder.py tests/test_screener_fundamentals_bulk.py tests/test_scalar_population_rail.py tests/test_screener_wave1_wiring.py tests/test_screener_wave2_wiring.py -v`.
- [ ] **Step 3: Commit** → `"screener: builder joins patterns/darkpool/opt-flow — 17 disjoint sources, carrier-key derivations"`.

---

### Task A7: Stage A verification — smoke, suites, build

**Files:**
- Create: `tools/screener_wave5_smoke.py`

- [ ] **Step 1:** READ-ONLY smoke against tmp stores (the Wave-2/Wave-4 pattern): seed patterns.db (two detections), darkpool.db (two sessions), a local opt-flow artifact; build 3 tickers via `build_row` with the real readers; print per-column presence for all 13 + the sources census; exit non-zero on deviation. Absent sources reported as absent, never "broken".
- [ ] **Step 2:** backend sweep: every `tests/test_screener_wave5_*.py` + the A6 suite list + `tests/test_flow_opt_aggregate.py tests/test_flow_worker_schedulers.py tests/test_ast_scalars.py` — green.
- [ ] **Step 3:** from `app/`: `npx vitest run src/components/chart/engine/ast --pool=threads --execArgv=--no-warnings` then the full sweep + `npm run build`.
- [ ] **Step 4: Commit** the tools file → `"screener: wave-5 read-only smoke (three sources, honest absences)"`.

---

### Task A8: Stage A ship gate — CONTROLLER-HELD

Not an implementer task. Controller: (1) fetch/merge origin/master, re-verify; (2) **ship window**: the push touches `flow_worker_main.py` (watched) → strictly outside Mon-Fri 9:15-16:20 ET (supersession #3); (3) BEFORE push: add `api/flow_opt_aggregate.py` to the flow-worker's Railway dashboard watch paths (pod-only — K8) and set `FLOW_OPT_AGG_ENABLED=1` on the flow-worker (`railway variables --set` auto-redeploys it — that bounce is this ship's WS cost, take it once); (4) push branch:master; (5) verify BY ARTIFACT: web deploy chunk/health as usual; flow-worker `GET /internal/health` proves the deploy, the R2 object (`data_sync.object_exists("screener/opt_flow_agg.json")` from any web-side probe) after 02:35 ET proves the job — never logs; (6) NEXT-MORNING receipts: build receipt's `populated` counts for all 13 columns (pattern/dp counts bounded by pod-recon expectations; opt_* ≈ classified-ticker count), `sources` census clean, the four job-train receipts, and the A0-recorded expectations reconciled.

---

### Task B1: the manifest bump — 28 promotions + 12 declarations (Stage B)

**Files:**
- Modify: `app/src/components/chart/engine/ast/closedTable.json`
- Modify: `tests/fixtures/ast/scalars.json` (+40 cases)
- Modify: `tests/test_ast_scalars.py`, `app/.../ast/freshness.test.js`, `app/.../ast/parse.test.js` (pins), `app/.../ast/sentence.test.js` (title honesty only)
- Test: extensions ride the parametrized floors (no new file)

**Interfaces (ruling D12 — the worked arithmetic, Stage-B leg):**
- Promote the 28 measured Wave-2 numerics (map 4 §8 table, verbatim list) — delete each `_scalars_excluded` key, add the full scalar object (`market_cap` shape: `source{store:"screener_rows",column:<name>}`, `as_of{column:"snapshot_date",grain:"date"}`, `cadence:"nightly"`, `yields:"num"`, lower-case NOUN-phrase sentence ≠ its filter label).
- Declare the 12 Wave-5 numerics the same way (all `snapshot_date`, all `nightly`, all `num` — `pattern_engine_dir` is num BECAUSE the reader encodes it, D4; `pattern_expectancy_r`'s sentence says "derived from hit rate at an assumed 2R-win/1R-loss", D3). `pattern_engine_ids` STAYS excluded (reword its reason to permanent — the `patterns` precedent).
- The 7 Wave-2 TEXT columns stay excluded, untouched (map 4 §6 — bright line).
- **Pins after Stage B:** `test_ast_scalars.py:163` stays `151`; `:174` `(54,97)`→`(94,57)`; `:543` `(70,54)`→`(70,94)`; `freshness.test.js` `54`→`94`, `97`→`57`; `parse.test.js` scalars `54`→`94`, declared.size `124`→`164`, bar stays `70`, `tableVersion` stays `1` (+ the `:417` it()-title); `sentence.test.js:1375` title honesty. `scalars.json` `cases` 54→94 (one verbatim case per new scalar, `market_cap` case shape, values plausible per column).
- `source.column == name` for every entry (the JS pin — no renames at the boundary).

- [ ] **Step 1:** the 40 manifest edits + 40 fixture cases + pins.
- [ ] **Step 2: the governed gates, explicitly:** `python tools/ast_conformance.py --coverage` (the runbook gate pytest cannot run — map 4 R5) AND `python tools/ast_conformance.py --check` (green — P0 cleared the backlog; if THIS task turns it red, the task did something wrong: scalar promotion moves no bar digest, D15).
- [ ] **Step 3: GREEN** — `python -m pytest tests/test_ast_scalars.py tests/test_ast_conformance.py tests/test_screener_filters.py -v` + from `app/`: `npx vitest run src/components/chart/engine/ast --pool=threads --execArgv=--no-warnings`.
- [ ] **Step 4: Commit** → `"ast: 40 screener columns enter the formula vocabulary (54 -> 94 scalars; the two-lane pins move together)"`.

---

### Task B2: FILTERS + columnDefs for the 12 (Stage B)

**Files:**
- Modify: `api/services/screener/filters.py`
- Modify: `app/src/pages/screener/columnDefs.js`
- Tests: extend `tests/test_screener_filters.py` fixtures ONLY if a pin names a count; frontend defs ride the existing rails

**Interfaces:**
- 12 `_open_range` controls (preset-free, "Any" only — zero invented thresholds), range control ↔ `num` yields (the `_paired_columns` rail starts firing for every promoted/declared column the moment B1 lands — map 4 §7; labels open on a capital and differ from the scalar sentences).
- Categories (K5 both halves): `pattern_engine_*` join the existing `pattern` category; `dp_*` and `opt_*` join ONE new category `{"key": "flow", "label": "Positioning & Flow"}` appended to `CATEGORIES` (spec §2's fourth family wording). Filters for the 28 promoted Wave-2 columns ALREADY exist (W2 T12) — nothing to add there; the pairing rail simply lights up.
- columnDefs: 12 entries with em-dash null formatters; `pattern_engine_ids` renders like `patterns`; descriptions carry the D3 synthetic-expectancy sentence, the D6 tier/scale split, the D7 block-floor + coverage caveats, and the K3 classified-denominator note.

- [ ] **Step 1: failing/extended tests** — the registry rails are derived (two-lane agreement, named-once, preset-free) and go green/red on their own; add one explicit case pinning the new category's both-halves presence and one pinning `pattern_expectancy_r`'s description contains "assumed".
- [ ] **Step 2: GREEN** — `python -m pytest tests/test_screener_filters.py tests/test_scan_screener_auth.py -v` (route counts untouched) + from `app/`: `npx vitest run src/pages/screener --pool=threads --execArgv=--no-warnings`.
- [ ] **Step 3: Commit** → `"screener: 12 Wave-5 filters + defs — Positioning & Flow category, honest descriptions"`.

---

### Task B3: Stage B verification

- [ ] Extend `tools/screener_wave5_smoke.py` with a Stage-B section: `filters.meta()` count check (137 filters expected: 125 + 12), a formula naming a promoted scalar parses (`parseFormula`-equivalent via the Python lane: `ast_table.scalar_source("float_pct")` resolves), `--coverage`/`--check` both green, full backend + frontend sweeps + build. Commit the smoke extension.

### Task B4: Stage B ship gate — CONTROLLER-HELD

Controller: fetch/merge, re-verify, push (web-only diff — no flow window constraint), artifact-verify (meta filter count 137 via an authed probe or the served-chunk discriminator), and next-morning: the 05:00 sweep's first receipts over formulas naming new scalars (`not_computable` should be near-zero for promoted columns since Stage A filled them nights earlier), plus one member-path formula spot check.

## Parallelism map

- P0 ∥ everything (own files). A0 (controller) before A2/A3/A4 dispatch.
- A1 first (COLUMNS is everyone's interface) → **A2 ∥ A3 ∥ A4 ∥ A5** (four disjoint lanes: pattern_join / darkpool_agg / flow-worker files / opt_flow+main.py) → A6 (sole owner of snapshot_builder.py + the rail file) → A7 → A8 (controller).
- Stage B only after A8's receipts: **B1 ∥ B2** (closedTable+fixtures vs filters.py+columnDefs — disjoint) → B3 → B4 (controller).

## Self-review notes (author)

- Spec §2.3 columns all covered (13 named; `fcb_signal_recency`/GEX/after-hours recorded absent); §2.4 covered by P0+B1 with the two-floor rule stated; §10's ship-gate language ("worker artifacts, not logs") implemented in A8's verification list.
- Placeholder scan: none — every step names real files, real values, real commands; the two deliberate adapt-to-reality escapes (A4's import-vs-transcribe direction-math wiring with a mandatory agreement test; A6's `_read_market_source` signature check) are explicit.
- Type consistency: carrier keys `pattern_entry_px`/`pattern_stop_px` produced in A2 and consumed in A6 under the same names; `closes` kwarg produced in A6, consumed in A3's signature; artifact key `screener/opt_flow_agg.json` identical in A4/A5/A8; pin arithmetic is staged (A1: 151/(54,97); B1: (94,57)) and internally consistent with map 4's end-state worked example.
