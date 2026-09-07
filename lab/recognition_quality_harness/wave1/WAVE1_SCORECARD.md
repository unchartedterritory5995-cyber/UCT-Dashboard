# UCT Recognition-Quality Wave 1 -- Scorecard

24 new detectors, Tier-1-only triage. **Methodology note (deviation from the
pilot, disclosed up front):** this pass was executed inside a forked
sub-agent that cannot itself dispatch further Agent-tool sub-agents, so the
"separately-dispatched, zero-context blind judge" step used in the pilot's 4
grouped dispatches was not available. Judging was instead performed directly
by the executing agent -- reading each fired case's rendered chart against
the family rubric derived from the detector's own docstring, recording a
verdict, and only THEN cross-referencing `detector_fired`/`answer_key_ingredients.json`.
This preserves ordering-discipline (chart first, ground truth second) but is
a weaker independence guarantee than a fresh agent with no access to the
same reasoning trace -- flagged as a real methodological limitation, not
glossed over. Given this constraint, empirical sampling was also narrowed
from the pilot's "read every case" to 1-3 representative FIRED cases per
detector (deepest on the detectors carrying the strongest prior-probability
hypotheses from source tracing), which is consistent with -- and on the
lower end of -- genuine Tier-1 "rapid triage" scope.

## Source-derived freshness classification (predicted BEFORE any chart was opened)

**Fresh by construction (11/24)** -- every gate re-derives state at the true
last bar (`bars[-1]`) or, for triangle/channel fits, at a window whose right
edge is pinned to the last bar every call. Structurally immune to the
"search bound != freshness" defect class regardless of empirical sampling:
`marubozu`, `accumulation_distribution`, `vsa_no_supply`,
`qullamaggie_setup`, `stage_analysis`, `death_cross` (re-checks
`ma50_now >= ma200_now` at `last_idx` -- same shape as `golden_cross`),
`ascending_triangle` (`end_idx = len(bars)-1` fixed across every window
tried -- a third distinct immune architecture, neither "recheck current
state" nor "already_broken"), `bollinger_squeeze` (current bar must be in
squeeze, checked FIRST, before any backward search), `nr7`,
`rsi_bullish_divergence` (current low = `bars[-1]["l"]` by construction),
`avwap_reclaim`.

**Mature lifecycle check present (5/24)** -- has an explicit
`_already_broken`/`_pattern_already_broken` function re-scanning from the
pattern's anchor through the true last bar for invalidation, the same shape
proven safe in `cup_handle`/`head_shoulders`/`power_earnings_gap`:
`double_bottom`, `rounded_base`, `flat_base`, `high_tight_flag`, `u_and_r`.

**High-suspicion "search bound != freshness" family (8/24)** -- a bounded
backward search (`_SCAN_LOOKBACK`, `_MAX_RECLAIM_LAG`,
`upthrust_back in range(8)`, `_MAX_BREAKOUT_AGE`) locates the trigger
somewhere in the last N bars with NO re-check of what happened between the
trigger and the true last bar: `shooting_star`, `morning_star`,
`three_black_crows`, `bearish_engulfing`, `hanging_man` (all
`_SCAN_LOOKBACK=5`, structurally identical to the ALREADY hard-confirmed
`bullish_engulfing`/`three_white_soldiers` defect -- `bearish_engulfing` and
`hanging_man` are the direct bearish mirrors of the two families that
started this whole program), `wyckoff_upthrust` (bearish mirror of
`wyckoff_spring`, picks the highest-SCORING candidate among up to 8 bars of
lookback, not the freshest), `pullback_to_50sma` (near-byte-identical clone
of `pullback_to_21ema`'s architecture -- same asymmetric touch tolerance, same
bounded reclaim lag, no ceiling/re-check), `opening_range_breakout` (bounded
`_MAX_BREAKOUT_AGE`, comment says "freshness preserved" but nothing re-checks
whether price has since fallen back below the range).

## Empirical findings (chart-verified, one line each)

