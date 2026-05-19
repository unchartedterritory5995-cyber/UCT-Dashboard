# Pattern Recognition — Phase 9 Batch 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Each detector follows superpowers:test-driven-development (fixture battery FIRST, then make it green).

**Goal:** Complete Phase 9 Batch 2 to full production standard. After this batch: **85 detectors live** (78 committed + 7). Verify the actual committed baseline at run time before asserting the final count.

## Context — why this plan exists

A prior session was interrupted mid-batch. Five Phase 9 Batch 2 detector files were written but never wired, fixtured, tested, or committed. Phase 9 Batch 1 (`eb058bf`) shipped 7 detectors; prior batches were 7 each. To match cadence and "complete and perfect the ultimate pattern recognition tool — the eyes and brain of the world's greatest traders," this batch is rounded to **7 detectors**: the 5 recovered + 2 textbook candlestick additions (`tweezer_top`, `tweezer_bottom`) that complete the single/two-bar candlestick canon alongside `marubozu`.

## Detectors in scope (7 total)

| # | Detector | Category | Direction | State |
|---|---|---|---|---|
| 1 | `marubozu` | candlestick | bullish/bearish | file written, untested |
| 2 | `golden_cross` | classical | bullish | file written, untested |
| 3 | `death_cross` | classical | bearish | file written, untested |
| 4 | `nr7` | classical | neutral | file written, untested |
| 5 | `lance_opening_drive` | uct | bullish | file written, untested |
| 6 | `tweezer_bottom` | candlestick | bullish | net-new |
| 7 | `tweezer_top` | candlestick | bearish | net-new |

## The rigid per-detector "definition of done"

Every prior detector (50+) follows this exact template. Confirmed against `hammer` (reference) and Phase 9 Batch 1 commit `eb058bf`. No deviations.

