# Pattern Recognition — Phase 2 (UCT Setups + Structure) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship 8 UCT-specific setup detectors + 4 structure detectors. These are the **edge patterns** — they encode UCT's trading philosophy (the scanner_candidates.py heuristics, the 34-template setup library) directly into the engine. Structure detectors surface support/resistance/trendlines/Weinstein stage as standalone Detection records that the chart overlay can render and other detectors can consume as context.

After Phase 2: **23 detectors live**, ~390+ tests, verify_phase.py 2 PASS.

**Architecture:** Same template as Phase 1 — each detector is a pure function with self-registration, paired with a 15-fixture battery. Structure detectors use `category: "structure"` and `direction: "neutral"`. Their `levels.entry` is the reference level (support price, trendline current price, etc.); `levels.stop` and `levels.target` may be `None` for pure structure markers, or set when the structure implies a trade interpretation (e.g., support bounce → entry above support, stop below, target = prior high).

**Critical for Phase 5 chart overlay:** Each detector's `geometry` field must be rich enough for the UI renderer to draw the pattern. Anchors should mark every visually meaningful point. `narrative` must be substantive — these are the "eyes of great traders" explanations users will read in the side panel.

**Spec reference:** `docs/superpowers/specs/2026-05-11-pattern-recognition-design.md` Section 3.3 (UCT setups) + 3.4 (structure).

**Pattern source material:** Cross-reference these encoded heuristics from the existing codebase:
- `C:\Users\Patrick\uct-intelligence\scripts\scanner_candidates.py` — `_detect_wedge_flag`, `_score_candle_from_df`, signal computation
- `uct-intelligence/data/setup_templates_staging.json` — 34 setup templates with entry/stop/target/invalidation rules

---

## File structure additions

| File | Responsibility |
|---|---|
| `api/services/pattern_engine/detectors/uct/__init__.py` | new package |
| `api/services/pattern_engine/detectors/uct/vcp.py` | Volatility Contraction Pattern |
| `api/services/pattern_engine/detectors/uct/high_tight_flag.py` | HTF / Powerplay |
| `api/services/pattern_engine/detectors/uct/episodic_pivot.py` | EP (volume + range expansion break of base) |
| `api/services/pattern_engine/detectors/uct/power_earnings_gap.py` | PEG (post-earnings gap-up continuation) |
| `api/services/pattern_engine/detectors/uct/flat_base.py` | Flat Base Breakout |
| `api/services/pattern_engine/detectors/uct/u_and_r.py` | Undercut & Rally |
| `api/services/pattern_engine/detectors/uct/remount.py` | Remount (broken stock retakes the level) |
| `api/services/pattern_engine/detectors/uct/cup_handle_uct.py` | UCT variant of Cup-with-Handle |
| `api/services/pattern_engine/detectors/structure/__init__.py` | new package |
| `api/services/pattern_engine/detectors/structure/swing_pivots.py` | Swing pivot mapping |
| `api/services/pattern_engine/detectors/structure/support_resistance.py` | Horizontal S/R levels |
| `api/services/pattern_engine/detectors/structure/major_trendlines.py` | Major up/down trendlines |
| `api/services/pattern_engine/detectors/structure/stage_analysis.py` | Weinstein 1-4 stage |
| `tests/fixtures/{detector}/` | per-detector fixture batteries (15 each) |
| `tests/pattern_engine/detectors/test_{detector}.py` | parametrized battery tests |
| `api/routers/patterns.py` | metadata + imports for all 12 |

---

## UCT setup definitions

The detection rules below come from the scanner_candidates.py heuristics and the setup_library templates. Each detector must articulate WHY the pattern matters in its narrative field.

### Task 1: `vcp` (Volatility Contraction Pattern — Minervini)
- **Window:** 30-90 bars
- **Series of contractions:** at least 2 successive base/pullback cycles, each subsequent contraction must be SMALLER than the prior (typical: 25% → 15% → 8% → 5%)
- **Volume:** dramatically contracts through each contraction; final contraction has the lowest volume
- **MA stack:** stacked_bullish required (close > 10 > 20 > 50, ideally > 200)
- **RS trend:** up
- **Pivot point:** the high of the most recent (tightest) contraction = breakout level
- **Direction:** bullish
- **Entry:** close > pivot on volume > 1.5× avg
- **Stop:** below the most recent contraction low
- **Target:** measured from the start of the first contraction → pivot, projected up
- **Narrative emphasis:** "Volatility is squeezing into a tight pivot. Each contraction is shallower than the last, signaling institutional accumulation. Volume is the tell — it should dry up into the breakout."

