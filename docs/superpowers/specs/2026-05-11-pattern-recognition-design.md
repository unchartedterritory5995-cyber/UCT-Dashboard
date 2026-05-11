# Elite Pattern Recognition System — Design Spec

**Date:** 2026-05-11
**Owner:** Patrick / UCT Intelligence
**Status:** Design approved by user. Ready for implementation plan.

---

## 1. Goal & Positioning

Build a **chart pattern intelligence engine** that detects classical, candlestick, UCT-specific, and structural patterns across the full 3,685-ticker $300M+ universe on every timeframe (5min, 15min, 30min, 1hr, Daily, Weekly, Monthly). The engine produces structured `Detection` records that downstream applications (chart overlay, scanner page, AI brain, alerts, journal, backtester) consume independently.

**The bar:** "the eyes of great traders" — each detection captures both the holistic chart picture (trend, structure, regime context) AND actionable trade-ready levels (entry, stop, target, R:R, narrative). The engine must be testable, explainable, and continuously learning from real-world outcomes.

**Critical constraint:** the engine must clear a multi-gate testing & verification battery before being exposed to end users.

---

## 2. Architecture — Engine as a Reusable Service

```
┌─────────────────────────────────────────────────────────┐
│  APPLICATIONS (independent consumers)                   │
│  • Chart overlay  • Scanner page  • Brain  • Alerts...  │
└─────────────────────────────────────────────────────────┘
                          ↑ REST
┌─────────────────────────────────────────────────────────┐
│  PATTERN ENGINE                                         │
│  • detectors/  one file per pattern, modular            │
│  • primitives/ shared math (pivots, trendlines, vol)    │
│  • scoring     0-100 confidence per detection           │
│  • narrative   "eyes of great traders" explanations     │
│  • memory      store every detection, track outcomes    │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│  LEARNING LOOP                                          │
│  • Detection stored on emit                             │
│  • Outcome tracker: did entry hit? stop hit? target?    │
│  • Per-(pattern × regime × TF) hit-rate stats accumulate│
│  • Confidence scoring recalibrates from real outcomes   │
└─────────────────────────────────────────────────────────┘
```

**Key invariants:**

- One detector per file. Modular, parallel-safe, independently testable. No detector depends on another detector.
- Shared primitives (pivot detection, trendline fitting, volume signature, geometry helpers, context lookup) live in `pattern_engine/primitives/` and are reused by every detector.
- Engine has zero knowledge of UI. UI has zero knowledge of engine internals. They communicate only via the REST API + the `Detection` schema.
- Memory layer is what makes the engine learn over time. Every detection ever emitted is stored. Outcomes are tracked. Per-pattern stats accumulate. Confidence scoring recalibrates from real data.

---

## 3. Pattern Catalog (~70 detectors across all phases)

### 3.1 Classical chart patterns (~20)

| Pattern | Direction | Typical TF | Phase |
|---|---|---|---|
| Bull flag, Bear flag, Pennant | Continuation | 5m–D | 1 |
| Falling wedge, Rising wedge | Reversal/cont. | 30m–W | 1 |
| Head & Shoulders, Inverse H&S | Reversal | D–W | 1 |
| Double top, Double bottom | Reversal | D–W | 1 |
| Cup & Handle, Inverse C&H | Continuation | D–W | 1 |
| Ascending / Descending / Symmetrical triangle | Continuation/Reversal | 30m–W | 4 |
| Rectangle (range) | Continuation | All | 4 |
| Channel (up/down/horizontal) | Trend | D–W | 4 |
| Rounded base, Rounded top | Reversal | W–M | 4 |
| Triple top, Triple bottom | Reversal | D–W | 4 |

### 3.2 Candlestick patterns (~23)

| Pattern | Bars | Phase |
|---|---|---|
| Doji (standard, gravestone, dragonfly, long-legged) | 1 | 3 |
| Hammer, Hanging man, Shooting star | 1 | 3 |
| Inverted hammer | 1 | Post-launch |
| Bullish/bearish engulfing, Piercing, Dark cloud cover | 2 | 3 |
| Harami (bull/bear) | 2 | 3 |
| Tweezer top/bottom | 2 | Post-launch |
| Morning star, Evening star, Three white soldiers, Three black crows | 3 | 3 |
| Three inside up/down, Abandoned baby | 3 | Post-launch |