1. **Detector file** `api/services/pattern_engine/detectors/<cat>/<name>.py`:
   - Module docstring = the pattern definition + attribution (already present for 1–5; write for 6–7).
   - `_PATTERN_ID`, `detect_<name>(bars, context) -> List[Detection]`.
   - Composite confidence: `round(0.40*geom + 0.25*vol + 0.20*ctx + 0.15*hist, 2)`, `hist = 50.0` cold-start, `_CONFIDENCE_FLOOR = 50.0` (confidence < 50 → not emitted).
   - `Detection` shape exactly per `api/services/pattern_engine/types.py` PLUS the trailing fields the template uses: `"status"`, `"outcome": None`, `"detected_at"`, `"last_seen_at"` (see `hammer.py`).
   - `geometry.shape = "candle_mark"` (1,5,6,7), classical cross = `"candle_mark"` (2,3) — match the file's docstring.
   - `geometry.extras` rich dict (every metric the docstring names).
   - `levels`: entry / entry_condition / stop / stop_basis / target_primary / target_secondary / risk_reward.
   - **Narrative**: 5 fields. `headline` ≥ 90 chars. `what_it_is`, `why_it_matters`, `what_to_watch_for`, `failure_signal` each ≥ 700 chars, with real values + named-trader attribution (match the docstring's attribution).
   - `register(_PATTERN_ID, detect_<name>)` at module bottom.
2. **Fixture battery** `tests/fixtures/<name>/` — JSON files + a `_generate.py` script that produces them. Shape per `tests/pattern_engine/detectors/fixture_loader.py`. **Gate 1 minimum: ≥5 positive, ≥8 negative, ≥2 edge.** Negatives must cover every hard-gate boundary the docstring lists.
3. **Test file** `tests/pattern_engine/detectors/test_<name>.py` — mirror `test_hammer.py`: parametrized battery over `load_all_fixtures`, plus `test_fixture_battery_has_minimum_coverage`, `test_narrative_richness`, `test_geometry_extras_richness`, and a levels test asserting the directional setup is coherent.
4. **Wire into** `api/routers/patterns.py`: the `from api.services.pattern_engine.detectors.<cat> import <name> as _<name>  # noqa: F401` import line AND a `_PATTERN_METADATA["<name>"]` entry (`name`, `category`, `direction`, `description`).
5. **Green**: `python -m pytest tests/pattern_engine/detectors/test_<name>.py -q` all pass.
6. **Commit** per task (controller pushes to Railway at the very end).

### Critical rule for detectors 1–5 (recovered code)

The module **docstring is the authoritative spec**, NOT the existing implementation. Build the fixture battery to the docstring's stated conditions/levels/gates. If a fixture written faithfully to the spec fails, **the detector is wrong — fix the detector**, do not weaken the fixture. Untested prior-session code is suspect until the battery proves it.

## Per-detector specs

### 1. `marubozu` (candlestick, bullish/bearish) — recovered

Full-body conviction candle (Nison 1991). Hard gates: body ≥90% of range; each wick ≤5% of range; range ≥1.2× 20-bar avg range; volume ≥1.3× 20-bar avg; bullish = up bar + DCR ≥0.95; bearish = down bar + DCR ≤0.05. Levels (bull): entry `high*1.001`, stop `low`, target `entry + range*2`. Negatives must include: wick >5%, body <90%, below-avg range, below-avg volume, DCR-fails-direction. Edge: exactly 90% body, exactly 5% wick.

### 2. `golden_cross` (classical, bullish) — recovered

50SMA crosses above 200SMA (Weinstein Stage 2). Gates: `ma50>ma200` now; `ma50<=ma200` 5 bars ago; both MAs rising over 20 bars; 200SMA slope ≥ −0.5%; volume soft-gate. Needs ≥200 bars. Levels: entry `close*1.001`, stop `ma50 − ATR14`, target 52w-high (or `entry*1.20`). Negatives: cross too old (>5 bars), MAs declining, 200SMA falling, insufficient bars (<200), no cross.

### 3. `death_cross` (classical, bearish) — recovered

Bearish mirror (Weinstein Stage 4). Gates: `ma50<ma200` now; `ma50>=ma200` 5 bars ago; both MAs declining over 20 bars; 200SMA slope declining/flat; volume soft-gate. Levels: entry `close*0.999`, stop `ma50 + ATR14`, target 52w-low (or `entry*0.80`). Negatives mirror golden_cross.

### 4. `nr7` (classical, neutral) — recovered

Narrowest range in 7 bars (Crabel 1990). Gate: current bar range < all prior 6 ranges. NR4 bonus. Inside-bar confluence. Emits NEUTRAL with both long+short levels (long primary; short in extras). Levels: entry_long `high*1.001`, stop_long `low`, target_long `entry + range*3`; short mirror. Negatives: not narrowest (any prior bar narrower), tie with a prior bar (must be strictly narrowest), <7 bars.

### 5. `lance_opening_drive` (uct, bullish, intraday) — recovered

Lance Breitstein opening drive — highest-edge intraday continuation. Gates: first session bar gap-up ≥1% AND DCR ≥0.7; bar2 close > bar1 close; bar3 close > bar2 close; bar3 DCR ≥0.6; bar3 high == session high; first-3-bar volume ≥2× trailing-20-session avg first-3 volume; needs ≥60 prior bars. Levels: entry `bar3_close*1.001`, stop `bar1_low*0.998` (or session low), target `entry + bar1_range*3`. Negatives: gap <1%, weak first-bar DCR, bar2/bar3 not continuing, bar3 fade (low DCR), bar3 not session high, insufficient volume, insufficient history.

### 6. `tweezer_bottom` (candlestick, bullish) — NEW

**Spec (author this docstring + detector, template = `hammer.py`):** Two (or more) consecutive candles whose **lows match within a tight tolerance** (`|low_a − low_b| ≤ 0.15% of price`, also expressible as ≤10% of the larger bar's range), printing **at a swing low / after a recent decline** (reuse `hammer`'s `_is_swing_low` / `_below_sma50` / `_recent_decline_pct` context logic). Strongest when bar A is bearish and bar B is bullish (reversal handoff). Nison "Japanese Candlestick Charting Techniques" (1991); Bulkowski empirical context. Direction **bullish**, requires next-bar close above the pattern high. Levels: entry `pattern_high*1.001`, stop `matched_low*0.985`, target `entry + 2×(pattern_high − matched_low)` capped at `nearest_resistance`. `geometry.shape="candle_mark"`, anchors = the two matched-low bars. Extras: `low_match_pct`, `bar_a_color`, `bar_b_color`, `at_swing_low`, `below_50sma`, `recent_decline_pct`, `matched_low`, `pattern_high`. Confidence: geometry = tightness of low match + reversal-color handoff; volume = expansion on bar B; context = swing-low/decline/support confluence (mirror `hammer._score_context`). Negatives: lows not matching (>tolerance), pattern mid-uptrend (no reversal context → must not fire / confidence <50), single bar only, both bars same direction with no handoff at a non-low, gap between the two bars' lows just over tolerance (edge), exact-tolerance match (edge).

### 7. `tweezer_top` (candlestick, bearish) — NEW

Bearish mirror of #6. Two consecutive candles whose **highs match within tolerance** at a **swing high / after an advance**. Strongest when bar A bullish, bar B bearish. Direction **bearish**, requires next-bar close below the pattern low. Levels: entry `pattern_low*0.999`, stop `matched_high*1.015`, target `entry − 2×(matched_high − pattern_low)` floored at `nearest_support`. Context: build a swing-high / above-50SMA / recent-advance analog (invert `hammer`'s helpers). Same extras shape (high_match_pct, …, matched_high, pattern_low). Negatives mirror #6 (highs not matching, mid-downtrend, single bar, exact-tolerance edge, just-over-tolerance edge).

## Workflow

Execute via superpowers:subagent-driven-development, one detector per task, in table order (1→7). Per task: implementer subagent (TDD, fixtures first) → spec-compliance reviewer (validates against THIS plan's spec + the docstring, esp. the "fix the detector not the fixture" rule for 1–5) → code-quality reviewer → fix loops until both ✅ → per-task commit → next.

After all 7:
- Audit `api/routers/patterns.py`: 7 import lines + 7 `_PATTERN_METADATA` entries present; `list_pattern_ids()` count == 85 (78 + 7) — verify the actual committed baseline at run time, don't assume.
- Run the full `python -m pytest tests/pattern_engine/ -q` suite green.
- Run `scripts/verify_phase.py` (inspect its CLI; run the launch-readiness / catalog check).
- Final whole-batch code review.
- Controller commits the integration task and **pushes to Railway** (per standing user preference: always commit + push after completing work).

## Definition of "Phase 9 Batch 2 done"

7 detectors live + registered + in metadata; each with Gate-1 fixture battery (≥5/≥8/≥2) and ~17 passing tests; full `tests/pattern_engine/` suite green; pushed to Railway. Catalog reaches 85 detectors.
