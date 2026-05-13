# Pattern Recognition — Phase 5 (Application Surfaces) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the 50-detector engine VISIBLE to users. Three surfaces:
1. **Chart overlay** — every StockChart renders detected patterns as SVG shapes (the "see patterns wherever you look" experience)
2. **Pattern Scanner page** (`/patterns`) — universe-wide scan with filters
3. **Admin verification dashboard** (`/admin/patterns`) — operator reviews live detections for Gate 5

**Architecture:**
- Chart overlay is an SVG layer peer to existing `ChartDrawingOverlay.jsx` (never collides with user drawings)
- Coordinate conversion via `timeScale.timeToCoordinate()` + `priceScale.priceToCoordinate()` from lightweight-charts v5
- 6 shape renderers: `trendline_pair`, `neckline`, `cup_curve`, `rectangle`, `candle_mark`, `horizontal_line`
- Side panel on click — full narrative + levels + history + feedback buttons
- Scanner page: filter bar + responsive results grid + drill-in
- Admin: 24-hour detection feed + accept/reject/flag per detection

**Tech stack:** React + Vite SPA, lightweight-charts v5, SWR, existing FastAPI backend.

**Spec reference:** `docs/superpowers/specs/2026-05-11-pattern-recognition-design.md` Sections 7-8.

---

## File structure

### New frontend
| File | Responsibility |
|---|---|
| `app/src/components/chart/PatternOverlay.jsx` | SVG overlay layer that renders all detections |
| `app/src/components/chart/patternShapes/TrendlinePair.jsx` | Shape renderer for `trendline_pair` |
| `app/src/components/chart/patternShapes/Neckline.jsx` | Shape renderer for `neckline` |
| `app/src/components/chart/patternShapes/CupCurve.jsx` | Shape renderer for `cup_curve` |
| `app/src/components/chart/patternShapes/Rectangle.jsx` | Shape renderer for `rectangle` |
| `app/src/components/chart/patternShapes/CandleMark.jsx` | Shape renderer for `candle_mark` |
| `app/src/components/chart/patternShapes/HorizontalLine.jsx` | Shape renderer for `horizontal_line` |
| `app/src/components/chart/PatternSidePanel.jsx` | Slide-in panel on click — full detection detail |
| `app/src/hooks/usePatternDetections.js` | SWR-cached fetcher: `useDetections(sym, tf)` |
| `app/src/pages/Patterns.jsx` | Scanner page |
| `app/src/pages/patterns/PatternFilter.jsx` | Filter bar (types, tf, min_conf, regime) |
| `app/src/pages/patterns/PatternResultCard.jsx` | One card per detection |
| `app/src/pages/admin/PatternAdmin.jsx` | Admin verification dashboard |
| `app/src/pages/admin/DetectionReviewCard.jsx` | One detection per row with accept/reject buttons |
| `app/src/components/chart/PatternToolbarButton.jsx` | Toolbar button to toggle overlay |

### New backend endpoints
| File | Endpoints |
|---|---|
| `api/routers/patterns.py` (extend) | `GET /api/patterns/scan` — universe scan with filters |
| `api/routers/admin_patterns.py` (extend) | `GET /api/admin/patterns/recent?hours=24` — recent detections; `POST /api/admin/patterns/{id}/review` — accept/reject/flag |

### Modified frontend
| File | Change |
|---|---|
| `app/src/components/StockChart.jsx` | Mount `PatternOverlay` as a peer to drawing overlay |
| `app/src/components/chart/ChartToolbar.jsx` | Add patterns-toggle button |
| `app/src/App.jsx` | Add `/patterns` + `/admin/patterns` routes |
| `app/src/components/NavBar.jsx` | Add "Patterns" nav entry (free tier) |
| `app/src/components/MobileNav.jsx` | Same mobile nav entry |

---

## Task 1: Pattern overlay scaffold + coordinate conversion

**Files:**
- Create: `app/src/components/chart/PatternOverlay.jsx`
- Create: `app/src/hooks/usePatternDetections.js`
- Modify: `app/src/components/StockChart.jsx`

- [ ] Implement `usePatternDetections(sym, tf, enabled)` — SWR fetch of `/api/patterns/{sym}?tf={tf}&min_conf=50`. Polls every 30s when chart is visible.

- [ ] Implement `PatternOverlay`:
  - Takes `chart` (lightweight-charts instance), `series` (candle series), `detections` (array), `enabled` (boolean), `onDetectionClick`
  - Renders an SVG element absolutely positioned over the chart with `pointerEvents: 'auto'` on shapes
  - Coordinate conversion helper: `(t, price) => { x: timeScale.timeToCoordinate(t), y: series.priceToCoordinate(price) }`
  - Listens to chart scroll/zoom (`subscribeVisibleTimeRangeChange`, `subscribeVisibleLogicalRangeChange`) to redraw shapes
  - Loops through detections, dispatches to per-shape renderer based on `detection.geometry.shape`
  - Each detection wrapped in an `onClick={() => onDetectionClick(detection)}` `<g>` element

