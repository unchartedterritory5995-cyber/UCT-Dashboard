# PA4 — Ichimoku compatibility-safe fix, and the 13 / 41 / 1 classification explained

Audit follow-up, 2026-10-13. Worktree `C:/w/indaud`, branch `audit/indicators-competitive-2026-10-13`, base `origin/master` = production `4a368e80ed`. **No runtime code, tests or config were changed.** The scratch probes are in `app/src/__audit_scratch__/phaseA-4/` and are not committed: `ichimoku.test.js` writes `ichimoku.json`, and `classify.py` holds the limitation ledger. All bars are synthetic: a seeded LCG random walk of 600 daily bars, plus closed-form linear bars. No market values were used.

Existing tests, run unchanged:
- vitest `indicators.test.js`, `goldenFixtures.test.js`, `engine/__tests__/sarIchimokuFlipParity.test.js` and `engine/__tests__/plotDisplacement.test.js`: **155 passed**.
- pytest `tests/test_indicator_ichimoku_periods.py` and `tests/test_indicator_golden.py`: **156 passed**.

---

# Task 1 — Ichimoku

## 1.1 Decision trail: why the cloud is undisplaced and unfilled

| Date | Commit / doc | What happened |
|---|---|---|
| 2026-05-04 | `4faa2b9bc9` "feat: add Ichimoku Cloud overlay indicator" (Patrick + Sonnet 4.6) | **The first implementation was already undisplaced.** One loop from `senkouBPeriod - 1` pushes `spanA`/`spanB` at `bars[i].t`, the bar that produced them, and pushes chikou at `bars[i - 26].t`. Five `LineSeries` are drawn with no fill. The commit message says "Senkou Span A & B (cloud boundaries)" and never mentions displacement. **Nothing records a decision.** It reads as an original implementation gap, not a choice. |
| 2026-08-01 | `2a61e0ce08` "compute stops rounding and stops trimming" (Phase B1) and plan `docs/superpowers/plans/2026-08-01-phase-b1-engine-foundations.md:518` | The B1 plan **verified** the deviation and wrote: *"B1 preserves all three behaviors exactly — pixel parity now, deliberate correction later in B3 with the owner's sign-off."* The commit message repeats this. It is the source of the docstring at `indicators.js:38-46`. **So it was a deliberate pixel-parity decision taken during a migration**, and it was explicitly scoped as temporary. |
| 2026-08-01 | `192193705b` "cover the four natives that had no tests" | Tests pin the CURRENT, non-standard span behaviour *"deliberately — correcting it is a separate, owner-visible decision"*. |
| 2026-08-01 | `62cb610da3`: native registry (`nativeRegistry.js:678-681`) | *"Expressing the cloud is a B3 decision with a pixel change."* No fill was added because a `band` needs a centre series. |
| 2026-08-02 | B3 plan `docs/superpowers/plans/2026-08-02-phase-b3-migration.md` | **B3 never scheduled the Ichimoku correction.** Its adjudication table has A5 (MACD head mask) and A7 (VWAP UTC-day anchor), and both went to the owner (spec `2026-07-31-indicator-platform-design.md:250-251`: MACD mask dropped on 2026-08-02; VWAP corrected on 2026-08-03 as `compute.rev` 2). B3 was scoped to **four** indicators (`:7`, `:4792`), and Ichimoku was left in the "remaining ten". |
| 2026-08-04 | `ebfec13f5f`, B5 Task 6, "sar and ichimoku are engine-drawn" | Ichimoku was migrated *"Transcribed, not corrected — correcting one is a measured owner-facing decision (the MACD head-mask at 88 px, the VWAP anchor at 2,590 px), not something a migration does in passing."* It was never priced in pixels and never put to the owner. |
| 2026-08-06 | `docs/decisions/2026-08-06-closed-bar-alert-cutover.md:179-192, 405-420` | The chikou alert dies under the closed-bar lane (19,574 fires lost). The ruling: chikou rows stay `active=1` and are surfaced as `needs_attention` with the displacement named, no `i-26` shim is added, and new chikou alerts are refused. The record notes that *"forward-displacing the cloud is an owner-facing chart change"*. |
| 2026-08-07 | `docs/decisions/2026-08-06-machine-repaint-linter.md`; spec D-A6 (`:265`) | **This is the only owner input on Ichimoku ever recorded, and it is about the chikou repaint badge, not displacement:** *"about the ichimoku, i have no idea. you decide."* The agent chose `preview-repaints` per plot. |
| 2026-08-09 | `97c22842b5` (formula functions): `closedTable.json` `_ichimoku_forward_cloud` | The formula functions `ichimokuSpanA/SpanB` were built on the undisplaced compute. The note says the forward displacement is "not drawn by this product and is therefore not declarable". ⚠️ **The note is partly wrong:** it says declaring the displacement would brand the spans `preview-repaints`. A forward-*drawn* span reads *older* data (`lead[i-25]`) and cannot repaint. Only chikou reads forward. |
| 2026-08-15 | `0b08759fac` "Ichimoku threw on periods its own form accepts" | The loop start moved from `senkouBPeriod - 1` to `longest - 1`. That fixed a crash and left identical output at 9/26/52. |
| 2026-09-28 | `nativeRegistry.js:649-652` (`calcTimeframe: false` comment) | This comment says *"Its cloud is PROJECTED"*, which is **false**. The library description, *"a projected cloud"* (`:646`), is also false. |

