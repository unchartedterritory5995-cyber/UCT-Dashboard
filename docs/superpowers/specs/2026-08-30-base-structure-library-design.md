# Base & Structure Library — design

*Written 2026-08-30. Branch `feat/pattern-library-expansion`.*

Extends the bar-naming work from single bars to multi-week structure: the candle
library named what TODAY is; this names what the last several WEEKS built. It is
the "bases and patterns" half of the same job.

---

## 1. The measured problem

The screener's Overview view renders one pattern column, `patterns`, produced by
`api/services/screener/patterns.py` — 45 lines, **six** detectors. Re-measured
2026-08-30 over all 3,707 tickers against current `bars.db`:

| key | hits | % of universe |
|---|---:|---:|
| flat_base | 926 | 24.98% |
| vcp | 657 | 17.72% |
| bull_flag | 113 | 3.05% |
| breakout_52w | 107 | 2.89% |
| golden_cross | 13 | 0.35% |
| death_cross | 9 | 0.24% |
| **any** | **1,519** | **41.0%** |

59% of rows render `—`. Three causes, none of them "this stock has no structure":

1. Six detectors is the entire vocabulary.
2. `golden_cross`/`death_cross` are single-day EVENTS (today's SMA pair vs
   yesterday's), so they are near-permanently empty by construction — 22 of 3,707.
3. `columnDefs.js:186` renders `v.split(',')[0]` — only the first key, ordered by
   the detector's dict-insertion order, not relevance. A name that is both a flat
   base and a VCP displays `flat_base`, and the count is invisible.

### What already exists and is not reachable

| Asset | Location | Contents |
|---|---|---|
| Model book | `uct_intelligence.db::setup_templates` | **48 setups** with `entry_triggers`, `stop_methods`, `invalidation`, `ma_alignment`, `rs_requirements`, `max_stop_pct`, `aliases`, `origin_trader` |
| Sourced criteria | `docs/superpowers/research/setups/setup_criteria.json` | 32 setups, per-criterion numbers + quotes. Header: *"Research artifact only — nothing reads this"* |
| Pattern engine | `api/services/pattern_engine/detectors/` | 85 detectors, 78 fired in the measured window |
| Ground truth | `uct_intelligence.db::setup_triggers` | 209 dated triggers, 119 resolved (47 win / 72 loss) |

**Overlap, measured:** 16 of 48 templates have an exact-name engine detector.
**32 have no detector at all**; 25 of those 32 also have no sourced criteria.
69 of the 85 engine detectors match no model-book template.

---

## 2. Owner rulings (2026-08-30)

1. **Unify all three sources** — model book, engine, research corpus — rather than
   electing one spine and discarding the others.
2. **Claim level: descriptive + measured-lift ledger.** Name the structure; publish
   a number only when measured on our universe against our base rate.
3. **Surface: replace Overview's `patterns` column, and add a Bases view.** The
   cheap heuristic column is retired, not left standing beside the new one.
4. **Scope: everything, including intraday-gated setups** (see §6 for the
   decomposition that makes this honest).
5. **Keep the 18 `detectors/candlestick/*` detectors.** Named consumer: the chart
   overlay `GET /api/patterns/{sym}`, which the candle library does not serve.

---

## 3. The evidence base

15 parallel research lanes, written to `docs/superpowers/research/bases/`:
**11,501 lines, 1.5 MB, ~4,300 quoted excerpts, 794 `value: null` refusals**
(a criterion a source discusses but never quantifies). Larger than the 8,480-line
candle corpus.

Six findings that constrain the design. Each is sourced in the lane files.

**F1 — The literature does not support forecasting.** Measured statistics
published: Weinstein 0, Minervini 0, Morales/Kacher 0, Kullamägi 0, Bonde 0,
Wyckoff 0 (33 explicit "none published"), IBD 0. Bulkowski is the only author who
measures, and his headline figures use `ultimate high = "the highest peak before
price declines by at least 20%"` — a look-ahead maximum with no holding period,
reported as **44% mean against a 23% median on the same 2,703 trades**. Four
sources in the entire corpus report a rate beside its base rate.

**F2 — Measured lift for the classics is approximately zero.** Head-and-shoulders
daily 42.0% vs a 42.0% pattern-free baseline (n=2,795); double bottom 56.9% vs
57.8% (n=6,692). Grimes measured 50-day highs and found underperformance against a
stated ~15%/yr base rate. Double 7's wins 82.5% and still loses buy-and-hold on
return (6.3% vs 10.1% CAGR), winning only on drawdown.

**F3 — Volume confirmation is contradicted by the same author on two pages.**
`Volume.html`: failure falls 25% to 8% as breakout volume rises. `VolumeStudy.html`:
failure is 14% on above-average vs 5% on below-average breakout volume. Opposite
sign, both Bulkowski, neither benchmarked. Independently, Edwards & Magee's own
head-and-shoulders data reports volume higher on the head about a third of the
time, equal a third, lower a third — so the "volume declines across the three
peaks" rule rejects roughly two-thirds of their own confirmed population.
⛔ **A volume gate may not be shipped as a quality upgrade.**

**F4 — Tuning tolerances buys nothing, and counts are not portable.**
Savin/Weller/Zvingelis tightened an H&S detector toward Bulkowski's own criteria:
detections fell 6,406 to 4,452 (−30%) with *"no evidence... that fine tuning the
algorithm... adds anything to its predictive power."* Nekrasov, implementing LMW's
**published** algorithm, fired ~15x more often than LMW (9.06 vs 0.61 H&S per
stock-year). ⛔ **No rate from any paper transfers to our detections, and a
"high-confidence" tier is a smaller sample, not a better signal.**

**F5 — The base vocabulary is commercially unoccupied.** Across 10 vendors
(TradingView, TrendSpider, Autochartist, TC2000, StockCharts, ChartMill, Finviz,
Trade Ideas, MetaStock, Recognia): **none** detects flat base, VCP, ascending base,
high tight flag, Darvas box, base-on-base, or pocket pivot. Vendors sell classical
*geometry*; nobody sells contraction-and-tightness *structure*. Table stakes is 5
patterns. 1 of 10 publishes any statistic about its own accuracy.

**F6 — Repainting is the industry blind spot.** Six of ten vendors say nothing
about it; only MetaStock admits it (*"Tomorrow, the signal might not be there"*);
only TrendSpider engineers against it. A per-detection as-of timestamp plus a
provisional/confirmed flag beats every vendor's disclosure and is nearly free.

### Sources disagree, and that is recorded, never merged

Cross-source conflicts found (lane 14 logs 11 irreconcilable ones):

- **IBD contradicts IBD**: cup minimum length 6 weeks vs 7; cup depth 12–33% vs
  30–35% vs 15–30%; double-bottom depth 30% vs 40%; three-weeks-tight is 1.5%
  between *each* weekly close vs 1–2% between the *highest and lowest* close.
- **The Minervini numbers in our own model book are unsourced.** `setup_templates`
  VCP says *"40-50%+ expansion on breakout day"* and *"1-2% above the pivot"*.
  A regex over the full 218-page *Think & Trade Like a Champion* finds three
  volume-and-percent sentences, **none a breakout threshold**. The only volume rule
  with a named window is the dry-up, *"below the 50-day average."*
- **Trend Template 52-week-low floor is 25%** in the 2017 book, not the 30% every
  third-party implementation uses.
- **The Follow-Through Day gain threshold is 1%–1.25%**, not the 1.7% universally
  attributed to IBD; its volume rule is only *"higher than the prior session; it
  doesn't need to be above average."* Over 37 years the gap is 64 vs 52 signals.
- **Livermore's "Reversal/Continuation Pivotal Point" appears zero times in his
  1940 book** — both are Smitten's 2005 coinages.
- **Darvas denies the stacked-contiguous box** every charting package draws:
  *"The bottom of a new box is not necessarily the top of the old box."*
- **Wyckoff's canon refuses its own taxonomy**: *"there is NO CLEAR CUT LINE of
  demarcation between a #1 spring and a #2 spring."*
- **NR4 means narrower than the previous THREE bars.** An off-by-one silently
  renames the pattern.
- **Crabel's ORB stop sits above the high of the opening range**, not above the
  open — differing by the full range height.
- **Edwards & Magee: arithmetic price scaling manufactures falling wedges** (a
  constant-percentage decline converges in points by construction); they prescribe
  log-space fitting. Murphy gives no scaling caveat. Our `falling_wedge.py`,
  `rising_wedge.py` and `trendlines.py` contain zero references to `log`.

---

## 4. Measured baselines — the ledger's denominator

Computed 2026-08-30, `scratchpad/base_rates.py`, over **3,705 tickers x 10 years**,
**non-overlapping** windows, using `technicals.usable_bars` sanitation:

| Baseline | Value | n |
|---|---|---:|
| A — closes higher after 10 sessions | **52.21%** (mean +1.16%, median +0.30%) | 789,175 |
| B — **+10% before −8% within 20 sessions** | **27.51%** target-first | 393,050 |
| B — −8% before +10% | **33.41%** stop-first | |
| B — neither within 20 sessions | 39.08% | |

⭐ **On a random day in this universe a 10%/8% trade hits the stop first more often
than the target — 33.41% vs 27.51%.** Any named setup must beat 27.51% defined
identically, and any "win rate" quoted without that definition is not comparable.

**The baseline drifts too much to pool.** Well-populated years only:

| year | closes-higher | target-first |
|---|---:|---:|
| 2018 | 47.4% | **17.1%** |
| 2019 | 57.2% | 24.9% |
| 2020 | 54.7% | **35.7%** |
| 2022 | 46.7% | 29.2% |
| 2026 | 53.4% | 35.1% |

⛔ **A structure is compared against the baseline for the years it actually fired
in, never a global constant.** (Rows before 2016 carry n=18–51, an artifact of the
2,600-bar read cap, and are excluded.)

---

## 5. Architecture

Three separable units, mirroring the shape proven by the candle library.

### 5.1 `base_catalog.py` — ONE GRAMMAR

One entry per named structure: `key`, `label`, `family`, `bars` (minimum window),
`bias`, `rank`, `desc`, `predicate`, `sources[]`, `criteria[]`.

Each criterion carries `condition`, `value`, `quote`, `source_id`, `confidence` —
or `value: null` plus `missing:` naming what would have to be published.

⛔ **Where no house publishes a number, the entry is marked `origin: "uct"` and the
number is ours, openly.** It is never attributed to a source that did not say it.
794 criteria in the corpus are in this state; the Minervini 40-50% figure already
sitting in `setup_templates` is exactly the defect this prevents.

The catalog derives the filter enum, the frontend labels, and the docs. Mutual
exclusivity lives **inside** the predicates — a parallel exclusion table would
drift, as `candle_catalog.py` already establishes.

### 5.2 `bases.py` — the classifier

Pipeline, identical in shape to `candles.py`:

    guard -> context -> segment -> classify SHAPE -> collect RELATIONS -> rank -> render

- **SHAPE is a total partition** — exactly one per symbol, always.
- **RELATIONS are sparse** — zero or many.

Fusing these two axes is what produced the original 7-label candle defect; the
split is carried forward deliberately.

**Two new primitives are required.**

1. **Volatility-scaled zigzag** (`primitives/zigzag.py`). Osler's method: the
   reversal cutoff scales to each security's own daily-return sigma, with explicit
   ±2-day de-duplication. `O(n)`, incremental, needs no smoothing pass, and is the
   only segmenter in the literature that is non-repainting by construction.
   ⛔ **The last pivot is always `provisional`** and must be flagged as such — this
   is the rail that makes F6 true for us and false for every vendor.
2. **Shape comparison between pivots** (`primitives/shape.py`). U-vs-V roundness,
   rim equality, symmetry ratios. This — not pivot detection — is the primitive
   whose absence actually blocks cup-with-handle, as `INDEX_bulkowski_patterns.md`
   already corrected on 2026-08-10.

**Line fitting moves to log space**, per Edwards & Magee, and ships with a control
test demonstrating that arithmetic fitting emits a falling wedge on a synthetic
constant-percentage decline while log fitting does not.

Reused as-is: `detect_pivots`, `fit_trendline`, `fit_pair_parallel`, `geometry`,
`volume_signature`, `contraction_score`, `dcr`, `structure_quality`.

### 5.3 `lift_ledger.py` — the evidence layer

For each named structure: `n`, conditional rate, and **lift = conditional −
baseline over the same years**, on **non-overlapping** windows.

Gates, all of which must pass before any number reaches a member:

1. `n` sufficient — **derived, not typed.** The minimum is whatever the CI in
   gate 2 requires at the structure's own observed rate; a hand-picked `n >= 30`
   would be a forecast wearing a threshold's clothes.
2. Lift confidence interval excludes zero.
3. **Lift exceeds the structure's own random-data null** — the identical detector
   run over phase-randomized series. Osler found average simulated profits negative
   ~80% of the time on data where the pattern is meaningless by construction;
   without this control a mechanical drag reads as signal with the wrong sign.

If any gate fails the field is **absent, not `0.0`**. `pattern_join.py` already
documents this exact bug shipping a synthetic breakeven to members as a
measurement; the ledger must not repeat it.

⛔ **Publish lift, never a raw hit rate.** A 57% win rate against a 57.8% baseline
is a negative-lift signal, and the raw number reads as a positive one.

---

## 6. Vocabulary — wave 1

**32 model-book templates have no detector.** All 32 are in scope, plus the
vendor-unoccupied structures (F5) and the Wyckoff schematic.

The 32, enumerated so the count is verifiable rather than asserted:

> Base-on-Base · Box Theory · Green Line Breakout · Low-Cheat · Pocket Pivot ·
> Measured Move · Wyckoff Accumulation · Wyckoff Distribution · Wyckoff LPSY ·
> Wyckoff SOS · BGU · Gap-and-Go · Open Bull Gap Support · Red to Green ·
> Go Signal · HVC · Kicker Candle · Launchpad · Power Play · Stage 2 Breakout ·
> Stage 2 Momentum · Wedge Pop · 20EMA Hold · EMA Crossback · EMA Crossover ·
> FTD · Mean Reversion · Oops Reversal · 7-Week Short Rule · Late-Stage Climax ·
> Short Squeeze · Stage 4 Breakdown

⛔ **`Kicker Candle` is not a base and does not get a base detector.** It is a
two-bar candle formation and the candle library's 62-label vocabulary is its
correct home; the model book simply files it beside the structures. Routing it
here would re-create the two-authorities defect this design exists to avoid.
Wave 1 therefore builds **31** base structures and files one ticket against the
candle catalog. `Oops Reversal` gets the same check during authoring — it is
Larry Williams', it is intraday by construction, and the corpus found Street
Smarts publishes no rules for it.

### 6.0 Wave decomposition

The 31 do not fit one implementation plan. Ordered so each wave ships a working
surface:

- **Wave 1a — the spine + 5 base structures.** `base_catalog.py`, `bases.py`
  skeleton, the two new primitives (`zigzag`, `shape`), the log-space fitting move,
  and the five chosen for unambiguous daily computability and exact quoted numbers:
  **Base-on-Base · Box Theory · Green Line Breakout · Pocket Pivot · Power Play**.
  Proves the pipeline end-to-end including the coverage rail.
- **Wave 1b — the ledger.** `lift_ledger.py`, the baseline table, the
  random-data null, and the honesty rails. Runs against wave 1a's five.
- **Wave 1c — the surface.** Overview column replacement, the Bases view, filters.
- **Wave 2 — stage / trend / remount (8):** Stage 2 Breakout · Stage 2 Momentum ·
  Stage 4 Breakdown · 20EMA Hold · EMA Crossback · EMA Crossover · FTD ·
  Mean Reversion.
- **Wave 3 — momentum continuation (7):** Low-Cheat · Go Signal · HVC · Launchpad ·
  Wedge Pop · Measured Move · Oops Reversal.
- **Wave 4 — short setups (3):** 7-Week Short Rule · Late-Stage Climax ·
  Short Squeeze.
- **Wave 5 — gap & catalyst (4)**, with the §6.1 intraday decomposition:
  BGU · Gap-and-Go · Open Bull Gap Support · Red to Green.
- **Wave 6 — the Wyckoff schematic (4):** Accumulation · Distribution · SOS ·
  LPSY. One state machine, largest single build, natural deferral candidate (§10).

**5 + 8 + 7 + 3 + 4 + 4 = 31.** Every structure is assigned to exactly one wave.
Flat-base variants and Ascending Base are the vendor-unoccupied additions from F5;
they attach to wave 1a's family and are counted separately from the 31, because
they come from the vendor gap analysis rather than the model book.

### 6.1 The intraday decomposition

Measured 2026-08-30 against `bars.db`:

| tf | tickers in screener universe | history |
|---|---:|---|
| 1-min | **98 / 3,707 (2.6%)** | 2026-05-15 -> 2026-08-21 |
| 5-min | **260 / 3,707 (7.0%)** | 2026-03-23 -> 2026-08-26 |

Kullamägi's entry is the high of the first 1- or 5-minute bar; Crabel's ORB needs
the opening range; the Parabolic Short needs VWAP, which has no daily analogue.
These are computable for 2.6–7.0% of names over 3–5 months — enough to detect,
never enough to measure lift.

⭐ **So an intraday-gated setup is split, not skipped:**

- the **structure** and the **entry level** are computed from daily bars and named;
- the **trigger** stays `forming`, carries `needs_intraday: true`, and is promoted
  to `triggered` only for symbols that have the required intraday bars;
- the structure publishes **no lift**, and its ledger row says
  `insufficient intraday history`, not a number.

⛔ A setup whose trigger cannot be evaluated must not render as `triggered` for the
93% of symbols where we cannot see the trigger. Silence there is the honest state.

### 6.2 Families

- **Base structures** — Base-on-Base, Box Theory (per Darvas's own
  non-contiguous rule, not the charting-package version), Green Line Breakout
  (Wish), Low-Cheat, Pocket Pivot, Power Play, Ascending Base, Flat Base variants.
- **Wyckoff schematic** — Accumulation, Distribution, SOS, LPSY, plus the events
  the engine already detects (`wyckoff_spring`, `wyckoff_upthrust`). This is a
  **state machine over a trading range**, not a per-bar predicate: 22 of 28 events
  are sequence-dependent and only 6 can bootstrap. ⚠️ SOS and Upthrust are
  bar-identical at resistance and separable only by later bars, so the detector
  must be able to say "not yet". The three spring types are **not** classified —
  the canon explicitly refuses to draw that line.
- **Stage / trend** — Stage 2 Breakout, Stage 2 Momentum, Stage 4 Breakdown,
  20EMA Hold, EMA Crossback, EMA Crossover, FTD. ⚠️ Weinstein's volume rule is
  **asymmetric by design** — ~2x on a Stage 2 breakout, explicitly none on a
  Stage 4 breakdown. A symmetric filter is not implementing Weinstein.
- **Gap & catalyst** (intraday-decomposed) — BGU, Gap-and-Go, Open Bull Gap
  Support, Red to Green. ⚠️ The BGU volume gate is ambiguous by a factor of 1.67
  in the secondary sources and ships `value: null` until the book text is read.
- **Short setups** — 7-Week Short Rule, Late-Stage Climax, Short Squeeze.
- **Classical** — Measured Move, and the price-objective formulas (18 of 25
  patterns in the E&M/Murphy canon publish one; 7 explicitly do not, and those
  ship no target rather than borrowing Bulkowski's).

⛔ **`Century Mark` is excluded from wave 1.** It must run on unadjusted prices;
our bars are adjusted, and on an adjusted feed it fires at the wrong bars and the
failure is invisible.

---

## 7. States and rendering

`forming` · `triggered` · `busted` · `expired`

`busted` is defined causally — after triggering, price moves **≤10% in the breakout
direction and then closes back on the opposite side of the breakout level itself**
(the pivot for an upside break, the support line for a downside one). Both legs are
knowable at the close of the bar that completes them. No look-ahead. This is the
only terminal state in the
corpus that can be evaluated on a live pattern; Bulkowski's 5% break-even failure
rate has no time bound and runs to the ultimate high, so it cannot.

⛔ **"Confirmed" and "failed" remain banned words**, extending the candle library's
existing rail. A test pins them.

**Rendering** follows the candle library: primary + secondary + count
(`Cup with Handle (Flat Base) +1`), with the state and, where earned, the lift.

**Overview's `patterns` column is replaced** by the new structure label, and
`columnDefs.js:186`'s `split(',')[0]` goes with it — the count and secondaries
render. A **Bases view** carries shape, relations, state, entry/stop levels, and
lift. Both are required: a filter family with no view behind it is half-shipped,
and that rail already exists.

---

## 8. Rails

1. **Coverage check at authoring time.** `cup_handle_uct` gates on six conditions
   simultaneously and fires on **2 of 2,890 symbols**. Every new structure reports
   its universe hit-rate at authoring; a structure at 0 or at >35% is flagged, not
   shipped silently. (`Compression Bar (NR4)` was deleted at 35% for this reason.)
2. **Standalone-vs-cascade diff.** Every predicate is evaluated in isolation and
   diffed against what the cascade actually rendered. This is the diagnostic that
   found `upthrust` at 11 satisfying / 0 rendering; "never fires" alone cannot
   distinguish rare from unreachable.
3. **A volume gate may not be presented as a quality upgrade** — test-pinned,
   citing F3's two contradicting pages.
4. **Non-repainting**: the last zigzag pivot is `provisional`; a test asserts a
   detection's history does not change when later bars arrive.
5. **Log-space fitting control**: a synthetic constant-percentage decline must not
   classify as a falling wedge.
6. **No filter family without a view** (existing rail extends to the new family).
7. **Ledger honesty**: a test asserts that a structure failing any lift gate emits
   **no key**, and that `0.0` is never written for "unmeasured".
8. **Provenance**: a test asserts every catalog criterion has either a `quote` +
   `source_id`, or `value: null` + `missing`, or `origin: "uct"`. No third state.

---

## 9. Explicitly out of scope

- **Retiring the 18 `detectors/candlestick/*`** — owner ruled keep. The boundary is
  railed instead: the candle library owns screener columns, the engine owns the
  chart overlay, neither crosses.
- **Expanding intraday bar coverage** beyond today's 2.6–7.0%. Named as the
  dependency that would unlock the trigger half of the gap setups.
- **Re-enabling `PATTERN_VISION_ENABLED`.** The 640 confirmed verdicts remain the
  only validated pattern output; a confirmed-only surface is a later wave.
- **Changing `setup_templates`' unsourced numbers.** The corpus now proves several
  are unattributable; correcting the model book is its own reviewed change.

---

## 10. Risks

- **The honest answer may be that most structures earn no lift.** F2 predicts it.
  The design must make a lift-free structure a normal, unembarrassing outcome —
  the label still has descriptive value — or there will be pressure to weaken the
  gates.
- **Wyckoff's state machine is the largest single build** and its canon supplies 16
  numbers against 183 `null`s. It may be the right candidate to defer to wave 2 if
  the schedule tightens.
- **`base_catalog.py` will be large.** If it grows past comfortable reading, split
  by family before it becomes unreviewable.