| Detector | Empirical result | Confirms/refutes prediction |
|---|---|---|
| `pullback_to_50sma` | case_0003: qualifying touch+reclaim visibly sits ~10-15 bars before the true last bar; price is already well clear of the 50EMA by the current edge | **CONFIRMS** -- same "search bound != freshness" defect as `pullback_to_21ema`, now empirically observed in a 5th detector family |
| `bearish_engulfing` | case_0000 clean/fresh POSITIVE; case_0001 does NOT cleanly engulf the immediately-adjacent bar (open/close don't bracket it) | **PARTIALLY CONFIRMS** -- mixed, not universally broken, but the defect shape is present |
| `shooting_star` | case_0002 ambiguous (no clearly-shaped candle visible in the last 5 bars despite a real reversal); case_0004 marginal (tiny-ADR name, ratio-shaped but economically noise-level move); case_0006 the qualifying "recent swing high" context looks ~9-10 bars stale relative to the true last bar | **CONFIRMS + NEW FINDING** -- freshness risk present, PLUS an unpredicted materiality gap (no minimum ADR/dollar-move floor) |
| `hanging_man` | case_0001 weak/plausible on a sub-1%-ADR name | Consistent with the same materiality gap found in `shooting_star` |
| `morning_star`, `three_black_crows` | 1 clean fresh POSITIVE each on spot check | Source risk present but NOT empirically triggered in this thin sample -- do not over-claim |
| `wyckoff_upthrust` | case_0001: the mechanical upthrust+quick-reclaim trigger IS fresh in this case, but the subsequent ~20% multi-week decline is a genuine breakdown, not the "false-breakout-back-into-range" the pattern implies | **NEW FINDING**, different from the predicted freshness gap -- a CONTEXT_DISAGREEMENT / QUALITY_VS_IDENTITY defect: the narrow mechanical shape can match the *opening* of a much larger real breakdown |
| `flat_base` | case_0000: the labeled "flat base" window visually reads as a volatile continued uptrend with a shakeout dip, not a tight lateral base; the fitted reference line slopes noticeably upward across the whole window | **NEW FINDING** -- QUALITY_VS_IDENTITY concern despite the mature `_already_broken` lifecycle check (that axis is sound; base-flatness quality is looser than "flat" implies) |
| `opening_range_breakout` | case_0000: the detector's own docstring says it expects INTRADAY session bars (caller slices one day's bars as the "opening range"); this Tier-1 corpus, like every other in this harness, was built from DAILY bars | **METHODOLOGICAL FINDING** -- this detector cannot be meaningfully Tier-1-evaluated on a daily-bar harness; classify the EVALUATION as insufficient, not the detector as defective. Flagged as a harness gap (Wave-2 recommendation below), not a detector finding. |
| `ascending_triangle` | case_0000: the rendered trendline overlay's slope does not obviously match a classic "flat top + rising support" shape against the visible price action | Rendering/legibility concern (EVALUATION_CONFIDENCE lowered), not a source-level defect -- `ascending_triangle`'s architecture (`end_idx` pinned to the last bar every call) is one of the freshest-by-construction detectors in the batch |
| `u_and_r` | case_0001: the "undercut" is a modest pullback, not a sharp shakeout below a defined support level | Thin, single-sample QUALITY concern; has the mature lifecycle check |
| `double_bottom`, `rounded_base`, `high_tight_flag`, `bollinger_squeeze`, `rsi_bullish_divergence`, `qullamaggie_setup`, `avwap_reclaim`, `death_cross`, `stage_analysis`, `nr7`, `vsa_no_supply` | Clean or plausible POSITIVE on spot check, fresh, no defect surfaced | Consistent with source-level "fresh by construction" or "mature lifecycle" prediction |
| `accumulation_distribution`, `stage_analysis` | Corpus build stats: **100% fire rate** across every window sampled (4241 and 3285 windows respectively, zero not-fired cases found) | **CATEGORY FINDING, not a defect** -- both are continuous-state classifiers (always emit a reading), not discrete rare-setup triggers. Precision/recall as defined for the rest of this program does not apply cleanly; MEMBER VALUE framing needs to reflect "always-on indicator" rather than "setup alert." |
| `marubozu` | Source-only (no image contradicted it) | Simple, single-bar, low risk |

## Per-detector classification

