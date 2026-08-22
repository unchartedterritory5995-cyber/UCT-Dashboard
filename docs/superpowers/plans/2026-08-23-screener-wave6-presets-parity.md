# Screener Wave 6 — Flagship Presets, accdis Repair, Finviz Parity, Polish

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the six owner-approved flagship presets through the registry-starter lane, close the accdis letter-in-num manifest defect through the governed path, add the cheapest verified Finviz parity columns, and absorb the recorded polish batch.

**Architecture:** Registry starters (`saved_screens.starters()`) carry all six presets — that lane trips no preset-rails and publishes the numbers AST grounding needs. One governed manifest bump (T1) moves 5 Wave-1 promotions + the accdis exclusion together. Finviz additions land columns-first, manifest-later (R8 ordering).

**Tech Stack:** FastAPI + SQLite snapshot store · closedTable.json AST manifest + conformance tooling · React/vitest frontend.

**Spec:** `docs/superpowers/specs/2026-08-21-screener-deep-work-design.md` (§7 presets OWNER-CONFIRMED 8/21; §3.1 parity; §5.1 accdis; §10 wave table).
**Measured map (canonical, read before any task):** `.superpowers/sdd/wave6-maps/wave6-surface-map.md`.

## Global Constraints

- Inherit W5's Global Constraints verbatim (`docs/superpowers/plans/2026-08-22-screener-wave5-patterns-flow.md` §Global Constraints) — honest-None, one-writer, derived-not-typed probes, no partner files, never `git add -A`.
- Baseline at plan time: manifest **94 declared / 57 excluded**, `filters.meta()` **137**, bars 70, tableVersion 1, conformance `--check` MATCHES 77×579.
- Frontend tests: `npx vitest run <paths>` with the repo-default pool (both pool variants measured green 8/22; do not fight the config).
- Registry-starter specs are the publication surface for §7 numbers — `FILTERS[…]["presets"]` gains NOTHING in this wave (the preset-free rails stay binding).
- ⛔ Spec §7's `vol_nweek_low ≥ 2` is a UNIT ERROR against the shipped column (stores 20/15/10 bar-counts) — everywhere in this wave the threshold is **`gte 10`** ("2-week volume low or drier"). Never author the literal 2.
- Ruling (controller, recorded): "implied move present" = `{"key":"implied_move_pct","op":"gte","min":0}` — no new SQL operator this wave; `col >= 0` excludes NULL which IS presence. Revisit an `exists` op only if a second consumer needs it.
- Ruling (controller, recorded): the AST-starter catalogue (`starterScans.json`) is NOT extended with §7 entries this wave except T5's "Power Earnings Gap" promotion (a taxonomy-legal name). The naming question for the other five is an OWNER decision on the punch-list; registry lane delivers them meanwhile.

---

### Task T1: Manifest bump #2 — 5 Wave-1 promotions + the accdis exclusion (ONE governed decision)

**Files:**
- Modify: `app/src/components/chart/engine/ast/closedTable.json`
- Modify: `tests/fixtures/ast/scalars.json` (+5 cases, −1 case)
- Modify: `tests/test_ast_scalars.py`, `app/src/components/chart/engine/ast/freshness.test.js`, `parse.test.js` (pins)
- Modify: `tests/test_scalar_population_rail.py` (the `:221` accdis empty-on-this-box waiver entry — revisit per its own comment)

**Interfaces:**
- Promote 5 Wave-1 columns as full `market_cap`-shape scalars (`screener_rows`/`snapshot_date`/`nightly`): `dollar_vol_30d` (num), `close_cv_pct` (num), `vol_updown_ratio` (num), `vol_nweek_low` (num — sentence MUST state the 20/15/10 bar-count encoding: "the volume-dryness bar count (20 = 4-week low, 15 = 3-week, 10 = 2-week)"), `ema_stack_intact` (**bool**).
- EXCLUDE `accdis`: delete `scalars.accdis`, add `_scalars_excluded["accdis"]` with reason ≥20 chars naming the letter-grade reality and citing D4 ("holds letter grades A–E; declaring it num was the live two-lane defect; the enum filter is the honest surface — see 2026-08-23 Wave-6 T1").
- Pins after T1: declared **98** / excluded **53**; `parse.test.js` declared.size **168**; `scalars.json` cases **98** (remove the accdis case; its 5 new cases use plausible values — vol_nweek_low ∈ {20,15,10,None}, ema_stack_intact ∈ {0,1}); bars 70 + tableVersion 1 untouched.

