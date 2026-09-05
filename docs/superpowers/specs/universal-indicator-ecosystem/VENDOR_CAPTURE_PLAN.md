# Track A — Vendor Capture Plan (TradingView Tranche 1 + thinkorswim/TC2000 prep)

Prepared 2026-09-04, per the owner's hybrid vendor-capture protocol (this session's
message beginning "Use a hybrid vendor-capture protocol"). **This document is the
plan. No observation has been captured yet.** Per `tests/fixtures/vendor/README.md`:
"A PLAUSIBLE NUMBER IS WORSE THAN NO NUMBER" — nothing below is written into
`tests/fixtures/vendor/observations/` until it was read off a real vendor screen.

**Owner-imposed boundary, restated so it travels with this plan:** I do not request,
enter, or store TradingView credentials; I do not create an account; I do not touch
subscription/account settings; I do not purchase anything. When login is required I
stop and the owner performs it manually. Once the owner confirms they are logged in,
I resume to do the mechanical capture work below.

## How the manifest and the existing divergence rows shaped this plan

Read fresh for this plan (not from memory): the 64-function `closedTable.json`
manifest, all 5 rows of `tests/fixtures/vendor/divergences.json` (every
`observation_ids` array is currently empty — **zero real vendor observations exist
today**, despite two rows carrying `status: accepted` / `status: confirmed`), the
vendor README's schema and transcription protocol, and the exact Python
implementations of `compute_atr_raw`, `compute_rsi_raw`, `compute_stoch_raw`, and
`_aroon_col` (`api/services/ast_interpret.py:1684-1713`, `api/services/
indicator_compute.py`).

Two things fell out of that reading that materially shape the tranche:

