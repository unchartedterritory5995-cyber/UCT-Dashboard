# Pattern Recognition — Phase 4 (Catalog Completion) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the final 13 detectors that complete the planned catalog. After Phase 4: **50 detectors live**, the engine catalog reaches 100% of the target. Subsequent phases (5-7) are application surfaces + verification gates + launch — no more new detectors.

**Architecture:** Same template as Phases 1-3. Rich Phase 2-style narratives required, DCR-aware where applicable.

**Spec reference:** `docs/superpowers/specs/2026-05-11-pattern-recognition-design.md` Sections 3.1 (remaining classical) + 3.4 (remaining structure).

---

## Detectors in scope (13 detectors, 4 batches)

### Batch 1 (4 detectors): Continuation patterns
1. `ascending_triangle` — flat top + rising support trendline. Bullish continuation.
2. `descending_triangle` — flat bottom + falling resistance trendline. Bearish continuation.
3. `symmetrical_triangle` — converging upper + lower trendlines (both sloping toward apex). Direction follows breakout.
4. `rectangle` — sideways range bounded by parallel horizontal trendlines. Continuation in prior trend direction.

### Batch 2 (4 detectors): Trend + base patterns
5. `channel` — parallel trendlines defining a sustained sloped channel (up, down, or horizontal). Trend pattern.
6. `rounded_base` — slow U-shaped consolidation over 30-120 bars. Bullish reversal/accumulation.
7. `rounded_top` — slow inverted-U over 30-120 bars. Bearish reversal/distribution.
8. `triple_top` — 3 peaks at similar prices. Stronger version of double_top.

### Batch 3 (3 detectors): Reversal + volume structure
9. `triple_bottom` — 3 troughs at similar prices. Stronger double_bottom.
10. `volume_profile_nodes` — high-volume price nodes (HVN) and low-volume nodes (LVN). Structure detector.
11. `accumulation_distribution` — Wyckoff-style A/D phase classification. Structure detector.

### Batch 4 (2 detectors): Context layer
12. `range_detection` — active consolidation range with high + low boundaries. Structure detector.
13. `52w_proximity` — distance from 52-week high/low. Structure detector.

---

## Detector geometric definitions

### ascending_triangle (direction: bullish)
- **Window:** 20-60 bars
- **Upper boundary:** flat resistance line (slope ≈ 0, multiple touches at same price ±2%)
- **Lower boundary:** rising support trendline (slope > 0, 2+ touches, validity ≥ 0.6)
- **Convergence:** lower line approaches upper line over time
- **Volume:** contracting through the pattern
- **Direction:** "bullish" (breakout above flat top usually direction of continuation)
- **Levels:** entry = flat_top * 1.001, stop = below lower trendline at current, target = entry + (pattern_height)

### descending_triangle (direction: bearish)
- **Mirror of ascending:** flat support bottom + falling resistance top
- **Direction:** "bearish"

### symmetrical_triangle (direction: neutral — direction-follows-breakout)
- **Both upper + lower lines converging toward apex** (upper slope < 0, lower slope > 0)
- **Touches:** ≥2 each side
- **Apex:** projected intersection within 1-30 bars ahead of current
- **Volume:** contracting
- **Direction:** "neutral" — emit but don't bias direction. Entry triggers on either side break.

### rectangle (direction: neutral or aligned with prior trend)
- **Window:** 15-50 bars
- **Upper boundary:** flat resistance (slope ≈ 0, ≥2 touches within 2% band)
- **Lower boundary:** flat support (slope ≈ 0, ≥2 touches within 2% band)
- **Range depth:** 5-25%
- **Volume:** contracting through range
- **Direction:** "neutral" unless prior 50-bar trend is clear, then direction = prior trend's direction (continuation bias)
- **Levels:** entry = upper * 1.001 (break out direction unknown — emit both bull + bear variants if neutral)

### channel (direction: based on slope)
- **Window:** 25-80 bars
- **Two parallel trendlines** containing price action, both same slope direction
- **Slope:** if both > 0 = ascending channel (bullish), both < 0 = descending channel (bearish), |slope| < 0.001 = horizontal channel (range)
- **Validity:** ≥3 touches on each line, parallel_score ≥ 0.7
- **Direction:** ascending=bullish, descending=bearish, horizontal=neutral

### rounded_base (direction: bullish)
- **Window:** 30-120 bars
- **U-shape:** polynomial degree-2 fit, coeff[0] > 0 (concave up)
- **No clear handle** (vs cup_handle which has handle)
- **Bottom-width:** ≥40% of bars in lowest 25% of depth — slow rounding bottom, not V-spike
- **Volume:** dries through middle, expands as right side rallies
- **Direction:** "bullish"