### 3.3 UCT setup patterns (~25 from existing setup_library)

The highest-value detectors — they encode UCT trading philosophy already in the app.

| Setup | Type | Phase |
|---|---|---|
| VCP (Volatility Contraction Pattern) | Continuation | 2 |
| High Tight Flag / Powerplay | Continuation | 2 |
| Episodic Pivot | Breakout | 2 |
| Power Earnings Gap (PEG) | Gap continuation | 2 |
| Flat Base Breakout | Continuation | 2 |
| Cup with Handle (UCT variant) | Continuation | 2 |
| U&R (Undercut & Rally) | Reversal | 2 |
| Remount | Continuation | 2 |
| Gap-and-Go, BGU, EMA Crossback, 20EMA Hold | Continuation | Post-launch |
| Stage 2 entry, Stage 4 breakdown | Trend transition | Post-launch |
| Powerplay, Box Theory, Base-on-Base | Continuation | Post-launch |
| Late-stage climax, 7-Week Short Rule | Distribution/Top | Post-launch |
| Oops Reversal, Red-to-Green, Go Signal, HVC | Reversal | Post-launch |
| Opening Range Breakout/Breakdown, 30min Pivot, Mean Reversion L/S | Intraday | Post-launch |

### 3.4 Structure patterns (~8 — enrichment layer)

These don't fire as standalone trades. They enrich every other detection's `context`.

| Detector | Output | Phase |
|---|---|---|
| Swing pivot mapping | Significant H/L pivots with strength score | 2 |
| Horizontal support/resistance | Multi-touch levels with strength | 2 |
| Major trendline detection | Up/down/horizontal trendlines with validity | 2 |
| Stage analysis (Weinstein 1-4) | Current stage of the chart | 2 |
| 52W high/low proximity | Distance + recency from key extremes | 2 |
| Volume profile high-volume nodes | Price levels where most volume accumulated | 4 |
| Range/consolidation detection | Active range boundaries | 4 |
| Accumulation/Distribution score | Wyckoff-style A/D phase | 4 |

---

## 4. Detection Output Schema

Every detector returns `Detection` records with this exact shape. Consumers treat all detections uniformly regardless of pattern type.