### Task 2: `high_tight_flag` (Powerplay)
- **Pole:** ≥90% advance in ≤8 weeks (≈40 trading days)
- **Flag:** tight consolidation, retrace ≤25%, ≤25 bars
- **Channel:** parallel or slightly down-sloping
- **Volume:** dramatic contraction in flag
- **Direction:** bullish
- **Entry:** close > flag high on volume expansion
- **Stop:** below flag low
- **Target:** pole_top + pole_height
- **Narrative emphasis:** "A near-vertical 90%+ advance followed by orderly consolidation. One of the rarest and most powerful continuations — institutional sponsorship is established and the next leg has historically been parabolic."

### Task 3: `episodic_pivot` (EP)
- **Setup:** stock in a multi-week base (15-60 bars of sideways action), depth ≤25%
- **Trigger bar:** breakout day with `bar_range_pct > 2 * avg_bar_range_pct(20)` AND `volume > 2 * avg_volume(20)` AND `close near high of day`
- **Catalyst implied:** earnings, news, sector rotation (not detectable from price alone, but the volume/range expansion is the price proxy)
- **Direction:** bullish (initially — EP can also occur on breakdowns, but Phase 2 ships bullish only)
- **Entry:** close > pre-EP base high on the EP bar
- **Stop:** below EP bar low
- **Target:** measured move from base height + 50% extension
- **Narrative emphasis:** "An episodic pivot is a single bar that announces a regime change. Volume and range expansion against a tight base signals institutional commitment. These often mark the start of multi-month advances."

### Task 4: `power_earnings_gap` (PEG)
- **Setup:** stock gaps up significantly (gap_pct ≥ 4%) on what appears to be earnings (heuristic: largest gap in last 30 bars + volume > 3× avg)
- **Continuation:** post-gap bars hold above the gap-up open (no fill of the gap)
- **Tight action:** 3-10 bar tight consolidation after the gap, intraday ranges narrow
- **Direction:** bullish
- **Entry:** close > post-gap high on volume
- **Stop:** below gap-up day low (filling the gap = invalidation)
- **Target:** gap + measured move = gap_high + (gap_high - gap_low)
- **Narrative emphasis:** "A power earnings gap is the market voting on new fundamentals. The first move is often the highest-conviction — if the gap holds (no fill) and tight action follows, the next 2-12 weeks frequently extend the move."

### Task 5: `flat_base` (Flat Base Breakout — Stockbee/Bauer)
- **Setup:** ≥15 bars of flat consolidation (high-low range < 12% of mid-price)
- **Prior advance:** 25%+ run in the 60-bar window before the base
- **Base depth ≤12%**, sideways drift
- **Volume:** dries up through the base
- **Direction:** bullish
- **Entry:** close > base high on volume > 1.5× avg
- **Stop:** below base low
- **Target:** base_high + (prior_advance_height * 0.5) or +20%
- **Narrative emphasis:** "After a strong advance, a flat base is the chart's way of saying 'pause to digest, not reverse.' Institutional support holds the line. Tight ranges + drying volume = potential energy."

### Task 6: `u_and_r` (Undercut & Rally — Brian Shannon)
- **Setup:** stock recently broke a key support level (e.g., 50 SMA or prior swing low)
- **Undercut bar:** close briefly BELOW the support
- **Rally bar:** the very next bar (or within 2 bars) closes BACK ABOVE the support
- **Confirmation:** follow-through close above the prior consolidation's high within 5 bars
- **Direction:** bullish (failed breakdown = reversal signal)
- **Entry:** close > prior consolidation high
- **Stop:** below the undercut low
- **Target:** prior consolidation high + (consolidation high - undercut low) * 2
- **Narrative emphasis:** "Undercut & Rally is the bear trap that becomes a bullish trigger. When a key support fails to hold and price snaps back above, it traps short sellers and forces them to cover. This is a high-RR reversal setup."

### Task 7: `remount`
- **Setup:** stock previously broke a key level (e.g., 20EMA, 50SMA, or prior breakout pivot) and traded below for 5-30 bars
- **Remount bar:** close back above the broken level on volume > avg
- **Tight follow-through:** next 3-7 bars hold above the level
- **Direction:** bullish
- **Entry:** close > the broken level + 1 ATR
- **Stop:** below the most recent pullback low
- **Target:** prior high + extension
- **Narrative emphasis:** "Remount = a previously broken stock 'remounts' its key level. This shows the bears couldn't sustain control and the bulls have reclaimed the line. Better than buying the original breakout — the false breakdown shook out weak hands."

