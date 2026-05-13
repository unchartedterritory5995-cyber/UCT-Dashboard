# Pattern Recognition — Phase 3 (Candlestick Library) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship 14 Japanese candlestick reversal/continuation detectors. After Phase 3: **37 detectors live**. Candlestick patterns enrich every chart with single-to-three-bar signals that often confirm or reject larger chart patterns.

**Architecture:** Each detector is small — typically scans the last 3-5 bars for the candle pattern's structural conditions. They produce DIFFERENT geometry from chart patterns:
- Single-bar candles → `geometry.shape = "candle_mark"`, 1 anchor
- Two-bar → 2 anchors
- Three-bar → 3 anchors
- Direction-aware (bullish vs bearish reversal candles fire in opposite trend contexts)

**Critical difference from Phase 1/2:** candlestick patterns ALONE are not high-edge signals — their power is in CONFLUENCE with structure (S/R levels, trendlines, prior trend). The narrative must be honest about this — candlesticks signal "potential" reversal/continuation, not deterministic outcomes.

**Spec reference:** `docs/superpowers/specs/2026-05-11-pattern-recognition-design.md` Section 3.2.

---

## Candlestick definitions

Reference: Steve Nison, "Japanese Candlestick Charting Techniques" (1991). Origin: Munehisa Homma, 1700s rice trading.

### Helpers (computed per bar)

```python
body = abs(close - open)
upper_wick = high - max(close, open)
lower_wick = min(close, open) - low
total_range = high - low
body_pct = body / total_range
is_green = close > open
is_red = close < open
```

### Tasks 1-14 (one detector each)

### Task 1: `doji` (direction: neutral — reversal signal)
- **Definition:** `body_pct < 0.05` (body is <5% of total range)
- **Variants in extras:**
  - "standard": both wicks meaningful
  - "long_legged": upper + lower wicks each ≥30% of range — indecision spike
  - "dragonfly": close ≈ open ≈ high (lower wick dominates) — bullish reversal
  - "gravestone": close ≈ open ≈ low (upper wick dominates) — bearish reversal
- **Context required:** doji at S/R or after sustained trend is meaningful; doji in chop is noise. Score higher when at a meaningful level.
- **Direction:** "neutral" (variant in extras determines bullish/bearish bias)
- **Levels:**
  - Entry: depends on variant + context — set entry as midpoint of next-bar action
  - Stop: bar high (for bearish bias) or bar low (for bullish bias)
  - Target: nearest opposite-side S/R

### Task 2: `hammer` (direction: bullish — reversal at swing low)
- **Definition:** lower_wick ≥ 2 × body, upper_wick ≤ 0.5 × body, body_pct ≤ 0.35
- **Context required:** appears at a swing low or after a decline
- **Direction:** "bullish"

### Task 3: `hanging_man` (direction: bearish — reversal at swing high)
- **Definition:** Same anatomy as hammer (long lower wick, small body, tiny upper wick) BUT appearing at a swing high or after advance
- **Direction:** "bearish"

### Task 4: `shooting_star` (direction: bearish — reversal at swing high)
- **Definition:** upper_wick ≥ 2 × body, lower_wick ≤ 0.5 × body, body_pct ≤ 0.35, appears after an advance or at swing high
- **Direction:** "bearish"

### Task 5: `bullish_engulfing` (direction: bullish — reversal)
- **Definition:** 2-bar pattern. Bar N-1: red (close < open). Bar N: green (close > open), AND bar N's body engulfs bar N-1's body (`bar_N.open ≤ bar_N-1.close` AND `bar_N.close ≥ bar_N-1.open`).
- **Context:** at a swing low or after a decline. Higher conviction if bar N has higher volume than bar N-1.
- **Direction:** "bullish"

### Task 6: `bearish_engulfing` (direction: bearish)
- Mirror of bullish_engulfing
- **Definition:** Bar N-1 green, bar N red. Bar N's body engulfs bar N-1's body (`bar_N.open ≥ bar_N-1.close` AND `bar_N.close ≤ bar_N-1.open`)
- **Direction:** "bearish"

### Task 7: `piercing` (direction: bullish — reversal)
- **Definition:** 2-bar. Bar N-1: red, long bar. Bar N: green, opens below bar N-1's low, closes ABOVE bar N-1's midpoint but below bar N-1's open.
- **Direction:** "bullish"

### Task 8: `dark_cloud_cover` (direction: bearish)
- Mirror of piercing
- **Definition:** Bar N-1: green, long bar. Bar N: red, opens above bar N-1's high, closes BELOW bar N-1's midpoint but above bar N-1's open.
- **Direction:** "bearish"

### Task 9: `bullish_harami` (direction: bullish — reversal/indecision)
- **Definition:** 2-bar. Bar N-1: red, long bar. Bar N: green or red, body ENTIRELY INSIDE bar N-1's body (`bar_N.high < bar_N-1.open` AND `bar_N.low > bar_N-1.close`)
- **Context:** at a swing low / after decline
- **Direction:** "bullish"

