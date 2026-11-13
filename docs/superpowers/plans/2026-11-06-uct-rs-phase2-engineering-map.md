# UCT Relative Strength: Phase 2a / 2b engineering map

Date: 2026-11-06. Author: tech lead, UCT-Dashboard. Status: build-ready map for the parallel agents; not a spec.
Plan it maps: `docs/superpowers/specs/2026-11-05-uct-relative-strength-indicator-design.md` (v4). Code baseline: branch `feat/uct-rs-phase1` at the unit 5 merge `a21d598a74` (unit 4 merge `577b558e47` and unit 7 `4749ba4df7` below it), ahead of `origin/master` (`7f6dd371`). Every `file:line` below is from that tree unless the path starts with `C:/Users/pgosz/projects/uct-rs-plan` (the plan checkout). Re-anchor on `a21d598a74` or later; the local `master` ref is stale at the merge-base and must not be used as a diff baseline.

Sources of truth for this map: the verified reconnaissance of 2026-11-06 (nine areas, 110 + 71 + 55 + 78 + 89 + 77 + 48 + 47 + 65 confirmed facts). Refuted claims are listed once in Appendix A so nobody re-derives them.

---

## 1. Summary

Phase 2a/2b adds the rating, history, readout, screener columns, alert lane, Discord post and evidence job around the Phase 1 line, and the code read forces four changes to the plan before any unit starts. First, the IBD-style rating and its history cannot be a worker job over bars.db as §11 says: the worker has no job scheduler of its own (`api/worker_main.py` runs flag-gated daemon threads; its two private APSchedulers are per-feature with volume locks), the R2 bridge ships only `bars.db`'s `ohlcv` table (`api/services/data_sync.py:990`, `:1059`), and the web pod already holds 252-bar daily windows with the by-date index the worker lacks (`api/services/screener/technicals.py:528`, `data_sync.py:467`), so `rs_rating_history` becomes a side table in the web pod's `/data/screener.db` written after the 03:00 ET screener build (the `volume_curve` pattern). Second, RS alert addresses cannot join `EVENT_ADDRESSES` (a rail pins its base set to `sar`, `tests/test_indicator_alert_evaluator.py:787`); they become a fifth global partition `RS_FUNCS`, closed-lane only, with a `reads_benchmark` branch in `call_series`. Third, the Discord post cannot go through `screen_alerts`/`alert_routing` (per-member in-app+email lane; a private alert never reaches Discord, `api/services/alerts.py:483`; `alert_routing` has one permitted importer, `tests/test_alert_destination.py:1272`); it becomes a dedicated poster on the `discord_index_close` shape with its own webhook variable and flag. Fourth, the readout consumer must use the shipped `scalarsFor(def, inputs, ctx)` (`serverCompute.js:447`) and a fail-closed top-level `readout[]`, appended into the chip label so the pinned `name(params)` grammar and the byte-exact chip rails survive. Several plan rows are already done on the branch (preset picker, `groupsCollapsed`, RSP prewarm, the Desk `v`/`t` video parameter) and four tests are red before 2a starts (AST partition, alert rev rail, webhook census, enumerationSites); unit 2a-01 clears the ones we own. The breakdown below is 16 units for 2a and 9 for 2b, each at most a day, grouped into waves whose units touch disjoint files so isolated worktrees cannot conflict.

---

## 2. Areas

Each area: what exists (facts with `file:line`), what 2a/2b must build, the smallest generic design, tests to add, risks.

### 2.1 Worker jobs and nightly placement

**What exists**
- The worker entrypoint starts jobs as daemon threads from `main()`; no APScheduler in `worker_main.py` (`api/worker_main.py:100`, the only "APScheduler" string is a comment at `:616`). Each start function reads its own `*_ENABLED` flag and logs "not started" when off (`:234-235`); registration is `try: start_x() except: log.warning(... non-fatal)` (`:946-948`); `worker_main` must never import `api.main` (`:66`). Every start function runs synchronously before `uvicorn.run` (`:982`), so it must only spawn a thread and return; boot-settle sleeps live inside the thread (`:319`).
- Two private worker APSchedulers exist, both started from `main()`: `fundamentals_pit.schedule.start_worker_scheduler()` (`:930`; `api/services/fundamentals_pit/schedule.py:82,93,100`) and `marketcap.schedule.start_worker_scheduler()` (`:936-937`; `api/services/marketcap/schedule.py:84,113` with `misfire_grace_time=4*3600` and a boot `catch_up_reason`). A test greps every `api/**/*.py` except files named `schedule.py` for `start_worker_scheduler(` and requires the only caller to be `worker_main.py` (`tests/fundamentals_pit/test_scheduler_owner.py:50-51`).
- Heavy CPU passes run as a subprocess, not a thread (13x measured, `api/worker_main.py:321,328`), armed by a REQUIRED destination path from env (`:312`). Worker health is a dict of per-job heartbeats at `/internal/health` (`:755`); the worker has no `/api/admin/*` routes and no `auth.db`.
- The screener nightly build is a WEB-pod job: `register_screener_jobs(_scheduler)` (`api/main.py:7438`), `CronTrigger(hour=3)` (`:2185`), `id="screener_snapshot_nightly", max_instances=1` (`:2186`), NO `coalesce` / `misfire_grace_time` (`:2187`), so a redeploy spanning 03:00 drops the night under the 1 s default grace and the 06:00 watchdog (`:2106,2119`) is the only catch. Post-build work is chained inline in `_run` (`:2166` `volume_curve.nightly_job()`), gated on a complete build (`:2176` `_nightly_shortfall(stats) is None`), with per-call flags read every run (`membership.job_enabled`, `api/services/screener/membership.py:208`). The file forbids appending unmeasured work to `run_build` (`:2198`) and requires unconditional registration with the flag read per call (`:2318`). Any `add_job` must sit after lifespan's `_scheduler = None` (`:6154`; `tests/test_lifespan_scheduler_binds_before_use.py:1`).
- Side-table recipe: `volume_curve` writes a small table in `screener.db` created on first write through `snapshot_db.connect()` (`api/services/screener/volume_curve.py:41,366`), returns a receipt and never raises (`:591`). Receipts table pattern: `screener_build_runs` (`snapshot_db.py:804`), `record_build_run` never raises (`:826`), `status()` carries `last_build` (`:887`). `SCREENER_DB_PATH` override exists for tests (`:451`).
- Status: `/api/screener/snapshot-status` is the one freshness authority (`api/routers/screener.py:388,431`); admin status routes are `Depends(require_admin)` or listed in `open_reads_gate` ADMIN tuple (`api/open_reads_gate.py:516`), policed by `tests/test_open_reads_gate.py:323`.
- R2: the bars snapshot tars only `bars.db` (`data_sync.py:414,444`), the web merge reads only `bars.db` and only `ohlcv` (`:990,1059`), newer-wins by ts (`:994`). Small stores bridge via `breadth_ohlc_sync` (gap-fill by PK, `:15,199,339`) or `put_bytes`/`get_bytes` JSON (`:240,252`; precedent `api/flow_opt_aggregate.py:387`, `api/services/screener/opt_flow.py:107,136`). Overnight upload cadence drops to 1800 s (`:94`).
- Flags: every off-by-default gate needs a `docs/feature_flags.json` entry (`tests/test_feature_flag_ledger.py:69,79`), a dark note of at least 20 chars (`:153`), and the ledger runs both ways (`:83`), so entry and reading code land in the same push.

**What 2a/2b must build**
- 2a: the rating/history store and its nightly job; its schedule registration, status block and shortfall alert; a once-only backfill behind a marker.
- 2b: the evidence job on the worker as a subprocess; its R2 JSON artifact and web pull.

**Smallest generic design**
- `rs_rating_history` on the WEB pod: new `api/services/screener/rs_history.py` with `TABLE = "rs_rating_history"` (PK `(session, ticker)`), `store()` via `snapshot_db.connect()` + inline `CREATE TABLE IF NOT EXISTS`, `nightly_job() -> receipt` that never raises, `status()`, a `rs_history_runs` receipt table shaped like `screener_build_runs`, and `read_fields(targets, failures=None)` in the `opt_flow.read_opt_flow_fields` shape (`opt_flow.py:143`). Closes through `bars_sqlite.get_bars(t, "D", n)` (`snapshot_builder.py:674`); benchmark SPY likewise. Backfill once behind `DATA_DIR/.rs_history_backfill_v1`, marker written only after success (`deep_history_warm.py:105,315`); a corrected method is a new marker name.
- Registration in `register_screener_jobs`: chain inline after `volume_curve.nightly_job()` under `_nightly_shortfall(stats) is None` if measured under a few minutes; otherwise its own cron at 04:15 ET with `coalesce=True, misfire_grace_time=3600`, `id="rs_rating_history"`, registered unconditionally, `RS_HISTORY_ENABLED` read per call inside the job. Alert `rs_history_short:{day}` at warning via `chart_health_alerts.emit` (`api/services/chart_health_alerts.py:316`). Status rides `snapshot_db.status()` as an `rs_history` block.
- `rs_evidence` on the WORKER: a boot-armed daemon thread that sleeps, then `subprocess.call([sys.executable, "-m", "api.services.rs_evidence", ...])` (`worker_main.py:318-340` shape), gated `RS_EVIDENCE_ENABLED`, destination path REQUIRED from env, resumable by `(session, signal)` checkpoint, writing `/data/rs_evidence.db`, publishing `rs/evidence.json` via `data_sync.put_bytes`; heartbeat key `rs_evidence` in `_health_payload`. Web pulls with `get_bytes`, refuses short payloads, writes atomically (the `opt_flow.run_pull` contract).
- No new module may define `start_worker_scheduler(` outside a file named `schedule.py`.

**Tests to add**
- `tests/test_rs_rating_history.py`: store/read round trip against `SCREENER_DB_PATH` tmp; `nightly_job` receipt shape and never-raises; backfill marker written only on success; `read_fields` notes `missing` / `stale:Nd` and never fabricates None.
- `tests/test_screener_schedule.py` extension (FakeScheduler, `:16`): new id present when `SCREENER_SNAPSHOT_ENABLED=1`, absent when `0`; job is a no-op when `RS_HISTORY_ENABLED` unset.
- `tests/test_rs_evidence_job.py`: subprocess entry refuses without a destination path; checkpoint resume; artifact refuses under `_MIN` rows; web pull preserves the prior artifact on a short payload.
- Ledger entries for `RS_HISTORY_ENABLED` (where `["web"]`, dark), `RS_EVIDENCE_ENABLED` (where `["worker"]`, dark).

**Risks**
- The 03:00 build has taken 44 minutes (`api/main.py:2089`); an inline chain lengthens the receipt window. Measure before choosing inline vs cron.
- A worker-only module may not trigger a worker redeploy (watch paths are a Railway setting; `railway.json` has none). Verify at ship time.
- `/data/screener.db` on web is the only copy of the history; an optional `put_bytes` JSON backup is cheap insurance.