1. **`atr-tr-starts-at-bar-1`'s `status: accepted` is evidenced by
   `tools/vendor_spec_probes.py` — an independent implementation of Pine's
   *published* formula — not by a real observation.** Per `divergences.json`'s own
   `_status_vocabulary`, that is the `spec-falsified` tier ("weaker than
   `confirmed` — nobody has read the vendor's SCREEN"), not the `confirmed`/
   `accepted` tier the row currently claims. This isn't a claim the underlying
   *decision* (keep Wilder's true convention) is wrong — `test_ast_indicators.py`
   independently proves ours is genuinely Wilder's — it's that the row is currently
   resting on a weaker evidence class than its own status name promises. A real
   TradingView observation is the direct fix, and it's also the exact "previous
   incident" class the owner asked to prioritize (this divergence was originally
   raised as a member-visible correctness concern because ATR feeds position
   sizing).
2. **`_aroon_col`'s own docstring already asserts an unverified algebraic identity
   against Pine**: "Pine writes `100 * (hb + n) / n` where this writes
   `100 * (n - hb) / n`. The two look opposite and compute the SAME number — which
   is precisely why `ta.highestbars` is refused at the Pine door." That claim has
   never been checked against a real `ta.aroon` plot. High-value, previously
   invisible target.

## Compatibility labeling (the 4-tier scheme)

Per the owner's instruction, adding a **distinct coverage dimension**, separate from
existing self-consistency/definition rails. This is documentation, not code — it
will live as a new section in `VALIDATION_COVERAGE_MAP.md` once real observations
exist to populate it (not created empty today, to avoid a table full of
`UNVERIFIED` rows that nobody asked for yet — the tranche below is what will
populate the first real rows). Definitions, most authoritative:

| Tier | Meaning | What currently qualifies |
|---|---|---|
| **UCT SELF-CONSISTENT** | JS and Python lanes agree (`ast_conformance.py --check`, 1e-9) | Every one of the 64 functions |
| **DEFINITION-TESTED** | Matches an independently-specified mathematical definition (a textbook formula, a vendor's *published prose*, or an independent from-spec re-implementation) | `atr` (Wilder's, `test_our_atr_IS_WILDER...`), `smoother-seeds-with-sma-of-first-window` (via `vendor_spec_probes.py`), `hull-half-window-floors` (via internal cross-check against Hull's published formula) |
| **VENDOR-OBSERVED** | At least one real, provenance-complete observation exists in `observations/` | **None today** |
| **VENDOR-VERIFIED** | Enough *discriminating* observations exist that the compatibility claim is load-bearing, not a single lucky bar | **None today** |

**Guardrail, stated because the owner explicitly asked for it:** one observation on
a stateless function (e.g. one bar of `ta.rsi`) is enough evidence to call that
function VENDOR-OBSERVED but not yet VENDOR-VERIFIED unless the read bar was chosen
to discriminate something (matches the probe-quality rule `divergences.json`
already enforces on itself). A `seeded` or `stateful` shape needs multiple
discriminating reads (seed bar + steady-state bar, or pre/post-latch bars) before
it earns VENDOR-VERIFIED — a single mid-series read of an EMA proves almost nothing,
because seed and carry-state errors decay and hide exactly where a careless read
would land (this is `divergences.json`'s own stated reason the `seeded` shape
exists as a category).

## TradingView Tranche 1 — bounded, discriminating, two scripts, one chart

**Design goal stated up front:** minimize logins/chart-switches inside the
authenticated session without sacrificing discrimination. Every case below was
selected because it produces a DIFFERENT number/bar under at least two candidate
semantics — never because it was convenient to sample.

**Chart:** AAPL, Daily, most recent ~6 months of bars (comfortably clears every
window below — `hma55` needs ~62 bars of lookback, the deepest dependency in this
tranche — and AAPL has had no split since 2020, so an unadjusted daily chart over a
recent window carries no split/dividend-adjustment risk per the README's own
guidance). One chart, two Pine Editor scripts added to it.

### Script 1 — synthetic smoother oracle (resolves the two open smoother rows)

```pine
//@version=5
indicator("uct-oracle-smoother-v1", overlay=false)
raw  = bar_index == 20 ? na : (10.0 + bar_index)
ema5 = ta.ema(raw, 5)
rma5 = ta.rma(raw, 5)
sma5 = ta.sma(raw, 5)
plot(raw,  "raw")
plot(ema5, "ema5")
plot(rma5, "rma5")
plot(sma5, "sma5")
```

This is the "synthetic/deterministic input inside the vendor runtime" the owner
asked for: `raw` ignores AAPL's real OHLC entirely (it's a pure function of
`bar_index`), so the chart choice becomes irrelevant to the result and the case is
reproducible on any symbol. One planted `na` at `bar_index == 20` gives a single
script two independent reads:

- **Seed check** (upgrades `smoother-seeds-with-sma-of-first-window` from
  spec-probe-refuted to real-vendor-observed): read `ema5`/`rma5`/`sma5` at
  `bar_index == 4` (the first bar all three should be non-`na` under a
  SMA-of-first-window seed: `raw` = 10,11,12,13,14 → mean = 12). If `ema5[4] !=
  sma5[4]`, the seed is NOT the window SMA and the row flips from `refuted` to
  `confirmed` — a real, load-bearing finding.
- **NaN-restart check** (resolves `nan-restarts-the-smoother`, currently
  `suspected` with no observation): read `ema5`/`rma5` at `bar_index` 19 through
  24. Under our convention (`ours`), both should be `na` for 4 bars after the hole
  (21, 22, 23, 24) and resume fresh on 25 (window 21-25). Under a carry-state
  convention, they'd continue with no gap at bar 21. **This is a pure bar-count
  observation — no float comparison needed to tell the two apart**, exactly the
  quality `divergences.json`'s own `_probe_rule` demands.

Human step: scroll to the start of the chart's loaded history (Home key / scroll
left) so `bar_index` 0-25 is reachable in the Data Window — no special trick, just
ordinary chart navigation.

### Script 2 — real-data multi-indicator oracle (bundles B, C, and the remaining A row)

```pine
//@version=5
indicator("uct-oracle-realdata-v1", overlay=false)
atr14                        = ta.atr(14)
tr1                          = ta.tr(true)
rsi14                        = ta.rsi(close, 14)
stochK14                     = ta.stoch(close, high, low, 14)
[aroonUp14, aroonDown14]     = ta.aroon(14)
hma55                        = ta.hma(close, 55)
modSign                      = (close - open) % 3
plot(atr14, "atr14")
plot(tr1, "tr1")
plot(rsi14, "rsi14")
plot(stochK14, "stochK14")
plot(aroonUp14, "aroonUp14")
plot(aroonDown14, "aroonDown14")
plot(hma55, "hma55")
plot(modSign, "modSign")
```