### Task 8: `cup_handle_uct` (UCT-flavored cup-with-handle)
Stricter variant of the classical cup_handle from Phase 1:
- Same geometric definition as cup_handle (rounded U + handle)
- **Additional requirements:**
  - Must come out of a Stage 2 uptrend (trend_stage == 2 in context)
  - Prior advance ≥ 30% before the cup formation
  - Cup duration 30-65 bars (tighter than classic — O'Neil's spec)
  - Handle duration 5-15 bars (tighter — handle should NOT be wide)
  - Handle low does NOT undercut the cup's bottom-third
  - Volume in handle must be ≤ 70% of cup average
- **Direction:** bullish
- **Entry/stop/target:** same as cup_handle but with the UCT context guard
- **Narrative emphasis:** "The UCT variant of cup-with-handle is O'Neil's institutional accumulation pattern. Strict criteria filter for the patterns that have historically produced 25%+ moves: post-30%-advance, tight handle, declining volume. This is a sponsorship signal."

---

## Structure detector definitions

### Task 9: `swing_pivots`
- **Output:** A single Detection containing the engine's swing pivot map for the recent 60 bars.
- **Geometry:** shape `"candle_mark"` with one anchor per significant pivot. extras include `{pivot_count, strongest_pivot_index, pivot_density_bars}`.
- **Direction:** neutral.
- **Levels:** `entry/stop/target` all `None` — this is pure structure markup. Set `risk_reward: 0`.
- **Always emits** when ≥3 swing pivots exist in the recent window (else returns empty list).
- **Narrative:** "Swing pivots mark the price levels where the market has historically reversed. Each pivot's strength reflects how dominantly it stood out from neighbors. These are reference levels for entries, stops, and targets."

### Task 10: `support_resistance`
- **Method:** cluster swing pivots by price proximity (within 2% of each other), score each cluster by (touch_count × strength), emit clusters with ≥2 touches.
- **Output:** one Detection PER active level (so a chart may have 3-6 simultaneous S/R levels emitted).
- **Geometry:** shape `"horizontal_line"` with two anchors: `{t: oldest_touch_t, price: level}` and `{t: most_recent_touch_t, price: level}`. extras: `{level_type: "support"|"resistance", touch_count, strength, age_bars}`.
- **Direction:** neutral.
- **Levels:** for a support level, `entry = level * 1.005` (above support), `stop = level * 0.985`, `target = nearest_resistance_above` (if any) → if no resistance, leave `target` = None.
- **Narrative:** "A {support|resistance} level confirmed by {N} touches over {N bars}. Buyers/sellers consistently defend this price — it serves as a tradeable reference for entries and stops."

### Task 11: `major_trendlines`
- **Method:** fit trendlines through swing-highs (downtrend lines) and swing-lows (uptrend lines), filter for ≥3 touches + validity > 0.6.
- **Output:** one Detection per validated trendline (typically 1-2 active per chart).
- **Geometry:** shape `"trendline_pair"` (single line — use `anchors=[p1, p2]`, ignoring the "pair" hint). extras: `{slope, touches, validity, trend_type: "rising"|"falling"|"horizontal", current_value: line_at(now)}`.
- **Direction:** "bullish" for rising trendline supports, "bearish" for falling trendline resistance, "neutral" for horizontal.
- **Levels:**
  - Rising support: `entry = current_value * 1.005`, `stop = current_value * 0.985`
  - Falling resistance: `entry = current_value * 0.995`, `stop = current_value * 1.015`
- **Narrative:** Describes which kind of trendline and how to trade it.

### Task 12: `stage_analysis`
- **Method:** wrap `primitives.context._trend_stage()` — call it on the current bars and emit a Detection describing the stage.
- **Output:** exactly one Detection summarizing the current stage.
- **Geometry:** shape `"candle_mark"` with one anchor at the most recent bar.
- **Direction:** bullish (stage 2), bearish (stage 4), neutral (stage 1, 3).
- **Levels:** None for pure markers. Confidence = 100 if stage clearly identified (steady trend), lower if borderline.
- **Narrative emphasis per stage:**
  - **Stage 1 (basing):** "After a prior decline, price is consolidating. Volume is drying up. The MA stack is flattening. Stage 1 is preparation — watch for breakout above the basing range and rising volume."
  - **Stage 2 (uptrend):** "The institutional advancing phase. Rising MA stack, higher highs and higher lows. Trade with the trend — buy pullbacks, hold winners."
  - **Stage 3 (distribution):** "After an uptrend, price stalls. The 30-week MA flattens. Distribution days accumulate. Stage 3 is the warning — trim positions, tighten stops, don't initiate longs."
  - **Stage 4 (downtrend):** "The decline phase. Falling MA stack, lower highs and lower lows. Avoid longs entirely. This is where shorts work."