```python
Detection {
  # IDENTITY
  id: str                    # uuid, stable across the detection's lifetime
  sym: str                   # ticker
  tf: str                    # "5min" | "15min" | "30min" | "1hr" | "D" | "W" | "M"
  pattern_id: str            # "bull_flag" | "head_shoulders" | "vcp" | ...
  pattern_name: str          # "Bull Flag" — display
  category: str              # "classical" | "candlestick" | "uct" | "structure"
  direction: str             # "bullish" | "bearish" | "neutral"

  # WHERE IT IS ON THE CHART
  start_t: int               # unix sec — earliest bar belonging to the pattern
  end_t: int                 # unix sec — most recent bar
  pivot_ts: list[int]        # key timestamps within the pattern (for animation/labels)

  # GEOMETRY (so UI can draw the pattern)
  geometry: {
    shape: str               # "trendline_pair" | "neckline" | "cup_curve" | "rectangle" | "candle_mark"
    anchors: list[{t, price}]  # vertices the shape connects
    extras: dict             # pattern-specific: e.g. {"height_pct": 8.2, "depth_pct": 23.5}
  }

  # ACTIONABLE LEVELS
  levels: {
    entry: float                       # trigger price
    entry_condition: str               # "close above $48.50 on volume > avg"
    stop: float                        # invalidation
    stop_basis: str                    # "pattern_low_minus_atr" | "swing_low" | etc.
    target_primary: float              # measured move
    target_secondary: float | null     # next resistance / fib extension
    risk_reward: float                 # (target_primary - entry) / (entry - stop)
  }

  # CONTEXT — the "great trader's eye" enrichment
  context: {
    trend_stage: int                   # Weinstein 1/2/3/4
    rs_trend: "up" | "flat" | "down"
    ma_alignment: str                  # "stacked_bullish" | "mixed" | "stacked_bearish"
    volume_signature: str              # "contracting" | "expanding" | "neutral"
    regime: str                        # current market regime (from existing brain)
    nearest_resistance: float | null
    nearest_support: float | null
    days_to_earnings: int | null
    sector_strength_rank: int | null   # 1-11
  }

  # CONFIDENCE & SCORING
  confidence: float          # 0-100 — composite quality score
  quality_components: {      # what fed into confidence (transparent)
    geometry_score: float    # how "clean" the shape is
    volume_score: float      # does volume confirm?
    context_score: float     # is the context favorable?
    historical_score: float  # how well has this pattern worked in similar regimes?
  }

  # NARRATIVE — "what would a master trader say about this?"
  narrative: {
    headline: str            # one sentence: "Clean bull flag forming on Stage 2 uptrend, 18% pole"
    what_it_is: str          # explanation of the pattern itself
    why_it_matters: str      # context: why this setup right here right now
    what_to_watch_for: str   # confirmation signal (breakout, volume, etc.)
    failure_signal: str      # what would invalidate
  }

  # STATUS (changes over time — tracked by learning loop)
  status: "forming" | "ready" | "triggered" | "completed" | "failed" | "expired"
  outcome: {                 # populated by learning loop after pattern resolves
    entry_hit: bool
    stop_hit: bool
    target_hit: bool
    max_favorable_excursion_pct: float
    max_adverse_excursion_pct: float
    bars_to_resolution: int
    resolved_at: int | null
  } | null

  # METADATA
  detected_at: int           # when engine first found it
  last_seen_at: int          # most recent scan that confirmed it still exists
}
```

**Schema design decisions:**

- **Geometry is structured, not pre-rendered.** UI can render shapes any way it wants. Engine doesn't know about UI.
- **Levels are mandatory.** Every detection is trade-ready, not just informational.
- **Confidence is decomposed.** `quality_components` shows WHY confidence is 78 vs 92. Transparent + tunable.
- **Narrative is structured (5 fields, not free text).** Consistent rendering, AI brain composes richer text from these primitives.
- **Status + outcome track the lifecycle.** Same Detection record from "forming" → "completed/failed". This is what the learning loop consumes.

---

## 5. Detection Methodology

### 5.1 Primitives (`pattern_engine/primitives/`)

| Module | Responsibility | Consumers |
|---|---|---|
| `pivots.py` | Swing high/low detection via fractal method (5/7/9-bar window). Returns `[{t, price, type, strength}]`. | Every classical + UCT detector |
| `trendlines.py` | Linear regression on pivots → trendline candidates. Filters: min 2 touches, max gap, slope sanity. Returns `{p1, p2, slope, r_squared, touches, validity}`. | flag/wedge/triangle/channel/H&S |
| `volume.py` | Contraction detection, accumulation/distribution scoring, volume signature classifier ("expanding"/"contracting"/"neutral"), HVN/LVN volume profile. | Every detector |
| `geometry.py` | Line intersections, slope angles, parallelism test, triangle apex calc, rectangle width/depth ratio, polynomial fit (cup roundness). | Detectors using 2+ trendlines |
| `context.py` | Weinstein stage analysis, MA stack alignment, RS trend, regime lookup, volume confirmation, earnings proximity. | Every detector for `context_score` |

### 5.2 Detector shape

Every detector is a pure function with this signature — ~150-300 lines each:

