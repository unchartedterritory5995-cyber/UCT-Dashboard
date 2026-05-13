# Pattern Recognition — Phase 8 (Elite Framework Detectors) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Add 8 detectors that encode specific frameworks from modern elite traders. After Phase 8: **58 detectors live**.

Phase 0-7 covered the classical canon + UCT setups + structure. Phase 8 fills the modern-trader gap. Each detector encodes a specific named framework from a specific elite practitioner.

## Detectors in scope (8 total, 2 batches of 4)

### Batch 1 — Modern momentum + cycle frameworks (4 detectors)

| Detector | Framework | Trader |
|---|---|---|
| `kell_cycle` | 5-stage Cycle of Price Action | Oliver Kell ("Victorious Stock Operator") |
| `qullamaggie_setup` | 4-week base + ATR thrust + low-vol retracement on 52w-high leader | Kristjan Kullamägi |
| `parabolic_short` | Climactic blow-off after 100%+ run in days/weeks | Kristjan Kullamägi (mirror of HTF) |
| `holy_grail` | Pullback to 20EMA in strong uptrend (ADX>30) | Linda Raschke |

### Batch 2 — Classical exhaustion + volatility frameworks (4 detectors)

| Detector | Framework | Trader |
|---|---|---|
| `td_sequential_buy` | TD9 buy setup (9 consecutive closes < close 4 bars ago) | Tom DeMark |
| `td_sequential_sell` | TD9 sell setup (mirror) | Tom DeMark |
| `bollinger_squeeze` | Bollinger Bands inside Keltner Channels | John Bollinger / John Carter |
| `donchian_breakout` | Close above 20-bar high or below 20-bar low (Turtle rules) | Richard Donchian / Turtle Traders |

---

## Detector specs

### 1. `kell_cycle` — Oliver Kell's Cycle of Price Action

**Direction:** based on current stage detected.

**Algorithm:** Always emits ONE Detection classifying current chart position in Kell's 5 stages:

1. **Reversal Extension** — sharp counter-trend break of >7% in 3-5 bars after sustained prior trend. Often climactic bar (range >2× ATR). Marks the end of the prior trend.
2. **Wedge Pop** — brief converging consolidation (5-15 bars) that breaks counter to the reversal direction. The first relief move after the reversal extension.
3. **Exhaustion Extension** — climactic move with parabolic acceleration (price gains >25% in <10 bars with volume expansion). Warning that the current trend is exhausting.
4. **Wedge Drop** — first significant pullback after exhaustion extension. The reversal trigger — trade with the NEW trend forming.
5. **Base & Breakout** — proper accumulation/distribution consolidation (≥15 bars sideways) then breakout into new trend. The "ready" stage.

Output: `geometry.candle_mark` at current bar. `extras.kell_stage` field (1-5). Per-stage narrative branches (mirror of `stage_analysis`).

**Levels per stage:**
- Stages 1, 3: warning markers — no entry signal
- Stage 2 (wedge pop): trade with reversal — entry above wedge break
- Stage 4 (wedge drop): trade with new trend
- Stage 5 (base & breakout): primary trade signal — entry above base high

### 2. `qullamaggie_setup` — Kristjan Kullamägi's Signature Combo

**Direction:** bullish.

**Conditions (all must hold):**
- Price within 5% of 52w high
- 4-6 week consolidation (15-30 bars sideways) — depth ≤15%
- Average True Range over the last 5 bars ≥ 1.5× the average ATR of the consolidation period (thrust signal — ATR-relative momentum)
- Latest bar's close in upper 30% of range (DCR ≥ 0.7)
- Volume on the thrust bar ≥ 1.5× the 20-bar average
- MA stack: close > 10EMA > 20EMA > 50SMA (stacked bullish)