### 2.2 Rating data

**What exists**
- Fast rating: `rs_ranking` fetches 200 calendar days from Massive (`api/services/rs_ranking.py:146,148`), documented as thin (`:138`), cached 1 h (`:31`), JSON disk snapshot only (`:45`), 12 threads (`:198`), percentile 1-99 by rank order (`:221`), population = universe + up to 20 UCT20 names (`:104`); `cached_rank_map()` never computes (`:304`) but the nightly build DOES compute on cold via `compute_rs_scores(force=False)` (`snapshot_builder.py:838/848`). Weights live once in `rs_weighted_return.RS_TERMS` (`:47`), 3m required (`:56`).
- bars.db: `DATA_DIR/bars.db` on both pods (`bars_sqlite.py:18`); `get_bars` returns `(ts,o,h,l,c,v)` oldest-first (`:685-686`), `get_bars_before` for point-in-time (`:697`), `get_count`/`get_first_ts`/`get_last_ts` (`:677,662,653`), lookup index `(ticker, tf, ts DESC)` (`:152`); the by-date index exists only on the WEB copy (`data_sync.py:467`; `bars_sqlite.py:142,186,229`). Busy timeout 30 s on worker vs 2 s on web (`:111,113`).
- Universe: `cap_universe.json` holds 3,640 names incl. ETFs (SPY, QQQ, IWM, DIA, XLK, XLF, XLE, XLV, XLI, XLRE, XLC, SMH, GLD, TLT; RSP absent) (`api/data/cap_universe.json:1`); `cap_universe.symbols()` (`api/services/cap_universe.py:55`); `etf_symbols()` from `prebuilt_etfs.json` misses GLD and XLRE (`:65`); `rs_benchmarks.LITERAL_BENCHMARKS` and `SECTOR_ETF` are a static in-repo ETF list (`api/services/rs_benchmarks.py:29,34`). The screener's own universe is wider (every US common + ADR, 11,230 rows, `snapshot_builder.py:1349-1350`), written on web by `build_and_save` (`screener_universe.py:17`). `is_etf` derives from `security_type`, NULL when unknown (`snapshot_builder.py:465`); untyped names fail closed (`screener_universe.py:56`).
- Prewarm: the worker queues `(sym, 'D', 5000)` for every cap_universe name (`api/services/bars_prewarm.py:978`), loads from the repo copy (`:730`), and RSP + the SPDR sector ETFs are already in `PRIORITY_TICKERS` via `RS_BENCHMARK_TICKERS` (`:30`, commit `4749ba4df7`, `tests/test_rs_benchmarks_prewarm.py`). The after-close full sweep is dark by default and conditioned on `_IS_WORKER and _dwm_extra` (`:1059,1051`).
- Splits: daily bars are fetched adjusted (`massive.py:1465`); the split-repair sweep runs on web only, default on (`bars_split_repair.py:76`; `api/main.py:2812`); `bars_sanitize.unadjusted_splits` exists (`:430`).
- Delisted: a 6,177-row bulk list with `last_date` (`api/services/delisted_registry.py:28,18`).
- Phase 1 already reads daily closes offline from the WEB bars.db (`api/routers/signature.py:832`), and `ratings_universe.nightly_job` already computes RS return from web `bars_sqlite` nightly (`api/services/research/ratings_universe.py:8`; registered only under `RATINGS_PERCENTILE_ENABLED`, `api/main.py:7857`).
- Pure math: `relative_strength.compute_phase1_columns(bars, benchmark_bars, ...)` (`api/services/relative_strength.py:311`), `PHASE1_COLUMNS` (`:284-286`), `red_day_column` (`:222`), `rolling_count` (`:239`), `partial_extreme_event` (`:169`), `last_rs_high` (`:383`); no rating, percentile or Mansfield function (`:49` pins 252).
- Census: any new `get_bars`/`get_bars_before` caller must regenerate `api/data/bars_ordinal_census.json` (`tools/bars_ordinal_census.py:50`; `tests/test_bars_ordinal_census.py:80`); close is projection position 4 (`api/services/canonical/address_book.py:106`).

**What 2a must build**
- `rs_rating_ibd` (12-month weighted-quarter percentile per §7), its 1m/3m/6m/12m companions and 5/20-session changes, with a stated population, ETF exclusion, `asof` and a split guard; a one-year point-in-time backfill.

**Smallest generic design**
- Compute on the web pod inside `rs_history.nightly_job` over `cap_universe.symbols()` (default; see open question 1) minus the ETF set = `screener_rows.is_etf == 1` for the session (web has `security_type`) unioned with `rs_benchmarks.LITERAL_BENCHMARKS + SECTOR_ETF.values()`; names with `is_etf IS NULL` are excluded from the ranked population and counted. Store `universe_source`, `n_ranked`, `n_excluded_etf`, `n_untyped`, `asof_session` on every run row.
- One indexed seek per ticker (`get_bars(t, "D", 270)`; backfill `get_bars_before(t, "D", 520, to_key)`), never a by-date scan. Named access via `address_book`, census regenerated once in the integration unit.
- Run `bars_sanitize.unadjusted_splits` over each window; publish `None` with `reason="unadjusted_split"` instead of a rating.
- Carry `asof` per rating in the payload: fast (hourly, Massive 200 d) and IBD-style (nightly, bars.db) differ.
- Survivorship sentence for 2b: count delisted names since the backfill start from `delisted_registry` and print the count.

**Tests to add**
- Population pinned from the file (`len(cap_universe.symbols())`), never a literal (`api/routers/ticker_search.py:3` already carries a stale 3,685).
- Fixture asserting the 14 known ETFs in cap_universe are excluded.
- Split guard: a synthetic 4:1 straddle yields `None` + reason.
- Rating math fixture shared with the JS lane if the chip shows it (the `rs_events_default.json` pattern).

**Risks**
- Web bars.db depth is unmeasured here (no bars.db in the worktree); a `get_count` pass on the first run must gate the backfill and name short names in the receipt.
- Web busy_timeout is 2 s; run after the build, in the same scheduler, never concurrently with `upsert_rows`.
- An IBD rating over 3,640 names and `rs_rank` over the same population agree in denominator; if the owner chooses the 11,230 universe the two ratings describe different pools and methodology must say so.

### 2.3 Readout and legend

**What exists**
- One pure pipeline: `legendChips` (`app/src/components/chart/engine/readout.js:794`) → `engineChips` (`:735`) → `chipsFrom(entries, seriesData, registry, inputsFor, displayFor, instances)` (`:343`), no payload input. Label grammar `name(params)` (`:276-280`) with raw input values; a plot-level `legend.label` short-circuits it (`:237`). Chip text is `label + ' ' + value` (`:440`; `IndicatorChip.jsx:35,282`); `chipValueText` honours `valueText` (`:206`). Frame suffix precedent ` · ` (`:419`). `disambiguateSiblings` keys on `defId::plotKey::label` (`:667`) and rebuilds `text` from `label` (`:717`). `paneReadoutLabel` prints `meta.name` + only `chip.suffix` and `chip.frameSuffix` (`:1028,1035`). Label-only chips set `text: label` (`:868`).
- `scalarsFor(def, inputs, ctx)` (`serverCompute.js:447,450`) reads the cached envelope, null on rev mismatch; `payload` is documented as the 2a readout's source (`:154`); `pickServerInputs` keys the fetch (`:177`). `primeServerColumns` does not notify (`:338`); `notifyColumnsLanded(key)` does (`:310`). `useServerColumns` is a counter, not data (`useServerColumns.js:18`).
- `defSchema`: `LEGEND_FIELDS` closed (`defSchema.js:398`); unknown top-level keys preserved (`defSchema.test.js:494`); unknown `plots[].legend` fields fail closed (`:659`); `meta.presets` validated (`defSchema.js:1223/1235`) but `inputs` keys unchecked.
- StockChart: imports `legendChips`, `chipValueText` (`StockChart.jsx:147`); off-cursor chips at `:4914`, hover at `:15904`; `serverColumnsGeneration` (`:7129`) is not in the off-cursor refresh deps (`:16017`) and the sym/tf effect returns early (`:14538`); the 500 ms always-show interval re-derives `computeLatestCrosshair()` (`:16089`). Binder sync ctx carries `sym` and `tf: resolvedTf` (`:13363,13367`). `LegendMenuHeader({label, value, hidden, sub})` (`:490`); chip menu About closes over the chip (`:19053`); About prints `meta.description` and `meta.category` only (`:19178-19179`); Display-in back-row pattern (`:19080`). `ContextPopover` renders `header` only in the items path (`:201,247`); `children` replaces items (`:56`), root role=dialog (`:239`).
- Phone: body tap replaces the menu opener (`IndicatorChip.jsx:229,243`); chips are 44 px dots with text indented off-screen at ≤640 px (`IndicatorChip.module.css:346`); legend tap opens the sheet editor (`MobileChartsApp.jsx:112`).
- Rails: nine shipped chips byte-for-byte (`legendFromDefinitions.test.jsx:550`; rsLine excluded by name, `readout.test.js:304`); `IndicatorChip.test.jsx:148`; every `<IndicatorChip>` inside the legend element (`parityGateBlindness.test.js:184`); every drawing definition keeps a chip (`everyIndicatorHasALegendDoor.test.js:57`); `serverCompute.js` names no tenant (`serverCompute.test.js:381`).
- Provider payload today: `benchmark, legend, lastRsHigh, history, inputs, intraday` (`api/routers/signature.py:941`); `legend_scalars` (`relative_strength.py:388,393`); the Python row declares only `payload_keys: ["payload"]` (`registry_defs.py:237`); `tests/test_rs_columns_provider.py:169,242`.

**What 2a must build**
- The `readout[]` schema, a pure row resolver, the chip scalar suffix, headline rows in the chip popover, the Leadership readout and three-line cards in About, Learn links.

**Smallest generic design**
- Top-level `readout: [{key, label, source: 'payload.a.b', format, chip?, card?: {what, origin, evidence?}}]` validated fail-closed as a behavioural field (carved out of preserve-unknown), `source` matching `/^payload(\.[A-Za-z0-9_]+)+$/`, `format ∈ READOUT_FORMATS` (int, pct1, signed, bool, text, barsAgo), unknown row fields refused by name.
- Pure `readoutRows(def, payload, inputs)` in new `engine/readoutSchema.js` resolving dotted paths, `—` for absent; names no definition id; extend the tenant scan to it.
- `readout.js` gains a trailing optional `opts` on `legendChips`/`engineChips`/`chipsFrom` with `opts.scalarsOf(defId, instanceId)`; rows flagged `chip: true` append ` · value` into `label` BEFORE `disambiguateSiblings`, and ALSO stamp `chip.suffix` so `paneReadoutLabel` keeps the benchmark. Every existing caller passes nothing and is byte-identical. rsLine sets `legendParams: []` so the chip reads `UCT RS · SPY · 94` with payload and `UCT RS` without.
- StockChart builds the resolver once: `(defId, id) => scalarsFor(engineRegistry.getDefinition(defId), inst.inputs, {sym, tf: resolvedTf})`; adds `serverColumnsGeneration` to the off-cursor effect deps (`:16017`). `LegendMenuHeader` gains a `rows` prop (inert lines, both touch and desktop). About gains `page` state: readout rows as buttons in the `children` branch, tap → card page (what/origin/evidence) with a back row. Learn links render here as react-router `<Link>`s. Nothing new enters the legend container.
- Member copy (operator voice, no emoji): chip `UCT RS · SPY · 94`; rows `Rating 94 (IBD-style, nightly)`, `Fast rating 91 (hourly)`, `Above 21 EMA by 1.8%`, `New RS high 3 bars ago, before price`; card evidence line falls back to the defensible field sentence until 2b data lands, with `universe as held, survivorship not yet corrected`.