- [ ] **Step 1:** the 6 manifest edits + fixture case moves + pin updates.
- [ ] **Step 2:** `python tools/ast_conformance.py --coverage` (98 scalar ALL COVERED, 168 disjoint) AND `--check` (MATCHES — scalar-only moves shift no bar digest; if red, the task is wrong, do not re-record).
- [ ] **Step 3:** `python -m pytest tests/test_ast_scalars.py tests/test_ast_conformance.py tests/test_screener_filters.py tests/test_scalar_population_rail.py -q` + from `app/`: `npx vitest run src/components/chart/engine/ast`.
- [ ] **Step 4:** Commit → `"ast: Wave-1 preset columns enter the vocabulary; accdis leaves it (94+5-1 -> 98; the letter-grade defect closes by exclusion)"`.

### Task T2: the accdis enum filter (the honest surface)

**Files:**
- Modify: `api/services/screener/filters.py` (remove the `:362-365` containment comment; add the control)
- Test: `tests/test_screener_filters.py`

**Interfaces:**
- `_enum("accdis", "Acc/Dis Grade", "fundamental", options_column="accdis")` — the exact shape the Wave-1 plan drafted (`2026-08-21-screener-wave1-backend-columns.md:1477`). Safe ONLY because T1 excluded the scalar (the yields↔control rail fires on declared scalars only) — **T2 hard-depends on T1**.
- meta() count 137→138.

- [ ] **Step 1:** failing test — `accdis` filter present, type enum, options served from the column; plus the two-lane rail still green (accdis unpaired-by-exclusion is legal).
- [ ] **Step 2:** implement; `python -m pytest tests/test_screener_filters.py tests/test_scan_screener_auth.py -q`.
- [ ] **Step 3:** Commit → `"screener: accdis ships as the enum it always was"`.

### Task T3: six flagship presets as registry starters

**Files:**
- Modify: `api/services/screener/saved_screens.py` (`starters()`)
- Test: `tests/test_screener_saved.py`

**Interfaces (exact specs — §7 numbers as approved, units corrected):**
```python
{"id": "starter_momentum_leaders", "name": "Momentum Leaders",
 "spec": {"filters": [
   {"key": "rs_rank", "op": "gte", "min": 90},
   {"key": "adr_pct", "op": "gte", "min": 4},
   {"key": "dollar_vol_30d", "op": "gte", "min": 20_000_000},
   {"key": "price", "op": "gte", "min": 5},
   {"key": "above_50sma", "op": "eq", "value": 1}],
  "view": "technical", "sort": {"key": "rs_rank", "dir": "desc"}}},
{"id": "starter_pullback_20ema", "name": "Pullback to the 20EMA",
 "spec": {"filters": [
   {"key": "rs_rank", "op": "gte", "min": 80},
   {"key": "pct_vs_ema20", "op": "between", "min": -2, "max": 2},
   {"key": "ema_stack_intact", "op": "eq", "value": 1},
   {"key": "vol_nweek_low", "op": "gte", "min": 10}],
  "view": "technical", "sort": {"key": "rs_rank", "dir": "desc"}}},
{"id": "starter_tight_base", "name": "Tight Base Near Highs",
 "spec": {"filters": [
   {"key": "dist_52w_high_pct", "op": "gte", "min": -8},
   {"key": "close_cv_pct", "op": "lte", "max": 2.5},
   {"key": "vol_updown_ratio", "op": "gte", "min": 1},
   {"key": "rs_rank", "op": "gte", "min": 70}],
  "view": "technical", "sort": {"key": "dist_52w_high_pct", "dir": "desc"}}},
{"id": "starter_gap_movers", "name": "Gap Movers",
 "spec": {"filters": [
   {"key": "gap_pct", "op": "gte", "min": 8},
   {"key": "vol_ratio", "op": "gte", "min": 3},
   {"key": "market_cap", "op": "gte", "min": 300_000_000}],
  "view": "momentum", "sort": {"key": "gap_pct", "dir": "desc"}}},
{"id": "starter_52w_breakout", "name": "52-Week Breakout on Volume",
 "spec": {"filters": [
   {"key": "new_52w_high", "op": "eq", "value": 1},
   {"key": "vol_ratio", "op": "gte", "min": 1.5},
   {"key": "dollar_vol_30d", "op": "gte", "min": 10_000_000}],
  "view": "technical", "sort": {"key": "vol_ratio", "dir": "desc"}}},
{"id": "starter_earnings_momentum", "name": "Earnings Momentum",
 "spec": {"filters": [
   {"key": "days_to_earnings", "op": "between", "min": 0, "max": 7},
   {"key": "implied_move_pct", "op": "gte", "min": 0},
   {"key": "rs_rank", "op": "gte", "min": 70}],
  "view": "overview", "sort": {"key": "days_to_earnings", "dir": "asc"}}},
```
- The four existing starters stay byte-identical (`_resolve_starter_screen` grounding — a retuned number reds `test_starter_library.py:500` by name).
- ⚠️ Before pinning the two `dollar_vol_30d` literals, MEASURE the column's unit (raw dollars vs millions) from one prod/snapshot row + the filter's `unit` metadata; if it is not raw dollars, scale the literals and record the measurement in the report.
- Views named must exist in `filters.VIEWS` (verify `momentum`/`technical`/`overview` keys; substitute the nearest real view if one is absent and say so).