**Entry:** consolidation high * 1.001
**Stop:** below 20EMA (Kullamägi's standard stop)
**Target:** consolidation high + ATR(20) * 5 (5R reward Kullamägi targets)

### 3. `parabolic_short` — Kullamägi's Blow-Off Top

**Direction:** bearish (short setup).

**Conditions:**
- Stock has gained ≥100% in the last 30 bars (parabolic run)
- Last bar shows climactic price action: range > 3× ATR(20), close in lower 30% of range (DCR ≤ 0.3)
- Volume on the climax bar ≥ 3× 20-bar average
- Price gap up at open ≥3% then sold off (gap-and-trap signal)

**Entry:** climax bar low * 0.999
**Stop:** climax bar high * 1.01
**Target:** prior 50-bar low (or last consolidation breakout level)

### 4. `holy_grail` — Linda Raschke's Pullback Setup

**Direction:** bullish.

**Conditions:**
- ADX(14) > 30 (strong trend confirmed)
- DI+ > DI- (uptrend confirmed)
- Recent pullback into the 20-EMA (low touched or crossed 20EMA within last 3 bars)
- 20EMA still rising
- Volume contracting on the pullback

**Entry:** close above the 20EMA after pullback bar
**Stop:** below the pullback low (or 1 ATR below 20EMA)
**Target:** recent swing high + ATR(14)

Attribution: Linda Raschke + Larry Connors ("Street Smarts" 1995)

### 5. `td_sequential_buy` — DeMark TD9 Buy Setup

**Direction:** bullish (exhaustion reversal signal).

**Conditions:**
- 9 consecutive bars where close < close 4 bars ago (TD setup count)
- Bar 9 marks "TD setup completion" — exhaustion of downside momentum
- Bonus signals:
  - Bar 9's low is the lowest of the 9 bars (TD perfection)
  - Below the lower TD Reference Setup band

**Entry:** close above bar 9 high * 1.001
**Stop:** below bar 9 low * 0.985
**Target:** retrace to highest high in last 13 bars

Attribution: Tom DeMark ("DeMark Indicators" 2008)

### 6. `td_sequential_sell` — Mirror of TD9 buy

**Direction:** bearish.

**Conditions:** 9 consecutive bars where close > close 4 bars ago. Mirror logic.

### 7. `bollinger_squeeze` — Bollinger/Carter Volatility Squeeze

**Direction:** neutral (precedes a directional breakout — trade with whichever side breaks).

**Conditions:**
- Bollinger Bands (20-period, 2 std) are INSIDE the Keltner Channel (20-period, 1.5 ATR)
- Squeeze sustained for ≥6 bars (the longer, the more energy)
- Volume drying up (current 5-bar avg < 70% of 20-bar avg)

**Entry:** depends on which side of the squeeze breaks first
- Upside: close > Bollinger upper * 1.001
- Downside: close < Bollinger lower * 0.999

**Stop:** opposite Bollinger band
**Target:** entry + 2x bandwidth at squeeze midpoint

Attribution: John Bollinger (Bollinger Bands inventor) + John Carter ("Mastering the Trade" — coined "Squeeze")

### 8. `donchian_breakout` — Turtle Traders Donchian Channel

**Direction:** based on break side.

**Conditions:**
- Close > 20-bar high (long break) OR close < 20-bar low (short break)
- Optionally require 55-bar high/low for "stronger" signal (Turtle System 2)
- Volume ≥ 20-bar average

**Entry:** close * 1.001 (long) or close * 0.999 (short)
**Stop:** 2 × ATR(20) from entry
**Target:** trail with 10-bar opposite Donchian band exit

Attribution: Richard Donchian (1934 Donchian channels) + Richard Dennis & William Eckhardt (Turtle Traders, 1983) + Curtis Faith ("Way of the Turtle")

---

## Per-task template

Same as Phase 1-3. Each detector ships with:
- Detector function in `api/services/pattern_engine/detectors/...`
- 15-fixture battery
- Battery test + `test_narrative_richness`
- Wire into `api/routers/patterns.py` (imports + `_PATTERN_METADATA`)
- Rich narrative ≥700 chars per body field with attribution

## File structure

| File | Category |
|---|---|
| `api/services/pattern_engine/detectors/uct/kell_cycle.py` | uct (modern framework) |
| `api/services/pattern_engine/detectors/uct/qullamaggie_setup.py` | uct |
| `api/services/pattern_engine/detectors/uct/parabolic_short.py` | uct |
| `api/services/pattern_engine/detectors/uct/holy_grail.py` | uct |
| `api/services/pattern_engine/detectors/classical/td_sequential_buy.py` | classical (DeMark) |
| `api/services/pattern_engine/detectors/classical/td_sequential_sell.py` | classical |
| `api/services/pattern_engine/detectors/classical/bollinger_squeeze.py` | classical |
| `api/services/pattern_engine/detectors/classical/donchian_breakout.py` | classical |

## Workflow

**Batch 1 (4 detectors):** kell_cycle, qullamaggie_setup, parabolic_short, holy_grail
**Batch 2 (4 detectors):** td_sequential_buy, td_sequential_sell, bollinger_squeeze, donchian_breakout

Each batch ships as one subagent dispatch. After both batches: run verify_phase 8 + commit report.

## Phase 8 Done — what will ship

- 8 new detectors (58 total)
- Modern elite framework coverage (Kell, Kullamägi, Raschke, DeMark, Bollinger, Donchian)
- ~120 new fixture files (15 per detector)
- ~136 new tests (17 per detector × 8)
- Updated `_PATTERN_METADATA` covers 58 detectors

## Self-review

- 8 detectors, each encoding a NAMED framework from a specific elite trader
- Kell's cycle is the marquee addition — fills the modern cycle-of-price-action gap
- Qullamaggie + parabolic short cover modern momentum + climax tops
- DeMark TD9 covers exhaustion reversal (was missing)
- Bollinger Squeeze covers volatility expansion (was missing)
- Donchian/Turtle covers trend breakout (foundational, was missing)
- After Phase 8: catalog reaches 58 detectors with explicit modern-era + pioneer coverage