**Tests to add**
- `defSchema.test.js` describe('readout'): accept/refuse pairs; `readoutSchema.test.js`: formats, absent paths, tenant-free.
- `rsReadout.test.js`: suffix appended only with payload and `chip: true`, byte-identical control, hidden chip keeps suffix without value, pane label keeps suffix, two benchmarks get no `#2`.
- StockChart DOM test: prime with `primeServerColumns(..., {payload})`, call `notifyColumnsLanded(key)`, assert chip text; header rows; About → card page; Learn `<Link>` href.
- Python rail beside `test_rs_columns_provider.py:242` diffing `readout[].source` against the provider's payload dict (not `payload_keys`).

**Risks**
- Chip scalar text is invisible on phones by the dot rule; say so in the copy review rather than fight the CSS.
- `legendFromDefinitions` nine-chip rail: control case must prove no shipped chip changes.

### 2.4 Mobile sheet

**What exists**
- `MobileIndicatorSheet.jsx` (`app/src/pages/charts/mobile/`) imports only `fieldFromInput` (`:8`) and the registry namespace (`:5`); the study editor maps `def.inputs` by hand with `?? inp.default` (`:418`), branches on raw type (`:419`), hand-rolls the switch (`:446`), falls to `fieldFromInput` only for enums (`:465`), returns null for source/datetime/session (`:477`); writes through `writeStudyInput` → `setInstanceInput` (`:198`); editor Sheet title is a string (`:372`), named by `ariaLabel` (`:377`; `Sheet.jsx:83`); `initialEditing` opens the editor on mount (`:164`); `Switch` is imported but used once (`:14`); no `useId` (`:1`); `QUICK_STUDY_IDS` is a census anchor, do not touch (`:150`; `enumerationSites.test.js:650`).
- `fieldsForInstance(def, inst)` already yields `values`, `all`, `inputs`, `style` with `group`, `inline`, `tooltip`, `activeWhen`, `isInt` (`indicatorRegistry.js:406-444`); `evalActiveWhen` (`:375,387`); `sectionize`/`packRows` are file-local to the dialog (`IndicatorSettingsDialog.jsx:119,100`). The dialog's tooltip is an always-visible sibling span wired by `aria-describedby` (`:402-408,524`; CSS `:267`), dimming is `disabled` + `aria-disabled` + dimmed label, never removal (`:413,422`), group heads are `aria-expanded` buttons (`:546`) with body unmounted when collapsed (`:551`), rows carry `data-input-key` (`:417`), ids from `useId()` (`:133`). `groupsCollapsed` IS honoured on the dialog's Inputs tab (`:617-628,712`); the Style tab starts expanded (`:718`).
- Mobile CSS: `.paramRow` has no `flex-wrap` (`MobileCharts.module.css:901`); `:disabled` rules exist only for `.row`, `.alertBtn`, `.layoutPrimary` (`:372,991`); `.sectionLabel` (`:345`), `.indNote` (`:465`).
- rsLine declares `group` on 14 inputs and `tooltip` on 8 (`nativeRegistry.js:284,3837,3851`), `groupsCollapsed: ['Line', 'New highs']` (`:3832`), presets (`:3836,3844`); no shipped definition declares `activeWhen`; the phone `SWATCHES` contain no RS default colour (`:19`).
- Tests: `MobileIndicatorSheet.studies.test.jsx` uses the real registry (`:28,109`); the dialog test's `fixtureDef`/`fakeRegistry` shape (`IndicatorSettingsDialog.test.jsx:140,151`); the user-definition lane admits only runtime/ast kinds (`nativeRegistry.js:3675`), so fixture injection is `vi.mock` of `getDefinition` and `listDefinitions`, or `initialEditing`.

**What 2a must build**
- Groups, tooltips and `activeWhen` dimming in the phone editor; `groupsCollapsed` honoured; the preset picker row.

**Smallest generic design**
- Replace the hand loop with `const model = fieldsForInstance(def, inst)` and render `model.all`; `cur = model.values[f.key]`; switch on generated `f.type`.
- Move `sectionize` and `packRows` into `indicatorRegistry.js` as exports plus `initialCollapsed(def)`; the phone seeds collapse state from it on `editing` change. The dialog swaps to the exports in the integration unit (not here, to keep files disjoint).
- Group head: `<button aria-expanded aria-controls>` styled like `.sectionLabel`, UIcon chevron `aria-hidden`, body unmounted when collapsed; ungrouped definitions render headerless, byte-identical.
- Tooltips: `.paramRow { flex-wrap: wrap }`, `.paramTip` sibling after the control with `id={`${uid}-${key}-tip`}`, `aria-describedby` on StepRow's three buttons and input and on each ChipRow option; swatches visible text only.
- Dimming: `disabled`, `aria-disabled`, `.paramRowOff` (opacity 0.4) plus new `:disabled` CSS for `.chipOpt`, `.swatch`, `.switch`, `.stepBtn`; never filter the field out.
- Preset row: first row of the editor, a ChipRow over `def.meta.presets`, calling the existing `applyPresetInputs` (`instanceControls.js:705`), shown only when presets exist. `data-input-key` on every row, `data-group` on sections.

**Tests to add**
- New `MobileIndicatorSheet.groups.test.jsx`: rsLine heads Simple (expanded), Line / New highs (collapsed); toggle shows/unmounts; tooltips resolve via `aria-describedby` for each field with `f.tooltip`, no accessible name contains tooltip text; `activeWhen` fixture dims and wakes; RSI unchanged; preset row applies Classic through `onWrite` once, instance count unchanged. Run `npx vitest run src/pages/charts/mobile --maxWorkers=2`.
- A phone sibling of `IndicatorSettingsDialog.everyDefinition.test.jsx` enumerating `fieldsForInstance(def, inst).all` rows, which surfaces the source/datetime/session gap as measured.

**Risks**
- `enumerationSites.test.js` is red for unrelated reasons (harness.jsx census, Python scan timeout); do not add a second failure by touching line 150.

### 2.5 Screener columns

**What exists**
- `build_row` pre-shapes the row to `snapshot_db.COLUMNS` (`snapshot_builder.py:434`), merges sources in order with `rs_fields` last (`:452`), never writes None (`:454`); bar families are `_step` calls inside `if bars:` (`:523`), 400-bar window (`:485`), `bars_full` kept; `rs_line_trend` is a bare try gated on `if spy_closes:` (`:558,560`) with a float-list kwarg pinned by `tests/test_screener_wave1_rs_line.py:11`; `bars_asof` stamped at `:566`; per-ticker bars carry `t` as the raw ts (`:678`); DEEP_BARS 5000 (`:669`); SPY read once as 60 bare closes (`:701,706`); whole-market sources read once via `_read_market_source(label, reader, targets, sources)` with contract `reader(targets, failures=failures)` (`:923,1396`); post-loop whole-table step `rank_sector_rs` (`:1588`; `snapshot_db.py:610`); `rs_fields` is the one mapping to `rs_rank`/`rs_return`/`chg_pct_3m/6m` (`:353,368,378`); weekly resample from `bars_full` already exists (`:541`).
- `snapshot_db`: add columns to `COLUMNS` only (`:14`), `_INT` (`:212`), `LIVE_ONLY_COLUMNS` (`:187`), ALTER-add on init (`:492`), bool→0/1 (`:565`), nightly `INSERT OR REPLACE` over every column (`:625`) so nothing persists across builds.
- Filters/views/starters: `_range` (`filters.py:28`), `_open_range` (`:98,138`), `_bool` (`:143`), `_enum` rs_line_trend (`:693`), presets are editorial claims (`:103`), views (`:1003,1026`), grammar reads FILTERS (`grammar.py:9`), starters (`saved_screens.py:544,548`); `query` compiles `eq` to `=` (`query.py:619`).
- Rails: every filter column in COLUMNS (`test_screener_filters.py:16`), preset-free stays preset-free (`:85,148`), yields match control type (`:594`), every family visible in a view (`:797`); AST partition `declared | excluded == COLUMNS` (`test_ast_scalars.py:194`) with pin `(138, 68)` red against live `(138, 98)` (`:291`; JS pin 98 at `freshness.test.js:124`), as-of census over three modules (`:421`), bars-fed scalars dated `bars_asof` (`:453`), scalar floor 138 (`:831`); writers censused over `api/services/screener/*.py` only (`test_scalar_population_rail.py:170,347`), `NO_COLLECTOR` dated (`:244`); every COLUMNS member member-reachable (`test_screener_wave1_columndefs.py:22,50`); 18 sources pinned (`test_screener_fundamentals_bulk.py:705`); `_TEXT`/`_INT` disjoint; desc ratchet 127 and MUST_DOCUMENT ranking family (`columnDescCoverage.test.js:19,55`); identities band for `rs_rank` (`identities.py:650`); methodology `_rs_rank_method` (`methodology.py:192`); `columnDefs.js:286`; `plainWords.js:9`.
- Unpartitioned today: `base_pivot_px`, `premarket_price`, `premarket_chg_pct` (`snapshot_db.py:108,172`); the two premarket columns are LIVE_ONLY with a ready reason.
- The fixture-case obligation (`tools/ast_conformance.py:541`) runs only via the hand CLI `--coverage`; two declared scalars already lack cases.

**What 2a must build**
- Columns `rs_new_high, rs_nh_before_price, rs_nh_red_day, rs_nh_bars_ago, green_on_red_20, rs_line_above_ma, rs_cross_up_bars_ago, mansfield, mansfield_cross_bars_ago, rs_benchmark_agree` (bar-derived) and `rs_rating_ibd, rs_rating_chg_5, rs_rating_chg_20, rs_rating_1m, rs_rating_3m, rs_rating_6m, rs_rating_12m` (history-derived); filters, views, starters, columnDefs, methodology, plain words, identities, partition. `rs_rating_fast` is dropped: `rs_rank` already is the UCT fast rating (§4.2 correction).

