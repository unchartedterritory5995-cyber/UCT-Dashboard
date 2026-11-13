# UCT Relative Strength: Phase 3 / Phase 4 engineering map

Date: 2026-11-08 (read 2026-11-07). Author: tech lead, UCT-Dashboard. Status: build-ready map for the parallel agents; not a spec.
Plan it maps: `docs/superpowers/specs/2026-11-05-uct-relative-strength-indicator-design.md` (v4, with the §20/§20b/§20c build records): §5 presets, §6, §7.13-7.16 and the v3 §7.20 anchor, §10, §11, §12.4, §15, §17. Where v4 says "as v3", the v3 text (§7.11-7.13, §7.20, §6.11, §18) is quoted from the plan repo at commit `efab28c613`.
Code baseline: worktree `C:/Users/pgosz/uct-worktrees/rs-golive`, branch `feat/uct-rs-golive` at `4c6d4ace6e` (master's RS content: Phase 1, 2a, 2b and the delegated-decision units merged). Every `file:line` below is from that tree unless the path starts with `docs/research` or names the plan. Production facts taken as given: `RS_V2_ENABLED`, `RS_HISTORY_ENABLED` and `RS_EVIDENCE_ENABLED` are ON, and `rsLine` serves `compute.rev` 3 with 22 wire columns.
Sources of truth: my own reads of the files cited, plus three read-only reconnaissance passes (education surfaces; Study, Compass and lists; Compare, scatter, anchor and placement). I spot-checked their load-bearing citations line by line before using them. Anything I did not read is marked UNVERIFIED.

The format follows the Phase 2 map: facts first, then units with their dependencies, then waves. The brief asked for six sections, and they are §1-§6 below. The audit of the plan's assumptions sits inside §1 (§1.12), so nobody has to re-derive it.

---

## 0. Summary

Phase 3 is mostly new maths and new controls on a contract that is already generic. Reading the code forces seven changes to the plan before any unit starts.

1. **A rotation graph already ships.** The UCT Terminal's `RRG` function plots RS-Ratio against RS-Momentum with tails (`app/src/pages/terminal/panels/RrgPanel.jsx:1-277`; maths in `relativeMath.js:163-200`). Its formula is `RRG_METHOD = { ratioLen: 10, momLen: 5, tail: 8 }`, an SMA ratio of ratios. That is not the plan's §7.14 formula, which takes an EMA trend, normalises it by its 252-bar sigma and clips it to 80-120. Building the Rotation preset to §7.14 would put two different "RS-Ratio" numbers in members' hands. There must be one formula, pinned in both lanes by one fixture (§5 D1).
2. **The "Compare panel" is real, but it cannot draw a scatter.** `app/src/pages/charts/CompareSymbolsPanel.jsx` (295 lines) is a desktop modal. It overlays % performance lines and resolves theme, sector and industry groups (`:13-17`). The rotation view becomes a Rotation tab in this panel that reuses the Terminal's graph, not a third implementation.
3. **The `string` input type can be declared, but nothing renders or validates it.**
   - `defSchema.INPUT_TYPES` lists `string` (`engine/defSchema.js:158-160`) and checks only its `typeof` (`:1822-1824`).
   - `fieldFromInput` returns `null` for it (`components/chart/indicatorRegistry.js:233-266`), so neither the dialog nor the phone sheet has a text control.
   - The server's `resolve_inputs` passes any type it does not know through unchanged (`api/services/signature/registry_defs.py:381-417`).

   The custom benchmark therefore needs a generic text control and a server-side string branch first. `registry_defs` cannot call `_sym_or_422`, because that function lives in the router (`api/routers/signature.py:181-195`); the row declares the symbol pattern instead.
4. **The anchor already exists; only the click is missing.** The Checks anchor, which is the benchmark's lowest close of the last 20 sessions, shipped in 2a (`signature.py:1808-1831`, `_RS_ANCHOR_WINDOW = 20` at `:1126`, readout row `checkAnchor`). What is missing:
   - No chart has a mode for picking a point and writing it to an input.
   - `time` inputs are reserved outside runtime documents (`defSchema.js:165-174`).
   - The server has no branch for time inputs.

   The anchor date becomes a `string` input in `YYYY-MM-DD` form. A one-shot pick mode writes it, built on the existing `onChartTap` click (`components/StockChart.jsx:2912`, handler `:18353`).
5. **One JS definition reaches every member at merge, so keeping new work dark needs a client gate.** The client draws whatever columns a server sends (`engine/serverCompute.js:420-438`), and it cannot see a server flag. With `RS_V2_ENABLED` already on, merging the Rotation, Quality and VARS presets would show members controls that draw nothing. The fix is a generic `requiresServer` marker. The client reads `/api/signature/definitions`, which is already published but read by nobody (constant at `serverCompute.js:36`). It hides any control, enum option or preset carrying the marker until the live server row declares it.
6. **The `bars_rs` screener step is gated only by `RS_V2_ENABLED`** (`api/services/screener/snapshot_builder.py:87-97`, `:590`), and that flag is on. Any new columns added to `rs_columns` would light up on the first 03:00 build after merge. `rrg_quadrant`, `clenow_score` and `vars_state` get their own per-call gate.
7. **A `compute.rev` bump costs saved alerts nothing.**
   - RS alerts compute directly from `relative_strength.compute_phase1_columns` and `compute_mansfield_columns` (`api/services/alert_rs_series.py:665-695`), never from the wire.
   - Nothing reads `alert_rev_migration.ADDRESS_REVS` for a builtin at runtime. The only caller of `migrate_bindings_to_rev` is `api/services/user_definitions.py:3205`.
   - A binding that was never migrated is never suppressed (`indicator_alert_evaluator.py:2858-2865`).

   Rev 4 behind a new import-time flag, `RS_V3_ENABLED`, follows the RS_V2 precedent exactly. No binding migrates, provided Phase 3 leaves those two functions' outputs byte-identical, and a rail enforces that.

Phase 4 is teaching work on surfaces that mostly do not exist yet. Three plan items close without code:
- **Learn links** shipped in 2a (`app/src/lib/deskVideoHref.js:32-41`, six lessons at `nativeRegistry.js:3915-3922`). The Desk parameter is `v`; there is no `video` parameter, and none is needed.
- **The premium preview** is moot, because there is no free tier. `FREE_PAGES = []` (`app/src/constants/freePages.js:21`), unpaid users are redirected (`app/src/components/AuthGuard.jsx:167-171`), and every signature route requires `require_paid` (`signature.py:175`).
- **The name "Leadership"** is already taken by the UCT 20 list (`/api/leadership` at `api/routers/engine_data.py:121`; `api/services/engine.py:793`; `components/tiles/LeadershipTile.jsx`). The RS lists are therefore named RS Leaders and RS Emerging.

The rest of Phase 4 (lists, tour, RSI row, glossary, Compass tools, Study drafts, walkthrough capture) is 11 units.

Totals:
- **Phase 3:** 14 units, about 11 agent-days, six waves.
- **Phase 4:** 11 units, about 8 agent-days, five waves.

Each wave has at most three units, and units in the same wave touch disjoint files.

---

## 1. Current-state facts each unit depends on

### 1.1 The server row, the flag and the wire contract (units 3-05, 3-06)

- F1. `RS_V2_ENABLED` is read once at import (`registry_defs.py:127`), and `_RS_LINE = _rs_line_row(RS_V2_ENABLED)` (`:300`). The v3 shape:
  - is version 3 with `compute.rev` 3 (`:221-222`, `:278-279`);
  - declares `payload_keys: ["payload"]` (`:291`).
- F2. The 22 wire columns are `relative_strength.PHASE1_COLUMNS` (18) plus `RS_PHASE2A_WIRE_COLUMNS`, which holds `mansfield`, `mansfieldCrossUp`, `mansfieldCrossDown` and `dotMansfieldCross` (`:223-225`, `:271-275`).
- F3. `wire_columns` requires the provider's keys to EQUAL the declared list (`:461-468`). Any new column therefore changes the declared list, which is why a flag has to choose the row shape (the RS_V2 precedent, comment at `:120-126`).
- F4. What `resolve_inputs` does with each kind of input:
  - `enum`: refuses a value outside the vocabulary (`:399-404`);
  - `int`/`float`: clamps (`:405-410`);
  - `bool`: coerces (`:411-415`);
  - any other kind: stored unchanged (`:416`);
  - undeclared keys: dropped (docstring `:383-388`).
- F5. The benchmark vocabulary is derived, never typed out again: `RS_LINE_BENCHMARKS = rs_benchmark_menu(order, LITERAL + AUTO)` (`:116-117`; `rs_benchmarks.py:32-33`). The one-list rail compares it with the JS enum (`tests/test_rs_columns_provider.py:126-128`, `:517-522`).
- F6. The rev rails:
  - JS `fn: 'rsLine', rev: N` must equal `_rs_line_row(True)["compute"]["rev"]` and `ADDRESS_REVS["rsLine"]` (`tests/test_rs_columns_provider.py:105-111`);
  - `test_the_python_rev_table_matches_the_js_registry` (`tests/test_alert_rev_migration.py:659-686`);
  - `meta.serverInputs` is compared against the row's input keys (`test_rs_columns_provider.py:550-557`).
- F7. `serve()` copies `rev` into every envelope (`registry_defs.py:551-560`). The provider's cache key starts with the rev and the payload shape (`signature.py:930-934`; `_RS_PAYLOAD_SHAPE = 3` at `:1139`), so a rev or shape bump is a cold cache on its own.
- F8. The flag ledger has rows for all four RS flags (`docs/feature_flags.json:3122-3140`). `RS_V2_ENABLED` is still recorded as `"status": "dark"` (`:3138`) even though production has it on. The ledger test (`tests/test_feature_flag_ledger.py`, per the Phase 2 map) requires an entry and a note, not an accurate status.

### 1.2 The provider (unit 3-06)

- F9. `_rs_line_provider` (`signature.py:876-1105`) is built from:
  - `resolve_phase1_inputs` (`relative_strength.py:345`);
  - toggles from `_RS_TOGGLE_DEFAULTS` (`signature.py:1110-1113`);
  - the bar count from `_rs_bars_count`: lookback + 600 on daily, lookback + 200 on weekly, 400 intraday (`:1923-1933`);
  - the benchmark from `rs_benchmarks.resolve_benchmark(..., fetch_bars=_fetch_bars_for_tf)` (`:944`).
- F10. The states are `same-symbol | no-benchmark-bars | no-bars | intraday | short-history | ok` (`:952-955`).
  - Intraday blanks every event and dot column (`:983-991`).
  - Mansfield view blanks the ratio family through `_RS_MANSFIELD_VIEW_BLANKS` (`:1142-1144`, applied at `:1016-1018`); event columns stay.
- F11. Regime, sensitivity and checks are computed on DAILY only (`:1024-1034`). The payload keys are `benchmark, legend, lastRsHigh, history, inputs, intraday, state, rating, mansfield, regime, sensitivity, checks, theme, evidence` (`:1045-1076`).
- F12. `_rs_checks` takes the anchor from the benchmark's lowest aligned close in the last 20 bars (`:1808-1831`). It returns `anchorTime` and `barsAgo`, and leaves the check undecided when the low is today (`:1814-1824`).
- F13. Bars come only from the web pod's local `bars.db` (`_fetch_bars_for_tf`, `:823-841`). A symbol outside the prewarm set has no rows until a chart or a job warms it.
- F14. `_sym_or_422` (`:181-195`), with `_SYM_RE = ^[A-Za-z][A-Za-z.\-]{0,9}$` (`:69`), validates only the chart's own `sym` on each route. `GET /columns` calls it and then `registry_defs.serve` (`:1976-2003`).
- F15. `_rs_theme(groups)` (`:1491-1510`) returns the sector and industry from `industry_map`. It is NOT a Theme Tracker theme.

### 1.3 Benchmarks (unit 3-04)

- F16. `resolve_benchmark`:
  - raises `ValueError` for any value outside `LITERAL + AUTO` (`rs_benchmarks.py:219-223`);
  - returns `{requested, resolved, label, fallback, bars}` (`:201-209`);
  - sends an ETF to SPY, with a reason (`:233-240`, `:252-254`).
- F17. The alert lane takes its benchmarks from the chart's list minus INDUSTRY (`alert_rs_series.py:122-123`). A `CUSTOM` option added to the chart's vocabulary would therefore reach the alert popover unless it is excluded by name.

### 1.4 The JS definition (units 3-01, 3-02, 3-08)

- F18. `RS_LINE_RAW` (`engine/nativeRegistry.js:3881-4289`):
  - version 3, `compute: { kind: 'server', fn: 'rsLine', rev: 3 }` (`:3884-3885`);
  - `meta.serverInputs`, 13 keys (`:3904-3906`);
  - `groupsCollapsed: ['Line', 'New highs']` (`:3911`);
  - `meta.learn`, six lessons (`:3915-3922`);
  - presets `classic`, `classicWeekly`, `phase`, `trend`, `trendWeekly`, `stress` (`:3940-3979`);
  - `placement: { target: 'pane', pane: { height: 0.20 }, axis: 'hidden' }` (`:3982`).
- F19. The reading switch is a bool, `showMansfield` ("Mansfield view" in the Line group), with the `activeWhen` pairs `RS_RATIO_VIEW` and `RS_MANSFIELD_VIEW` (`:3879-3880`). The plan's "Method" group was folded into Line and New highs in 2a. No `rrgWindow`, `clenowWindow`, `atrLength` or `varsLookback` input exists.
- F20. A stored instance that carries an input key the definition no longer declares is REFUSED, not ignored (`engine/instances.js:708-720`). A declared input therefore can never be removed or renamed without a migration. The engine has no input-migration mechanism (a grep of `engine/*.js` for migrate, alias or renamed inputs found none), and the schema has no hidden-input field.
- F21. The readout contract (`nativeRegistry.js:4172-4288`):
  - `readout[]` rows carry `source` (`'scalar:<path>'` or `'input:<key>'`), `format`, `when`, `detailOf`, `note`, `muted` and `chip`;
  - a `card` carries `what`, `origin`, `evidence`, `evidenceSource` and `learn`;
  - the provider rail resolves every `scalar:` path against a real provider payload (comment at `:4166-4171`).
- F22. Phases 1 and 2 never needed client-side dark-ness:
  - the client draws whatever columns arrive (`serverCompute.js:420-438`);
  - `scalarsFor` returns whatever payload arrived (`:446-460`);
  - `revMismatch` (`:187-190`) has no member-facing consumer (a grep found none outside `serverCompute.js` and tests).
- F23. `SERVER_DEFINITIONS_PATH = '/api/signature/definitions'` (`serverCompute.js:36`) is declared but fetched by nobody. The route returns every row as data, behind `require_paid` (`signature.py`, `server_definitions`).

### 1.5 Inputs, fields and controls (units 3-01, 3-02)

- F24. The input type lists in `defSchema.js`:
  - `INPUT_TYPES = int, float, bool, enum, string, color, source` (`:158-160`);
  - `RESERVED_INPUT_TYPES` includes `time` and `symbol` (`:165-167`);
  - `RUNTIME_INPUT_TYPES = ['time', 'session']`, allowed only when `compute.kind === 'runtime'` (`:174`).

  `symbol` stays reserved (C-A3; see the comment on the benchmark input in `nativeRegistry.js`).
- F25. The `string` branch of `validateInputValue` checks only `typeof d !== 'string'` (`defSchema.js:1822-1824`). There is no pattern and no length limit.
- F26. Which input types have controls:
  - `fieldFromInput` maps color, bool, enum, source, int/float, time and session, and returns `null` for anything else (`indicatorRegistry.js:233-266`);
  - the dialog renders number, select, datetime, session, toggle and color (`components/chart/IndicatorSettingsDialog.jsx:476-557`);
  - the phone sheet renders number, color, toggle and select (`pages/charts/mobile/MobileIndicatorSheet.jsx:452-460`).

  No native definition declares a `string` input today.
- F27. `coerce` already accepts a string for any non-numeric type (`engine/instanceControls.js:232-257`), so `setInstanceInput` can write a string input with no change.
- F28. `enumerationSites.test.js` asserts that a generated control reaches every declared input (comment at `indicatorRegistry.js:228-231`). A `string` input with no renderer, or a legacy input that is never rendered, turns it red.

### 1.6 Placement (unit 3-07)

- F29. In `resolvePlacement` (`engine/placement.js:443-787`), `target === 'price'` always answers with the candles' own scale: `scaleId: MAIN_PRICE_SCALE_ID`, `scaleOptions: null`, `autoscale: 'exclude'` (`:488-502`). An RS ratio near 0.25 moved to the price pane today lands on a $150 axis and is invisible.
- F30. An instance's stored target wins over the definition's, and an instance without one follows the definition (`:461-467`). Changing `rsLine`'s `placement.target` would move every saved RS instance.
- F31. Production runs in `'panes'` mode (`engine/paneLayout.js:121,137-139`, per the reconnaissance).
  - `'bands'` mode already draws an indicator in pane 0 on an overlay scale named after it (`placement.js:759-786`).
  - The pool turns any `scaleId` string into a `priceScaleId` (`engine/pool.js:671-695`).
  - The only own-scale series on pane 0 today are built by hand outside the engine, such as the legacy compare series with `priceScaleId: 'compare'` (`StockChart.jsx`, `:14221-14242` per the reconnaissance; line range UNVERIFIED).
- F32. `placement.axis: 'hidden'` is honoured only in the own-pane branch (`placement.js:709-731`); `HIDDEN_AXIS_SCALE_ID = 'uct-axis-hidden'` (`:246`).

### 1.7 Screener (units 3-10, 3-11)

- F33. `rs_columns.COLUMNS` holds the ten bar-derived columns (`api/services/screener/rs_columns.py:50-61`). `rs_benchmark_agree` compares SPY with RSP only (`:60`), not three benchmarks.
- F34. The step runs only under `rs_v2_enabled()` (`snapshot_builder.py:87-97`, `:590`). It costs about 55-75 ms of CPU per ticker on the web pod (docstring `:90-93`), and its time goes into the build receipt (`:607-610`).
- F35. Text columns live in `_TEXT` (`snapshot_db.py:216-228`), which already holds `rs_line_trend` and `theme`. There is no `above_sma200` column, but there is `pct_vs_sma200` (`snapshot_db.py:70`; `technicals.py:737`).
- F36. The AST partition pin is `(149, 107)` (`tests/test_ast_scalars.py:343`; the JS mirror is `engine/ast/freshness.test.js:77,160`). The 2a history columns first landed excluded with dated reasons and were promoted after the first fill (the R8 pattern, `test_ast_scalars.py:303-342`).

### 1.8 Rotation surfaces (unit 3-12)

- F37. `RrgPanel.jsx`:
  - universe: the 11 SPDR sectors, a list of 2-12 names, or one name among the sectors (`:37-45`; `RRG_MAX = 12` at `:31`);
  - cadence: weekly by default, daily optional (`:49-54`);
  - drawing: a hand-written SVG graph with quadrant labels, tails and a table (`:117-156` and `:223-253`, per the reconnaissance);
  - it prints that the formula is UCT's approximation (`:13-14`).
- F38. `relativeMath.js` holds `RRG_METHOD = { ratioLen: 10, momLen: 5, tail: 8 }` (`:169`), `quadrantOf` (`:173-177`) and `rrgPath(symSeries, benchSeries, method)` (`:181-200`). Closes come from `/api/bars` through `useCloses(syms, tf)` (`panels/useCloses.js:78`). Tests: `relativeMath.test.js`, `relativeMath.accuracy.test.js`, `RrgPanel.labels.test.js`, `comparePanels.test.jsx`.
- F39. `CompareSymbolsPanel.jsx` is a centred modal over the active chart that takes tickers and groups (theme, sector, industry) (`:1-17`). `pages/charts/ChartsWorkspace.jsx:3918` mounts it after the phone branch has returned, so it is desktop only (`hub/sections/chartSection.js:126`).
- F40. No server code computes RRG, Clenow or VARS. A grep of `api` and `app/src` for `rrg_quadrant|clenow_score|vars_state|def .*clenow|def .*rrg` found nothing outside the Terminal's client-side maths. `indicator_compute` has `compute_sma`, `compute_ema` and `compute_atr` (`api/services/indicator_compute.py:92,144,652`).

### 1.9 Alerts and revisions (units 3-05, 3-06)

- F41. `ADDRESS_REVS = {"vwap": 2, "rsLine": 3}` (`alert_rev_migration.py:72-82`) and `ADDRESS_BASE_DEFINITION = {"rs_line": "rsLine"}` (`:94-96`). `compute_rev(address)` reads through both (`:99-110`).
- F42. `migrate_bindings_to_rev(address, new_rev, *, notify, ...)` (`:299-...`) is called only from `user_definitions.py:3205`, for member-authored definitions. No boot job, deploy hook or script runs it for a builtin bump (grep of `api`, `tools` and `scripts`).
- F43. `consume_if_suppressed` suppresses only a binding that has a migration record (`indicator_alert_evaluator.py:2858-2865`, `:2900`). An RS alert armed at rev 3 therefore keeps its `last_value` and its cycle across a rev-4 deploy.
- F44. RS alert maths: `alert_rs_series.build_rs_series` picks one column out of `rsm.compute_phase1_columns` or `rsm.compute_mansfield_columns` (`:665-695`). Alerts run on `RS_ALERT_TFS = ("D", "W")` (`:102`), across twelve `rs_line.*` addresses (2b-05). A Phase 3 change that leaves those two functions byte-identical cannot move a saved alert.

### 1.10 Phase 4 surfaces (units 4-01 to 4-10)

- F45. Library search:
  - `matches(row, q)` is a plain substring test over name, shortName, id, category and tags (`components/chart/IndicatorLibraryDialog.jsx:99-108`). `ChartSettingsIndicators.jsx` shares it (import at `:88`).
  - Results are grouped by category in a fixed order: Trend, Momentum, ..., Relative Strength, Levels (`technicalCategories.js:26-34`).
  - So "RS" shows RSI (under Momentum) above UCT RS, and **"RSI" does not show UCT RS at all**.
  - No disambiguation or editorial row exists. The nearest seam is the host's `extraRows` prop (`IndicatorLibraryDialog.jsx:244-247`, `:339`).
  - The library's tier badge is text only (`:596-598`), and its comment "every native is free today" (`:585-587`) is out of date.
- F46. Tours:
  - The Notebook tour engine (`pages/journal-2-0/components/notebook/onboarding/tourRegistry.js`, `GenericTourEngine.jsx`) stores seen state in the `notebook_tours` preference (`tourSeenState.js:20`). It starts only on `START_ROUTES` (`tourRegistry.js:68-73`), which are Notebook and Journal pages.
  - `/charts` is viewport-locked (`firstRun/viewportLockedRoutes.js:22`); there, the first-run slot waits for the next ordinary page.
  - No seam fires when an indicator is added. Adds go through `toggle` and `addAnother` (`IndicatorLibraryDialog.jsx:146-212`, `:445-456`), neither of which has a callback.
  - `HubCoachMark.jsx` stores its dismissal on the server (`hub/HubCoachMark.jsx:6-9`).
- F47. Learn:
  - `deskVideoHref(id, t)` emits `/desk?section=videos&v=<id>[&t=<n>]`, adding `t` only when it is at least 1 (`lib/deskVideoHref.js:32-41`);
  - `RS_LEARN_VIDEOS` (`:69-100`) and `learnHref(key)` (`:108-114`);
  - the consumer is `VideosSection.jsx:287-295`;
  - rails: `tests/fixtures/indicators/rs_learn_videos.json` and `tests/test_rs_learn_seed.py`. Every id must be in `education_seed.SEED_VIDEOS`, which `tools/gen_education_seed.py` generates from the workshop sheet.
- F48. Tiers: `FREE_PAGES = []` (`constants/freePages.js:21`); `AuthGuard` redirects when `!isPaid && !isFreePage` (`components/AuthGuard.jsx:167-171`); every signature route is behind `require_paid` (`signature.py:175-178`).
- F49. There is no glossary route or component. Public method pages already exist at `/methodology` and `/methodology/measured-edge` (`App.jsx:500,503`). Route rails a new page must pass:
  - `components/navGroups.route.test.jsx` (nav targets only);
  - `firstRun/viewportLockedRoutes.test.js` (only if the page is added to `NAV_ITEMS`);
  - `components/screener/reachable.test.js` (reachability).
- F50. Compass. No tool reads RS, an indicator readout or screener columns.
  - Chat read tools register in `_BRAIN_TOOLS` (`api/services/journal_two/coach_chat_tools.py:1734`), either under the import-time `BRAIN_TOOLS_ENABLED` (`:1884-1891`) or per call through `_GatedToolRegistry` (`:2136`).
  - Voice tools register through `voice_tool(..., gate=...)` (`voice_tools.py:17-37`) and must appear in BOTH `_compass_tool_union()` (`voice_agents.py:344`) and `_COMPASS_CORE_TOOLS` (`:481`). Under the default lean mode the active set is union ∩ core (`:530-537`).
  - `CompassAssistButton({pageHint})` sets a voice page hint (`components/voice/CompassAssistButton.jsx:30,48`), truncated to 500 characters (`api/routers/voice.py:1159`). Text chat has no page-hint path (grep).
  - The report card is `api/services/compass_eval/golden_set.json`: 50 questions, one RS mention.
- F51. Study:
  - Items live in `study_items` with `review_status` `draft | approved | retired | rejected` (`api/services/study_store.py:60-61`), and members see `approved` items only (`:18`).
  - `POST /api/study/import` stores drafts and strips any status not stamped `reviewed.by == "owner"` (`api/routers/study.py:653-685`). The pod import is `scripts/study/import_bank.py` over `docs/study/bank/*.json`.
  - Item types include `tap` and `spot` (`study_store.py:96-98`).
  - The drill chart's `sym` is the item id, never the ticker (`pages/study/DrillPlayer.jsx:360`; `study_store.py:15-17`), so a drill cannot fetch `/api/signature/columns`. `primeServerColumns(defId, sym, tf, inputs, wire)` exists (`serverCompute.js:327`).
  - Items can carry engine `indicatorInstances` (`pages/study/studyChartLook.js:81-82`). No item references `rsLine`.
- F52. Lists:
  - The nightly leaders query `_rs_leaders_for(session)` (`api/main.py:2288-2330`) selects `screener_rows` by `bars_asof` and excludes SPY and `is_etf = 1`.
  - `rs_history` provides `read_fields`, `status` and `ticker_history` (`api/services/screener/rs_history.py:1020,1119,1105`); the ETF set is `default_etf_tickers()` (`:433-461`).
  - Managed prebuilt watchlists delete anything not configured unless it is exempted (`api/services/watchlist_prebuilt.py:1-9`, `:558-569`). The Sunday Scans family is the precedent for an exempt, job-written list (`:36-45`; `_is_sunday_family` at `:200`; `sync_sunday_scans` at `:342`).
  - The picker groups lists by category (`:431-440`); a single list has no sections.
  - Theme per ticker comes from the screener `theme` column (`snapshot_db.py:120`, filled at `snapshot_builder.py:869-872`; None for most of the universe) or from `groups.resolve_primary_theme(sym)` (`api/services/groups.py:513`).
  - The RS starters stay hidden unless `RS_V2_ENABLED` is on (`api/services/screener/saved_screens.py:519-535`), with liquidity floors `_RS_LIQUID` (`:522-523`).
- F53. Video:
  - `youtube_client.upload()` exists (`api/services/youtube_client.py:84`; OAuth environment at `:60-62`).
  - The admin door to register a video is `POST /api/education/videos` (`api/routers/education.py:451-466`).
  - `chart_renderer` captures PNGs only (`services/chart_renderer/app.py:1-22`, `:748`), and nothing in the repo records video.
  - Python Playwright is already installed for `tools/mobile_audit.py` (CLAUDE.md, mobile audit harness).

### 1.11 Pure maths available (units 3-03, 3-10)

- F54. `relative_strength.py` exports `rs_line`, `rs_moving_average`, `above_column`, `cross_columns`, `rolling_extreme_event`, `pct_change`, `red_day_column`, `rolling_count`, `dot_column`, `benchmark_closes_aligned`, `compute_phase1_columns` (`:366`), `mansfield_column` (`:447`), `compute_mansfield_columns` (`:621`), `bars_ago_column` (`:540`) and `benchmark_agree` (`:580`). The fixtures `rs_events_default.json`, `rs_line_spy.json` and `rs_mansfield.json` are shared by both lanes.

### 1.12 The plan's Phase 3 and Phase 4 assumptions, checked against the code

| # | Plan says | Code says | Verdict and change |
|---|---|---|---|
| A1 | §11: own-scale overlay = `placement.ownScale: true` + binder | Pool and binder already take any `scaleId` (F31). Only the price branch of `resolvePlacement` hard-codes the candles' scale (F29) | Confirmed, and smaller than planned: one placement answer plus one schema field. No binder change expected (verify in 3-07) |
| A2 | §11: `customBenchmark` string input, `_sym_or_422` on the server | `string` has no renderer (F26) and no server validation (F4). `_sym_or_422` lives only in the router (F14). Bars are local only (F13). The alert lane would inherit the option (F17) | Corrected: a generic text control (3-02), a declared `pattern` in `resolve_inputs` (3-05), a CUSTOM branch that warms missing bars (3-04), and CUSTOM excluded from alerts |
| A3 | §5 and v3 §7.11: RRG-style with `rrgWindow` 14, `rrgTail` 12, sigma normalisation | A different UCT RRG formula already ships to members (F37-F38) | Refuted as written: one formula across Terminal, chart and screener (D1) |
| A4 | §10.5 and v3 §10.4: rotation view "in the Compare panel" | The Compare panel exists as a desktop modal with no 2-D plot (F39); the Terminal graph exists (F37) | Confirmed home, with reuse: a Rotation tab in the Compare panel that renders the Terminal's graph, extracted into a shared component |
| A5 | v3 §7.20: anchor = the benchmark's 20-session low, "clickable date, Phase 3" | The default anchor shipped in 2a (F12). There is no pick mode, and `time` is reserved (F24) | Half done: Phase 3 adds a `string` date input and a pick mode |
| A6 | §6.3: a "Method" group holds the method inputs | Folded into Line and New highs in 2a (F19) | Changed: one collapsed "Method" group returns, holding only the Phase 3 inputs |
| A7 | §10.1: Phase 3 adds `rrg_quadrant`, `clenow_score`, `vars_state` | No code yet. The step's only gate is already on (F34), and the quadrant is text (F35) | Confirmed, with a new per-call gate on `RS_V3_ENABLED` |
| A8 | Brief: a new wire column needs a rev bump and a flag | The equality contract (F3) and the rail triangle (F6) force a new row shape. Alerts never read the wire (F44) | Confirmed: `RS_V3_ENABLED`, rev 4, no binding migration (§4) |
| A9 | §6.11 and §17.9: Learn links need a Desk `video` parameter (Phase 4) | Already shipped with `v` and `t`, and railed (F47) | Refuted: zero work. A new lesson is one key in three pinned places |
| A10 | §12.4: premium preview (lock + preview) | There is no free tier (F48) | Moot: no audience, so no unit |
| A11 | §6.1: RSI disambiguation row | Missing, and worse than assumed: "RSI" never shows UCT RS (F45) | Confirmed; built as a generic `meta.searchHint` |
| A12 | v3 §6.2: tour shown once per member, stored in preferences | No chart tour, no first-add seam, and `/charts` is viewport-locked (F46). Research card 3 carries the "87" figure, which v4 §1.7 says has no published sample | Corrected: a definition-level tour in the chip menu, shown on first add; card 3 rewritten |
| A13 | §10.4: Leadership list = rating ≥ 90 ∧ RS high ≤ 10 bars ∧ above the 200-day ∧ benchmarks agree | "Leadership" is already the UCT 20 list (§0). `rs_benchmark_agree` compares SPY with RSP only (F33). There is no above-200 flag; use `pct_vs_sma200 > 0` (F35). Lists have no sections (F52) | Corrected: named RS Leaders and RS Emerging; rule written in real columns; theme carried as the item note and the sort order |
| A14 | v3 §10.5: each marker's three lines are what Compass says | The cards live only in the JS definition (F21), and there is no RS tool (F50) | Corrected: a generated JSON export of the cards, glossary and tour copy that Python reads, plus two read tools |
| A15 | v3 §10.5: Study drill "which of these two RS lines is the leader?" | A drill cannot fetch server columns (F51) | Corrected: the generator precomputes RS into the item, and the drill primes the real indicator from it |
| A16 | §12.4: walkthrough video on the Desk | No recording tooling exists; the upload and register doors do (F53) | Split: code produces a captioned capture; publishing is the owner's job (§6) |
| A17 | §12.4: glossary page | None exists; public method pages are the precedent (F49) | Confirmed: `/methodology/relative-strength` |
| A18 | `alert_rev_migration` docstring: "every bump migrates" | True only for member-authored definitions (F42) | Refuted for builtins; 3-05 states this in the `ADDRESS_REVS` comment |

---

## 2. Units

Rules for every unit:
- At most one day of work, and one push per finished, locally tested unit (CI minutes are billed).
- A unit edits only the files it lists.
- New flags land with their ledger entry in the same unit.
- Member-facing copy is written in operator voice, with no emoji, no "buy" or "sell", and no [S]/[U] research.
- Vitest runs with `--maxWorkers=2` on scoped directories.
- Pytest runs on the unit's own files.

### Phase 3

**3-01 Server-gated controls and legacy inputs (engine).** Size M. Depends on: none.
- Goal: keep a merged-but-dark control invisible until the server row can answer it, and let a declared input retire without breaking saved layouts.
- Files: `app/src/components/chart/engine/serverCompute.js`, `engine/defSchema.js`, `components/chart/indicatorRegistry.js`, `engine/__tests__/enumerationSites.test.js`, plus new tests `engine/__tests__/serverGate.test.js` and `engine/defSchema.serverGate.test.js`.
- Contract changes:
  - `defSchema` accepts `requiresServer: true` on an input, on an enum option entry (`['CUSTOM', 'Your symbol', {requiresServer: true}]` or the object form) and on a `meta.presets[]` entry. It fails closed on any other value.
  - New input field `legacy: true`: the input is still declared, still accepted in stored instances (F20), and never rendered.
  - `serverCompute.serverDeclares(defId)` fetches `SERVER_DEFINITIONS_PATH` once per page load (SWR-shaped, memoised) and returns the live row's input keys and enum options, or `null` while unknown or failed.
  - `fieldsForInstance(def, inst, {declared})` drops `legacy` inputs. It also drops `requiresServer` inputs and options that the live row does not declare, treating a `null` declaration as "not declared" (fail closed).
  - New export `visiblePresets(def, declared)` hides a `requiresServer` preset, and any preset whose `inputs` name a hidden input or a hidden option value.
  - `enumerationSites` exempts `legacy` inputs by rule, not by name.
- Tests:
  - accept and refuse pairs for both fields;
  - a fake definitions response shows the option, a failed fetch hides it, and an ungated control is never hidden;
  - presets are filtered by input and by option value;
  - a legacy input stored on an instance validates but is not rendered;
  - a byte-identical control: a definition without either field yields today's `fieldsForInstance` output.
- Risks: `fieldsForInstance` is the shared model behind the dialog and the sheet (2a-11), so the control case matters. The definitions fetch is one paid GET per page load.

**3-02 Generic text input control.** Size M. Depends on: 3-01.
- Goal: make a `string` input editable on desktop and phone with a declared pattern, and filter preset pickers through `visiblePresets`.
- Files: `engine/defSchema.js`, `components/chart/indicatorRegistry.js`, `components/chart/IndicatorSettingsDialog.jsx`, `pages/charts/mobile/MobileIndicatorSheet.jsx`, plus new tests `IndicatorSettingsDialog.text.test.jsx` and `MobileIndicatorSheet.text.test.jsx`.
- Contract changes:
  - A `string` input may declare `pattern` (an anchored regex source), `maxLength` (1-64), `case: 'upper'` and `placeholder`. `validateInputValue` enforces `pattern` and `maxLength` on non-empty values; empty is always legal and means "not set".
  - `fieldFromInput` maps `string` to `{type: 'text', pattern, maxLength, case, placeholder}`.
  - The dialog and the sheet render a text control that commits on Enter or blur, upper-cases when told to, shows `aria-invalid` and a muted "Letters, dots and dashes, up to 10" line on a miss, and never writes an invalid value.
  - Both preset pickers (the dialog header and the sheet's preset row) list `visiblePresets(def, serverDeclares(def.id))`.
- Tests: a valid value commits through `setInstanceInput` once; an invalid value writes nothing; the tooltip is wired through `aria-describedby`; the phone row keeps 44 px; the dialog everyDefinition census still passes.
- Risks: this is the first text control on either surface. Watch the 296 px popover and the inspector column truncation found in the 2a visual round.

**3-03 Rotation, Quality and VARS maths (pure).** Size M. Depends on: none.
- Goal: one implementation of each Phase 3 reading, shared by the provider, the screener and (for RRG) the Terminal.
- Files: `api/services/relative_strength.py`, new fixtures `tests/fixtures/indicators/rs_rrg.json`, `rs_clenow.json` and `rs_vars.json`, new `tests/test_rs_phase3_math.py`, new `app/src/pages/terminal/panels/relativeMath.rsFixture.test.js`.
- Contract changes. New pure functions, none of which touch an existing function:
  - `rrg_columns(bars, benchmark_bars, ratio_len, mom_len) -> {rsRatio, rsMomentum, quadrant}`, with quadrant codes 1 Leading, 2 Weakening, 3 Lagging, 4 Improving, else None;
  - `clenow_columns(bars, window, gap_pct) -> {clenowScore, clenowAnnual, clenowR2, clenowGap}`, using OLS of ln C on the bar index, annualised as `(1 + b)^252 − 1`, with score = annual × R²;
  - `vars_columns(bars, benchmark_bars, atr_length, lookback, ma_length=50) -> {vars, varsMa, varsState}`, where state is 1 for `vars > 0 ∧ vars > MA`, 2 for `> 0 ∧ ≤ MA`, 3 for `< 0 ∧ > MA` and 4 for `< 0 ∧ ≤ MA`;
  - `PHASE3_COLUMNS`.

  All of them join by bar time, skip gaps and return None (never 0) during warm-up. The RRG formula follows D1, which recommends the Terminal's `RRG_METHOD`. `rs_rrg.json` is read by BOTH `tests/test_rs_phase3_math.py` and the new vitest file, which calls `relativeMath.rrgPath`, so the Terminal and the server cannot drift.
- Tests:
  - every fixture value;
  - warm-up and gap behaviour;
  - a halted benchmark bar stays None;
  - Clenow's gap flag at the threshold;
  - VARS ATR seeding;
  - **the no-move rail**: `compute_phase1_columns` and `compute_mansfield_columns` reproduce `rs_events_default.json` and `rs_mansfield.json` byte for byte. This protects saved alerts (F44).
- Risks: if D1 instead chooses the plan's sigma formula, `relativeMath.js` changes in this unit too, and the Terminal's RRG moves for every member. Run that through the 3-13 parity measurement first.

**3-04 Custom benchmark resolution.** Size S. Depends on: none.
- Goal: resolve `CUSTOM` to a member's ticker honestly.
- Files: `api/services/rs_benchmarks.py`, new `tests/test_rs_benchmarks_custom.py`.
- Contract changes:
  - `CUSTOM_BENCHMARK = "CUSTOM"`, kept OUT of `AUTO_BENCHMARKS` so the derived lists (F5, F17) do not grow by accident.
  - `resolve_benchmark(..., custom=None, warm=None)`. For `CUSTOM`:
    - the ticker is matched against `CUSTOM_SYMBOL_RE` (the same expression as `_SYM_RE`, stated once here and imported by `registry_defs`) and upper-cased;
    - empty or invalid → SPY with `fallback: "no custom symbol"`;
    - equal to the chart's symbol → resolved as itself, so the provider's same-symbol state applies;
    - no bars → resolved as the ticker with `bars: []`, so the provider reports `no-benchmark-bars` and `note` reads "No XYZ bars yet; they usually load within a minute". The injected `warm(ticker)` is called once (the provider passes the existing bars warm path; per-process memo, at most one warm per ticker per 10 minutes).
  - Never a silent swap to SPY for a valid ticker.
  - Label `"XYZ"` (the provider may replace it with the company name if `ticker_meta` has it cached; no network).
- Tests: valid, invalid, empty, same symbol, no bars plus the warm call counted, and the ETF ticker case (an ETF is allowed as a custom benchmark).
- Risks: the warm path must stay off the request thread (pass a fire-and-forget callable). Check that the existing `warm_bars_async` import in `api/routers/engine_data.py` is that shape.

**3-05 Python row v4, the flag and the rails.** Size M. Depends on: 3-03, 3-04.
- Goal: declare the Phase 3 shape behind `RS_V3_ENABLED` without moving production.
- Files: `api/services/signature/registry_defs.py`, `api/services/alert_rev_migration.py`, `api/services/alert_rs_series.py`, `docs/feature_flags.json`, `tests/test_rs_columns_provider.py`, new `tests/test_registry_string_inputs.py`.
- Contract changes:
  - `RS_V3_ENABLED` is read at import, beside `RS_V2_ENABLED`. `_rs_line_row(v2, v3)` returns three shapes: v1 (both off), v3 (V2 only, byte-identical to today) and v4 (V2 and V3; V3 alone is ignored and logged).
  - The v4 shape is version 4, `compute.rev` 4, with columns = today's 22 plus the wire subset of `PHASE3_COLUMNS`: `rsRatio`, `rsMomentum`, `clenowScore`, `dotClenowGap`, `vars`, `varsMa`.
  - New declared inputs:
    - `view`: enum `ratio | mansfield | rotation | quality | vars`, default `ratio`;
    - `customBenchmark`: string with `pattern`, `maxLength` 10 and `case: upper`;
    - `rrgRatioLength` (10, 3-60) and `rrgMomentumLength` (5, 2-30);
    - `clenowWindow` (90, 20-252) and `clenowGapPct` (15, 1-50);
    - `atrLength` (20, 5-100) and `varsLookback` (60, 10-252);
    - `anchorDate`: string, pattern `^\d{4}-\d{2}-\d{2}$`, default empty.
  - The benchmark enum in v4 is `RS_LINE_BENCHMARKS + ("CUSTOM",)`, exported as `RS_LINE_BENCHMARKS_V4`. `RS_LINE_BENCHMARKS` itself does not change, so the alert lane stays as it is. `alert_rs_series.RS_ALERT_BENCHMARKS` also excludes `CUSTOM` by name, as a belt-and-braces guard.
  - `resolve_inputs` gains a `string` branch: strip, apply `case`, then refuse with `InputRejected` on a non-empty value that misses `pattern` or exceeds `maxLength`. An unknown kind is refused rather than stored raw (F4), which closes a hole no current row reaches.
  - `ADDRESS_REVS["rsLine"] = 4`, with the comment: "builtin bumps are a vocabulary mirror; no runtime migrates rs_line bindings; Phase 3 left `compute_phase1_columns` / `compute_mansfield_columns` byte-identical (3-03 rail), so no migration is owed."
  - Ledger entry `RS_V3_ENABLED` (web, dark, with an arming note). Correct `RS_V2_ENABLED`'s status to the live state the owner set (F8).
- Tests:
  - the three shapes;
  - JS rev = `_rs_line_row(True, True)` rev = `ADDRESS_REVS` = 4;
  - the one-list rail against `RS_LINE_BENCHMARKS_V4`;
  - the `serverInputs` rail against the v4 keys (it goes green when 3-08 lands, so mark it `xfail(strict=True)` here and drop the mark in 3-08);
  - string branch accept and refuse pairs;
  - `RS_ALERT_BENCHMARKS` has no CUSTOM.
- Risks: the rail triangle is shared with 3-08, so land 3-05 and 3-08 in consecutive waves. The import-time flag needs `railway redeploy` to arm and to roll back (§4).

**3-06 Provider v4.** Size L. Depends on: 3-03, 3-04, 3-05.
- Goal: compute and explain the three new readings, the custom benchmark and the picked anchor.
- Files: `api/routers/signature.py`, new `tests/test_rs_provider_v4.py`.
- Contract changes. All of the following apply only when the row is v4 (`definition('rsLine')["compute"]["rev"] == 4`):
  - `params` gains the new inputs.
  - The cache key adds `view`, `customBenchmark` and `anchorDate` (it already carries `requested`; F7).
  - `_RS_PAYLOAD_SHAPE` becomes 4.
  - A view blanking table replaces the Mansfield-only one. Each view keeps its own family and blanks the others (ratio: today; mansfield: today; rotation: `rsRatio`, `rsMomentum`; quality: `clenowScore`, `dotClenowGap`; vars: `vars`, `varsMa`). Event columns are never blanked. `showMansfield: true` with `view` absent or `ratio` resolves to `mansfield`, which keeps saved Trend instances (D2).
  - Rotation is computed on the chart's bars (the weekly presets carry the read). It is intraday-blank like the dots.
  - New payload blocks:
    - `rotation {quadrant, ratio, momentum, inQuadrantBars, summary}`, e.g. `Leading, 6 weeks`;
    - `quality {score, annualPct, r2, gap, summary}`, e.g. `Score 0.62, 91% a year, R² 0.68, no gap over 15%`;
    - `vars {value, state, stateWord, summary}`.
  - Each block is `None` with a reason when the bars cannot support it, the same as the 2a blocks.
  - `checks.anchor` honours `anchorDate`: the first bar on or after the date. It reports `source: "picked" | "default"`, and its reason names the date. A date before the history held, in the future, or with no bar yields `pass: None` with the reason, never a silent fallback to the default.
  - `benchmark` passes `custom=inputs.customBenchmark` and `warm=` the bars warm path.
- Tests: every view's blanking; the legacy `showMansfield` mapping; each block on the shared fixtures; anchor picked, default and out-of-range; custom benchmark states; the v3 row stays byte-identical (the flag-off control); p95 measured warm on SPY / NVDA / a 300-bar IPO and recorded in the PR (plan §8.2 budget).
- Risks: the provider is already 230 lines. Keep each block in its own pure helper, the 2a convention (`signature.py:1100-1108`). Budget: Clenow's rolling OLS is O(n·w), so compute only the tail the chart shows (lookback + 600 bars) and vectorise the running sums.

**3-07 Own-scale placement and readout actions (engine).** Size M. Depends on: 3-02 (because `defSchema.js` is shared).
- Goal: let an indicator drawn on the price pane keep its own invisible scale, and let a readout row offer an action.
- Files: `engine/defSchema.js`, `engine/placement.js`, new `engine/__tests__/placement.ownScale.test.js`, `engine/defSchema.readoutAction.test.js`; `engine/binder.js` only if 3-07's test proves the price-pane fill skip (`binder.js:2740-2747`, per the reconnaissance) drops the series.
- Contract changes:
  - `placement.ownScale: true` (boolean, behavioural, fails closed).
  - In `resolvePlacement`, when the resolved target is `price` and the definition declares `ownScale`, the answer is `{paneIndex: priceIndexOf(c), scaleId: 'own:' + instanceKey, scaleOptions: {visible: false, borderVisible: false, scaleMargins: {top: 0.62, bottom: 0.04}}, autoscale: 'default', lastValue: false}`. That puts the line in the lowest third under the bars, the IBD look, and leaves the candles' scale untouched.
  - Readout rows gain an optional `action: {kind: 'pickDate', input: '<key>'} | {kind: 'resetInput', input: '<key>'} | {kind: 'openRotation'}`, a closed vocabulary validated against declared inputs.
- Tests: the answer shape; the candles' range is unchanged with the overlay present (the `autoscaleOnARealScale` precedent); two instances get two scale ids; a definition without `ownScale` is byte-identical; action refusals.
- Risks: margins are a visual call (§5 D3). A screenshot pass in 3-14 is the gate. The phone shell's bottom inset (B3) sits over the lowest band; measure it.

**3-08 rsLine definition v4.** Size L. Depends on: 3-01, 3-02, 3-05, 3-07.
- Goal: the member-facing Phase 3 indicator.
- Files: `app/src/components/chart/engine/nativeRegistry.js`, `engine/__tests__/rsIndicator.golden.test.js`, `components/chart/__tests__/rsPresets.test.js`, `tests/test_rs_columns_provider.py` (drop the 3-05 `xfail`).
- Contract changes:
  - `version: 4`, `compute.rev: 4`, `placement.ownScale: true` (the default stays `target: 'pane'`, so no saved instance moves; F30).
  - Inputs:
    - `view` (Simple group, label "Reading", `requiresServer`);
    - `showMansfield` becomes `legacy: true` (D2);
    - benchmark option `CUSTOM` labelled "Your symbol" (`requiresServer`), plus `customBenchmark` (Simple, `activeWhen {key:'benchmark', equals:'CUSTOM'}`, `requiresServer`, placeholder `SMH`);
    - a "Method" group, collapsed, `requiresServer`, holding the six method inputs, each dimmed unless its view is selected;
    - `anchorDate` (a Checks group, collapsed, `requiresServer`, tooltip "Blank uses the benchmark's lowest close of the last 20 sessions").
  - Plots:
    - `rsRatio` and `rsMomentum` (two lines, info and neutral, with a 100 guide drawn only under the rotation view);
    - `clenowScore` (line) plus `dotClenowGap` (a neutral point marker);
    - `vars` and `varsMa` (line and dashed average, zero guide under the vars view).
  - Readout:
    - a glance row for each view, printed only under its view (`when: 'input:view=rotation'`; extend the `when` grammar in 3-07 if it lacks an equals form — check `readoutSchema.js` first);
    - cards with what, origin and evidence, using only [V] statements from `03-evidence.md` (§5 D8);
    - a Checks anchor row gains `action: pickDate` and a Reset row;
    - the Rotation card gains `action: openRotation`.
  - Presets `rotation`, `rotationWeekly`, `quality` and `volAdjusted`, each `requiresServer`, each setting `view` and its lengths only (the 2026-11-06 rule: a preset sets the reading, never the benchmark).
  - `RS_CLASSIC_TOGGLES` gains `view: 'ratio'` so `detectPreset` stays exact.
  - `meta.serverInputs` adds the nine keys.
  - The description is updated to name only what ships.
- Tests: the golden fixture for each new column; `detectPreset` round trip for every preset; presets hidden with no server declaration; the chip reads `UCT RS · SMH · 94` under CUSTOM; the pane label under each view; the provider readout-source rail resolves every new `scalar:` path.
- Risks: this is the biggest definition in the registry. Respect the palette budget (≤ 2 hues + 1 neutral per view, gold only as the one look-here mark; the Rotation view has no gold). The `defSchema` checks for `activeWhen` on an option-dependent input must already accept `equals` on an enum (they do for bools; verify for enums).

**3-09 StockChart surfaces: pick mode, preset page, rotation link.** Size M. Depends on: 3-07, 3-08.
- Goal: the clickable anchor and the chip menu's Preset page under the server gate.
- Files: `app/src/components/StockChart.jsx`, new `components/StockChart.rsAnchor.test.jsx`.
- Contract changes:
  - A readout row with `action.kind === 'pickDate'` renders a button: "Pick a date on the chart".
  - Pressing it closes the menu and sets a one-shot pick state, with a toast-style hint "Click a bar to anchor the check. Esc cancels". The next `subscribeClick` / `onChartTap` time (`:18353-18372`) is converted to the ET session date and written through `setInstanceInput(anchorDate)`. Escape, a symbol change or a timeframe change cancels it.
  - Phone: a tap does the same. There is no hover requirement, because the library's click fires on touch (`:2912` comment).
  - `resetInput` writes `''`.
  - The Preset page lists `visiblePresets`.
  - `openRotation` dispatches a workspace event (`uct:compare-open`, detail `{tab: 'rotation', sym, group: 'theme'}`) that 3-12's panel listens for. On a surface with no Compare panel (phone, the Terminal, the popup chart) the row is not rendered.
- Tests: pick writes the date once and leaves the mode; Escape cancels; a click on a news or desk badge does not count as a pick (those handlers run first, `:18380-18503`); the phone tap path; the reset path.
- Risks: StockChart is about 19k lines with six developing-bar writers. The pick mode must not add a writer, and must not leave a pick armed across a symbol change. `singleWriterIndex.test.js` stays green.

**3-10 Screener collector for the three Phase 3 columns.** Size M. Depends on: 3-03.
- Goal: put `rrg_quadrant`, `clenow_score` and `vars_state` into the nightly build, dark.
- Files: `api/services/screener/rs_columns.py`, `api/services/screener/snapshot_builder.py`, `api/services/screener/snapshot_db.py`, new `tests/test_screener_rs_phase3_columns.py`.
- Contract changes:
  - `rs_columns.PHASE3_COLUMNS = ("rrg_quadrant", "clenow_score", "vars_state")`, computed in `collect_one` only when the builder passes `phase3=True`.
  - `snapshot_builder.rs_v3_enabled()` reads `registry_defs.RS_V3_ENABLED` per call, the twin of `rs_v2_enabled()` (`:87-97`). The step's timing record gains a `phase3_ms` share.
  - `rrg_quadrant`: TEXT `Leading | Weakening | Lagging | Improving`, computed on weekly bars resampled from `bars_full` (the existing resample, Phase 2 map §2.5) against SPY.
  - `clenow_score`: REAL, 4 dp, daily, 90 bars.
  - `vars_state`: TEXT `Strong, rising | Strong, fading | Weak, improving | Weak, falling`, daily.
  - All three go in `COLUMNS`, with `rrg_quadrant` and `vars_state` in `_TEXT`, and the ALTER is added on init.
- Tests: values equal `relative_strength` on fixture bars; flag off leaves all three None and costs no time; short history gives None plus a count under `sources['bars_rs']`.
- Risks: added CPU on the 03:00 build (F34). The receipt measures it before arming (N7 precedent).

**3-11 Screener surfaces and AST partition.** Size M. Depends on: 3-10.
- Goal: filters, column definitions, methodology and partition for the three columns.
- Files: `api/services/screener/filters.py`, `api/services/screener/methodology.py`, `app/src/pages/screener/columnDefs.js`, `app/src/pages/screener/focus/plainWords.js`, `app/src/components/chart/engine/ast/closedTable.json`, `tests/test_ast_scalars.py`, `engine/ast/freshness.test.js`, `tests/test_scalar_population_rail.py`, `tests/test_screener_filters.py`.
- Contract changes:
  - `_enum` filters for both text columns (the `rs_line_trend` precedent, `filters.py:693` per the Phase 2 map) and `_open_range` for `clenow_score`, all preset-free.
  - A column description for each (`columnDescCoverage` ratchet).
  - A methodology entry that says "RRG-style, UCT's formula" (with the formula printed), "Clenow-style, 90 trading days" and "VARS-style".
  - Partition: all three land in `_scalars_excluded` with dated `ARTIFACT_EMPTY` reasons (R8). The pin moves from `(149, 107)` to `(149, 110)` in both lanes. They are promoted after the first clean prod fill, as a follow-up push.
  - No starter yet. "Rotation: Improving quadrant" waits for the fill (`test_screener_saved.py` forbids starters on empty columns).
- Tests: filter compile, `every filter column in COLUMNS`, the partition pins, description coverage.
- Risks: the pins are shared with every other screener author. Rebase immediately before pushing.

**3-12 Rotation view in the Compare panel.** Size M. Depends on: 3-03.
- Goal: RS-Ratio against RS-Momentum with tails for a watchlist, a theme or the panel's own symbols, from one formula and one graph.
- Files: new `app/src/components/rotation/RrgGraph.jsx` (+ `.module.css`, extracted from `RrgPanel.jsx`'s graph, label placement and aria label), `app/src/pages/terminal/panels/RrgPanel.jsx` (imports the extracted graph, no behaviour change), `app/src/pages/charts/CompareSymbolsPanel.jsx` (+ `.module.css`), new `pages/charts/CompareSymbolsPanel.rotation.test.jsx`.
- Contract changes:
  - The panel gains two tabs, "Overlay" (today's panel) and "Rotation".
  - Rotation universe:
    - the panel's own symbols when there are any;
    - else a picked group (theme, sector or industry, through the panel's existing group resolver);
    - else a watchlist picked from `GET /api/watchlists?include_items` (`api/routers/watchlists.py:323-352`).
  - The universe is capped at `RRG_MAX` (12). A larger group shows the 12 names with the highest `rs_rating_ibd`, and says so in a muted line ("12 of 41 names, highest RS rating first"). Ratings come from the screener rows the panel can already read; a fallback is the first 12 alphabetically, and the panel says that too.
  - Closes come from `useCloses(syms, 'W')`, with a weekly or daily toggle.
  - The method line printed under the graph is the Terminal's.
  - It listens for `uct:compare-open` (3-09).
- Tests: universe resolution for each source; the cap sentence; one formula (the graph's points equal `rrgPath` on the shared fixture); the Terminal panel renders unchanged (`comparePanels.test.jsx` green); keyboard and aria.
- Risks: `CompareSymbolsPanel` is desktop only (F39). Phone members reach the same graph through the Terminal's `RRG` function. 12 names of weekly closes is 12 bars requests through `useCloses`'s own bounded fetch (verify its concurrency).

**3-13 Fixture set 1, the rest (parity).** Size S. Depends on: 3-03; data per §6.
- Goal: the §12.1 public-method parity for Rotation, Quality and VARS.
- Files: new `tests/fixtures/indicators/rs_parity_rrg_stockcharts.json`, `rs_parity_clenow.json`, `rs_parity_vars.json`, new `tests/test_rs_phase3_parity.py`.
- Contract changes: none (tests only).
  - RRG: quadrant agreement ≥ 85% with StockCharts on the 11 SPDR sectors over at least 12 weekly dates. If the agreement misses, the test is `xfail` with the measured number, and D1 is reopened rather than the threshold being edited.
  - Clenow: equals the quant-investing worked example within 1% on its published inputs.
  - VARS: matches the OANDA case study's sign changes on its dates.
- Tests: the three files.
- Risks: the StockCharts reference has to be read by a person or a browser-driven session (§6). The Clenow and OANDA references are public pages an agent can fetch; record each URL and its access date in the fixture.

**3-14 Phase 3 integration.** Size S. Depends on: all Phase 3 units.
- Goal: integration on the RS branch, visual review, PR.
- Files: `api/data/bars_ordinal_census.json` (regenerate only if a new `get_bars` caller appeared; 3-04 and 3-06 use the existing `_fetch_bars_for_tf`), `docs/feature_flags.json` (sweep).
- Contract changes: none.
- Tests: the focused suites of every unit in foreground chunks; screenshots on desktop dark and light and on the phone for every view, CUSTOM, the overlay and the pick mode, sent to the owner; the sandbox run with `RS_V3_ENABLED=1` and then `=0` proves the controls appear and disappear.
- Risks: as Phase 2. Pre-existing reds are triaged against the parent branch and listed in the PR.

### Phase 4

**4-01 RS Leaders and RS Emerging lists (service and job).** Size M. Depends on: none.
- Goal: two auto-built lists, refreshed nightly, that members open in the Watchlist picker.
- Files: new `api/services/rs_lists.py`, `api/services/watchlist_prebuilt.py`, `api/main.py` (registrar only), `docs/feature_flags.json`, new `tests/test_rs_lists.py`.
- Contract changes:
  - `rs_lists.build(session) -> {leaders, emerging, receipt}`, read from `screener_rows WHERE bars_asof = session_ymd AND COALESCE(is_etf,0) != 1 AND ticker NOT IN default_etf_tickers()` with the `_RS_LIQUID` floors (`saved_screens.py:522-523`).
    - **Leaders**: `rs_rating_ibd >= 90 AND rs_nh_bars_ago <= 10 AND pct_vs_sma200 > 0 AND rs_benchmark_agree = 1`.
    - **Emerging**: `rs_cross_up_bars_ago <= 5 AND rs_rating_ibd >= 80`, minus anything already in Leaders.
  - Group order: theme (the screener `theme` column, else `groups.resolve_primary_theme`, else the sector), with themes ordered by member count and names within a theme by rating, then by the most recent RS high. Cap 30 per list, trimmed from the bottom.
  - Write: two managed prebuilt lists named `RS Leaders` and `RS Emerging` in a new category "UCT Relative Strength". Each item note reads `"<Theme> · RS <rating> · high <n> bars ago"`. The family predicate `_is_rs_family` is exempted from the delete step, like Sunday Scans (`watchlist_prebuilt.py:558-569`).
  - Job `rs_lists_nightly` at 04:40 ET (after `rs_history_nightly` at 04:15), with `coalesce=True, misfire_grace_time=3600`, registered unconditionally, reading `RS_LISTS_ENABLED` per call. It never writes a list from a session whose `rs_history.status()` latest session is older than the screener session (it skips, with a reason). It never writes an empty list over a full one unless the screener session is fresh and the rule truly returned nothing. The receipt goes into `snapshot_db.status()`.
  - Ledger entry `RS_LISTS_ENABLED` (web, dark).
- Tests: the rule on synthetic rows; ETF exclusion through both sources; cap and order; the stale-session skip; the empty-over-full guard; the delete-exemption predicate; the FakeScheduler registration (the `test_screener_schedule.py` pattern).
- Risks: the watchlist writes go to `auth.db` on the web pod. Use the module's admin-user path (`_admin_user_id`, `watchlist_prebuilt.py:51`). A list updated in place has no history; D10 explains why that is acceptable.

**4-02 Teaching content and its export.** Size M. Depends on: none.
- Goal: one authored source for the glossary, the misconceptions, the five tour cards and the readout cards, readable by both lanes.
- Files: new `app/src/content/rs/teaching.js`, new `tools/export_rs_teaching.mjs`, new `api/data/rs_teaching.json`, new `app/src/content/rs/teaching.export.test.js`.
- Contract changes:
  - `teaching.js` exports:
    - `GLOSSARY`, the 15 terms of 04 §c in brand voice, with "typically within ±3–5 points of MarketSurge" replaced by "our measured difference is shown in the readout" (v4 §18);
    - `MISCONCEPTIONS`, the 8 of 04 §e;
    - `TOUR`, the five cards (D12 copy);
    - `CARD_KEYS`, read from `RS_LINE_RAW.readout`.
  - The export writes `{version, glossary, misconceptions, tour, cards: {key: {label, what, origin, evidence}}}` to `api/data/rs_teaching.json`.
  - The vitest test regenerates the export in memory and diffs it with the committed file, so editing a card without re-exporting is red.
- Tests: the export diff; every glossary term has a definition of at most two sentences; no banned word (§3 list) appears anywhere in the content; no emoji.
- Risks: `api/data` is shipped in the web image while `app/src` is not needed at runtime. That is exactly why the JSON exists. Do not make Python read `app/src`.

**4-03 Tour and search-hint engine.** Size M. Depends on: none.
- Goal: generic definition-level onboarding and a disambiguation row, with no RS names in the engine.
- Files: `engine/defSchema.js`, `components/chart/IndicatorLibraryDialog.jsx`, new `components/chart/useIndicatorTours.js`, new tests `IndicatorLibraryDialog.searchHint.test.jsx`, `useIndicatorTours.test.js`, `engine/defSchema.tour.test.js`.
- Contract changes:
  - `meta.tour: [{title, body}]` (1-6 cards; title ≤ 60 characters, body ≤ 240) and `meta.searchHint: {queries: [string], line: string}` (queries lower-case, matched as a whole trimmed query, never as a substring), both validated fail-closed.
  - `useIndicatorTours()` reads and merges the preference `indicator_tours_seen` (a map `defId → ISO date`) through `usePreferences`, following the `notebook_tours` merge rule (`tourSeenState.js:20`) so two tabs cannot overwrite each other.
  - The library fires `onFirstAdd(defId)` when `toggle` or `addAnother` adds the first instance of a definition that has a `meta.tour` the member has not seen.
  - When a query equals a hint query, the library renders one muted row under the matching results: `line`, plus an "Add UCT Relative Strength" button that calls the same `toggle`. It does this in the library only; the settings tab's search keeps plain matching.
  - Remove the stale "every native is free today" comment (`:585-587`).
- Tests: the hint shows for "rsi" and "relative strength index", not for "rs" or "rsi divergence"; pressing it adds the definition once; `onFirstAdd` fires only on the first add and never on a re-enable; seen-state merge; schema refusals.
- Risks: `IndicatorLibraryDialog.test.jsx:310-314` already warns that a regex matches both RSI and rsLine. Make hint matching an exact comparison.

**4-04 rsLine teaching copy.** Size S. Depends on: 4-02, 4-03.
- Goal: the five cards and the RSI hint on the definition, from `teaching.js`.
- Files: `engine/nativeRegistry.js`, `components/chart/__tests__/rsTeaching.test.js`.
- Contract changes:
  - `meta.tour = TOUR` and `meta.searchHint = {queries: ['rsi', 'relative strength index'], line: 'Looking for strength versus the market? That is UCT Relative Strength.'}` (the plan's line, verbatim).
  - `meta.tags` unchanged. Adding "rsi" there would put UCT RS in every RSI search with no ordering control (F45).
- Tests: the definition registers; the copy equals the export; the tagline appears exactly once, on card 5.
- Risks: none beyond the copy (D12).

**4-05 StockChart teaching surfaces.** Size M. Depends on: 4-03, 4-04, 4-06, 4-07.
- Goal: show the tour on first add, link the glossary, and ask Compass from the chip.
- Files: `app/src/components/StockChart.jsx`, `app/src/pages/charts/mobile/MobileChartsApp.jsx` (only if the phone sheet's readout entry needs the tour page), new `components/StockChart.rsTour.test.jsx`.
- Contract changes:
  - On `onFirstAdd(defId)` with a tour, open the chip menu on a "Tour" page:
    - one card at a time, with Next, Back and "Skip tour";
    - the last card marks the tour seen (Skip marks it too);
    - on the phone it uses the readout sheet (C5);
    - it never opens over a pick mode or another popover.
  - The About page gains a "Glossary" link to `/methodology/relative-strength`, beside the Learn links.
  - The chip menu gains "Ask Compass about this" for a definition with a readout, using `CompassAssistButton` with a page hint of at most 480 characters built from the readout's glance rows (`UCT RS for NVDA vs SPY: rating 94 IBD-style; RS line above its 21 EMA; last RS high 3 bars ago, before price; regime persistence; checks 3 of 4`). It is shown only where a `VoiceProvider` is mounted (the button returns null otherwise).
- Tests: first add opens the tour once; Skip persists; a second instance does not reopen it; the phone path; the hint length cap; the glossary link href.
- Risks: popover height and the 296 px RS popover width (2a). Five cards must each fit without scrolling. Copy length is enforced in 4-03.

**4-06 Glossary page.** Size S. Depends on: 4-02.
- Goal: a public page that a member, Compass and a search engine can all point to.
- Files: `app/src/App.jsx` (one route), new `app/src/pages/RsGlossary.jsx` (+ `.module.css`), new `pages/RsGlossary.test.jsx`.
- Contract changes:
  - Route `/methodology/relative-strength`, public, the same class as `/methodology/measured-edge` (`App.jsx:503`).
  - It renders `GLOSSARY` and `MISCONCEPTIONS` from `teaching.js`, the formulas actually shipped (RS line, IBD-style rating, Mansfield, the RRG formula from D1, Clenow, VARS), and the three external references from v3 §6.11 (ChartSchool Price Relative, IBD's RS line article, Stage Analysis Mansfield) as plain links.
  - It has Learn links to the Desk, which are paid, so they say "Members: watch the lesson".
  - It is not added to `NAV_ITEMS`.
- Tests: renders signed out; every term present; reachable through the App route (the `reachable.test.js` rail).
- Risks: the page must carry no member data and no live numbers (it is public).

**4-07 Compass RS tools.** Size M. Depends on: 4-02.
- Goal: Compass can read a ticker's RS and explain any RS term in the indicator's own words, by voice and in chat.
- Files: `api/services/voice_tool_impls.py`, `api/services/journal_two/coach_chat_tools.py`, `api/services/voice_agents.py`, `api/services/compass_eval/golden_set.json`, `docs/feature_flags.json`, new `tests/test_compass_rs_tools.py`.
- Contract changes. Two read tools:
  - `get_rs_reading(ticker, benchmark="SPY")` calls `registry_defs.serve("rsLine", sym, "D", {"benchmark": b})` (the router module is imported once so the provider is registered). It returns the glance summaries (`benchmark.label`, `rating.summary`, `legend.summary`, `lastRsHigh.summary`, `sensitivity.summary`, `regime.label`, `checks.summary`, plus `rotation` and `quality` and `vars` summaries when present) with `rating.asof`, never a raw column.
  - `explain_rs(term)` reads `api/data/rs_teaching.json` (cards, then glossary, then misconceptions, matched by key, label or alias). It returns the what, origin and evidence verbatim, plus the Learn link path.

  Both are registered in voice (`voice_tool(..., gate=lambda: RS_COMPASS_TOOLS_ENABLED per call)`, added to `_compass_tool_union` AND `_COMPASS_CORE_TOOLS`) and in chat (a per-call gate through `_GatedToolRegistry`; chat delegates to the voice implementation with `_voice_delegate`). The golden set gains three questions ("What does the gold dot on the RS line mean?", "Is NVDA leading the market right now?", "Is RS the same as RSI?") with `must_call_tools` including the new names. Ledger entry `RS_COMPASS_TOOLS_ENABLED` (web, dark).
- Tests: both tools return text that matches the export; an unknown term gets a "not a UCT RS term" answer listing the nearest three; the gate is off by default on both surfaces; a parity test confirms voice and chat expose the same names (extend `test_compass_voice_unification.py`'s pattern in the new file); golden-set validation (`compass_eval/test_golden_set.py`).
- Risks: `serve` runs the full provider (about 150 ms warm, more cold). Voice latency is fine, but do not call it in a loop: a watchlist question stays with `grade_watchlist`. The report card run costs Anthropic tokens (§6).

**4-08 Study RS drill drafts.** Size M. Depends on: none.
- Goal: about 40 owner-review drafts in four families, ready for the next sitting.
- Files: new `scripts/study/bank_v2/gen_rs.py`, new `docs/study/bank/rs.drills.json`, `docs/study/skill_map.json`, new `tests/study/test_gen_rs.py`.
- Contract changes. Item families, all `review_status: "draft"`, `source_kind: "generator"`, and `lesson_origin` naming the card they teach:
  - (a) "Tap the RS new high": type `tap`, answer `{bar_index, bar_tol: 1}` from `rsNH`;
  - (b) "Which line is the leader?": type `spot`, two choices, two names over the same 120 sessions;
  - (c) "Strong on a weak day?": type `spot`, yes or no on a marked red SPY session (`gor`);
  - (d) "RS or RSI?": type `recall`, from `MISCONCEPTIONS[0]`.

  Each chart item embeds the bars (`bars_embed`) plus a precomputed `prompt_json.chart.rs = {columns: {rsLine, rsMa, dotNH, dotNHbeforePx}, times, inputs}` from `relative_strength.compute_phase1_columns` over `bars.db`. The real ticker stays in `sym`, never served before scoring. A new skill `read.rs` goes into a new unit "Reading relative strength" in `skill_map.json`.
- Tests: every item passes `study_import.check_item` offline (number grounding, voice); the RS columns are reproducible from the embedded bars; no ticker appears in any prompt text.
- Risks: the owner reviews every item (F51; memory "Study"). Keep the batch small enough for one sitting. Check whether an unknown `skill_id` fails import before the owner's sitting (UNVERIFIED).

**4-09 Study chart seam for the RS line.** Size M. Depends on: 4-08.
- Goal: drills show the real UCT RS pane, not a drawing of one.
- Files: new `app/src/pages/study/studyRsOverlay.js`, `app/src/pages/study/DrillPlayer.jsx`, new `pages/study/studyRsOverlay.test.js`.
- Contract changes: when `prompt_json.chart.rs` is present, the drill calls `primeServerColumns('rsLine', chartItemId, 'D', inputs, {columns, times, rev: 4, payload: null})` (`serverCompute.js:327`) before mount, and adds one `rsLine` instance with the Classic preset inputs to the drill chart's `indicatorInstances` (`studyChartLook.js:81-82`). The pane label reads `UCT Relative Strength · SPY`, which never names the stock.
- Tests: the instance draws from the primed columns with no fetch (spy on `fetch`); no `/api/signature/columns` call is made; the drill scoring is unchanged.
- Risks: `rev` in the primed wire must equal the JS definition's, or `revMismatch` flags it. Read the rev from the definition, never type it.

**4-10 Walkthrough capture tool.** Size S. Depends on: Phase 3 shipped; ideally 4-05.
- Goal: a reproducible, captioned 90-second screen capture of the indicator for the owner to approve and publish.
- Files: new `tools/rs_walkthrough/capture.py`, new `tools/rs_walkthrough/script.json`, new `tools/rs_walkthrough/README.txt` (operator steps, not docs).
- Contract changes: none in the product.
  - `capture.py` drives the local sandbox (`scripts/hub-sandbox.ps1`, the `hubtest@local.dev` account; the script refuses any other base URL) with Python Playwright `record_video_dir`, at 1920×1080 then 390×844, through the scripted path: open NVDA daily → add UCT RS from search → the tour → the chip readout → switch to Sector → Stress preset → Rotation view → the Compare panel rotation tab → pick an anchor date.
  - It burns captions from `script.json` with ffmpeg if it is on the PATH, otherwise it writes an `.srt` beside the video.
  - Output goes to the scratchpad, never the repo.
- Tests: none in CI (it is an operator tool). A `--dry-run` prints the step list.
- Risks: it is a dev-tool use of an already-installed library, not a new dependency (CLAUDE.md's mobile audit uses the same Playwright). The video is not published by code (§6).

**4-11 Phase 4 integration.** Size S. Depends on: all Phase 4 units.
- Goal: integration, review, PR.
- Files: `docs/feature_flags.json` (sweep).
- Contract changes: none.
- Tests: focused suites; screenshots of the tour (desktop and phone), the RSI row, the glossary page and the two lists in the picker; a sandbox run of `rs_lists_nightly` with `RS_LISTS_ENABLED=1` against a copied screener DB, printing the two lists for the owner.
- Risks: as Phase 3.

Not units, with the reasons:
- **Learn links**: shipped (A9). A walkthrough lesson, once published, is one key added to `RS_LEARN_VIDEOS`, `rs_learn_videos.json` and `meta.learn`. Its id must also reach `SEED_VIDEOS` (§6).
- **Premium preview**: moot (A10, §5 D14).

---

## 3. Build order

Units in one wave touch disjoint files, so they can run at the same time in separate worktrees. Each wave has at most three units.

### Phase 3

| Wave | Units | Why these together |
|---|---|---|
| P3-W1 | 3-01, 3-03, 3-04 | JS engine / Python maths / benchmark resolver; no shared file |
| P3-W2 | 3-02, 3-05, 3-10 | `defSchema` and `indicatorRegistry` (3-02, after 3-01) / `registry_defs` and rails (3-05) / screener collector (3-10, after 3-03) |
| P3-W3 | 3-06, 3-07, 3-11 | provider / placement and `defSchema` (3-07, after 3-02) / screener surfaces |
| P3-W4 | 3-08, 3-12, 3-13 | `nativeRegistry` / the Compare panel and Terminal graph / parity fixtures |
| P3-W5 | 3-09 | StockChart (after 3-07 and 3-08) |
| P3-W6 | 3-14 | integration |

Critical path: 3-01 → 3-02 → 3-07 → 3-08 → 3-09 → 3-14, about 5.5 agent-days. 3-03 → 3-05 → 3-06 runs beside it. Total about 11 agent-days; with three worktrees, the wall time is about 6 working days plus the owner's screenshot sitting.

### Phase 4

| Wave | Units | Why these together |
|---|---|---|
| P4-W1 | 4-01, 4-02, 4-03 | lists service and job / content export / library engine; disjoint |
| P4-W2 | 4-04, 4-06, 4-08 | `nativeRegistry` / App route and page / Study generator |
| P4-W3 | 4-07, 4-09 | Compass (ledger after 4-01) / Study seam |
| P4-W4 | 4-05, 4-10 | StockChart / operator tool |
| P4-W5 | 4-11 | integration |

Phase 4 can start beside Phase 3 for 4-01, 4-02, 4-03 and 4-08, with four overlaps to respect:
- 4-03 shares `defSchema.js` with 3-01, 3-02 and 3-07, so run it after 3-07 has merged.
- 4-01 and 4-07 share `docs/feature_flags.json` with 3-05 and 3-14, so never run either in the same wave as those.
- 4-02's export reads the readout cards, so regenerate it after 3-08 lands, or the export diff goes red.
- 4-05 waits for 3-09, because both edit `StockChart.jsx`.

The three-units-per-wave limit counts across both phases when they run together. Total about 8 agent-days.

---

## 4. Flags and arm order for production

### The new flags

| Flag | Pod | Read | What it gates | Default |
|---|---|---|---|---|
| `RS_V3_ENABLED` | web | at import, `registry_defs` (row shape v4, rev 4); per call in `snapshot_builder.rs_v3_enabled()` | the v4 row, the Phase 3 columns and payload, CUSTOM, the anchor input; through `/api/signature/definitions`, every `requiresServer` control | off |
| `RS_LISTS_ENABLED` | web | per call in `rs_lists_nightly` | writing the two lists | off |
| `RS_COMPASS_TOOLS_ENABLED` | web | per call (voice `gate=`, chat `_GatedToolRegistry`) | the two Compass tools | off |

Nothing else needs a flag:
- **The own-scale overlay** is engine code reached only through Display in → Price on a definition that declares it.
- **The tour, the RSI row and the glossary** are copy and are gated by review in the PR.
- **Study drafts** are invisible until the owner approves each one (F51).
- **The rotation tab** reads public closes the Terminal already reads.

### Arm order, one at a time, each verified on the pod before the next

1. **Merge Phase 3 dark.** Verify from the pod: `/api/signature/definitions` still shows `rsLine` rev 3, a chart still draws today's indicator, and no Rotation, Quality, VARS, "Your symbol" or anchor control is visible on desktop or phone.
2. **`RS_V3_ENABLED=1`, then `railway redeploy --service web --yes`** (import time; "variables --set" behaviour is in CLAUDE.md). Verify:
   - the definitions endpoint shows rev 4 and the `view` input;
   - one chart per view on NVDA daily and weekly;
   - CUSTOM `SMH`, and CUSTOM with a symbol outside the prewarm set (the "loads within a minute" sentence, then the line on reload);
   - a picked anchor;
   - an existing RS alert keeps firing on schedule (`GET` its last-evaluated time before and after);
   - the cache keys `rs4p4` appear in logs.
3. **The next 03:00 build.** The receipt shows `bars_rs.phase3_ms` and the three columns fill. Then push the follow-up that promotes them out of `_scalars_excluded`, and add the "Rotation: Improving quadrant" starter.
4. **Merge Phase 4.** The copy is live: tour, RSI row, glossary. Verify on a fresh test account (the `bench@` member account, never the owner's Chrome) that the tour shows once.
5. **`RS_LISTS_ENABLED=1`** (per call, no redeploy needed, but confirm from the pod: CLAUDE.md records that `--set` behaviour differs by service). Verify the 04:40 receipt and the two lists in the picker the next morning.
6. **`RS_COMPASS_TOOLS_ENABLED=1`**, after the report card run with the tools on has passed the safety checks (§6).
7. **The Study import** happens on the owner's word, after the merge (`scripts/study/import_bank.py --only rs`). Members see items only as the owner approves them.

### Rollback

- `RS_V3_ENABLED` off plus a redeploy returns the v3 row byte for byte (3-05's control test). The `requiresServer` controls disappear on the next page load.
- An instance saved with `view: 'rotation'` simply draws the ratio under the v3 server, because `resolve_inputs` drops the undeclared key (F4). Its picker shows the preset hidden, not wrong.
- No alert is touched in either direction (F42-F44).
- The other two flags are per call.

### How saved alerts bound to rev 3 survive

- `ADDRESS_REVS["rsLine"]` goes to 4 because the rail triangle requires it (F6).
- `compute_rev("rs_line.*")` then answers 4, but no runtime reads it for a builtin (F42).
- No binding has an `indicator_alert_rev` row, so none is suppressed (F43).
- The alert series never read the wire (F44).
- 3-03's no-move rail guarantees the two functions the alerts call are unchanged.

If a future phase ever changes `compute_phase1_columns` or `compute_mansfield_columns`, an operator script must call `migrate_bindings_to_rev("rs_line", N, notify=...)` in the deploy that ships it. Nothing does that automatically. 3-05 records this in the `ADDRESS_REVS` comment so the next author finds it.

---

## 5. Decisions the owner would normally make, with the recommended answer

The owner delegated these. Each answer below is the most member-friendly honest one, with its reason.

| # | Question | Recommended answer | Why |
|---|---|---|---|
| D1 | Which RRG formula: the Terminal's shipped `RRG_METHOD` (SMA 10/5, tail 8) or the plan's §7.14 (EMA trend, sigma-normalised, clipped)? | **The Terminal's formula, everywhere** (chart preset, screener column, Compare tab, glossary). 3-13 measures it against StockCharts. Only if agreement is under 85% do Terminal and chart switch together to §7.14, in one unit with a release note | Members already read the Terminal's numbers. Two "RS-Ratio" values for one stock would be the exact two-authorities defect the plan's principle 5 forbids. The shipped formula is simpler, already printed under its graph, and needs fewer bars (works on young names) |
| D2 | Reading switch: keep the `showMansfield` bool and add more bools, or one enum? | **One "Reading" enum** (Ratio, Mansfield, Rotation, Quality, Volatility-adjusted). `showMansfield` stays declared as a `legacy` input and maps to Mansfield on the server | Bools allow two readings on one scale (the flattened state A2 removed). An enum is one choice and one pane. Keeping the old key is the only way saved Trend layouts stay valid (F20) |
| D3 | Default placement for new instances: pane or on price? | **Pane stays the default.** "On price (own scale)" is a Display-in choice, drawn in the lowest third under the bars | Changing the definition's target moves every saved instance (F30). The own-scale overlay is for members who want the IBD look; the pane is what 2a's readout and phone work were tuned for |
| D4 | What may a custom benchmark be? | **Any listed ticker** matching `^[A-Z][A-Z.\-]{0,9}$`, ETFs included. No index symbols (`$SPX`). Not offered for alerts in Phase 3. No bars yet → an empty pane with "No XYZ bars yet; they usually load within a minute", never a silent swap to SPY | Honest about the data the web pod holds (F13). An alert on an arbitrary symbol would bypass the benchmark cache the alert lane depends on (F17) |
| D5 | Where does the rotation view live? | **A Rotation tab in Compare Symbols** (desktop), drawing the Terminal's extracted graph. Phone members use the Terminal's `RRG`. Cap 12 names; a bigger group shows the 12 highest IBD-style ratings and says so | The plan named the Compare panel, and the graph already exists. One graph and one formula. 12 is the Terminal's tested legibility limit (F37) |
| D6 | Anchor date semantics | **The first daily bar on or after the picked date**, ET session date. Daily charts only (the checks are daily, F11). A Reset row restores "the benchmark's lowest close of the last 20 sessions". An unusable date shows its reason, never a quiet fallback | Matches what a member sees under the cursor and keeps the default visible |
| D7 | Timeframes for the screener columns | `rrg_quadrant` **weekly**, `clenow_score` **daily 90 bars**, `vars_state` **daily** | The plan's Rotation preset is weekly; Clenow's published use is 90 trading days; VARS is a daily read |
| D8 | Evidence lines for the three new cards | **Only [V] statements from `03-evidence.md`**: "A map, not a system" for Rotation; the Quanterlab out-of-sample line for Quality only if `03` tags it [V], else the honesty sentence; "Dampens genuine breakouts" for VARS only if [V]. Each card otherwise ends with the honesty sentence | v4's copy rule: nothing tagged [S] or [U] is member copy |
| D9 | List names | **RS Leaders** and **RS Emerging** | "Leadership" is already the UCT 20 list's name on the dashboard and in the API. Two different "Leadership" lists would confuse members on day one |
| D10 | List host and history | **Two managed prebuilt watchlists**, updated in place nightly, under "UCT Relative Strength", with the theme in each item's note and theme-block order. No dated history. Screener starters with the same rules, added after the first fill | Members already open prebuilt lists in the Watchlist widget and chart from them. A dated family (the Sunday Scans pattern) would add 250 lists a year for a daily read. The rule's own screener starter is the history (it runs on any day's snapshot) |
| D11 | List rule details | Leaders: `rs_rating_ibd ≥ 90`, `rs_nh_bars_ago ≤ 10`, `pct_vs_sma200 > 0`, `rs_benchmark_agree = 1`. Emerging: `rs_cross_up_bars_ago ≤ 5` and `rs_rating_ibd ≥ 80`, not already a Leader. ETF-free, with the `_RS_LIQUID` floors. Cap 30, cut by rating | The plan's rule written in real columns. "Benchmarks agree" is SPY and RSP, and the list's description says so (F33) |
| D12 | Tour copy and trigger | **Five cards on the first add of UCT RS**, inside the chip menu (desktop popover or phone sheet), skippable, seen state stored server-side. Card 3 drops the "87" figure: "Watch for RS new highs. When the line tops its old high before price does, the stock is leading before the chart shows it." Card 4 as v4 §6.11. Card 5 ends with the tagline once: "Navigate the market, effectively." | The chip menu is where the explanation already lives, and it avoids the first-run slot that waits on `/charts` (F46). The 87 figure has no published sample (v4 §1.7) |
| D13 | RSI row | Queries **"rsi" and "relative strength index"**, exact match. The row carries an Add button | Catches the confusion the research names first, without polluting RSI results for "rsi divergence" |
| D14 | Premium preview | **Moot; no work.** The library's "premium" badge stays as is | There is no free tier (F48). A lock and preview would be shown to nobody. The badge marks UCT's server-computed indicators and is pinned by a test |
| D15 | Glossary page | **Public at `/methodology/relative-strength`**, linked from the RS About page | Static text with no member data, the same class as the measured-edge method page. Compass and support can link to it |
| D16 | Compass scope | **Two read tools** (`get_rs_reading`, `explain_rs`) on voice and chat, behind their own flag, plus "Ask Compass about this" on the chip (voice) | Gives the "what does the gold dot mean" answer in the indicator's own words. Watchlist-wide questions stay with `grade_watchlist` |
| D17 | Study drills | **About 40 drafts in four families**, skill `read.rs`, unit "Reading relative strength". Each chart drill shows the real RS pane | Small enough for one review sitting. The real indicator teaches the look members will use |
| D18 | Walkthrough video | **Captioned, no voice-over**, recorded by the capture tool on the sandbox, published on the Desk under the same show rules as other Desk videos | Captions are consistent, translatable and fast to redo after a UI change. A voice-over can come later if the owner wants one |
| D19 | `compute.rev` | **Bump to 4**, behind `RS_V3_ENABLED`, with no binding migration | It follows the rev-3 precedent and the rails. A cold cache comes for free. Alerts are provably unaffected (§4) |
| D20 | One flag or several for Phase 3 | **One** (`RS_V3_ENABLED`) | The row shape, the columns and the controls are one contract. Arming them separately would recreate the half-state the `requiresServer` gate exists to prevent |

---

## 6. What cannot be automated, and why

| Item | Who | Why it needs a person |
|---|---|---|
| Merging the Phase 3 and Phase 4 PRs | Owner | Repo policy: agents push branches and open PRs; merges to master deploy to production |
| Setting `RS_V3_ENABLED`, `RS_LISTS_ENABLED` and `RS_COMPASS_TOOLS_ENABLED` on Railway, and the redeploy for the first | Owner (or an agent on his explicit go) | Production configuration changes are his call. The import-time flag restarts the web pod, so pick a quiet window (`docs/runbooks/deploy-windows.md`) |
| StockCharts RRG reference readings for 3-13 (quadrants of the 11 sectors on 12+ weekly dates) | Owner or an operator with a browser | StockCharts has no public API for RRG data, and the reading is visual. An agent may drive a browser only in its own profile, never the owner's Chrome (CLAUDE.md) |
| Approving every Study draft (4-08) and the go for the pod import | Owner | The Study module requires his review of every item. The import runs on the production pod |
| Running the Compass report card with the new tools on | Owner approves the spend | It calls the Anthropic API (tokens are billed; see the cost-driver memory). The deploy-gate rule says no Compass change ships on a failed safety check |
| Publishing the walkthrough video | Owner | The upload goes to his YouTube channel (OAuth credentials are his), and the published video is public to members. Registering it on the Desk is an admin write (`POST /api/education/videos`) |
| Adding the walkthrough's YouTube id to the workshop sheet, so `SEED_VIDEOS` regenerates with it | Owner | `SEED_VIDEOS` is generated from his sheet (`tools/gen_education_seed.py`). The Learn rail requires the id there (F47) |
| Approving the screenshots of the views, the overlay margins (D3) and the tour on a phone | Owner (delegated; he reviews on mobile) | Visual calls and brand. The "polish every feature" rule asks for a real-screen review before calling a unit done |
| Creating any new Discord or other external webhook | Owner | Not needed for Phase 3 or 4 as mapped. It is listed only so nobody adds one. The RS Discord webhook from 2b is still on his list |

Housekeeping found while reading, not part of either phase: `docs/feature_flags.json:3138` records `RS_V2_ENABLED` as dark while production runs it on (3-05 corrects it); the "every native is free today" comment at `IndicatorLibraryDialog.jsx:585-587` is out of date (4-03 removes it).