```python
def detect_bull_flag(bars: list[Bar], context: Context) -> list[Detection]:
    """1. Find candidates — fast prefilter using primitives
       2. Validate each candidate against pattern definition
       3. Score (geometry + volume + context + history)
       4. Build narrative
       5. Return clean list (may be empty)
    """
    detections = []
    pivot_list = pivots.detect(bars, window=5)

    for candidate in _find_pole_then_consolidation(bars, pivot_list):
        flag_lines = trendlines.fit_pair_parallel(candidate.flag_pivots)
        if not _is_valid_flag(flag_lines, candidate): continue

        geom_score   = _score_flag_geometry(flag_lines, candidate)
        vol_score    = volume.score_flag_volume(bars, candidate)
        ctx_score    = context.score_for_pattern("bull_flag", bars, context)
        hist_score   = memory.get_historical_hit_rate("bull_flag", context.regime)
        confidence   = _composite(geom_score, vol_score, ctx_score, hist_score)
        if confidence < 50: continue  # filter weak detections

        narrative = _narrate_bull_flag(candidate, flag_lines, context)
        levels    = _compute_levels(candidate, flag_lines, bars)

        detections.append(Detection(...))
    return detections
```

### 5.3 Engine entrypoint

```python
def detect_all(bars, context, pattern_ids=None) -> list[Detection]:
    """Run all (or filtered) detectors. Merge + dedupe. Sort by detected_at desc,
       then confidence desc."""

def detect_one(bars, context, pattern_id) -> list[Detection]:
    """Run one detector. Used internally and for debugging."""
```

### 5.4 Hard confidence floor

Detections with confidence < 50 are never stored or returned. This filters obvious junk before it leaves the engine. Threshold is per-detector tunable via config.

---

## 6. Storage + Learning Loop

### 6.1 Schema (SQLite, in `/data/auth.db`)

```sql
-- Every detection ever fired. Append-only. Source of truth.
CREATE TABLE pattern_detections (
  id            TEXT PRIMARY KEY,        -- uuid
  sym           TEXT NOT NULL,
  tf            TEXT NOT NULL,
  pattern_id    TEXT NOT NULL,
  category      TEXT NOT NULL,
  direction     TEXT NOT NULL,
  start_t       INTEGER NOT NULL,
  end_t         INTEGER NOT NULL,
  confidence    REAL NOT NULL,
  quality_json  TEXT NOT NULL,
  geometry_json TEXT NOT NULL,
  levels_json   TEXT NOT NULL,
  context_json  TEXT NOT NULL,
  narrative_json TEXT NOT NULL,
  status        TEXT NOT NULL,
  detected_at   INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL
);
CREATE INDEX idx_pd_sym_tf ON pattern_detections(sym, tf);
CREATE INDEX idx_pd_pattern ON pattern_detections(pattern_id);
CREATE INDEX idx_pd_status ON pattern_detections(status);

-- Outcome per detection, populated by the tracker job.
CREATE TABLE pattern_outcomes (
  detection_id  TEXT PRIMARY KEY REFERENCES pattern_detections(id),
  entry_hit     INTEGER NOT NULL,
  entry_hit_t   INTEGER,
  stop_hit      INTEGER NOT NULL,
  stop_hit_t    INTEGER,
  target_hit    INTEGER NOT NULL,
  target_hit_t  INTEGER,
  mfe_pct       REAL,
  mae_pct       REAL,
  bars_to_resolve INTEGER,
  resolved_at   INTEGER NOT NULL
);

-- Rolling stats per (pattern × regime × TF). Recomputed nightly.
CREATE TABLE pattern_stats (
  pattern_id    TEXT NOT NULL,
  tf            TEXT NOT NULL,
  regime_bucket TEXT NOT NULL,           -- "bull"|"bear"|"choppy"|"transition"
  n_total       INTEGER NOT NULL,
  n_resolved    INTEGER NOT NULL,
  n_entry_hit   INTEGER NOT NULL,
  n_target_hit  INTEGER NOT NULL,
  n_stop_hit    INTEGER NOT NULL,
  avg_mfe_pct   REAL,
  avg_mae_pct   REAL,
  median_bars   INTEGER,
  hit_rate      REAL,
  expectancy_R  REAL,
  last_updated  INTEGER NOT NULL,
  PRIMARY KEY (pattern_id, tf, regime_bucket)
);

-- User feedback (drives Phase 7+ confidence retraining)
CREATE TABLE pattern_feedback (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  detection_id  TEXT NOT NULL REFERENCES pattern_detections(id),
  user_id       TEXT NOT NULL,
  rating        TEXT NOT NULL,           -- "great"|"good"|"miss"|"wrong"
  note          TEXT,
  created_at    INTEGER NOT NULL
);
```