**Smallest generic design**
- Collector `api/services/screener/rs_columns.py` (inside the censused package) called as `_step("bars_rs", ...)` with the 400-bar window and SPY bar dicts, delegating to `relative_strength.compute_phase1_columns` plus the new pure `mansfield_column` (weekly resample inside `relative_strength`, pure). Rewrite `_read_spy_closes` into a bar-dict reader at `DEEP_BARS` (a 400-bar SPY read does not cover a halted name's earliest time; one hole voids a 252 window, `relative_strength.py:157`), derive the float list from it so the wave1 test stays green; read RSP once per build the same way for `rs_benchmark_agree`; count short series under `sources['spy_bars']`/`['rsp_bars']` and leave columns None.
- History columns arrive as a peer `_read_market_source("rs_history", rs_history.read_fields, ...)` with a disjoint key set; `rs_rating_ibd` can alternatively be ranked post-loop like `rank_sector_rs`.
- Flags and integer ranks in `_INT`; `mansfield` REAL.
- Partition in the same commit: declare bar-fed columns with `as_of: bars_asof`, yields bool for flags, one `scalars.json` case each; history columns land in `_scalars_excluded` first (R8) with dated `ARTIFACT_EMPTY` reasons and are promoted after a clean nightly fill (the `pattern_engine_vcp` precedent). Move the Python pin, the scalar floor and the JS pin together.
- Controls: `_bool` for flags, `_range`/`_open_range` for ages, counts, mansfield and ratings; only `rs_rating_ibd` may carry Over 80/90 presets (identical to `rs_rank`'s published thresholds); all others preset-free. Momentum view seats. Starters as plain-English names over filter keys; no starter on a column until it fills in prod.
- Member copy for starters (operator voice): `RS new highs (52-week)`, `RS new high before price`, `RS new highs on a red day`, `Up on down days (6 of 20)`, `Crossed above 21 EMA within 5 bars`, `Mansfield crossed zero (weekly)`, `Leaders vs equal-weight too`, `RS 90+ (IBD-style)`.

**Tests to add**
- `tests/test_screener_rs_columns.py`: fixture bars + SPY, asserts each column against `compute_phase1_columns`; short SPY leaves None and counts; `spy_closes` float-list compat.
- Extend `test_ast_scalars.py:421` tuple with `rs_columns`; `test_screener_fundamentals_bulk.py:705` 18→19; new `ARTIFACT_EMPTY` rows dated 2026-11-xx.
- Optionally add a real-DOC call of `assert_scalar_corpus_covers_the_table` so the fixture-case rail bites (will surface the two existing gaps; owner-visible choice).

**Risks**
- The partition is red on the branch today; 2a's own partition decision cannot be verified green until 2a-01 lands.
- Denominator mismatch between `rs_rank` (3,640) and the screener universe (11,230) must be stated in methodology.

### 2.6 Alert lane

**What exists**
- Partitions: `EVENT_ADDRESSES = (sar.*)` (`indicator_alert_evaluator.py:385`), `CROSS_ADDRESSES = ("ma_cross",)` (`:392`), `INDICATOR_FUNCS` = `SERIES_FUNCS` minus the three named partitions (`:395,406`), `ADDRESS_PARTITIONS` (`:461`), `THRESHOLD_ADDRESSES = tuple(INDICATOR_FUNCS)` (`:451`), `CLOSED_ONLY_ADDRESSES` (`:446`, `_lane_for` `:1008`). Forming-lane closure calls `column(bars, params)` only (`:364`) through the `_value_of` wrapper (`:1328`); closed lane passes the column itself through `call_series` with tf and sym (`:1745`, judges `series[i]` vs `series[i-1]` `:1765`); right-hand address operands call `series_for` without tf/sym (`:1668`). Bars window `lookback + 400` capped 5000 (`:1133,1182`), raw tf store key (`:1228`), one fetch per `(sym, tf)` group (`:2568,2601`). Conditions: `THRESHOLD_OPERAND` per `(address, condition)` (`:554,559`), `ALERT_CONDITIONS` rows (`:773`), `ALERT_BASE_LABELS` (`:851`), `instance_label` via `describe` (`:932`), `ALERT_VALUE_DECIMALS` (`:2184`), `_CALENDAR_TFS` (`:1410`), `fn.validate` read by `params_refusal` (`:975`).
- `alert_series`: `fn.inputs` (`:93`), `ma_cross` last (`:388`), `input_options` (`:325`), `instance_defs` (`:328`), `lookback` (`:260`), length assert (`:457`). `alert_user_series.call_series`: `runtime_plot` gets sym (`:1104`), `reads_symbols` gets tf (`:1106`); `_symbol_bars` cache 20 s TTL keyed `(ticker, tf, want)` (`:456,468`), max 64 cleared wholesale (`:481`), reads the store locally (`:476`).
- Door: every needs_threshold-False rule needs a `THRESHOLD_OPERAND` row (`indicator_alert_service.py:1529`); conditions must be in `check_condition`'s vocabulary (`:1438`); 260-bar probe with `{}` params (`:1306,1381`); empty column is not closed-lane dead (`:904`); only the instant-only-on-calendar refusal exists (`:1504`). Level vs edge fire keys (`alert_fired_log.py:101,266`), re-arm (`indicator_alert_service.py:707`).
- Pure math: `rsAbove` uses `>=` (`relative_strength.py:113`); `crossUp/Down` exactly 1.0/0.0 from it (`:126`); join by bar time `t` (`:277`; `indicator_compute.py:2403`); both alert loaders set `t` (`scan_evaluator.py:1067`). Provider blanks events intraday (`signature.py:926`) and only under `RS_V2_ENABLED` (`:916`), rounds ratio columns to 6 dp (`:939`). `RS_LINE_BENCHMARKS` one list (`registry_defs.py:97`; `test_rs_columns_provider.py:68`); Python row inputs with min/max (`:207`). `rs_benchmarks.resolve_benchmark(sym, requested, tf, count, fetch_bars=...)` (`:119`), INDUSTRY fans out to 60 members (`:58,151`).
- Rails and pins: base set `{sar}` (`test_indicator_alert_evaluator.py:787`), partitions 4 (`:335`), catalog tail `["close", "ma_cross"]` (`:1125`); 32 addresses (`test_alert_ma_cross.py:93`; `test_alert_closed_bar.py:489`), INDICATOR_FUNCS 28 (`test_alert_ma_cross.py:91`); soak 30 of 32 (`test_indicator_alert_service.py:792`), probe resolves every address (`:804`), GET list 31 (`:1078`); shadow 31 (`test_alert_shadow.py:238`); replay enumerates three partitions (`tools/alert_replay.py:1443,635`); notification totality (`test_indicator_alert_notification.py:372`); rev rail (`test_alert_rev_migration.py:674,681`) is RED now: registry has `rsLine: 2`, `ADDRESS_REVS` has only `vwap` (`alert_rev_migration.py:74`). Popover: `needs_threshold` (`IndicatorAlertPopover.jsx:324`), `input_options` select (`:520`); `idKey('rs_line') == idKey('rsLine')` (`alertSets.js:117`; defId at `nativeRegistry.js:3814`).

**What 2b must build**
- A benchmark-aware series builder, RS addresses, conditions, operands, labels, the closed-lane routing, an intraday refusal, and rails moved together.

**Smallest generic design**
- `RS_ADDRESSES`/`RS_FUNCS` as a fifth global partition appended to `ADDRESS_PARTITIONS`; `and address not in RS_ADDRESSES` in the `INDICATOR_FUNCS` comprehension so the 28-wide frozen grid is untouched; `RS_ADDRESSES ⊂ CLOSED_ONLY_ADDRESSES`.
- New `api/services/alert_rs_series.py`: `_rs_column(key) -> fn(bars, params, tf=None, sym=None)`, returns `[None]*len(bars)` without tf/sym, else resolves the benchmark via `resolve_benchmark(..., fetch_bars=alert_user_series._symbol_bars)`, calls `compute_phase1_columns`, rounds `rsLine/rsMa` to 6 dp, returns the named column. `fn.reads_benchmark = True`; one new branch in `call_series` before `:1106`. `fn.inputs` uses the Python row's key names; `fn.input_options = {benchmark: list(RS_LINE_BENCHMARKS), maType: ['EMA','SMA']}`; `fn.validate` refuses enum/range errors AND intraday tfs for event addresses (plan §6.5 rule, quoted in the refusal); `fn.lookback = lookback + (6*maLength if EMA else maLength)`; `fn.instance_defs = ['rsLine']`; `fn.describe`.
- Addresses (base `rs_line`): `rs_line.newHigh`, `.newHighBeforePrice`, `.newHighRed`, `.crossUp`, `.crossDown` (event columns, condition `above`, `THRESHOLD_OPERAND` const 0.5), `rs_line.mansfield` (`cross_zero`, needs the 2a pure column), `rs_line.rating` (oscillator conditions, default 90; ships only after `rs_history` exists, daily only). `ALERT_BASE_LABELS['rs_line'] = 'UCT Relative Strength'`; `ALERT_VALUE_DECIMALS['rs_line.*'] = 4` for line-valued addresses.
- Member copy (ALERT_CONDITIONS labels): `RS line made a new high this bar`, `RS line made a new high before price`, `RS line made a new high on a red benchmark day`, `RS line crossed above its average`, `RS line crossed below its average`, `Mansfield RS crossed zero`, `RS rating crossed above` / `fell below` (member types the level). Note in copy that consecutive new-high bars notify once (level key, re-arm on the first 0 bar).
- Benchmark load: resolve inside the column through `_symbol_bars` (shared per `(tf, want)` within the 20 s TTL under the 60 s cycle); memoise SECTOR/INDUSTRY per `(sym, requested, tf)`; restrict offered benchmarks to LITERAL + SECTOR until INDUSTRY has its own cache (60 reads vs a 64-entry cache that clears wholesale).
- Give the probe (`:1381`) a benchmark seam so `test_the_probe_resolves_every_catalog_address` stays green.

**Tests to add**
- `tests/test_rs_alert_series.py` modelled on `test_alert_ma_cross.py`: catalog shape, INDICATOR_FUNCS still 28, `rs_line` not in `THRESHOLD_ADDRESSES`, series equality with `compute_phase1_columns` on `rs_line_spy.json` (halt gap stays None), fires on fixture event bars, no fire under forming mode, one trigger per event with re-arm, one benchmark store read per `(tf, want)` across N groups, SECTOR fallback, intraday refusal, create-door refusals via POST.
- Move pins together: partitions 4→5 (`:335-338`), tail `["close","ma_cross","rs_line"]` (`:1125`), 32→32+N (`test_alert_ma_cross.py:93`, `test_alert_closed_bar.py:489`), soak 30→30+N, GET 31→31+N, `_ADDRESS_PLOT`/`_NO_CHART_PLOT`, and either leave the three diff instruments at 31 as `ma_cross` did or grow `alert_replay.py:1443`, `alert_shadow_log.py:552`, `test_alert_shadow.py:238` together.

**Risks**
- The rev rail is red today (pre-existing from Phase 1's rev 2); fix in 2a-01, and bump again if 2a-14 changes the columns list.
- Under `RS_V2_ENABLED=0` the chart draws no dots while the alert math is flag-free; the alert lane should consult `registry_defs.RS_V2_ENABLED` for event addresses.

### 2.7 Chart Data panel, presets, dot size

**What exists**
- Preset applier exists: `applyPresetInputs(cs, instanceId, def, preset, registry)` (`instanceControls.js:705`), skips undeclared keys with `console.warn` (`:716`), compares against STORED inputs (`:721`), writes each key through `setInstanceInput` (`:722`). Dialog picker at `IndicatorSettingsDialog.jsx:662-692` (`applyPreset` `:368`, write `:379`, Reset `:683`), `detectPreset` compares input values only (`:139`), `writeSettings` (`:319`), `setTarget` (`:341`), Style tab `renderFields(model.style)` (`:718`) then chip box (`:720`). `groupsCollapsed` honoured on Inputs tab only (`:617-628,712`). Presets test exists (`IndicatorSettingsDialog.presets.test.jsx:208,279`). `defSchema` validates presets shape (`:1235`) and `groupsCollapsed` (`:1267`); `inputs` keys unchecked.
- Writers: `setInstanceVisibility` (`:1301-1305`), `setInstanceDotSize(cs, id, size, registry, plotKey)` (`:1013,1015,1029`), `setInstanceDisplayTarget` (`:1109,1111,1120`), `setInstancePanePosition` (`:923,925`, harness-only callers), `rewriteInstance` live-only (`:1206,1211`), `withInstances` marks `preset:'custom'` (`:333`), `setInstanceInput` validates (`:657,662`).
- Dot size: `DOT_SIZES {small 1.5, medium 2.5, large 4}`, `DEFAULT_DOT_SIZE`, `DOT_SIZE_CHOICES` (`presentation.js:316-318`), `resolveDotSize` per-output → instance → medium (`:333`); `presentedPlot` rewrites only `plot.width` for markers plots (`:421`) → `pointMarkersRadius` (`pool.js:761`, `pointMarkersVisible` `:760`, default radius 3 `:415`); the binder ALSO draws a series-marker glyph whenever `plot.marker` exists (`binder.js:2511,2541`; `markerPrimitive.js:80`), which `dotSize` never touches; `pool.js` has no `plot.marker` awareness. RS dot plots carry `marker:{size: 0.6 | 1.2}` (`nativeRegistry.js:3898-3903`); hidden `rsAbove` plot (`:3896`) is excluded from restyle controls. `setInstanceDotSize` has no `.jsx` caller; only refusal tests (`instanceWriters.test.js:204,210`); `DOT_SIZE_CHOICES` imported nowhere else.
- Chart Data: visibility control (`ChartSettingsIndicators.jsx:2963,2997`), display target (`:2656`), `styleControl` (`:2705`, plotKey convention `:2749`), `commitWrite` (`:2767`), pane order via `movePane/movePaneTo` (`:143`). Agent `STYLE_OPS` has `setVisibility` (`agentMutations.js:51,917`), no dot-size op. Visibility presets `all/intraday/dailyUp/custom` (`instanceTimeframe.js:113,133,155`); eligibility hides, never drops (`eligibility.js:177`). Fetch key is `meta.serverInputs` only (`serverCompute.js:178`). Rails: dialog writes only inside `indicatorInstances` (`IndicatorSettingsDialog.test.jsx:687`, drives RSI), `everyAdjustment` (`:185`), `mtfModel.test.js:126,224`, control-door census (`controlDoorCensus.test.js:640`).

**What 2a must build**
- Trend and Stress presets that also set visibility/dot size; a Dot size control in the dialog Style tab and the Chart Data row; a decision on the two dot renderers.

**Smallest generic design**
- Extend `applyPresetInputs` (same function, inside THE_WRITER, no new census entry) with optional preset fields `visibility`, `dotSize` (word or `{plotKey: word}`), `displayTarget`, chained after the input loop through the existing writers; absent field = untouched. Extend `detectPreset` to compare these fields when present. Do not add pane position. Validate the new fields in `defSchema`'s presets block in the integration unit (2a-15).
- Dot size select in the dialog Style tab between `:718` and `:720` for each plot whose resolved style is `dots`, writing `setInstanceDotSize(..., single ? undefined : plot.key)` via `writeSettings`; the same control in `styleControl` beside Plot style; `setDotSize` op in agent `STYLE_OPS`.
- Dot rendering: keep the glyph and make `presentedPlot` scale `marker.size` by the dotSize word, and suppress `pointMarkersVisible` when `plot.marker` exists; verify on a real chart (screenshot to the owner) before 2a-14 multiplies dot plots.

**Tests to add**
- `instanceWriters.test.js` success paths for `setInstanceDotSize` (store large, delete medium, per-plotKey, sibling untouched).
- Presets test: non-input fields land, absent fields leave keys absent, refused field leaves the rest, apply-twice identity (not apply-vs-fresh, see `:721`), Cancel rollback.
- Dialog test: Dot size appears only for a definition with a markers plot; new case for the nested-key assertion (`:687`).
- Presentation test for the chosen rendering model; eligibility test `dailyUp` hides on `5`, shows on `D`.
- Registration rail: every `meta.presets[].inputs` key is a declared input and every value validates.

**Risks**
- The double-renderer effect on screen is unmeasured; the visual check is a gate.

### 2.8 Education links

**What exists**
- The Desk already has the per-video parameter: `/desk?section=videos&v=<youtube_id>[&t=<int>]` (`VideosSection.jsx:273,276,286,287,291,294`); `videoStore.play` takes `startAt` (`videoStore.js:52`); `GlobalVideoLayer` seeds `startSeconds` (`:286`); `section=videos` is mandatory because Desk falls back to `desk_section` localStorage (`Desk.jsx:62,75,77`). Emitters: `deskMentionHref` (`StockChart.jsx:899-900`, navigates with `window.open(href,'_self')` `:17948`), `ArticleReader` `<Link>` (`:638`). Tests: `StockChart.deskmarkers.test.jsx:242,244`, `VideosSection.landing.test.jsx:703,718`, `Desk.test.jsx:140`, `ArticleReader.test.jsx:324`. The two emitters disagree on `t=0` (builder emits `&t=0`, consumer ignores it).
- `GET /api/education/by-youtube/{id}` paid, returns id/title/youtube_id (`education.py:269,277`; `education_service.py:1241`); `useDeskVideoByYoutube` hook with one caller (`:11`); `edu_videos.chapters` JSON column exists via boot ALTER (`education_service.py:161`) served by `/api/education/videos/{id}/insights` (`education.py:282`). The five RS workshop ids are in `SEED_VIDEOS` with titles and one category (`education_seed.py:458-492`), seeded idempotently at boot (`education_service.py:424`; `api/main.py:4038`); a seed shape rail exists but pins no ids (`tests/test_education.py:140`). `defSchema` preserves unknown `meta.*` (`defSchema.js:20,1216/1272`). `IndicatorChip` imports nothing from react-router (`IndicatorChip.jsx:5`).

**What 2a must build (optional, cheap)**
- Learn links in the About readout; zero Desk/router/API edits.

**Smallest generic design**
- `app/src/lib/deskVideoHref.js` exporting `deskVideoHref(youtubeId, t)` emitting `&t=` only for integer `t >= 1` (the consumer's rule). `meta.learn: [{label, v, t}]` on rsLine with short labels. Render as `<Link>` in the About page (2a-10), never inside `IndicatorChip`/`LegendRow`. Check production `chapters` for the five ids via `by-youtube` → `insights` before asking the owner to hand-pick seconds.

**Tests to add**
- Unit test for the helper (t omitted, t=0 omitted, rounding); `rsReadout` assertion that every `meta.learn` entry renders a Link with `/desk?section=videos&v=`; Python rail that the five ids are in `SEED_VIDEOS`, reading them from `tests/fixtures/indicators/rs_learn_videos.json` shared with the JS lane.

**Risks**
- A regenerated seed sheet could drop a target silently; the fixture rail is the guard.

### 2.9 Discord routing

**What exists**
- `screen_alerts.run_nightly` is per-member (`screen_alerts.py:220,326`; `watchlist_alert_service.py:623,27`); `add_alert` fires Discord for broadcast only (`alerts.py:468,483`) to the admin webhook (`:138`) with an emoji title (`:675`); `scanner_match` is dead and censused (`:21`; `test_alerts_broadcast_type_reachability.py:188`). `alert_routing` has no transport (`:65`), ops/business only (`:103`), one permitted importer (`test_alert_destination.py:1272`). Webhook census regex and `LEGACY_WEBHOOKS` (`test_alert_channel_registry.py:14,29,47`; `channels.py:70,11,56,39`), red on master for `DISCORD_BREADTH_WEBHOOK_URL` (`breadth_alerts.py:29`).
- Member-facing poster precedent `discord_index_close`: flag per call default off (`:100`), webhook per call with no fallback (`:105`), marker after 2xx (`:88`) written atomically (`:134`), `_RUN_LOCK` (`:93`), per-day idempotency (`:435`), `username: "UCT Intelligence"` and mentions disabled (`:310`), `post_fn/force/dry_run` (`:405`); registered unconditionally in `api/main.py` (`:3540,3560`) with a retry job (`:3576`) and a boot armed/dark line (`:7491`); manual door and status behind `PUSH_SECRET` (`discord_interactions.py:1144,1213,1200`); admin door precedent with `target=test|live` and `force` (`calendar.py:4701,4706`; `calendar_week_poster.py:42,50,65,143,419`). Tests: `test_discord_index_close.py:100,198,236,267,293,312/335`; `test_calendar_week_post.py:116,229`.
- `#uncharted-scanners` is channel `1511543228455718963`, posts by an external "Uncharted Scanners" app (`docs/wisdom/discord-sources.json:18`), the UCT Intelligence bot measured 403 there (no role overwrite); "Uncharted Scanners" is also a TradingView saved-script name (`tools/visual_conformance/probes/saved-scripts.json:31`). Copy guard `discord_close_note` refuses emoji, markup, mentions, em dashes and any digit (`:43,45,62`). Post-then-edit via webhook `PATCH .../messages/{id}` (`desk_session_announce.py:274,38`). Sessions are the snapshot's date (`spec_alerts.py:14`; `scan_store.py:103,582`; `screen_alerts.py:148`). Worker Discord = OPS webhook only (`worker_main.py:32,558`).
- The v3 §10.3 template and trigger (SPY close ≤ −0.5 %, suppressed under three names, posted by Uncharted Scanners) are recoverable from the plan repo at commit `efab28c613` lines 343-349 and 424; the template itself uses bold, arrows and an ellipsis, which the house guard refuses.

**What 2b must build**
- A dedicated poster, its webhook variable and flag, its registrar with retry, an owner door, and an RS copy validator.

**Smallest generic design**
- `api/services/rs_discord_post.py` on the index-close shape: `enabled()` reads `RS_DISCORD_POST_ENABLED` per call; `webhook_url()` reads `DISCORD_RS_SCANNERS_WEBHOOK_URL` with no fallback (registered in `LEGACY_WEBHOOKS` with purpose `rs_scanners`); `run_red_day_leaders_post(*, leaders_fn, now_et=None, post_fn=None, force=False, dry_run=False) -> dict`, never raises, names every skip reason; trigger SPY session change ≤ −0.5 % (D3); floor 3 names; marker keyed `(target, as_of YYYYMMDD)` written atomically after 2xx; `allowed_mentions: {"parse": []}`; `username` per owner decision. Runs on the WEB pod (its inputs, `rs_rating_history` and `screener_rows.rs_nh_red_day`, live there) after `rs_history`, with a retry pass. Admin door `POST /api/rs/discord/post?target=test|live&force=&dry_run=` behind `require_admin` plus a status readback; test target may fall back to the admin webhook, live never.
- Validator: reuse `_EMOJI_RE`/`_BANNED_CHARS` but allow digits; refuse markdown.
- Draft template (owner approval required; operator voice, plain text):
  `RS leaders on a red day. SPY -0.8% on Wed Nov 5.`
  `New 52-week RS highs against SPY while the index fell, IBD-style rating in brackets:`
  `NVDA (97), ANET (95), CRWD (93)`
  `Rule: RS line at a 252-bar high on a session where SPY closed at or below -0.5%. Universe as held, 3,640 names. Not a recommendation.`

**Tests to add**
- `tests/test_rs_discord_post.py` mirroring `test_discord_index_close.py`: armed-only, same session once, failure does not mark, dry_run posts nothing, force ignores gates, no mentions, inside limits, floor of 3, validator refusals, red-day trigger; AST registrar probe and real-scheduler readback; 401 on the door (mirror `:312/335`, not `:305`); ledger and census green.

**Risks**
- Identity and channel are owner decisions (open questions 2-3). Posting to `#uncharted-scanners` needs a webhook created by the owner; the bot token path is 403.

---

## 3. Task breakdown

Rules for every unit: at most one day; one push per finished unit; the unit's files are the only files it edits; two units that share a file never run in the same wave; new flags land with their ledger entry in the same unit; no `start_worker_scheduler(` definition outside a `schedule.py`; member-facing copy in operator voice, no emoji.

### Phase 2a

| Unit | Scope | Files touched | Depends on | Size |
|---|---|---|---|---|
| 2a-01 | Clear pre-existing reds we own: partition `base_pivot_px` (REAL, bars_asof) and `premarket_price`/`premarket_chg_pct` (LIVE_ONLY reason) in `closedTable.json`; Python pin `(138, 68)` → live counts; JS pin 98 → new count; `ADDRESS_REVS['rsLine'] = 2`. Investigate `enumerationSites.test.js` reds (harness.jsx census, Python-scan timeout) and fix or document. | `app/src/components/chart/engine/ast/closedTable.json`, `tests/test_ast_scalars.py`, `app/src/components/chart/engine/ast/freshness.test.js`, `api/services/alert_rev_migration.py`, `app/src/components/chart/engine/__tests__/enumerationSites.test.js` | none | 0.5 d |
| 2a-02 | Pure math: `mansfield_column` (weekly resample of RS vs its 52-week SMA, pure), `mansfield_cross_column`, `benchmark_agree`, bars-ago helpers for cross events; fixture. | `api/services/relative_strength.py`, `tests/test_rs_mansfield.py` (new), `tests/fixtures/indicators/rs_mansfield.json` (new) | none | 0.5 d |
| 2a-03 | `rs_history` module: table, receipts, `nightly_job`, `status`, `read_fields`, backfill marker, population + ETF exclusion + split guard, `asof`. No env flag read here. | `api/services/screener/rs_history.py` (new), `tests/test_rs_rating_history.py` (new) | none | 1 d |
| 2a-04 | Wire `rs_history` into `register_screener_jobs` (inline under `_nightly_shortfall(stats) is None` if measured < 3 min, else own 04:15 ET cron with coalesce + misfire grace), per-call `RS_HISTORY_ENABLED`, `snapshot-status` `rs_history` block, `rs_history_short:{day}` alert, ledger entry (web, dark). | `api/main.py`, `api/routers/screener.py`, `docs/feature_flags.json`, `tests/test_screener_schedule.py` | 2a-03 | 0.5 d |
| 2a-05 | Screener bar-derived RS columns: `rs_columns.py` collector as `_step("bars_rs")`, SPY and RSP bar-dict readers at DEEP_BARS (float-list compat kept), `COLUMNS`/`_INT` for the ten bar-derived columns. | `api/services/screener/snapshot_builder.py`, `api/services/screener/snapshot_db.py`, `api/services/screener/rs_columns.py` (new), `tests/test_screener_rs_columns.py` (new) | 2a-02 | 1 d |
| 2a-06 | History columns into the build: `_read_market_source("rs_history", rs_history.read_fields, ...)` as a disjoint source; `COLUMNS`/`_INT` for the seven rating columns; 18→19 source pin. | `api/services/screener/snapshot_builder.py`, `api/services/screener/snapshot_db.py`, `tests/test_screener_fundamentals_bulk.py` | 2a-03, 2a-05 | 0.5 d |
| 2a-07 | AST partition and fixtures: declare bar-derived columns (bars_asof, yields), exclude rating columns under R8 with dated reasons, `scalars.json` cases, as-of census tuple + `rs_columns`, pins moved together, `ARTIFACT_EMPTY` rows. | `closedTable.json`, `tests/fixtures/ast/scalars.json`, `tests/test_ast_scalars.py`, `freshness.test.js`, `tests/test_scalar_population_rail.py` | 2a-01, 2a-05, 2a-06 | 0.5 d |
| 2a-08 | Filters, views, starters, columnDefs (desc for every column), methodology, plain words, identities band for `rs_rating_ibd`. Starters only on columns that fill in prod. | `api/services/screener/filters.py`, `api/services/screener/saved_screens.py`, `api/services/screener/methodology.py`, `api/services/screener/identities.py`, `app/src/pages/screener/columnDefs.js`, `app/src/pages/screener/focus/plainWords.js`, `tests/test_screener_filters.py`, `tests/test_screener_saved.py` | 2a-05, 2a-06 | 1 d |
| 2a-09 | Readout engine: `readoutSchema.js` (`readoutRows`, formats), `defSchema` top-level `readout` fail-closed, `readout.js` `opts.scalarsOf` + label suffix + `chip.suffix`, tenant scan extension. | `app/src/components/chart/engine/readoutSchema.js` (new), `defSchema.js`, `defSchema.test.js`, `readout.js`, `readout.test.js`, `rsReadout.test.js` (new), `serverCompute.test.js` | none | 1 d |
| 2a-10 | Readout surfaces: resolver, `LegendMenuHeader rows`, About page/card with back row, Learn `<Link>`s from `meta.learn` via the 2a-16 helper, `serverColumnsGeneration` in off-cursor deps, DOM tests. | `app/src/components/StockChart.jsx`, `app/src/components/StockChart.rsReadout.test.jsx` (new) | 2a-09, 2a-16 | 1 d |
| 2a-11 | Mobile sheet: `fieldsForInstance` loop, group heads, tooltips, dimming, preset row, `data-input-key`; `sectionize`/`packRows`/`initialCollapsed` exported from the registry (dialog untouched here). | `app/src/pages/charts/mobile/MobileIndicatorSheet.jsx`, `app/src/pages/charts/mobile/MobileCharts.module.css`, `app/src/components/chart/indicatorRegistry.js`, `MobileIndicatorSheet.groups.test.jsx` (new) | none | 1 d |
| 2a-12 | Presets with non-input fields: extend `applyPresetInputs` and `detectPreset`; Dot size control in dialog Style tab and Chart Data `styleControl`; `setDotSize` agent op; writer success tests. No `defSchema` edit here. | `app/src/components/chart/engine/instanceControls.js`, `app/src/components/chart/IndicatorSettingsDialog.jsx`, `app/src/components/chart/ChartSettingsIndicators.jsx`, `app/src/components/chart/builder/agentMutations.js`, `instanceWriters.test.js`, `IndicatorSettingsDialog.presets.test.jsx`, `IndicatorSettingsDialog.test.jsx` | none | 1 d |
| 2a-13 | Dot rendering model: scale `marker.size` by dotSize in `presentedPlot`, suppress `pointMarkersVisible` when `plot.marker` exists; screenshot to the owner. | `app/src/components/chart/engine/presentation.js`, `app/src/components/chart/engine/pool.js`, presentation/pool tests | none | 0.5 d |
| 2a-14 | rsLine definition v3 + provider: `readout[]`, `legendParams: []`, `meta.learn`, Trend and Stress presets (visibility dailyUp, dot sizes), red-day/new-low dot markers, Mansfield plot + zero-cross marker; provider adds `mansfield` column, `payload.rating {ibd, fast, asof}`, `regime`, `sensitivity` (RSP, sector ETF, null with reason when bars missing), `checks`, `theme`; ETF input special-case (sector `Exchange Traded Fund` → SPY fallback); `compute.rev` 3 in both lanes and `ADDRESS_REVS`; readout-source rail. | `app/src/components/chart/engine/nativeRegistry.js`, `api/routers/signature.py`, `api/services/signature/registry_defs.py`, `api/services/alert_rev_migration.py`, `tests/test_rs_columns_provider.py`, RS fixtures | 2a-01, 2a-02, 2a-03, 2a-09, 2a-12 | 1 d |
| 2a-15 | Integration: `defSchema` presets block validates `visibility`/`dotSize`/`displayTarget`; dialog swaps to the registry `sectionize`/`packRows`; regenerate `api/data/bars_ordinal_census.json`; ledger sweep; full suite (`--maxWorkers=2`, scoped dirs). | `defSchema.js`, `IndicatorSettingsDialog.jsx`, `api/data/bars_ordinal_census.json`, `docs/feature_flags.json` | 2a-09, 2a-11, 2a-12, 2a-14 | 0.5 d |
| 2a-16 | Learn link helper and rails: `deskVideoHref`, five-id fixture, Python seed rail; production `chapters` check for the five ids (report to owner). | `app/src/lib/deskVideoHref.js` (new) + test, `tests/fixtures/indicators/rs_learn_videos.json` (new), `tests/test_rs_learn_seed.py` (new) | none | 0.5 d |

Waves (units in one wave touch disjoint files and may run concurrently in separate worktrees):
- Wave 1: 2a-01, 2a-02, 2a-03, 2a-09, 2a-11, 2a-12, 2a-13, 2a-16.
- Wave 2: 2a-04, 2a-05, 2a-10.
- Wave 3: 2a-06, 2a-14.
- Wave 4: 2a-07, 2a-08.
- Wave 5: 2a-15.
Critical path: 2a-02 → 2a-05 → 2a-06 → 2a-07 (3 d of chained work); 2a-09 → 2a-10; 2a-03 → 2a-14 → 2a-15. Total ≈ 12.5 agent-days; wall time with eight worktrees ≈ 5 working days plus the owner sittings.

### Phase 2b

| Unit | Scope | Files touched | Depends on | Size |
|---|---|---|---|---|
| 2b-01 | Evidence job as a `python -m` module: signals from `compute_phase1_columns` (+ 2a-02 Mansfield), point-in-time over bars.db, `(session, signal)` checkpoint, `/data/rs_evidence.db`, REQUIRED destination path, `rs/evidence.json` via `put_bytes` with a row floor, survivorship count from `delisted_registry`. | `api/services/rs_evidence/__init__.py`, `api/services/rs_evidence/__main__.py` (new), `tests/test_rs_evidence_job.py` (new) | 2a-02 | 1 d |
| 2b-02 | Worker arming: `_start_rs_evidence_pass` daemon thread → sleep → subprocess, `rs_evidence` health key, `RS_EVIDENCE_ENABLED` ledger (worker, dark). | `api/worker_main.py`, `docs/feature_flags.json`, `tests/test_rs_evidence_worker_arming.py` (new) | 2b-01 | 0.5 d |
| 2b-03 | Web pull + payload: `rs_evidence_pull.py` (`get_bytes`, refuse short, atomic write) registered in `register_screener_jobs`; provider reads the local artifact into `payload.evidence` with `asof`; card evidence source. | `api/services/rs_evidence_pull.py` (new), `api/main.py`, `api/routers/signature.py`, `tests/test_rs_evidence_pull.py` (new), `tests/test_rs_columns_provider.py` | 2b-01, 2a-14 | 0.5 d |
| 2b-04 | Alert series builder: `alert_rs_series.py`, `SERIES_FUNCS` append, `call_series` `reads_benchmark` branch, benchmark memo, probe seam. | `api/services/alert_rs_series.py` (new), `api/services/alert_series.py`, `api/services/alert_user_series.py`, `api/services/indicator_alert_service.py` (probe seam only), `tests/test_rs_alert_series.py` (new) | 2a-02 | 1 d |
| 2b-05 | Evaluator partition and catalog: `RS_ADDRESSES`/`RS_FUNCS`, `INDICATOR_FUNCS` exclusion, `CLOSED_ONLY`, `ALERT_CONDITIONS`, `THRESHOLD_OPERAND`, `ALERT_BASE_LABELS`, `ALERT_VALUE_DECIMALS`, intraday refusal; all pins moved together. | `api/services/indicator_alert_evaluator.py`, `tests/test_indicator_alert_evaluator.py`, `tests/test_alert_ma_cross.py`, `tests/test_alert_closed_bar.py`, `tests/test_indicator_alert_service.py`, `tests/test_indicator_alert_notification.py`, `tests/test_alert_shadow.py`, `tools/alert_replay.py`, `api/services/alert_shadow_log.py` | 2b-04 | 1 d |
| 2b-06 | `rs_line.rating` address: per-session rating series aligned to daily bars from `rs_rating_history` (web only), oscillator conditions, default 90, daily-only refusal. | `api/services/alert_rs_series.py`, `api/services/indicator_alert_evaluator.py`, `tests/test_rs_alert_series.py` | 2b-05, 2a-04 | 0.5 d |
| 2b-07 | Discord poster module, validator, webhook row, flag ledger (dark with reason), draft template file for owner review. | `api/services/rs_discord_post.py` (new), `api/services/alert_taxonomy/channels.py`, `docs/feature_flags.json`, `tests/test_rs_discord_post.py` (new), `docs/alerts/RS-DISCORD-POST.md` (new) | 2a-03, 2a-05 (data; build against a `leaders_fn` seam) | 1 d |
| 2b-08 | Registrar + doors: `register_rs_discord_post_job` (unconditional, ET cron after rs_history, retry pass, boot line), admin door `target=test|live&force&dry_run`, status readback; AST and real-scheduler tests; 401 test. | `api/main.py`, `api/routers/rs_discord.py` (new), `tests/test_rs_discord_post.py` | 2b-07, 2b-03 (main.py sequencing), 2a-04 | 0.5 d |
| 2b-09 | Literature replication and evidence copy: the five defensible statements plus our measured numbers in the readout card, methodology text, honesty sentence. Mostly analysis over 2b-01 output. | `docs/superpowers/research/...` (plan repo), `api/services/screener/methodology.py`, readout card text in `nativeRegistry.js` | 2b-01, 2b-03 | 1 d |

Waves:
- Wave 1: 2b-01, 2b-04, 2b-07 (may start as soon as 2a-02 is merged; 2b-07 against a seam).
- Wave 2: 2b-02, 2b-03, 2b-05.
- Wave 3: 2b-06, 2b-08.
- Wave 4: 2b-09.
Total ≈ 7 agent-days. 2b units 01, 04, 05, 07 can run beside 2a once 2a-02 has merged; 2b-03, 2b-06, 2b-08 need 2a-03/04/14 (see §4.4).

---

## 4. Corrections the facts force on plan §8, §10, §11 and §15

Format: plan says / code says / change.

### 4.1 Section 8

1. Plan says `scalarsFor(def, ctx)` returns `payload` (8.3). Code says `scalarsFor(def, inputs, ctx)` (`serverCompute.js:447`), ctx `{sym, tf}`. Change: adopt the shipped signature; the readout resolver passes `inst.inputs` and `{sym, tf: resolvedTf}`.
2. Plan says the readout is "rendered by the chip and readout rows" with the chip reading `UCT RS · SPY · 94` (6.6). Code says chip label grammar is `name(params)` with raw values (`readout.js:276-280`), pinned by three rails, and `text` is `label + ' ' + value` to the byte (`IndicatorChip.jsx:35`). Change: `legendParams: []` on rsLine; readout rows with `chip: true` supply ` · SPY · 94` into `label` through `opts.scalarsOf`; rows render in `LegendMenuHeader` and the About popover, not a new panel; on phones the chip is a dot and the card is reached by long-press → About.
3. Plan says `readout` is "validated by `defSchema`". Code says unknown top-level keys are preserved silently (`defSchema.test.js:494`). Change: `readout` is a behavioural field validated fail-closed, explicitly carved out of the preserve policy.
4. Plan says 2a adds `rating, regime, sensitivity, checks, theme, evidence` to payload from the provider. Code says the provider payload has six keys (`signature.py:941`) and the Python row declares only `payload_keys: ["payload"]` (`registry_defs.py:237`). Change: `rating.ibd` reads the web `rs_rating_history` table, `rating.fast` reads `rs_ranking.cached_rank_map()`, each with `asof`; `evidence` reads the pulled `rs/evidence.json` (2b) and is null with reason until then; a rail diffs `readout[].source` against the provider's payload dict.
5. Plan says the provider fetches RSP and the sector ETF for sensitivity from 2a. Code says RSP is in the prewarm priority set (`bars_prewarm.py:30`, `4749ba4df7`) but live presence is unverified. Change: `sensitivity` degrades to null with `reason: "benchmark_bars_missing"`; verify with `get_count` after deploy.
6. Plan says `SECTOR` resolves via Finviz sector → SPDR ETF. Code says every ETF row is sector `Financial` / industry `Exchange Traded Fund` (`tests/fixtures/finviz_etf_sample.csv:2`; `groups.py:534`), so SPY's sector benchmark is XLF. Change: special-case industry `Exchange Traded Fund` → SPY with `benchmark.fallback` set.
7. Plan says `columns` is an exact-match contract at `compute.rev: 2`. Code says the rev rail is already red (`rsLine: 2` in the registry, `ADDRESS_REVS` has only `vwap`). Change: 2a-01 adds `rsLine: 2`; 2a-14 bumps both lanes and `ADDRESS_REVS` to 3 when `mansfield` joins the columns list.
8. Plan says Phase 1 columns include red-day and new-low events "so scans can use them". Code says no screener module calls `relative_strength` and the population rail censuses only `api/services/screener/*.py`. Change: the collector lives in `api/services/screener/rs_columns.py` (§4.2.1).

### 4.2 Section 10

1. 10.1 says the columns come "from the same functions in the nightly snapshot". Code says `rs_line_trend` is the only RS-line column, computed from 60 bare SPY closes positionally (`snapshot_builder.py:560,701,706`), and writers must live in the screener package (`test_scalar_population_rail.py:170`). Change: new collector in the package; SPY read as bar dicts at DEEP_BARS joined by `t`; `spy_closes` float list derived from it for the wave1 test.
2. 10.1 lists `rs_rating_fast`. Code says `rs_rank` already IS the UCT fast rating percentile (`rs_fields`, `snapshot_builder.py:368`; methodology `_rs_rank_method`). Change: drop `rs_rating_fast`; the chip's "fast" value reads `rs_rank`'s source.
3. 10.1 lists `rs_rating_chg_5/20` and `rs_rating_1m..12m` as snapshot columns. Code says `screener_rows` is `INSERT OR REPLACE` nightly (`snapshot_db.py:625`), so nothing persists across builds. Change: these come from the `rs_rating_history` side table through a peer `_read_market_source` reader; they land in `_scalars_excluded` with dated reasons until the first clean fill.
4. 10.1 presets "Crossed above 21 EMA within 5 bars" and "Mansfield crossed zero (weekly)". Code says `rs_line_above_ma` alone cannot express an age and no Mansfield function exists. Change: add `rs_cross_up_bars_ago` and `mansfield_cross_bars_ago` columns; Mansfield math is pure in `relative_strength.py` (2a-02) and shared by screener, provider and alert.
5. 10.1 presets are "in plain English". Code says a preset is an editorial claim the owner publishes (`filters.py:103`) and starters may not filter columns empty in prod (`test_screener_saved.py:206`). Change: ship starters for bar-derived columns in 2a-08; rating starters after the first fill; owner approves the eight names and thresholds (open question 5).
6. 10.1 ratings as percentiles. Code says `rs_rank` ranks 3,640 cap_universe names while the build covers 11,230. Change: methodology states the denominator; owner picks it (open question 1).
7. 10.2 "RS addresses in `EVENT_ADDRESSES`". Code says a rail pins that partition's base to `{sar}` (`test_indicator_alert_evaluator.py:787`) and three instruments enumerate INDICATOR+EVENT+PRICE as 31. Change: fifth partition `RS_FUNCS`, excluded from `INDICATOR_FUNCS`, in `CLOSED_ONLY_ADDRESSES`; record as a plan amendment.
8. 10.2 "RS Rating crossed 90 / 80 / fell below 80" as three rows. Code says `THRESHOLD_OPERAND` is keyed `(address, condition)` and every needs_threshold-False row needs an operand (`indicator_alert_service.py:1529`). Change: one `rs_line.rating` address with oscillator conditions and default 90; the member types 80.
9. 10.2 "RS line crossed its MA (above / below)". Code says `rsAbove` uses `>=` (`relative_strength.py:113`) while `check_condition`'s cross is `prev <= 0 < cur`, so a spread cross can disagree with the chart at ties. Change: alert on the `crossUp`/`crossDown` event columns with `above` + const 0.5.
10. 10.2 says nothing about intraday. Code says the provider blanks events intraday (`signature.py:926`) and the door has no calendar-only refusal (`:1504`). Change: `fn.validate` refuses intraday tfs for event addresses, quoting §6.5.
11. 10.3 "through the screener alert routing (`screen_alerts.py`, `alert_routing.py`)". Code says that lane is per-member in-app+email, a private alert never reaches Discord (`alerts.py:483`), and `alert_routing` has one permitted importer. Change: dedicated `rs_discord_post.py` on the `discord_index_close` shape, new webhook variable in `LEGACY_WEBHOOKS`, flag with ledger entry; restore the v3 trigger (SPY ≤ −0.5 %) and the three-name floor in the text; the v3 template is re-approved after rewriting to plain text.
12. 10.3 "premium channel". Code says `#uncharted-scanners` is posted into by an external app and the UCT bot is 403 there. Change: owner creates a webhook in the chosen channel and picks the `username` (open questions 2-3).

### 4.3 Section 11

1. Row "Rating IBD-style + history": plan says worker job over bars.db with `.rs_history_backfill_v1`. Code says the worker has no scheduler of its own (`worker_main.py:100`), the R2 bridge merges only `ohlcv` (`data_sync.py:990,1059`), and the web pod already computes universe-wide RS from its own bars.db nightly (`ratings_universe.py:8`) with the by-date index (`data_sync.py:467`). Change: WEB pod, `screener.db` side table after the 03:00 build; `RS_HISTORY_ENABLED` is a web flag; the marker name stays; no R2 snapshot of screener.db (optional `put_bytes` backup).
2. Row "Evidence job": plan says `rs_evidence` table. Code says 2b is CPU-heavy and the subprocess recipe is the worker's (`worker_main.py:321,328`). Change: worker subprocess writing `/data/rs_evidence.db`, publishing JSON via `put_bytes`; web pulls and reads the artifact, never the table.
3. Row "Alerts": `EVENT_ADDRESSES` → `RS_FUNCS` (fifth partition), `reads_benchmark` closed-lane only.
4. Row "Preset picker: No". Code says it exists (`instanceControls.js:705`; dialog `:662-692`; `IndicatorSettingsDialog.presets.test.jsx`). Change: mark done (1); 2a extends presets with `visibility`/`dotSize`/`displayTarget` and adds the phone row.
5. Row "Groups, tooltips, dimming": `meta.groupsCollapsed` hint (1) is done on the dialog Inputs tab (`:617-628`), Style tab expanded by design. Change: keep the mobile 2a item; strike the dialog item.
6. Row "RSP bars: add to prewarm (1)". Code says done (`bars_prewarm.py:30`, test). Change: replace with "verify live depth with `get_count` after deploy".
7. Row "Scalar path": `scalarsFor` signature as §4.1.1.
8. Add row "Dot size control": `setInstanceDotSize` has no `.jsx` caller and two renderers draw the dots (`presentation.js:421` vs `binder.js:2511`). Change: 2a-12 control, 2a-13 rendering model.
9. Add row "Learn links": plan §4/§6.11/§17.9 say a Desk `video` param is Phase 4 work. Code says `/desk?section=videos&v=<id>&t=<n>` ships and is tested (`VideosSection.jsx:273-294`). Change: zero Desk work; a helper, `meta.learn` and Links in About (2a-16, 2a-10).
10. Flags paragraph (§13, referenced by §11): `RS_HISTORY_ENABLED` is web; all three new flags need `docs/feature_flags.json` entries in the same push as the code (`test_feature_flag_ledger.py:69,83`).

### 4.4 Section 15

1. 2a scope: add "clear the pre-existing partition, rev and webhook-census reds" (2a-01) and "dot size control + rendering model"; move "Learn links" from Phase 4 into 2a at 0.5 d (the Desk side is done); note Mansfield (preset and marker, §6.7 says 2a) is a 2a pure-math dependency of the 2b Mansfield alert.
2. 2a "Ratings + history": on the web pod, not the worker; sizing unchanged.
3. "2b can run beside 2a on a second machine": true only for 2b-01, 2b-04, 2b-05 and 2b-07 (against a seam) once 2a-02 merges; 2b-03, 2b-06 and 2b-08 depend on 2a-03/04/14. State the dependency.
4. Phase 4 "video": zero work; remove from the estimate (§17.9 closes).
5. Sizing: 2a ≈ 12.5 agent-days over 16 units; 2b ≈ 7 agent-days over 9 units. With parallel worktrees the wall time is roughly one working week each plus owner sittings and the copy review; the plan's three weeks per phase is conservative but holds if the owner's review cadence is weekly.

---

## 5. Open questions only the owner can answer

1. Rating denominator: rank `rs_rating_ibd` against the 3,640-name cap universe (matches `rs_rank`) or the full 11,230-name screener universe? Default in this map: cap universe minus ETFs.
2. Discord channel: which channel is "the premium channel" for "RS leaders on a red day"? If `#uncharted-scanners`, you need to create a webhook there (the UCT Intelligence bot is 403 in that channel as of 2026-09-13).
3. Discord identity: `username` "Uncharted Scanners" (v3 wording) or "UCT Intelligence" (the estate's other automated posts)?
4. Discord copy: approve the plain-text template in §2.9 (the v3 §10.3 template uses bold, arrows and an ellipsis, which the house guard refuses) and confirm the −0.5 % SPY trigger and the three-name floor.
5. Screener starters: approve the eight preset names and thresholds in §2.5 as editorial claims (RS 90+, 6 of 20, within 5 bars, etc.).
6. Backfill: should rating history start at the first nightly run, or backfill one year point-in-time from bars.db (over today's universe, so "survivorship not yet corrected" appears in the readout from day one)?
7. Learn videos: once engineering reports which of the five workshop rows have generated `chapters`, pick a start second (t >= 1) for the rows that have none.
8. Dot rendering: review the screenshot from 2a-13 (glyph scaled by dot size, LWC point markers suppressed) before the Trend/Stress markers multiply the dot plots.
9. Intraday RS alerts: refuse intraday timeframes for the event addresses (recommended, matches the chart) or compute them and let an alert fire where the chart draws nothing?
10. `DISCORD_BREADTH_WEBHOOK_URL`: fold the missing registry row into 2a-01 or leave the pre-existing census red as a separate line item?
11. Placement confirmation: the map moves `rs_rating_history` to the web pod against plan §11's wording; confirm, or state the reason to insist on the worker (then the breadth_ohlc_sync bridge and a worker `schedule.py` are two extra units).

---

## Appendix A. Refuted claims (do not re-derive)

Worker jobs
- "The one worker-side APScheduler family is fundamentals_pit" — false; `marketcap.schedule.start_worker_scheduler()` is a second (`worker_main.py:936-937`), and the better template (misfire grace, catch-up).
- "Worker jobs are daemon threads that start after boot" — backwards; every start function runs before `uvicorn.run` (`:982`) and must return instantly.
- "The worker exposes only /internal/health and /api/health" — also `/api/ready`, gated `/api/bars-history/{ticker}`, and the flow routers under `WORKER_SERVES_FLOW=1`; still no `/api/admin/*`.
- "Once-a-day jobs use coalesce + misfire_grace_time=3600" — the watchdog does; `screener_snapshot_nightly` has neither (`api/main.py:2185-2187`).
- "The only nightly Discord lane in the screener family is screen_alerts" — operator paging also exists via `chart_health_alerts.emit` at critical.
- "HEAD is unit 3" — HEAD was the unit 4 merge `577b558e47`, later the unit 5 merge `a21d598a74`.
- bars_prewarm citation at line 645 for the prewarm default — correct claim, line 670.

Rating data
- Six bars_prewarm.py citations were 23-25 lines off after `4749ba4df7` (corrected lines: 978, 730, 457, 1059, 450, 645); claims hold.
- "snapshot_builder reads RS from the cache map, never computing" — the build computes on cold (`:838/848`).
- "RSP and the sector ETFs are missing from the prewarm set" — stale; added in `4749ba4df7` with a test.

Readout / legend
- `scalarsFor(def, ctx)` — the shipped signature is `(def, inputs, ctx)`.
- "No reader of `meta.groupsCollapsed` or `meta.presets` exists" — stale; unit 4 landed both.
- `tf={resolvedTf}` at StockChart.jsx:19140 belongs to a different element (`:19157`); `sym`/`resolvedTf` are still in scope.
- Six defSchema/nativeRegistry line citations drifted by 11-69 lines after units 4 and 5; the rsLine plot row now carries `colorMode: 'column:rsAbove'` (`:3889-3891`).

Mobile sheet
- "Sheet, dialog and registry are byte-identical to master" — true only against `origin/master`; the local `master` ref is stale at the merge-base.

Screener columns
- "A declared scalar with no fixture case is a named red" — only via the hand CLI `tools/ast_conformance.py --coverage`; CI does not run it and two gaps already exist.

Alert lane
- `id: 'rsLine'` at nativeRegistry.js:3803 and the 4-dp plot row quote at :3865 — moved to `:3814` and `:3889-3891`; substance holds.
- "Mansfield is Phase 3" — the plan tags the Mansfield preset and marker 2a (`:88,136,177`).
- "SPY is read once per cycle" — once per `(tf, want)` because the cache key carries `want`.

Chart data panel
- "No preset applier exists; the dialog never reads groupsCollapsed; only one preset; only the toolbar has applyPreset; the dialog imports four instanceControls symbols" — all stale after units 4 and 5 (`instanceControls.js:705`; dialog `:368,379,617-628`; presets `classic` and `phase` at `nativeRegistry.js:3836,3844`; five imports `:46-47`). Twenty-two further line citations drifted by 11-127 lines; corrected lines are in §2.7.

Education links
- "edu_videos has no structured chapter column" — `chapters` JSON exists via `_EXTRA_COLUMNS` (`education_service.py:161`), served by `/api/education/videos/{id}/insights`.
- "Nine tests pin the v/t behaviour in the two cited files" — seven; others live in `ArticleReader.test.jsx` and `StockChart.deskmarkers.test.jsx`.
- "Mirror StockChart.jsx:899 for t" — the builder emits `&t=0`, the consumer ignores it; mirror the consumer's `t >= 1`.

Discord routing
- "The v3 §10.3 template is not in the repo" — recoverable at plan-repo commit `efab28c613` lines 343-349 (with the trigger and identity v4 dropped).
- `test_the_manual_trigger_needs_the_push_secret` (`:305`) only checks the route exists; the 401 rail is `:312/335`.