Reads needed, all from the Data Window (not the tooltip, per the README):

1. **ATR bar-0/bar-1 alignment** (the "accepted"-but-under-evidenced row, and the
   real prior incident) — scroll to the very first bars of the loaded history and
   find the FIRST bar at which `atr14` prints a value, and read `tr1` on the first
   TWO bars of the series. The divergence row's own probe says this is visible
   *without comparing any float* — just which bar number first carries a value —
   so this is a fast, high-confidence read.
2. **RSI** — read `rsi14` at any one steady-state bar comfortably past bar 14 (the
   user's own named example function; promotes RSI from DEFINITION-TESTED-by-
   inheritance to VENDOR-OBSERVED directly).
3. **Stochastic %K** — read `stochK14` at the same bar. Low ambiguity risk (a
   textbook formula, and Pine's `ta.stoch(source, high, low, length)` signature
   matches our `stoch(source, high, low, length)` argument-for-argument), so this
   is a cheap confirmation rather than a live suspicion — worth one read because
   it costs nothing once the chart is open.
4. **Aroon Up/Down** — read both at the same bar. This is the one that checks
   `_aroon_col`'s own unverified "the two look opposite and compute the SAME
   number" claim against Pine's actual `ta.aroon`, not just against Pine's
   documented `ta.highestbars` semantics.
5. **HMA(55)** — read at the same bar. Cheap (one more plotted line, same chart),
   and it directly re-grounds `hull-half-window-floors` — currently `confirmed`
   only against Hull's *published formula*, never a real TradingView plot — in
   real vendor-screen evidence instead.
6. **mod sign** — find (by scrolling, or by eye on the candles) a nearby RED daily
   bar (`close < open`) and read `modSign` there. A green bar would not discriminate
   anything (the two candidate conventions can agree by coincidence on a positive
   dividend), so the bar must specifically be chosen for `close < open`.

**Bars to capture for `market.bars` in every observation drawn from this chart:**
the ~90-100 most recent daily bars ending at the read date (covers `hma55`'s ~62-bar
dependency with margin), via TradingView's "Export chart data" feature if it's
available on a free account, or manual Data-Window transcription of OHLCV per bar
if it is not — this is a genuine unknown until the session is live, noted here
rather than assumed either way.

**What happens after capture (offline, no further vendor-platform access needed):**
for each read, I run OUR OWN Python implementation (`compute_atr_raw`,
`compute_rsi_raw`, `compute_stoch_raw`, `_aroon_col`, the `hma`/`mod` AST bindings)
against the identical captured vendor bars, encode both into the observation schema,
and run `python tools/vendor_truth.py --check`. A delta gets classified per the
README's own three-way rule (explained / unexplained-bug-until-proven-otherwise /
transcription error) before anything is changed — never an immediate semantics
edit, per the owner's explicit instruction.

## Tooling & CI verification (2026-09-04)

Verified end-to-end against the current, still-empty observation store, so the
plumbing is proven sound BEFORE it carries any real evidence — proving the pipe
works is different from having anything to pour through it:

- `python tools/vendor_truth.py --check` → **exit 2**, correctly refuses on the
  empty store with the exact "this is NOT a pass" message the README promises.
- `python tools/vendor_truth.py --coverage` → **exit 2**, reports 0 held in all
  three shapes (`stateless`/`seeded`/`stateful`).