**Answer.** Displacement was missing from the first implementation (May 2026). B1 then deliberately froze the deviation for pixel parity and promised an owner-signed B3 correction. B3 dropped Ichimoku from scope, B5 transcribed it, and **no owner decision on displacement or the cloud fill was ever requested or recorded.** Every "B3" reference in the code (`indicators.js:40-46`, `nativeRegistry.js:681`) points at a phase that has finished without doing the work.

## 1.2 Technical constraints

**Measured on synthetic bars** (`phaseA-4/ichimoku.json`):

| Fact | Result |
|---|---|
| Legacy `spanA`/`spanB`/`tenkan` vs an independent *undisplaced* lead line (Pine's `leadLine1`/`leadLine2`) | **max abs 0**. The span maths is correct. It is drawn on the wrong bar. |
| First finite bar, engine vs TradingView convention | tenkan **51 vs 8**, kijun **51 vs 25**, spanA **51** (drawn) vs lead 25 / drawn 50, spanB 51 vs drawn 76, chikou **25 vs 0** |
| Chikou index shift | the engine writes `close[j+26]` (549/549 bars); TradingView's built-in uses `offset = -displacement + 1`, which is `close[j+25]` (0/549 match). **The chikou is one bar off TradingView**, a MetaTrader-style shift. |
| Price vs cloud (above/inside/below), legacy vs conventional | **177 of 524 bars differ (33.8%)**; 8 bars are on opposite sides |
| Cloud colour (spanA > spanB) at each bar | **232 of 524 differ (44.3%)** |
| Projected tail a conventional chart draws past the last bar | **25 points** |
| `binder.drawShiftOf({displace: 25})` | **0**. Positive displacement is refused or ignored. `-25` gives `-25`. |

### Forward displacement needs future time points

- The **future axis** is a hidden whitespace `LineSeries` (`StockChart.jsx:1827-1895`, effect `:8529-8556`), built by `buildFutureWhitespace`.
  - D bars skip weekends and NYSE holidays.
  - Intraday slots are naive `last + i·step`, so they run through overnight hours.
  - **`FUTURE_MIN` is below 25 on several frames:** `30`/`60` = 24, `W` = 20, `M` = 14, and any unlisted TF = 20 (`:1835`).
- **A native compute cannot output beyond the last bar.** The output contract is input-length (`indicators.js:4-9`), and `toPoints` maps `i < bars.length` only (`binder.js:310`).
- `plots[].displace` exists (2026-09-26), but it is **negative only**. `defSchema.js:1458-1471` refuses positive values: *"A rightward displacement belongs in the tree as a bar offset"*. `displacedColumn` (`binder.js:285-300`) only re-indexes inside the bar range. So the platform's rule is: **a rightward shift is computed** (the value at bar i is `x[i-N]`), and nothing can draw into the future.
- LWC itself can draw it. The time scale is the union of all series' times (that is how the whitespace series extends the axis). A line series whose last points sit at future slot times is legal. It needs:
  - a new binder capability: a "projection tail" whose times come from the same slot generator;
  - the fill primitive's `times` (`binder.js:2221`) extended to cover the tail.
- **Live path.** `_applyData` (`StockChart.jsx:10814-10829`) calls `update(lastPoint)` unless the last point is whitespace. With a tail, the last point is the projection of the *current* bar's lead value, and that is exactly the only projected value that changes on a developing bar. So the incremental path stays correct. A backwards `update` is caught and falls back to `setData` (the refused-update crash class is already guarded there).

### How Chikou works today

- The compute writes bar i's close to index `i − kijun`, leaving a **trailing NaN pad of 26** (`indicators.js:520-522`; Python `indicator_compute.py:933-934`; golden fixture pad declared as `TRAILING_PAD`).
- It is declared `forward: 26` (`nativeRegistry.js:701-702`), so the linter's verdict is `preview-repaints`.
- The renderer turns NaN into whitespace. `_applyData` falls through to `setData` because the newest point is whitespace (`StockChart.jsx:10821-10826`).
- The closed-bar alert lane can never read it. Existing chikou alerts are `needs_attention`, and new ones are refused (`indicator_alert_service.py:1160-1176`).

### Server lane and alerts: what an alert on `spanA` should mean

- `alert_series.py:202-206` addresses the five columns with fixed kwargs 9/26/52.
- Ichimoku conditions are `_OSCILLATOR_CONDITIONS`: above, below, or crossing a **typed threshold** (`indicator_alert_evaluator.py:648-653, 720-724`).
- There is no user-facing "price vs cloud" relation. `THRESHOLD_OPERAND` is a server-declared table (`:529-534`), and the formula alert lane (`alert_user_series.py`) can express `close > ichimokuSpanA(...)`.

Proposed conventional semantics (TradingView convention, with `off = displacement − 1 = 25`):

| Reading at closed bar t | Definition | Note |
|---|---|---|
| `spanA` (the cloud **under bar t**) | `leadA[t − 25]` = (tenkan[t−25] + kijun[t−25]) / 2 | No lookahead; computable at t |
| `spanB` (under bar t) | `leadB[t − 25]` | — |
| Price **above** the cloud | `close[t] > max(spanA_t, spanB_t)`. **Below** is `< min`; otherwise **inside** | Compares price with the spans *displaced to today* |
| Cloud **ahead** bullish / kumo twist | `leadA[t] > leadB[t]`, or a sign change of `leadA − leadB` | This is the cloud that will sit 25 bars ahead |
| Chikou vs price (honest closed-bar form) | `close[t] > close[t − 25]` | It replaces the dead plotted-point alert with no lookahead |

⭐ **Key compatibility fact.** Today's undisplaced `ichimoku.spanA` at bar t **equals the conventional *leading* Span A computed at t** (what TradingView draws at t+25). So every existing alert has a coherent conventional meaning: "Leading Span A (projected)". Keeping it exactly is a *relabel*, not a frozen bug.

### Cloud fill

- **Correction to the brief:** Bollinger and Donchian do **not** use a fill. Their `band` style is drawn as a centre line only (`pool.js:84-96`: *"BB's middle and Donchian's middle are single LineSeries… with NO fill"*). No native declares `fill` today.
- The usable primitive is `plots[].fill: { with }` (C1-B, `fillPrimitive.js`; binder `:2207-2233`). It is schema-validated for any definition (`defSchema.js:1750-1758, 1979-2016`). It supports per-bar colours through `colorMode: 'column:<key>'` (`fillColours`, `binder.js:444-452`), which covers a green/red cloud, never bridges gaps, and honours each edge's draw shift.
- The fill would work for a native once the compute returns a `{0,1}` "bull" column, which must be declared (hidden plot or event column). Note: **a native declaring `fill` is untested.**

### Warm-up

- The loop starts at `longest − 1 = 51` for **all** lines, inherited from the May-2026 single loop over trimmed arrays.
- B1 padded the arrays but kept the start for parity, and `0b08759fac` only generalised `senkouB` to `longest`.
- Conventional start bars are: tenkan t−1 (8), kijun k−1 (25), leadA max(t,k)−1 (25), leadB s−1 (51), chikou 0.
- The formula functions inherit the same start (`closedTable._ichimokuSpanA_note`).

## 1.3 Compatibility map

| Surface | What is stored or bound | Versioning | Changes if computed conventionally? |
|---|---|---|---|
| Chart instance | `{instanceId, defId:'ichimoku', defVersion:1, inputs, placement, hidden, scope?}` (`instances.js:11-19`). Legacy-seeded and re-enabled instances store **only what the user set** (`:480-490`, `instanceControls.js:342`). `addInstance` writes every declared default plus `createInputs` (`instanceControls.js:508-516`) | `defVersion` is **informational**: a mismatch is tolerated (`instances.js:567-573`). `compute.rev` lives in the definition and is not pinned per instance. **The registry holds one definition per id** (`nativeRegistry.js:3958`). There are no versioned native definitions | Yes: all five lines and the head-of-history values |
| Templates / layouts / presets | Copies of instances (e.g. `__fixtures__/preset-tradingview-price-overlays.json:187`) | none | Yes, unless they carry an explicit input |
| Indicator alert | `indicator_alerts` row: `indicator` (address), `condition`, `threshold`, `params_json` (seeded from **server** defaults, not the instance — WS1 D-5), `instance_id`, `last_value` (`indicator_alert_service.py:110-170`). Side table `indicator_alert_rev(def_rev, …)` (`alert_rev_migration.py:95-105`) | `ADDRESS_REVS` only `{"vwap": 2}` (`:68-71`). A rev bump **force-migrates** every binding (reset, suppress first cycle, notify). It does **not** pin | Yes: `ichimoku.tenkan/kijun` (warm-up only), **`spanA/spanB` (every value)**, `chikou` (shift 26→25) |
| Alert replay / baselines | `tools/alert_replay.py` frozen grid (691,195 fires), `tests/fixtures/alerts/*` | digest | Yes (all ichimoku rows) |
| Formula functions | `ichimokuTenkan/Kijun/SpanA/SpanB/Chikou` (`closedTable.json` `functions`); JS `interpret.js:2862-2865` and Python `ast_interpret.py:2108-2128, 2391-2395` both call the shared compute | A saved definition's `compute.rev` comes from its `astHash`. Changing the *function* changes every saved formula with no rev change | **Yes, unless the functions are kept as-is.** They are the undisplaced lead lines, which is a legitimate Pine series. Keep them |
| Formula alerts / screener scans | `alert_user_series.py`, `screener/scan_evaluator.py` (formula functions only) | as above | Only if the functions change |
| Pine import | Pine has no `ta.ichimoku`. Scripts compose donchian, and a positive integer `offset` becomes a tree `x[N]` (`pine.js:24422-24434`), which is **already the conventional at-bar value, with no future tail**. Negative offset → `displace` | — | No. ⚠️ A native and an imported Ichimoku on one chart already disagree |
| Builder "customize" forks | not customizable: *"Ichimoku's forward cloud"* (`builtinForks.js:16`) | — | No |
| Golden fixtures / parity | `tests/fixtures/indicators/ichimoku_9_26_52.json`, `goldenFixtures.test.js`, `test_indicator_golden.py`, `test_indicator_ichimoku_periods.py`, `sarIchimokuFlipParity.test.js`, `ast/lint.test.js` (trailing pad 26), `tests/test_alert_closed_bar.py:820-872` | — | Yes |
| Linter / badges | chikou `forward: 26` (`nativeRegistry.js:702`); `closedTable._ichimoku_forward_cloud` | — | Chikou forward becomes 25. The spans stay non-repainting |
| Copy | library description *"a projected cloud"* (`:646`); the `calcTimeframe` comment; the `indicators.js` docstring | — | Copy only |

## 1.4 Options

| | (a) New "Ichimoku Cloud" v2 + legacy renamed | (b) One definition, `displacement` input: absent = 0 (legacy), new = 26 | (c) Global switch with notice (`compute.rev` 2) |
|---|---|---|---|
| Charts | Old instances render as "Ichimoku (legacy, undisplaced)". The upgrade swaps `defId`. **The `instanceId` changes** (`newInstanceId(defId)`), so bound alerts orphan (`instance_missing_at`) | Old instances are **byte-identical** (absent → 0). New instances (library, toolbar, agent `addInstance`) get 26 through `meta.createInputs`, the **exact precedent of Stochastic `smoothK`** (`nativeRegistry.js:550-557`, `instanceControls.js:236-255`). Upgrade = set the input to 26 on that instance; the id is kept | Every chart moves at once |
| Alerts | Legacy addresses unchanged. Five new addresses appended at the **end** of `SERIES_FUNCS` (the order rule at `alert_series.py:161-173`) plus a new replay grid | Add a `displacement=0` kwarg to the five `_column` entries. Missing params mean 0, so **every armed alert keeps its exact series** and replay `--check` is unchanged. New alerts carry 26 **only if the popover seeds from the instance** (D-5 is a prerequisite, otherwise a silent mismatch) | Rev migration resets `last_value`, suppresses one cycle and notifies, **but the meaning of every armed `spanA` threshold changes**, and level alerts can flip state on the deploy |
| Formulas | Unchanged | Unchanged (lead lines). Document `ichimokuSpanA(high, low, 9, 26, 52)[25]` for the cloud under the bar | Unchanged if the functions are kept; otherwise every saved formula moves silently |
| Python lane | New compute or param | Same param in `compute_ichimoku_raw` | Rewrite the compute; legacy is gone |
| Surface churn | **High**: registry counts and enumeration rails, catalog, library-hidden list, mobile sheet, agent resolution of "Ichimoku", presets, `cs.indicators.ichimoku` seed mapping, alert labels and `alertSets` base | **Low–medium**: one definition and one input; a new projection capability in the binder (needed by every option) | Lowest code, highest user impact |
| Policy fit | Clean | Legacy becomes a supported *input value*, not a pinned rev. This needs an owner ruling against spec §3.1's "no eternal pinning" | This is spec §3.1 as written (the VWAP precedent), but it contradicts the owner's "not at the expense of silently changing existing studies" |

## 1.5 Recommendation: option (b), shipped in three steps

1. **Compute, both lanes.** Change `computeIchimoku(bars, t, k, s, displacement = 0)` and `compute_ichimoku_raw(…, displacement=0)`.
   - `displacement === 0`: the current code path, untouched (byte-identical; no `compute.rev` bump).
   - `displacement ≥ 1`: `off = displacement − 1`.
     - Per-line warm-up.
     - `spanA[i] = leadA[i−off]`, `spanB[i] = leadB[i−off]`.
     - `chikou[j] = close[j+off]`.
     - Return `leadA`/`leadB` (undisplaced) as extra columns for the tail and for "cloud ahead" readings, plus `cloudBull` (`{0,1}`) for the fill colour.
2. **Definition and rendering.**
   - `ichimoku` gains `periodInput('displacement', 'Cloud displacement', 0, 0, 100)` and `meta.createInputs: { displacement: 26 }`.
   - `spanA.fill = { with: 'spanB', colorMode: 'column:cloudBull' }`.
   - Chikou `forward` follows the input (25 or 26).
   - Add a new plot field, e.g. `projectFrom: { column: 'leadA', bars: { param: 'displacement', add: -1 } }`, which the binder draws into future slots from the same generator as `buildFutureWhitespace`. Raise `FUTURE_MIN` to at least `off` on every frame.
   - Fill `times` cover the tail.
   - Legacy instances get an inspector notice: *"Undisplaced (legacy) — the cloud sits over the bars that produced it, unlike other platforms. [Use standard cloud]"*.
3. **Alerts.**
   - Add `displacement=0` to the five addresses.
   - The popover seeds `displacement` (and periods) from the instance.
   - On upgrade, list the alerts bound by `instance_id` and offer:
     - **keep** (default): unchanged series, relabelled "Leading Span A/B (projected)";
     - **switch**: re-arm through the `alert_rev_migration` machinery (reset `last_value` and suppress the first cycle).
   - Never auto-change.
   - Later: declared "price above/below/inside cloud" and "kumo twist" conditions, and the honest chikou form `close vs close[25]`.

**Files:**
- `app/src/components/chart/indicators.js`
- `engine/nativeRegistry.js`, `engine/defSchema.js` (projection field), `engine/binder.js` (tail + fill times), `engine/readout.js` (optional future-slot chips)
- `StockChart.jsx` (`FUTURE_MIN`; slot generator into the binder ctx)
- `IndicatorSettingsDialog.jsx` (notice and upgrade), `IndicatorAlertPopover.jsx` (seeding)
- `api/services/indicator_compute.py`, `alert_series.py`, `indicator_alert_evaluator.py` (labels), `ast_lint.py` / `TRAILING_PAD`
- `closedTable.json` notes and sentences (no function change; rewrite `_ichimoku_forward_cloud`)
- `tests/fixtures/indicators/_generate.py`; the copy in `indicators.js:38-46` and `nativeRegistry.js:646-652, 678-681`

**Tests (independent references, synthetic bars):**
1. **Closed form**, n=120, h=10+i, l=9+i, c=9.5+i, 9/26/52, d=26 (all verified in the probe):
   - tenkan[i] = i+5.5, first at 8 (13.5);
   - kijun[i] = i−3, first at 25;
   - leadA[i] = i+1.25, first at 25;
   - leadB[i] = i−16, first at 51;
   - drawn spanA[60] = 36.25 (i−23.75), first at 50;
   - drawn spanB[80] = 39 (i−41), first at 76;
   - chikou[10] = 44.5 (close[35]), last finite at index 94;
   - tail of 25 points, the last = 120.25.
2. **Random walk**: a test-local reference (the `tvIchimoku` shape in the probe) matches the engine at d=26 with 0 diff, and **d=0 equals the committed `ichimoku_9_26_52.json`** (the legacy golden fixture is left untouched).
3. **Python**: a new shared fixture `ichimoku_9_26_52_d26.json` asserted by both lanes, and an extended `test_indicator_ichimoku_periods.py`.
4. **Instances**: absent key → legacy output (`JSON.stringify` equality); `addInstance`, the toolbar and the agent → 26; legacy blob seed → absent.
5. **Alerts**: `params_json` without `displacement` gives an identical series, and `tools/alert_replay.py --check` digest is unchanged; with 26 the series is displaced; the closed-lane chikou pad is 25.
6. **Binder/LWC**:
   - tail count = off;
   - tail times ⊆ the future whitespace slots;
   - fill times include the tail;
   - the incremental `update` does not throw;
   - a rail: `FUTURE_MIN[tf] ≥ max displacement − 1`.
7. Parameter sweep over the `displacement` range, and the chart-parity case "legacy instance = 0 changed px".

**Risks:**
- The projection tail is a new binder capability (M). Intraday slots run through overnight clock time, so the projected cloud re-lays when the session opens.
- Old templates and presets re-create legacy instances.
- New alerts are silently legacy until D-5 seeding lands.
- The TradingView (25) vs MetaTrader (26) convention must be ruled on.
- Agent and NL answers about "above the cloud" must read the displaced columns.
- The golden, replay and lint rails must gain cases without losing the legacy ones.

---

# Task 2 — The 13 / 41 / 1 classification, re-derived

**WS1's rubric** (`WS1 §1.2`): status 2 = "correct maths, but chart-only, timeframe-gated, has a convention or parity caveat, or is premium-gated". The 41 are vwap, stoch, avwap, atrBands, movingAverage, dollarVolume, rsLine, volumeProfile and the 33 Tier-1 studies.

**Categories:** CALC = calculation defect · CONV = convention difference (documented) · VIS = missing visual feature · CFG = incomplete configuration · REACH = surface reach (chart-only) · TF = timeframe gating · ACCESS = access gating · APPROX = untested/approximate · Other-PARITY = the chart is right but another surface (alert/formula) computes a different value · Other-HIST = level depends on loaded history · Other-LIVE = live-update latency · Other-DOMAIN = input-domain defence.

**Severity:** S1 user-visible wrong value · S2 misleading UI or value · S3 missing capability · S4 cosmetic.

## 2.1 Per built-in limitations (each limitation has exactly one primary category)

| Built-in | Limitations (category, severity) |
|---|---|
| vwap | PARITY S1: the alert anchors at ET midnight over ETH bars while an RTH-only chart anchors at 09:30 (D-3; `indicator_alert_evaluator.py:1102-1120` has no session filter) · TF S3: hidden on 2/3/10/45/65/120/195/240m (`eligibility.js:59`) · CALC S1: a NaN volume blanks the rest of the session (`indicators.js:367-370`; data-conditional) |
| stoch | PARITY S2: new instances are slow 14/3/3 (`nativeRegistry.js:550-557`), the alert lane is fast-only (disclosed; Tier-1 decision §6) · CONV S4: %K=50 on a flat range · DOMAIN S4: kPeriod 0 throws (D-10) |
| avwap | CALC S1: calendar anchors start at the first *loaded* bar (`indicators.js:1056-1095`; contrast the refusal at `:1069-1076`) · CALC S2: swing anchor = running extreme since the first loaded bar · TF S3: 1–60m only · REACH S3: no alert address; formula `avwap()` covers the session window only |
| atrBands | REACH S3: a Python twin exists but there is no `SERIES_FUNCS` row · CONV S4: Wilder ATR seed |
| movingAverage | REACH S3: alertable only as close-SMA/EMA `price_vs_ma` (`alert_series.py:138-158`, period seeded 50); 7 types and non-close sources are not alertable · PARITY S2: NaN-hole policy differs between lanes (D-7; gappy sources) · LIVE S4: only SMA/EMA step per tick (Tier-1 doc §5) |
| dollarVolume | REACH S3: chart-only |
| rsLine | ACCESS S3: premium (`nativeRegistry.js:3698`) · CFG S3: benchmark SPY/QQQ/IWM only (`:3708`) · REACH S3: no alert, screener or formula; no other-TF calc · CALC S4: 6-dp delivery rounding (`indicator_compute.py:2392-2405`; edge) |
| volumeProfile | APPROX S2: whole bar volume goes to its hlc3 bin, and the binning has no unit test (`StockChart.jsx:1993-1998`) · VIS S3: no up/down split, value area or session/fixed/anchored modes; visible range only · REACH S3: canvas carve-out |
| superTrend | REACH S3 · CONV S4: Wilder vs Pine ATR seed (converges) |
| aroon | REACH S3 (has a formula primitive) · CONV S4: tie → most recent extreme (TA-Lib) |
| vortex, choppiness, ppo, tsi, cmo, ultimate, bullBearPower, envelope, chaikinMoneyFlow, forceIndex, upDownVolume, percentFromMa | REACH S3 only |
| momentum, standardDeviation | REACH S3 only (they have formula primitives) |
| awesome | REACH S3 only (hl2 is the standard source) |
| stochRsi | REACH S3 · CONV S4: flat RSI range → 50 |
| roc | REACH S3 (formula primitive) · CONV S4: default 12 vs TradingView 9 |
| trix | REACH S3 · CONV **S2**: ×100 %-change (TA-Lib) vs TradingView's log ×10000, a different scale (`technicalStudies.js:325-332`; decision doc §4) |
| balanceOfPower | REACH S3 (formula `bop`) · CONV S4: SMA-14 default vs TradingView raw |
| keltner | REACH S3 · PARITY **S2**: formula `kcUpper/kcLower` = EMA(TR, n) (`callExpansions.js:133-140`), chart = Wilder ATR(10) (`technicalStudies.js:389-396`). Same name, different bands · CFG S4: EMA basis only · CONV S4: ATR seed |
| bbPercentB, bbWidth | REACH S3 (bbWidth has `bbw`) · CFG S4: source fixed to close, SMA basis |
| atrPercent | REACH S3 · CONV S4: ATR seed |
| adrPercent | REACH S3 · CONV S4: per-bar range on intraday |
| historicalVolatility | REACH S3 · CONV **S2**: sample σ·√252 vs TradingView population σ·√365, so **TradingView reads ≈17% higher at period 20** (√(365/252)·√(19/20); this corrects WS1's "≈23%") (`technicalStudies.js:480-490`) · TF S3: D/W/M only (`nativeRegistry.js:1604`) |
| squeeze | REACH S3 · CONV S4: generic BB-inside-KC, Wilder ATR |
| relativeVolume | REACH S3 · CONV **S2**: mean of the previous n *bars*, not time-of-day, so intraday RVOL near the open is not comparable to TC2000-style RVOL |
| accumDist, pvt | REACH S3 · HIST S4: the cumulative level depends on loaded history |
| chaikinOscillator | REACH S3 · CONV S4: SMA-seeded EMA vs TA-Lib first-value seed (converges) |
| fiftyTwoWeek | REACH S3 · TF S3: D/W/M only, needs 364 days loaded (`nativeRegistry.js:1732`) · CFG S4: no lookback input |

## 2.2 Counts (78 limitations across 41 built-ins; `classify.py`)

| Category | Limitations | Built-ins affected |
|---|---|---|
| Surface reach (chart-only) | 39 | **39** (all except vwap and stoch) |
| Convention difference | 15 | 15 |
| Incomplete configuration | 5 | 5 (rsLine, keltner, bbPercentB, bbWidth, fiftyTwoWeek) |
| Timeframe gating | 4 | 4 (vwap, avwap, HV, 52W) |
| Calculation defect | 4 | **3** (avwap ×2, vwap, rsLine) |
| Other: chart↔alert/formula parity | 4 | 4 (vwap, stoch, keltner, movingAverage) |
| Other: history-dependent level | 2 | 2 (accumDist, pvt) |
| Missing visual feature | 1 | 1 (volumeProfile) |
| Untested / approximate | 1 | 1 (volumeProfile) |
| Access gating | 1 | 1 (rsLine) |
| Other: live latency / input domain | 1 / 1 | movingAverage / stoch |

By severity: **S1 = 3**, **S2 = 8**, **S3 = 46**, **S4 = 21**. Worst severity per built-in: S1 = 2 (avwap, vwap), S2 = 7, S3 = 32.

## 2.3 Severity-ranked short list

1. **AVWAP calendar anchors are partial-period values** (CALC S1). This is the most common YTD/QTD use. Fix S.
2. **VWAP alert ≠ drawn VWAP on RTH-only charts** (PARITY S1). Fix S–M.
3. **VWAP blanks for the session after one NaN volume** (CALC S1; the frequency in the store was not measured). Fix S.
4. AVWAP swing anchors depend on how much history is loaded (CALC S2).
5. **Keltner formula vs chart bands differ** (PARITY S2; a new finding).
6. Stochastic chart slow vs alert fast (PARITY S2; disclosed). This is part of the general D-5 seeding gap.
7. HV ≈17% below TradingView, TRIX on a different scale, RVOL not time-of-day (CONV S2; documented only in `docs/decisions/2026-10-01-technical-library-tier1.md`, not in the UI).
8. Volume Profile is approximate and untested (APPROX S2).
9. MA NaN-hole policy differs between lanes (PARITY S2; gappy sources only).
10. Timeframe gating of VWAP/AVWAP/HV/52W on offered frames (TF S3).
11. 39 chart-only built-ins (REACH S3). This is a product gap, not a correctness one.

## 2.4 The answer in one line

**Of the 41, 7 have a value-level problem and 34 are correct.**

- **On the chart itself (3 + 1).** 3 have a calculation defect: AVWAP (material), VWAP (conditional on NaN volume) and RS Line (edge-case precision, cosmetic). Volume Profile is approximate.
- **Across surfaces (3 more).** Stochastic, Keltner and Moving Average draw correctly, but an alert or formula of the same name computes something else. VWAP also has this problem.
- **The other 34 are correct.** 16 of them are *purely* chart-only: 15 Tier-1 plus dollarVolume. The other 18 add documented convention differences, gating, configuration limits, premium access or a history-dependent level.

**Caveat on the rubric.** Status 1 is not limitation-free. The D-5 alert-param seeding gap affects every alertable status-1 indicator (e.g. RSI(7) arms RSI(14)). ATR's Wilder seed and OBV's history-dependent level are the same conventions counted here for status-2 rows. In WS1, "status 2" mainly means "has no server twin".

---

# Owner decisions

1. **O-1: Choose the Ichimoku fix.** Recommended: **(b)**, a `displacement` input where absent = 0 (legacy), new = 26, with a per-instance one-click upgrade. Alternatives: (a) a new definition, or (c) a global `compute.rev` 2 with notice.
2. **O-2: Convention.** Recommended: TradingView (spans +25, chikou −25), which makes today's chikou one bar off TradingView. Alternative: MetaTrader/by-index (26).
3. **O-3: Is the legacy undisplaced mode permanent?** It is an exception to spec §3.1 "no eternal pinning", justified because it is an input value, not a pinned rev. The alternative is a sunset with notice after N months.
4. **O-4: On upgrade, what happens to bound alerts?** Recommended default: keep them, relabelled "Leading Span (projected)", with an explicit option to switch. Also decide whether legacy charts get a proactive one-time notice.
5. **O-5: Ship the in-data alignment, fill and warm-up together with the 25-bar future tail**, behind an admin flag first, rather than a cloud without its projection.
6. **O-6: Keep the formula `ichimokuSpanA/SpanB` as undisplaced lead lines** and document the `[25]` idiom, instead of changing saved formulas.
7. **O-7: Prerequisite.** Approve fixing D-5 (alert params seeded from the instance) before or with O-1.
8. **O-8: Accept the reclassification.** Split status 2 into **2a: value issue (7)** and **2b: correct but reach/convention-limited (34)**. Prioritise AVWAP anchors, the VWAP alert anchor and Keltner formula parity ahead of the Tier-1 reach work.