- [ ] **Step 1:** failing tests — a starters-are-valid-specs rail: every starter's every `key` exists in `FILTERS`, every `op` valid for its control type, every bool filter uses eq/1, every named `view` exists, ids unique and string-typed; plus explicit presence of the six new ids.
- [ ] **Step 2:** implement; `python -m pytest tests/test_screener_saved.py tests/test_screener_api.py tests/test_concept_vocabulary.py tests/test_starter_library.py -q` (the last two prove grounding didn't break).
- [ ] **Step 3:** one member-path receipt: POST `/api/screener/scan` with each spec against the local sandbox — every one returns 200 with a coverage line (hit counts may be 0 on stale local data; the receipt is validity, not yield).
- [ ] **Step 4:** Commit → `"screener: the six flagship presets ship as registry starters (§7 numbers as approved; vol_nweek_low unit corrected to the bar-count encoding)"`.

### Task T4: "Power Earnings Gap" joins the AST starter catalogue

**Files:**
- Modify: `app/src/components/chart/engine/ast/starterScans.json` (move PEG from `_ungrounded` to `starters`)
- Test: rides `tests/test_starter_library.py` + `criteria.test.js:1054` + `pcf.test.js:640` (no new files)

**Interfaces:**
- Source: `days_to_earnings >= 0 && days_to_earnings <= 7 && implied_move_pct >= 0 && rs_rank >= 70` — every literal grounded in `starter_earnings_momentum` (T3). Grounding: `[{"kind": "starter_screen", "screen": "starter_earnings_momentum"}]`.
- Frozen canonical tree via the same tooling that built "Classic Flag/Pullback" (derive with the repo's canonicalizer — `user_definitions.assert_canonical` must accept it; hash derived, never typed).
- "Power Earnings Gap" IS a `SETUP_GROUPS` name (taxonomy-legal — the rail at `:746` passes).
- **T4 hard-depends on T3** (grounding target) and on T1 only via B1 (already landed: both columns declared).

- [ ] **Step 1:** author entry; run `python -m pytest tests/test_starter_library.py -q` — the previously-red `undecided`/`_ungrounded` state for PEG resolves to a declared starter passing all 26 rails.
- [ ] **Step 2:** from `app/`: `npx vitest run src/components/chart/builder src/components/chart/engine/ast` (round-trip + native-dialect + catalogue tests).
- [ ] **Step 3:** Commit → `"ast: Power Earnings Gap becomes the second grounded starter (grounded in the Earnings Momentum registry starter)"`.

### Task T5: the _ungrounded truth pass (30 reasons re-adjudicated)

**Files:**
- Modify: `app/src/components/chart/engine/ast/starterScans.json` (`_ungrounded` reasons ONLY — no new starters beyond T4's)
- Test: `tests/test_starter_library.py` (reasons-shape rails already exist; add ONE rail: every reason that cites a missing column names a column absent from `closedTable.json.scalars` — mechanical truth, AST-derived)

**Interfaces:**
- Rewrite every stale reason to current truth (map lane-1 gap-6 has the survey): "HVC" cites the offset gap that closed `291c9d8a` + `hvc_52w` exists — reason becomes the REAL remaining blocker or, if none, flag to the controller as promotable (do NOT promote in this task); "Remount"/"Kicker Candle"/"Oops Reversal"/"Red to Green" reasons updated for the offset node's existence; VCP/Flat Base/Launchpad/Go Signal/News Gappers reasons restated against the 98-scalar table.
- Reasons stay ≥20 chars, distinct (the NOT-ONE-SENTENCE rail), and truthful against the post-T1 manifest.

- [ ] **Step 1:** the new mechanical-truth rail (red against today's stale reasons).
- [ ] **Step 2:** rewrite; `python -m pytest tests/test_starter_library.py -q` + the ast vitest sweep.
- [ ] **Step 3:** Commit → `"ast: ungrounded reasons tell the current truth (offset node + 98-scalar table); promotable candidates flagged, not promoted"`.

### Task T6: Finviz parity — transactions pair + option/short flags (+ the parser debts)

**Files:**
- Modify: `api/services/screener/finviz_universe.py`
- Modify: `api/services/screener/snapshot_db.py` (4 new columns: `insider_trans_pct`, `inst_trans_pct` REAL; `optionable`, `shortable` INT)
- Modify: `api/services/screener/filters.py` (+4 controls: two `_open_range` preset-free; two bool)
- Modify: `app/src/pages/screener/columnDefs.js` (+4 entries, em-dash nulls)
- Modify: `app/src/components/chart/engine/ast/closedTable.json` (**4 `_scalars_excluded` entries** — R8: "awaiting first nightly fill; promote after a receipt shows population", NOT declared)
- Tests: `tests/test_screener_wave2_finviz.py` + `tests/test_screener_filters.py` fixtures

**Interfaces:**
- **CONTROLLER PRE-GATE — DONE 8/23 (owner-browser, live):** ids VERIFIED: `27` = Insider Trans · `29` = Inst Trans · `80` = Optionable · `83` = Shortable (71-94 walk also mapped 84 = Short Interest, 85 = Float % — see the note below). Page headers are DISPLAY forms; the export serves fuller names — `_HEADERS` guesses "Insider Transactions"/"Institutional Transactions"/"Optionable"/"Shortable" and the first pull's `missing_headers` receipt adjudicates spelling (a miss degrades honestly by construction).
- **Recorded correction:** "Float %" DOES exist at classic `c=85` — the 8/22 "not a Finviz column" conclusion overreached its 125-153 scope. Ruling: the DERIVE fix stands (single-authority beats a third column over the same fact); module docstring corrected same day. Do NOT re-pin float_pct to 85.
- Transactions pair: signed % columns → `_PCT_COLUMNS` membership; NOT raw-millions.
- Option/short flags: Finviz serves "Yes"/"No" → new `_BOOL_COLUMNS` set + a boolean branch in the parse path (Yes→1, No→0, else None); columns land in `snapshot_db._INT`.
- **Parser debts (same file, same task):** delete the dead `is_pct` parameter from `_parse` (AST-verified unused) OR make it real — pick one, say which; add the bare-percent guard: a `_PCT_COLUMNS` member whose text carries no `%` suffix parses the bare number but is counted in a new receipt field `bare_pct` (honest disclosure, no magnitude guessing).
- Receipt gains the 4 new headers; `missing_headers` covers them name-for-name.
- One-writer: this module is the sole writer for all 4 (the population rail derives from real readers and will see it).

- [ ] **Step 1:** failing tests — parse fixtures for signed %, Yes/No→1/0/None, bare-percent counted; schema membership; 4 controls preset-free/bool; columnDefs entries.
- [ ] **Step 2:** implement; `python -m pytest tests/test_screener_wave2_finviz.py tests/test_screener_filters.py tests/test_screener_wave2_schema.py tests/test_scalar_population_rail.py -q` + `tools/screener_wave4_smoke.py` + `tools/screener_wave5_smoke.py` (meta count moves 138→142 — B3's smoke pin must move WITH this task).
- [ ] **Step 3:** Commit → `"screener: finviz transactions pair + option/short flags (verified ids; new bool parse class; bare-percent receipt)"`.
- Post-ship: after the first nightly fill receipt, a one-line follow-up bump promotes the two numerics (bools promote as bool) — recorded on the punch-list, not this wave's scope.

### Task T7: polish batch (screener tree — runs LAST, after T1–T6 land)

**Files:**
- Modify: `app/src/pages/screener/screenSharing.mount.test.jsx` (6 prose strings), `app/src/pages/screener/ScreensManager.test.jsx` (1 string + the dual-testid suffix), `app/src/pages/screener/ScreensManager.jsx` (testid suffix `screens-manager-error--screens` / `--scans`), `app/src/pages/screener/hooks/useScreenSpec.js` (`applySpec` copies `sort`/`columns`), `api/services/screener/scan_store.py:412` (annotate `latest_coverage_for(def_hashes: list[str] | tuple, tf: Any) -> dict`)
- Add: a minimal `title`-attribute surface for `columnDefs.desc` on `VirtualResults` header cells (the B2 follow-up — desc stops being dead metadata; one attribute, no tooltip framework)

- [ ] **Step 1:** each edit + its existing test file run (`ScreensManager.test.jsx`, `screenSharing.mount.test.jsx`, `Screener.scanmount.test.jsx`, `useScreenSpec` tests, `VirtualResults` test).
- [ ] **Step 2:** `python -m pytest tests/test_screener_wave4_scan_store.py -q` (or the scan_store test file that exists — derive, don't guess) + from `app/`: `npx vitest run src/pages/screener`.
- [ ] **Step 3:** Commit → `"screener: polish batch — prose supersessions, split error testids, applySpec copies, coverage annotation, desc surfaces as title"`.

### Task T8: Wave-6 verification + ship gate — CONTROLLER-HELD

- [ ] Extend `tools/screener_wave5_smoke.py`'s Stage-B section pin 137→142 rides T6 (already in its step 2); run the full gate set: both conformance CLI gates, backend screener sweep (`pytest tests/ -k "screener or finviz or ast_scalars or starter"`), frontend `npx vitest run src/components/chart/engine/ast src/pages/screener src/components/chart/builder`, `npm run build`.
- [ ] Ship after-hours per the standing rules; artifact-verify: meta 142 via authed probe, starters list carries the six new ids, accdis filter type enum.
- [ ] Next-morning receipts: the 05:00 sweep over a formula naming a T1-promoted scalar; `bare_pct` receipt value from the first finviz pull; the 4 parity columns' population counts (promote-or-wait decision).

## Parallelism map
- T1 → T2 (hard dep) · T3 independent of T1/T2 → T4 (hard dep on T3) → T5 (after T4 so PEG's move is out of `_ungrounded` first).
- T6 independent of T1–T5 EXCEPT the controller id pre-gate; runs any time after it.
- Lanes: {T1,T2} manifest+filters-accdis · {T3,T4,T5} starters · {T6} finviz — disjoint files except `filters.py` (T2 vs T6: serialize T2 before T6) and `closedTable.json` (T1 vs T6 exclusions: serialize T1 before T6).
- T7 strictly last (test-file churn); T8 controller.

## Self-review notes (author)
- Spec coverage: §7 all six (T3) + AST half where taxonomy-legal (T4) + naming decision recorded as owner item; §5.1 accdis (T1+T2); §3.1 parity subset with ids verified-first (T6); §10 polish (T7). Deliberately absent: `exists` operator (ruled), AH columns (ruled out by spec), taxonomy additions (owner), HVC promotion (flagged by T5, not shipped — one new AST starter per wave keeps the catalogue reviewable).
- Placeholder scan: none — every threshold literal is written, both unit traps (vol_nweek_low bar-counts, dollar_vol_30d measure-first) are explicit.
- Type consistency: T4's grounding id matches T3's `starter_earnings_momentum`; T6's meta count 142 = 137 + accdis(T2) + 4 = 142 ✅.