### rounded_top (direction: bearish)
- **Mirror of rounded_base:** inverted dome, slow rollover

### triple_top (direction: bearish)
- **Three peaks** at similar prices (±3% similarity, stricter than double_top's 4%)
- **Three retrace troughs** between peaks
- **Window:** 30-100 bars
- **Spacing:** ≥7 bars between each peak
- **Direction:** "bearish"

### triple_bottom (direction: bullish)
- **Mirror of triple_top**

### volume_profile_nodes (direction: neutral)
- **Window:** last 60 bars
- **Build volume histogram:** bin price range into 20 buckets, sum volume per bucket
- **HVN (High Volume Node):** bucket with volume ≥ 1.5× average bucket volume
- **LVN (Low Volume Node):** bucket with volume ≤ 0.5× average
- **Emit:** one Detection per HVN/LVN. Structure markers (no trade signal, just reference levels).

### accumulation_distribution (direction: based on phase)
- **Window:** last 30 bars
- **Method:** sum of `(close - open) * volume` / total volume per bar (Williams A/D modified)
- **Classification:**
  - Avg score > 0.3 → "accumulation" (bullish)
  - Avg score < -0.3 → "distribution" (bearish)
  - else → "neutral"
- **Direction varies based on classification**
- **Emit always.**

### range_detection (direction: neutral)
- **Method:** look for the most recent window where (window_high - window_low) / mid < 0.10 AND duration ≥ 10 bars
- **Output:** range high, range low, duration, current_position_in_range (0-1)
- **Direction:** neutral

### 52w_proximity (direction: based on position)
- **Compute:** 52-week (~252-bar) high and 52-week low
- **Current_distance_from_52w_high_pct** = (52w_high - current_close) / 52w_high
- **Current_distance_from_52w_low_pct** = (current_close - 52w_low) / 52w_low
- **Classification:**
  - Within 5% of 52w high → "near_high" (often bullish — strong stock)
  - Within 5% of 52w low → "near_low" (often bearish — weak stock or potential reversal)
  - else → "mid_range"
- **Direction:** bullish if near_high, bearish if near_low (with context for reversal flips)
- **Emit always** when ≥200 bars available; emit with `confidence: 50` and `context_uncertain: true` if shorter series.

---

## Per-task template

Same as Phase 3. Each task: detector + 15 fixtures + battery test + `test_narrative_richness` + wire into `api/routers/patterns.py`.

Rich narrative ≥700 chars per body field with attributions:
- Triangles: Edwards & Magee (1948)
- Rectangle: Schabacker (1932), Wyckoff (1908)
- Channel: Donchian (1934)
- Rounded base/top: O'Neil, Stockbee
- Triple top/bottom: classical TA
- Volume profile: Steidlmayer Market Profile (1980s), Jim Dalton
- Accumulation/Distribution: Williams A/D (1972), Wyckoff phases
- Range detection: practical TA
- 52w proximity: O'Neil CAN SLIM (specifically the "N" = new highs)

DCR usage: where applicable (especially for rounded_base, triple_bottom, range_detection — patterns that benefit from understanding the buy/sell-into-close behavior at key levels).

## Workflow per batch

Run full pattern_engine suite after each batch. Push to Railway after every 2 batches (Batches 1-2 → push; Batches 3-4 → push). Commit per batch with descriptive message.

## Task 14: verify_phase.py 4 + report

After all 13 detectors committed + pushed:

```bash
until curl -s -m 10 https://uctintelligence.com/api/admin/patterns/health 2>/dev/null | python -c "import sys, json; print(json.loads(sys.stdin.read() or '{}').get('detector_count', 0))" 2>/dev/null | grep -q "^50$"; do sleep 20; done
python scripts/verify_phase.py 4
```

Expected after Phase 4:
- 50 detectors registered (catalog 100% shipped)
- ~990+ tests passing
- Performance bench should still be <100ms p99 at 1000 bars (current trajectory: 0.95→11.5→21.9→33.8ms means Phase 4 ≈ 50-60ms estimated)
- All 9 verification checks PASS

Commit + push the verification report.

---

## Phase 4 Done — what shipped

- 13 new detectors completing the catalog
- 50 total detectors registered
- Catalog 100% complete; Phases 5-7 are NOT detector work

## Self-review

- 13 detectors cover the remaining catalog from Section 3.1 + 3.4 of the spec.
- Geometric definitions are concrete; multi-direction patterns (sym triangle, channel) emit with direction based on shape characteristics.
- Volume profile + A/D are the first volume-focused structure detectors.
- 52w proximity completes the position-context layer.
- 4 batches of ~3-4 detectors each, then verification.