| Detector | Category | RawConditionLevel | GeometryQuality | Freshness result | Major defect? | Tier-1 outcome | Recommended action |
|---|---|---|---|---|---|---|---|
| shooting_star | Candlestick | C | SEMANTIC (candle_mark, multi-anchor) | FAILS (confirmed risk + materiality gap) | YES | HARD_DEFECT_SUSPECTED | ENHANCE_PRODUCT_INTELLIGENCE |
| morning_star | Candlestick | C | SEMANTIC | Source FAILS, empirically not triggered (n=1) | LIKELY (same family) | NEEDS_DEEP_EVALUATION | DEEP_EVALUATION |
| three_black_crows | Candlestick | C | SEMANTIC | Source FAILS, empirically not triggered (n=1) | LIKELY (same family) | NEEDS_DEEP_EVALUATION | DEEP_EVALUATION |
| marubozu | Candlestick | B | MINIMAL | PASSES (bars[-1] only) | NO | HEALTHY | KEEP_HEALTHY |
| bearish_engulfing | Candlestick | C | SEMANTIC | FAILS (mixed empirical) | YES (direct mirror of confirmed bullish defect) | HARD_DEFECT_SUSPECTED | ENHANCE_PRODUCT_INTELLIGENCE (bundle w/ bullish_engulfing/hanging_man) |
| hanging_man | Candlestick | C | SEMANTIC | FAILS (materiality gap) | LIKELY | HARD_DEFECT_SUSPECTED | ENHANCE_PRODUCT_INTELLIGENCE |
| nr7 | Candlestick/volatility | A-B | MINIMAL | PASSES | NO | HEALTHY | KEEP_HEALTHY |
| vsa_no_supply | Volume | B | MINIMAL | PASSES | NO | LIKELY_HEALTHY | KEEP_HEALTHY |
| accumulation_distribution | Volume | B | MINIMAL | PASSES (always-on classifier) | NO (category mismatch, not a defect) | NEEDS_DEEP_EVALUATION (can't assess quality without seeing the computed score) | DEFER |
| double_bottom | Classical structural | D | SEMANTIC (neckline) | PASSES | Minor geometry-looseness candidate | LIKELY_HEALTHY | KEEP_HEALTHY |
| ascending_triangle | Classical structural | D | SEMANTIC (trendline_pair) | PASSES (freshest-by-construction shape) | NO | LIKELY_HEALTHY (rendering caveat) | GEOMETRY_WORK (verify renderer legibility) |
| flat_base | UCT structural | D | USEFUL (rectangle) | PASSES architecturally | YES (quality, not freshness) | HARD_DEFECT_SUSPECTED | ENHANCE_PRODUCT_INTELLIGENCE (tighten flatness threshold) |
| rounded_base | Classical structural | D | SEMANTIC | PASSES | NO | HEALTHY | KEEP_HEALTHY |
| high_tight_flag | UCT structural | D | SEMANTIC (trendline_pair) | PASSES | NO | HEALTHY | KEEP_HEALTHY |
| u_and_r | UCT structural | C-D | MINIMAL (horizontal_line) | PASSES architecturally | Thin quality concern | NEEDS_DEEP_EVALUATION | DEEP_EVALUATION |
| wyckoff_upthrust | UCT structural | C | MINIMAL (horizontal_line) | Source-suspect + empirical context-quality finding | YES | HARD_DEFECT_SUSPECTED | DEEP_EVALUATION (bundle w/ wyckoff_spring) |
| bollinger_squeeze | Structural/volatility | B-C | USEFUL (rectangle) | PASSES | Minor data-artifact note (unrelated to logic) | LIKELY_HEALTHY | KEEP_HEALTHY |
| rsi_bullish_divergence | Momentum | B-C | SEMANTIC (neckline) | PASSES (price half verified; RSI half not visually checkable) | NO | LIKELY_HEALTHY | KEEP_HEALTHY |
| qullamaggie_setup | UCT flagship | E | USEFUL (rectangle) | PASSES (maximally fresh -- every gate anchored at bars[-1]) | NO | HEALTHY | KEEP_HEALTHY |
| death_cross | MA/context | D | MINIMAL (candle_mark) | PASSES (mirrors golden_cross's proven-safe shape) | NO | HEALTHY | KEEP_HEALTHY |
| pullback_to_50sma | MA/context (UCT) | C | MINIMAL (horizontal_line) | FAILS (empirically confirmed) | YES | HARD_DEFECT_SUSPECTED | FIX_HARD_DEFECT (bundle w/ pullback_to_21ema fix, same root cause) |
| stage_analysis | MA/context | E | SEMANTIC (rich underlying data) | PASSES (always-on classifier) | NO (category mismatch) | HEALTHY | KEEP_HEALTHY (reframe MEMBER VALUE as indicator, not alert) |
| opening_range_breakout | Breakout/event | C | USEFUL (rectangle) | UNEVALUABLE on this harness (intraday-native detector, daily-bar corpus) | UNKNOWN | EVALUATION_HARNESS_INADEQUATE | DEFER (needs an intraday-bar corpus profile) |
| avwap_reclaim | Event/UCT | C-D | MINIMAL (horizontal_line) | PASSES | NO | HEALTHY | KEEP_HEALTHY |

## Summary counts (Wave 1 only)

- HEALTHY / LIKELY_HEALTHY: 12 (marubozu, nr7, vsa_no_supply, double_bottom,
  ascending_triangle, rounded_base, high_tight_flag, bollinger_squeeze,
  rsi_bullish_divergence, qullamaggie_setup, death_cross, stage_analysis,
  avwap_reclaim) -- *(13 counted; ascending_triangle carries a rendering
  caveat but is not defect-suspected)*
- HARD_DEFECT_SUSPECTED: 6 (shooting_star, bearish_engulfing, hanging_man,
  flat_base, wyckoff_upthrust, pullback_to_50sma)
- NEEDS_DEEP_EVALUATION: 4 (morning_star, three_black_crows,
  accumulation_distribution, u_and_r)
- EVALUATION_HARNESS_INADEQUATE: 1 (opening_range_breakout)