### 6.2 Three jobs

**1. `store_detection(d: Detection)`** — called by engine on every detect call. UPSERTs by stable hash of `(sym, tf, pattern_id, start_t, end_t)`. New shapes get new rows; recurring detections of the same pattern just update `last_seen_at` + `confidence`.

**2. `track_outcomes(lookback_hours=48)`** — background job, runs every 4 hours via APScheduler. For each detection with `status in ("ready", "triggered")`:
- Fetch bars since `detected_at`
- Check chronologically: entry hit, stop hit, target hit
- Update `pattern_outcomes`
- Flip status to `completed` (target hit) | `failed` (stop hit) | `expired` (>30 days no resolution)
- Track MFE / MAE along the way

**3. `recompute_stats()`** — nightly job. Aggregates `pattern_outcomes ⋈ pattern_detections` into `pattern_stats`. Buckets by `(pattern_id, tf, regime)`. Feeds `_composite()` as `historical_score`.

### 6.3 Confidence evolution

- **Cold start (Phase 1 launch):** every detector ships with `historical_score = 50` (neutral prior). Confidence is pure geometry + volume + context.
- **Week 4:** `pattern_stats` has real numbers. `_composite()` weighting tips toward realized hit rate. "Bull flag in bear regime" with 22% hit rate scores lower automatically.
- **Month 6:** every `(pattern × regime × TF)` combo has hundreds of samples. Confidence becomes calibrated — an 80-confidence detection actually hits ~80% of the time.
- **User feedback (Phase 7+):** explicit signal adds another weight. Patterns marked "wrong" repeatedly get weighted down.

---

## 7. Application Surfaces (Phase 1 scope)

Two surfaces ship as part of Phase 1. They validate the engine and do real user-facing work.

### 7.1 Chart Overlay

- **Trigger:** Toolbar gear → "Show patterns" toggle. Default OFF until Phase 7 (Gates 4-5 pass and engine earns its place).
- **Render:** Each `Detection` from `/api/patterns/{sym}?tf=...` becomes an SVG overlay on top of the chart canvas. New overlay layer is peer to existing `ChartDrawingOverlay.jsx` — never collides with user drawings.
- **Shape renderers:**
  - `trendline_pair` → two parallel/converging lines (flags, wedges, channels, triangles)
  - `neckline` → horizontal/sloped line + shoulder arcs (H&S)
  - `cup_curve` → fitted polynomial arc + handle parallelogram
  - `rectangle` → range box
  - `candle_mark` → small badge above/below candle (candlestick patterns)
- **Visual encoding:** green=bullish, red=bearish, gold=neutral. Opacity = confidence/100. Dashed = forming, solid = ready/triggered, glowing = recent breakout. Confidence badge floats near pattern endpoint. Entry/stop/target lines render as dashed horizontals.
- **Click pattern → side panel slides in (right edge):**
  - Pattern name + confidence + direction
  - Levels: entry (with trigger condition), stop, primary + secondary targets, R:R
  - Context: trend stage, RS, MA alignment, regime, days-to-earnings, nearest S/R
  - Narrative: 5 fields rendered as collapsible sections
  - Quality components: small horizontal bar chart showing geometry/volume/context/historical contribution
  - Historical stats: hit rate for this pattern × regime × TF, with sample size
  - Feedback buttons: 👍 Great | 👌 Good | ❌ Miss | ⚠ Wrong → writes `pattern_feedback`

### 7.2 Pattern Scanner page (`/patterns`)

- **Layout:** Filter bar top, results grid main
- **Filters:** pattern type multi-select, timeframe (5m/30m/1hr/D/W), min confidence slider, regime context, category chips
- **Results:** one card per active detection, sorted by `confidence desc`. Each card: ticker + sparkline + pattern name + confidence ring + entry/stop/target strip + tiny narrative headline
- **Click card →** TickerPopup opens with overlay ON, drilled to the right TF
- **Universe:** scans full 3,685 tickers × selected timeframe. Cached 15 min per (tf, filter set)
- **Saved scans:** filter combos savable. Stored in `user_preferences`. Phase 1 wires the dropdown; no UI for managing yet