---

## Per-task template (Tasks 1-12)

Each task creates the detector + 15-fixture battery + battery test + wires into patterns.py, following the Phase 1 template exactly. See `docs/superpowers/plans/2026-05-11-pattern-recognition-phase-1-classical-core.md` "Per-task template" section for the structural recipe.

### Task structure (same as Phase 1):

- [ ] **Step 1: Write battery test** (parametrized over fixtures, plus coverage assertion)
- [ ] **Step 2: Implement detector** following the geometric definition above
- [ ] **Step 3: Write `_generate.py`** deterministic generator with seeded RNG
- [ ] **Step 4: Generate fixtures** + iterate detector/fixture params until ≥16/16 pass
- [ ] **Step 5: Wire into patterns.py** — import + `_PATTERN_METADATA` entry
- [ ] **Step 6: Run full pattern_engine suite** — verify no regressions
- [ ] **Step 7: Commit** (NO PUSH — controller batches every 3-4 tasks)

### Special considerations for Phase 2

- **Narrative quality:** the user explicitly emphasized "very important information." Each detector's `narrative` field must articulate WHY the pattern matters in 2-4 sentences per field — not generic templates. Reference the narrative_emphasis lines above when writing the narrative composition logic.
- **Geometry richness:** anchors must mark every visually meaningful point (pole base + top, contraction lows for VCP, gap-up open + close + post-gap consolidation for PEG, etc.). The Phase 5 chart overlay will only be as good as the geometry data.
- **Structure detectors output style:** they emit `confidence: 100` for clean structure (a strong S/R level isn't "70% confident — it's THERE), reserve lower confidences for borderline cases. They never participate in the false-positive sweep budget the same way (no entry triggers fire/don't-fire). Test their coverage with fixtures that ensure the right NUMBER of structures emit (not zero, not 20).
- **Confidence floor stays 50** for UCT setups. Structure detectors: don't apply a hard floor — emit always when the structure exists, with confidence reflecting strength.

---

## Task 13: verify_phase.py 2 + report

After all 12 detectors are committed + pushed:

- [ ] **Step 1: Wait for Railway redeploy**
```bash
until curl -s -m 10 https://uctintelligence.com/api/admin/patterns/health 2>/dev/null | python -c "import sys, json; print(json.loads(sys.stdin.read() or '{}').get('detector_count', 0))" 2>/dev/null | grep -q "^23$"; do sleep 20; done
echo "23 detectors live"
```

- [ ] **Step 2: Run `python scripts/verify_phase.py 2`**

Expected:
- Test Suite: 245 + 12 × ~16 = ~437+ tests passing
- Detector Inventory: **23 detectors registered**
- Live API Smoke: 3/3 OK
- Fixture Batteries: ~360+ fixtures pass
- False-Positive Sweep: 0 detections on synthetic data (or very few — structure detectors may produce some on synthetic series)
- Performance Bench: p99 should stay <50ms for 1000 bars (Phase 1 was 11.5ms with 11 detectors; 23 detectors ≈ 25ms estimated)
- Cross-Detector Consistency: 23 detectors, no duplicates

- [ ] **Step 3: Commit report + push**
```bash
git add docs/superpowers/phase-reports/
git commit -m "verify(patterns): Phase 2 verification — 23 detectors, all 9 checks pass"
git push
```

---

## Phase 2 Done — what shipped

- 12 new detectors: 8 UCT setups + 4 structure markers
- 23 total detectors registered
- ~437+ tests in `tests/pattern_engine/`
- `_PATTERN_METADATA` covers all 23 with display name + direction + description
- Phase 2 verification report committed

## Self-review

- 8 UCT detectors cover the highest-value setups from setup_library + scanner_candidates.py heuristics.
- 4 structure detectors enable the chart overlay to render context (S/R, trendlines, stages, pivots) as separate annotation layers.
- Per-task template references the Phase 1 plan for procedural details — no duplication.
- Each detector's narrative_emphasis is documented inline so implementers don't have to invent the "why" — they encode it.
- Confidence floor 50 stays for UCT setups; structure detectors emit with confidence reflecting strength (no floor).
- Phase 2 verification gate is explicit: 23 detectors live, 437+ tests passing.