### Task 10: `bearish_harami` (direction: bearish)
- Mirror of bullish_harami
- **Definition:** Bar N-1: green long bar. Bar N: body entirely inside bar N-1's body.
- **Direction:** "bearish"

### Task 11: `morning_star` (direction: bullish — reversal)
- **Definition:** 3-bar. Bar N-2: red, long bar. Bar N-1: small body (doji or near-doji, gaps below or near bar N-2's close). Bar N: green, long bar, closes above bar N-2's midpoint.
- **Direction:** "bullish"

### Task 12: `evening_star` (direction: bearish)
- Mirror of morning_star
- **Definition:** Bar N-2: green long. Bar N-1: small body near top. Bar N: red long, closes below bar N-2's midpoint.
- **Direction:** "bearish"

### Task 13: `three_white_soldiers` (direction: bullish — continuation/reversal)
- **Definition:** 3-bar. Three consecutive green bars, each opening within the previous bar's body and closing near its high. Each bar's body is long (body_pct ≥ 0.6).
- **Direction:** "bullish"

### Task 14: `three_black_crows` (direction: bearish)
- Mirror of three_white_soldiers
- **Definition:** Three consecutive red bars, each opening within the previous bar's body, closing near its low. Each body_pct ≥ 0.6.
- **Direction:** "bearish"

---

## Per-task template

Each candlestick detector follows this skeleton:

```python
from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.types import Bar, Detection
import uuid, time

_PATTERN_ID = "..."
_CONFIDENCE_FLOOR = 50.0


def detect_<name>(bars: list[Bar], context: dict) -> list[Detection]:
    if len(bars) < <required_bars>:  # e.g., 1, 2, or 3
        return []
    
    detections = []
    # Scan the last 5 bars looking for the pattern (most recent firing wins)
    for i in range(max(<required_bars>-1, len(bars) - 5), len(bars)):
        candidate = _try_extract(bars, i)
        if not candidate: continue
        
        geom_score = _score_geometry(candidate)
        vol_score = _score_volume(bars, candidate, i)
        ctx_score = _score_context(context, bars, i, direction)
        hist_score = 50.0
        
        confidence = round(0.40*geom_score + 0.25*vol_score + 0.20*ctx_score + 0.15*hist_score, 2)
        if confidence < _CONFIDENCE_FLOOR: continue
        
        d = _build_detection(bars, candidate, confidence, context, ...)
        detections.append(d)
    
    return detections


register(_PATTERN_ID, detect_<name>)
```

Per-task steps (same as Phase 1/2):

- [ ] Write battery test (parametrized over fixtures + coverage + narrative_richness)
- [ ] Implement detector with rich Phase 2 narrative
- [ ] Write `_generate.py` deterministic generator
- [ ] Generate 15 fixtures (≥5 positive, ≥8 negative, ≥2 edge)
- [ ] Iterate until 16+/16+ passes
- [ ] Wire into `api/routers/patterns.py` (import + `_PATTERN_METADATA` entry)
- [ ] Run full pattern_engine suite
- [ ] Commit (NO PUSH — controller batches every 3-4 tasks)

## Narrative requirements

Same Phase 2 depth:
- headline ≥90 chars with pattern + bar values + direction + R:R
- 4 body fields each ≥700 chars (target 1000-1500)
- Real values woven in: body_pct, wick_pcts, bar prices, context.trend_stage, ma_alignment, regime
- Attribution: Nison (1991), Homma (1700s), specific historical context per pattern

## Geometry shapes

All candlestick patterns use `"candle_mark"` with the bar(s) of interest as anchors. Extras include the body_pct, wick ratios, prior-bar relationship metrics.

## Fixture generator

Candlestick generators are simpler than chart-pattern generators — you're synthesizing 1-3 bars with specific OHLC ratios + a few context bars before. Use deterministic RNG seeds.

15 fixtures per detector:
- 5 positive: clean textbook + 4 variants
- 8 negative: wrong direction, wrong wick ratios, wrong context, missing follow-through, etc.
- 2 edge: boundary thresholds

## Task 15: verify_phase.py 3 + report

After all 14 detectors committed + pushed:

```bash
until curl -s -m 10 https://uctintelligence.com/api/admin/patterns/health 2>/dev/null | python -c "import sys, json; print(json.loads(sys.stdin.read() or '{}').get('detector_count', 0))" 2>/dev/null | grep -q "^37$"; do sleep 20; done
python scripts/verify_phase.py 3
```

Expected after Phase 3:
- 37 detectors registered
- ~720+ tests passing (Phase 2 480 + 14 × ~17 each)
- Performance bench should still be <50ms p99 at 1000 bars

Commit the report and push.

---

## Phase 3 Done — what shipped

- 14 new candlestick detectors
- 37 total detectors
- ~720+ tests
- Phase 3 verification report

## Self-review

- 14 detectors cover the most-traded candlestick patterns (Nison's core canon).
- Geometric definitions are concrete with specific ratio thresholds.
- Single detector pattern template — small files (~150-250 lines each) reduce per-task complexity.
- Phase 2 narrative depth required throughout.
- Confluence with context (S/R, trend, MA) factors into context_score for each detector.
- 14 + verification = 15 tasks total.