### 7.3 Phase 1 explicitly defers

- Brain layer integration (own follow-up initiative)
- Alerts on pattern detections (own follow-up initiative)
- Journal auto-tagging (own follow-up initiative)
- Per-pattern backtest hookup (own follow-up initiative)

---

## 8. API Design

All endpoints behind AuthGuard. Same pattern as existing routers.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/patterns/types` | List supported pattern types + categories + parameter schemas |
| `GET` | `/api/patterns/{sym}?tf=D&types=...&min_conf=50` | All active detections for symbol. Used by chart overlay. |
| `GET` | `/api/patterns/{sym}/{detection_id}` | Full detection detail (geometry, narrative, stats, outcome if resolved) |
| `GET` | `/api/patterns/scan?types=...&tf=D&min_conf=70&regime=bull` | Universe scan. Returns `[{sym, detection_summary}]`. Cached 15 min. |
| `GET` | `/api/patterns/stats?pattern_id=bull_flag&tf=D&regime=bull` | Historical stats for pattern × regime × TF |
| `POST` | `/api/patterns/{detection_id}/feedback` | User rates detection. Writes `pattern_feedback`. |
| `GET` | `/api/admin/patterns/health` | Admin: detector hit rates, false-positive flags, recent flagged detections. Used by Section 9 verification harness. |

**Performance contract:**
- `/api/patterns/{sym}` for one TF: < 300ms p99 (single-symbol = single set of bars, all 20 detectors run in <100ms compute + cache)
- `/api/patterns/scan` for full universe: < 8s end-to-end (parallelized 8 workers, results cached 15 min after first call per filter set)
- Detection results cached in `cache.TTLCache` keyed by `(sym, tf, bar_count)` for 5 min. Invalidate on new bar close.

---

## 9. Testing & Verification Strategy

Five gates between "code exists" and "users see it." This is what makes the engine trustworthy.

### Gate 1 — Per-detector unit tests (fixture-based)

Each detector ships with `tests/fixtures/{pattern_id}/` containing hand-crafted bar arrays:

```
tests/fixtures/bull_flag/
├── clean_textbook.json          # ideal example, should fire confidence ≥85
├── tight_consolidation.json     # tight bars, low volume — should fire ≥75
├── wide_choppy.json             # too wide/messy — should NOT fire OR fire <50
├── no_pole.json                 # consolidation without preceding pole — should NOT fire
├── descending_flag.json         # downward-sloping flag — should fire (still bull flag)
├── pole_too_short.json          # <8% pole — should NOT fire
├── flag_too_deep.json           # >50% retrace — should NOT fire
```

Each fixture: `{bars: [...], expected: {fires: bool, min_confidence: float, geometry: {...}}}`. Tests assert detection matches.

**Coverage per detector:**
- ≥5 positive fixtures (clean variants)
- ≥8 negative fixtures (close-but-not-quite — false-positive killers)
- ≥2 edge cases (boundary of validity)

Runs in <2s. Blocks merge if a detector regresses.

### Gate 2 — Curated historical chart library

Reference battery of **real historical examples**, handpicked from years of chart history.

```
tests/historical_charts/
├── bull_flag/
│   ├── AAPL_2024-03-15_D.json   # known textbook flag, breakout worked
│   ├── NVDA_2024-01-08_D.json   # famous flag at $480
│   ├── ...                      # 15-20 per pattern
├── head_shoulders/
│   ├── TSLA_2022-04-04_W.json   # well-known H&S top
│   ├── ...
```

Each capture: bar slice + expected detection (`pattern_id`, confidence band, geometry anchors with tolerance) + actual market outcome.

Tests check:
- Engine **detects** every textbook example
- Geometry matches within tolerance (pivot times within ±2 bars, levels within ±2%)
- Confidence falls in the expected band

**Pattern enters live engine only after passing this battery.**

### Gate 3 — False positive sweep

Engine runs against:
- **Random walks** — synthesized gaussian-drift bars. Should produce very few detections.
- **Pure trends** — synthesized monotonic up/down. Should produce trend-relevant patterns only (no H&S, no double tops in clean uptrends).
- **3,685 tickers × 8 timeframes × 1 year of history** — production-scale sweep.

Recorded per detector:
- Detections per 1,000 bars (rate)
- Confidence distribution (histogram)
- Resolution outcomes (% target / % stop / % expired)

**Hard ship gate:** detector firing >2× median rate OR with hit rate <30% is tuned or shelved before exposure.

### Gate 4 — Confidence calibration backtest

After Gate 3, every detector has thousands of historical detections with known outcomes. Calibration test:

- Bin detections by confidence (0-50, 50-60, 60-70, 70-80, 80-90, 90-100)
- Compute realized hit rate per bin
- Plot: x-axis = predicted confidence midpoint, y-axis = realized hit rate
- **Ship gate:** line should be roughly y=x (calibrated). If 80-confidence detections only hit 40%, scoring is broken — recalibrate before launch.

When engine says 85, it should actually mean 85.

### Gate 5 — Production shadow mode (1-2 weeks)

Before exposing engine via UI:
1. Deploy engine to Railway. Run continuously on live data. Store every detection.
2. UI surfaces remain OFF for users.
3. Admin verification dashboard (`/admin/patterns`) shows live detections in real time:
   - Detection list with confidence, geometry preview, narrative
   - Side-by-side: detection rendered on the live chart
   - Per-detection: 👍 Accept | 👎 Reject | 🚩 Flag for review
4. Operator (Patrick) reviews ~100 live detections daily, marks accuracy.
5. **Ship gate:** ≥85% accept rate sustained over 5 trading days. If below, identify failing detectors and re-tune.

After Gate 5 → toggle UI surfaces ON. Engine has earned its place.

### Continuous quality monitoring (post-launch)

- Pattern stats roll up nightly (`pattern_stats` table)
- Anomaly detection: any pattern's 30-day hit rate drops >15% from baseline → admin alert
- User feedback (👍/❌) feeds per-detector "user accuracy score" alongside outcome-based stats
- Quarterly retune: per-detector confidence weights re-derived from accumulated outcomes

---

## 10. Phased Implementation Plan

Seven phases. Each ships independently. Each runs through Gates 1-3 before next phase starts. Gates 4-5 fire at Phase 6 (pre-launch). Phase 7 activates the learning loop and opens UI to users.

| Phase | Scope | Detectors added | Gates | ETA |
|---|---|---|---|---|
| **0 — Foundation** | Engine skeleton, types, all primitives (pivots/trendlines/volume/geometry/context), memory schema, REST API contracts, 1 pilot detector (bull flag), basic test harness. E2E plumbing: detect → store → API → chart overlay renders one pattern. | bull_flag | 1 | ~1 wk |
| **1 — Classical core** | 10 more classical detectors. Per-detector fixture libraries. Confidence v1. False-positive sweep against universe. | bear_flag, pennant, falling_wedge, rising_wedge, head_shoulders, inverse_h&s, double_top, double_bottom, cup_handle, inverse_cup_handle | 1, 2 | ~2 wk |
| **2 — UCT setups + structure** | 8 highest-value UCT setups + 4 structure detectors. The "edge" patterns specific to UCT trading style. | vcp, high_tight_flag, episodic_pivot, peg, flat_base_uct, u_and_r, remount, cup_handle_uct + swing_pivots, support_resistance, major_trendlines, stage_analysis | 1, 2 | ~2 wk |
| **3 — Candlestick library** | 15 candlestick detectors. Ride on top of existing detections (engulfing in a flag = much higher conviction). | doji_variants, hammer, hanging_man, shooting_star, engulfing×2, piercing, dark_cloud, harami×2, morning_star, evening_star, three_soldiers, three_crows | 1 | ~1.5 wk |
| **4 — Remaining classical + structure** | Fill out the catalog: triangles, rectangles, channels, rounded bases, volume profile, A/D detection. | asc_triangle, desc_triangle, sym_triangle, rectangle, channel, rounded_base, rounded_top, triple_top, triple_bottom, volume_nodes, accumulation_distribution, range_detection, 52w_proximity | 1, 2 | ~1.5 wk |
| **5 — Application surfaces** | Chart overlay component (renderers, side panel, feedback buttons), Pattern Scanner page (`/patterns`), Admin verification dashboard, API plumbing complete. | (no new detectors) | — | ~1.5 wk |
| **6 — Verification + calibration** | Confidence calibration backtest (Gate 4). Production shadow mode (Gate 5). Threshold tuning per detector. Operator review cycle. | (tuning only) | 4, 5 | ~1-2 wk |
| **7 — Launch + learning loop activation** | Toggle UI surfaces ON. Outcome tracker job active. Nightly stats rollup. First feedback cycle. | — | continuous | ~3 days |

**Total: ~10-12 weeks to elite-level launch.**

---

## 11. Post-Phase-7 Follow-Up Initiatives

These are independent. Each its own future spec. None blocks the others.

- **Brain layer integration** — morning wire mentions active patterns with context. Coaching layer cites detected patterns when reviewing trades.
- **Alert system on pattern emergence** — pattern type + symbol + min confidence triggers in-app + email + Discord notification.
- **Journal auto-tagging** — trades log auto-detects which pattern was active at entry and pre-populates the setup field.
- **Pattern-specific backtest hookup** — Backtester gets a new strategy template family: "every X pattern detection, take the trade." Per-pattern realized expectancy.
- **Catalog expansion** — remaining detectors from the catalog become live as engine stability proves out:
  - ~17 UCT setups: Gap-and-Go, BGU, EMA Crossback, 20EMA Hold, Stage 2 entry, Stage 4 breakdown, Powerplay, Box Theory, Base-on-Base, Late-stage climax, 7-Week Short Rule, Oops Reversal, Red-to-Green, Go Signal, HVC, ORB/ORD, 30min Pivot, Mean Reversion L/S
  - ~8 less-common candlesticks: Inverted hammer, Tweezer top/bottom, Three inside up/down, Abandoned baby

---

## 12. Constraints & Out-of-Scope

**In scope:**
- Rules-based detectors with hand-crafted geometric definitions
- Learning loop via outcome tracking + stats accumulation
- SQLite storage co-located with existing `auth.db`
- 8 timeframes from existing bar pipeline
- 3,685-ticker $300M+ universe from existing `cap_universe.json`
- Two application surfaces (chart overlay + scanner) as Phase 1 validation

**Out of scope (Phase 0-7):**
- ML-based detectors (CNN on chart images, etc.) — possible future addition once outcome data accumulates
- Multi-leg pattern composition ("bull flag inside cup & handle") — separate future spec
- User-defined custom detector creation — separate future spec
- Cross-asset pattern correlation (e.g., "bull flag in semis ETF AND in NVDA") — separate future spec
- Real-time WebSocket push of new detections — Phase 1 polls; push is a Phase 8+ enhancement

**Non-functional constraints:**
- Engine must complete one-symbol detection in <100ms compute (Phase 1 target)
- Memory layer must not require schema migrations after initial deploy (additive only)
- Detectors must be pure functions of (bars, context) — no global state, no side effects from detection logic
- All confidence < 50 detections discarded before storage (hard floor)

---

## 13. Success Criteria

The system is "elite-level" if:

1. **Detection accuracy:** ≥85% operator-accept rate sustained over 5 trading days in shadow mode (Gate 5).
2. **Confidence calibration:** within ±5% of y=x line across confidence bins (Gate 4).
3. **Performance:** all per-symbol queries <300ms p99; universe scans <8s.
4. **Coverage breadth:** ≥50 detectors live across all 4 categories by Phase 7 (Phase 0+1+2+3+4 total).
5. **Learning loop:** `pattern_stats` populated with ≥1,000 resolved samples per major pattern within 90 days of launch.
6. **Application integration:** chart overlay + scanner both ship and demonstrate the engine to internal users.
7. **Operator trust:** Patrick (the user) trusts the system enough to act on detections without manual verification.

---

*End of design spec. Ready for implementation plan (Phase 0 first).*