- `python tools/vendor_truth.py --selfcheck` → **exit 0**, and it genuinely
  discriminates: an agreeing planted value reports `MATCH`, a value deliberately
  offset by +1.0 reports `DELTA`. This is the positive control the README
  requires ("a harness that cannot fail on a planted defect cannot pass on a
  real one") and it is not decorative — confirmed by reading its actual output,
  not just its exit code.
- `python -m pytest tests/test_vendor_truth.py -v` → **15/15 passed**, including
  the harness-discriminates test and the ATR-accepted-ruling test.
- `load_observations()` (`tools/vendor_truth.py:104-106`) returns `[]` when
  `tests/fixtures/vendor/observations/` doesn't exist on disk — **the directory
  is not required to exist for the tool to behave correctly**, so no placeholder
  `.gitkeep` was added; doing so would be a cosmetic no-op, not a fix for
  anything actually broken.
- **CI wiring: none exists.** Searched `.github/workflows/` (the only file is
  `optionsflow-guard.yml`, an unrelated partner-file guard) and every YAML/TOML/
  JSON config in the repo — nothing invokes `vendor_truth.py`, and there is no
  general pytest CI workflow in this repository at all today for `vendor_truth`
  to be missing FROM. Adding vendor-truth-specific CI where no general test CI
  exists would be an odd, isolated addition outside this track's judgment to
  make well — reported as a finding, not fixed, per the owner's own instruction
  to report rather than guess when authority is unclear.

## Full prioritized vendor-parity function list (all 64, beyond Tranche 1)

Extracted programmatically from `closedTable.json`'s `functions` section (64
entries, verified by `len()`, not retyped). Ranked by the owner's own stated
criteria — known ambiguities first, then core/high-use indicators with no
vendor observation, then internally-cross-checked-but-never-vendor-observed
entries, then everything else — with `seeded` weighted above `stateless`
because a seeding error decays and hides exactly where a careless read would
land (the vendor README's own reasoning, not an assumption added here).

**A structural finding that reshapes the `stateful` row of `--coverage`:**
none of the 64 functions is actually `stateful`-shaped in the README's sense (a
non-decaying LATCHED decision, its own named example is `supertrend`).
`closedTable.json::_functions_excluded.supertrend` states this is a **deliberate
grammar limitation** — Pine's own reference implementations agree it needs
unbounded self-reference (a ratcheting band + a flip against its own prior
value) that this AST cannot express; every declared function with internal
state (`ema`, `rma`, `atr`, `adx`, `vwap`, `obvN`, `cumFrom`) is a *decaying
seed*, not a *latching decision*. **So the `stateful` shape's 0-coverage is not
"uncaptured," it's "inapplicable until a new sealed stateful primitive is
declared" — an engine-design decision outside Track A's authority, not a
vendor-observation gap this track can close.** Reported here so nobody spends a
future tranche looking for a stateful vendor capture that cannot exist yet.

### Tier 1 — known ambiguities (`divergences.json`), unresolved or under-evidenced