- [ ] Mount in StockChart.jsx as peer to `ChartDrawingOverlay`. Pass `enabled` from a new toolbar toggle state (default OFF until validated).

- [ ] Commit

---

## Task 2: Shape renderers (6 files, one batch)

Per-shape SVG renderers. Each takes detection + coord-conversion helpers, returns `<g>` element with the appropriate SVG primitives.

**Color/style conventions:**
- `direction: "bullish"` → green (#10b981)
- `direction: "bearish"` → red (#ef4444)
- `direction: "neutral"` → gold (#c9a84c)
- Opacity = `detection.confidence / 100`
- Stroke width: 2 normally, 3 if `status === "triggered"`
- Dashed if `status === "forming"`, solid otherwise
- Glow filter applied if detection.detected_at within last 5 bars

**Renderers (one file each):**

### TrendlinePair (flags, wedges, channels, pennants, triangles, rectangles for trendlines)
- 4 anchors → 2 lines
- Line 1: anchor[0] → anchor[1]
- Line 2: anchor[2] → anchor[3]
- Optional connecting "fill" polygon between the two lines with low opacity for channel patterns

### Neckline (H&S, inverse H&S, triple top/bottom)
- 5 anchors: [shoulder_left, trough_left, head, trough_right, shoulder_right]
- Lines connecting shoulder-trough-head-trough-shoulder arcs
- Horizontal line through the two troughs (the neckline itself)

### CupCurve (cup_handle, cup_handle_uct, inverse_cup_handle, rounded_base, rounded_top)
- 3-5 anchors: [left_rim, cup_bottom/dome_peak, right_rim, (handle_low), (handle_high)]
- Quadratic Bezier path: M left_rim Q cup_bottom right_rim
- If handle anchors present, render small handle box (parallelogram)

### Rectangle (rectangle pattern, range_detection)
- Either 4 anchors (4 corners) or just upper-left + lower-right
- SVG `<rect>` with the bounds + low opacity fill + bordered stroke

### CandleMark (single-bar candlesticks, swing_pivots, stage_analysis)
- Anchor at the candle of interest
- Small icon/badge above the candle (15px circle with letter indicating pattern type) for individual candles
- For swing_pivots: dot per pivot location

### HorizontalLine (support_resistance, volume_profile_nodes, major_trendlines if horizontal)
- 2 anchors (line endpoints)
- Straight line across the chart range
- Label "S" or "R" near the right edge

---

## Task 3: Pattern side panel (click-to-detail)

**File:** `app/src/components/chart/PatternSidePanel.jsx`

- Slides in from the right when a pattern is clicked
- Contents:
  - Pattern name + confidence + direction badge
  - Levels: entry, stop, target, R:R
  - Context: trend_stage, ma_alignment, rs_trend, regime, DCR signature
  - Narrative: 5 collapsible sections (headline + 4 body fields)
  - Quality components: small horizontal bar chart (geometry, volume, context, historical)
  - Historical stats placeholder ("Available after Phase 7 launch — outcome tracker pending")
  - Feedback buttons: 👍 Great | 👌 Good | ❌ Miss | ⚠ Wrong → POSTs to `/api/patterns/{id}/feedback`
  - "Add to Watchlist" / "Set Alert" actions (links to existing watchlist/alerts surfaces)

- Close: ESC, click backdrop, or Close button

---

## Task 4: Chart toolbar integration

**Files:**
- Create: `app/src/components/chart/PatternToolbarButton.jsx`
- Modify: `app/src/components/chart/ChartToolbar.jsx`

- Toolbar button: 🎯 icon, click to toggle pattern overlay on/off
- State persisted in `chartSettings.showPatterns` via existing `usePreferences` hook
- When ON, fetches detections via `usePatternDetections`
- Submenu: category filter (Classical / Candlestick / UCT / Structure) — multi-select chips
- Submenu: min confidence slider (50-95)

---

## Task 5: Pattern Scanner page — backend endpoint

**File:** `api/routers/patterns.py` (extend)

Add `GET /api/patterns/scan` endpoint:

```python
@router.get("/scan")
def scan_universe(
    types: Optional[str] = Query(default=None),
    tf: str = Query(default="D"),
    min_conf: float = Query(default=70.0, ge=50.0, le=100.0),
    limit: int = Query(default=50, le=200),
):
    """Scan the universe for active detections matching filters."""
    pattern_ids = [t.strip() for t in types.split(",")] if types else None
    # Query pattern_detections table for detections in the last 5 days with status in (forming/ready/triggered)
    # Filter by pattern_ids if specified, min_conf, tf
    # Order by detected_at DESC, confidence DESC
    # Limit results
    # Return list of detection summaries (id, sym, tf, pattern_id, confidence, direction, narrative.headline, levels, detected_at)
```

Cache results for 5 minutes per filter set.

---

## Task 6: Pattern Scanner page — frontend

**Files:**
- Create: `app/src/pages/Patterns.jsx`
- Create: `app/src/pages/patterns/PatternFilter.jsx`
- Create: `app/src/pages/patterns/PatternResultCard.jsx`
- Modify: `app/src/App.jsx` (add `/patterns` route)
- Modify: `app/src/components/NavBar.jsx` (add "Patterns" nav)
- Modify: `app/src/components/MobileNav.jsx` (add mobile nav)

Layout:
- Top: filter bar with pattern category chips (multi-select), timeframe dropdown, min confidence slider (50-95), regime filter
- Main: responsive grid of detection cards. Each card:
  - Ticker symbol (large)
  - Mini sparkline (50-bar overview)
  - Pattern name + confidence ring (visual gauge)
  - Direction badge (green/red/gold)
  - Levels strip: entry / stop / target / R:R
  - Tiny narrative headline
  - Detected X bars ago
- Click card → opens TickerPopup with the symbol + overlay enabled, drilled to the right timeframe

Polling: refresh every 5 minutes (SWR).

---

## Task 7: Admin verification dashboard — backend

**File:** `api/routers/admin_patterns.py` (extend)

Add 2 endpoints:

```python
@router.get("/recent")
def recent_detections(hours: int = Query(default=24, le=168)):
    """Return detections from the last N hours (default 24)."""
    # Query pattern_detections WHERE detected_at >= now - hours*3600
    # Include geometry/levels/narrative for full-detail review
    # Return list, ordered by detected_at DESC

@router.post("/{detection_id}/review")
def review_detection(detection_id: str, body: ReviewBody):
    """Operator marks a detection as accepted / rejected / flagged.
    
    Body: { action: "accept" | "reject" | "flag", note: optional }
    
    Writes to pattern_feedback with user_id="admin_operator" and rating mapping:
      accept → "great", reject → "wrong", flag → "miss"
    """
```

---

## Task 8: Admin verification dashboard — frontend

**Files:**
- Create: `app/src/pages/admin/PatternAdmin.jsx`
- Create: `app/src/pages/admin/DetectionReviewCard.jsx`
- Modify: `app/src/App.jsx` (add `/admin/patterns` route)
- Modify: `app/src/pages/Admin.jsx` (link from main admin page)

Layout:
- Header: stats summary (last 24h count, accept rate so far, recent flags)
- Filter: pattern type, confidence range, status
- Main: detection feed (one row per detection)
- Each row:
  - Mini chart preview (chart of the symbol + overlay showing the detection)
  - Pattern name + ticker + confidence
  - Narrative headline
  - 3 buttons: ✅ Accept | ❌ Reject | 🚩 Flag
  - Optional note input
  - Live updating: as operator clicks buttons, the row moves to "reviewed" state and the running accept rate updates

Operator goal: review ≥100 detections per day across 5 trading days, target ≥85% accept rate per Gate 5 of the verification strategy.

---

## Task 9: End-to-end smoke + Phase 5 verification

After all tasks committed + pushed:
- [ ] Visit `https://uctintelligence.com/patterns` — should load the scanner page with filters
- [ ] Open any TickerPopup chart, toggle the patterns overlay — should render detected patterns as colored shapes
- [ ] Click a pattern on the chart — side panel slides in with narrative + levels + feedback buttons
- [ ] Visit `https://uctintelligence.com/admin/patterns` (admin only) — should show recent detection feed
- [ ] Run `python scripts/verify_phase.py 5` — should pass (8/9 checks; FP sweep WARN is still expected from Phase 4)
- [ ] Commit Phase 5 verification report

---

## Phase 5 Done — what shipped

After this plan:
- Chart overlay layer on every StockChart renders all 50 detector outputs as visual shapes
- `/patterns` scanner page exposes universe-wide detection feed with filters
- `/admin/patterns` provides operator review interface for Gate 5 shadow mode
- Engine is now USER-VISIBLE — Phase 6 (calibration + shadow mode) and Phase 7 (launch) can proceed

## Self-review

- 9 tasks: 4 chart-overlay tasks + 1 scanner backend + 1 scanner frontend + 1 admin backend + 1 admin frontend + 1 verification.
- Reuses existing patterns (StockChart, drawing overlay layer, TickerPopup, AuthGuard, NavBar conventions).
- All 6 shape renderers ship together in Task 2 — tightly coupled, easier to build as a unit.
- Backend endpoints are thin queries on the existing pattern_detections table — no new schema.
- Admin dashboard wires Gate 5 shadow mode for Phase 6.
- No new dependencies — uses existing lightweight-charts v5 + SWR + React Router.