| Function | Shape | Row | Why it leads |
|---|---|---|---|
| `ema` / `rma` | seeded | `nan-restarts-the-smoother` (suspected, no observation ever), `smoother-seeds-with-sma-of-first-window` (only spec-probe-refuted) | The manifest's own words: "the highest-leverage unmeasured decision in the engine." Feeds `rsi`, `atr`, `adx`, `macd` — an error here propagates into every one of them. Tranche 1. |
| `atr` | seeded | `atr-tr-starts-at-bar-1` (status `accepted` but evidenced only by a spec probe, not an observation — see the retention-style finding at the top of this doc) | A genuine prior member-facing incident; feeds position sizing. Tranche 1. |
| `mod` | stateless | `mod-takes-the-sign-of-the-dividend` (suspected) | Cheap (one constant-literal plot), closes an open suspicion outright. Tranche 1. |
| `hma` | stateless | `hull-half-window-floors` (confirmed only against Hull's *published formula*, never a live plot) | Already the subject of one near-miss (`fractionalWindowAdvice` shipped wrong guidance until `ba78a1e27`). Tranche 1. |

### Tier 2 — core/high-use indicators, self-consistent or definition-tested only, zero vendor observation

| Function | Shape | Why |
|---|---|---|
| `rsi` | seeded (own Wilder recurrence, own seed — NOT literally the shared `rma` binding, so it is an independent seed question, not merely inherited from Tier 1) | The owner's own named example; the single most recognizable oscillator in the product. Tranche 1. |
| `adx` / `plusDI` / `minusDI` | seeded, double-smoothed | ADX has a genuine, well-known industry history of cross-platform disagreement (DM calculation and smoothing conventions vary by vendor) — this is a real-world risk class, not a hypothetical one, and it has never been vendor-observed here. Recommend for Tranche 2. |
| `macd` | seeded (two EMAs + a signal EMA) | The single most recognized indicator after RSI; inherits the Tier-1 EMA seed question a second, compounded way (EMA of an EMA difference). Recommend Tranche 2. |
| `stoch` | stateless (raw %K only in this engine — no mid-pipeline rounding at the AST layer, confirmed by reading `ast_interpret.py::_fn_stoch` directly) | Textbook formula, low live risk, but zero observation exists — cheap to add. Tranche 1 (bundled). |
| `cci`, `mfi`, `williamsR` | stateless per-window | All three have known industry-wide convention variants (CCI's mean-deviation choice, MFI's tie-handling on unchanged typical price, Williams %R's sign/range display convention). Stateless means no decay-hiding risk, but also zero observation exists. Recommend Tranche 2. |

### Tier 3 — bar-reading / session / channel functions, medium priority

| Function | Shape | Why |
|---|---|---|
| `aroonUp` / `aroonDown` | stateless, bar-index-derived | `_aroon_col`'s own docstring asserts an unverified algebraic identity against Pine's `ta.highestbars` convention — never checked against a live `ta.aroon` plot. Tranche 1 (bundled). |
| `vwap` / `avwap` / `cumFrom` | live, session-anchored accumulation | Session-boundary conventions (regular vs. extended hours) are a classic real-world VWAP gotcha. **Harder to capture than the rest of this tranche** — needs a live session straddling a real market open, not an after-hours-friendly synthetic read. Defer to a dedicated, market-hours-timed capture rather than force it into Tranche 1/2. |
| `donchianUpper` / `Middle` / `Lower` | stateless | A rolling max/min channel is about as unambiguous as arithmetic gets. Low priority. |
| `pivothigh` / `pivotlow` | forward-declaring, extensively self-tested (tie-plateau corpus counts) | The manifest explicitly claims to match "what TradingView draws" for a strict-extreme pivot, but this has never been checked against a live chart. Medium — nice-to-have confirmation of an existing strong internal claim, not an open suspicion. |
| `obvN` | stateless-per-window bar reader | Flat-day (zero price change) contribution convention is a real, if narrow, cross-vendor OBV gotcha. Medium-low. |
| `ichimoku*` (5 functions) | mixed, one forward-reaching (`ichimokuChikou`) | Genuinely complex; Pine has no single `ta.ichimoku` built-in (members typically paste a hand-composed script), so capture needs a full custom script, not a one-liner — more expensive per observation than anything above. Defer to a later, dedicated tranche. |
| `barssince` / `valuewhen` | bounded-state | The `n`-vs-`-1` sentinel difference from TC2000's `SinceTrue` is already a DECLARED, deliberate divergence, not a suspicion — a TC2000 read is a nice cross-reference for that specific document, not an open question needing resolution. Low priority for TradingView; noted for the TC2000 tranche. |
| `highest` / `lowest` / `highestbars` / `lowestbars` | stateless / tie-break convention | Already unusually well self-tested (a real 579-bar corpus with a counted tie rate, per `_functions_arg_extreme`) — a live read would be confirmatory, not urgent. Low priority. |

### Tier 4 — near-zero vendor-parity risk (standard-library math / already-settled by design)

`abs`, `sign`, `sin`, `cos`, `tan`, `atan`, `sinh`, `exp`, `ln`, `log10`,
`sqrt`, `pow`, `min`, `max`, `idiv`, `na`, `nz`, `change`, `crossOver`,
`crossUnder`, `sma`, `wma`, `sum`, `dev`, `stdev`, `round`. These are either
literal IEEE math-library calls with no platform-specific convention to
diverge on, or textbook rolling-window formulas already serving as the
*calibration* functions `vendor_spec_probes.py`'s own docstring cites as
agreeing to ~1e-13 precision (i.e., they are the control group, not a
suspect). `round`'s cross-language half-rounding difference is already an
explicit, tested design decision (matches Pine's away-from-zero convention),
not an open question. `accum` is an engine-internal composition primitive with
no directly-callable Pine equivalent to observe against. Not worth a capture
slot ahead of anything in Tiers 1-3.

## thinkorswim / TC2000 — prepared now, captured later

Per the owner's ruling: no placeholder files under `tests/fixtures/vendor/
observations/` (any file there implies "this went through the transcription
protocol," and an empty-but-shaped file is exactly the "plausible number" risk the
README warns against). Instead, tracked here, explicitly labeled
**VENDOR-UNVERIFIED**, until a real capture happens.

### thinkorswim — highest-value targets + prepared formulas

| Function | thinkScript oracle | What it would resolve | Capture steps |
|---|---|---|---|
| ATR | `plot ATR = WildersAverage(TrueRange(high, close, low), 14);` alongside `plot TR1 = TrueRange(high, close, low)[0]` on bar 1 | Same bar-0/bar-1 alignment question, second dialect | Add a Custom study with the two plots above on a `AAPL` Daily chart with no corporate actions in-window; open the Chart's data grid / hover crosshair for exact values; read the FIRST bar `ATR` prints and `TR1`'s first two bars |
| RSI | `plot RSI = RSI(length = 14);` (thinkScript built-in, Wilder's by default) | VENDOR-OBSERVED for RSI, 2nd dialect | One value at one steady-state bar |
| na/gap handling | `plot Raw = if BarNumber() == 21 then Double.NaN else 10 + BarNumber();` `plot EMA5 = ExpAverage(Raw, 5);` | thinkScript's own na-restart-vs-carry-state convention (a THIRD, independently useful data point beyond Pine's) | Same synthetic-series technique as Script 1; `BarNumber()` is thinkScript's `bar_index` equivalent |

### TC2000 — highest-value targets + prepared formulas

TC2000's PCF (formula) language is more limited (no native na-injection or
bar-index-driven synthetic series in the way Pine/thinkScript allow), so the
prepared targets lean on real-data reads rather than synthetic ones:

| Function | PCF oracle | What it would resolve | Capture steps |
|---|---|---|---|
| ATR | `ATR(14)` (PCF built-in) plotted alongside price on an AAPL Daily chart | Same bar-alignment question, third dialect — or a `refuted` finding if TC2000's own convention differs from both Pine and ours, which would itself be a new, useful divergence row | Read the first bar the study prints a value, cross-referenced against the chart's own OHLCV grid |
| RSI | `RSI(14)` | VENDOR-OBSERVED for RSI, 3rd dialect | One value at one steady-state bar |

### Short human capture protocol (both platforms, reusable)

1. Open the exact script/formula text above on a real chart (symbol/date noted at
   capture time — do not substitute a "similar" script).
2. Read every value **from the platform's own data grid / crosshair readout**, not
   a tooltip, full precision, no rounding.
3. Record: platform, platform version if shown, capture date, the exact bars used
   (OHLCV), and a screenshot if the platform makes one easy.
4. Hand the raw numbers + screenshots back — I do the schema encoding and the
   `vendor_truth.py --check` run, exactly as with the TradingView tranche.

Until step 4 happens for a given row, it stays recorded here as **VENDOR-UNVERIFIED**
and nowhere else — never fabricated, never inferred, never silently promoted.

## After the TradingView capture — the report this plan owes

Per the owner's spec, once Tranche 1 is captured I will return, in this order:
(1) functions tested, (2) oracle cases used, (3) raw vendor observations, (4) our
computed results against the same bars, (5) exact matches, (6) mismatches, (7)
ambiguities resolved, (8) ambiguities remaining, (9) compatibility-tier changes,
(10) new regression fixtures added, (11) anything that changes the Phase One
roadmap. Any mismatch is classified — vendor semantics / source market data /
session-timeframe / forming-bar behavior / parameter-default behavior / translation
/ canonical execution / unknown — before any UCT semantics change is even
considered, and minimized/documented rather than immediately "fixed."

## Status

**Plan complete. No login has been requested yet — this document was the
preparation the owner asked for before that happens.** Ready whenever the owner
chooses to log into TradingView; thinkorswim/TC2000 remain prepared-but-uncaptured
by design.
