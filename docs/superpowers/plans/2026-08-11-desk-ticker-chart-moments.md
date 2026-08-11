# Desk Ticker Chart Moments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Desk recording ticker chips gain since-session return tags + performance sort, clicking a chip opens the user's chart anchored back at the session date (scroll right reveals what happened after), and a theater follow-along pane auto-switches its chart as the discussion moves.

**Architecture:** One new batch endpoint (`/api/education/videos/{id}/ticker-returns`) computes anchor_date + per-ticker returns server-side from bars.db. Frontend consumes it via one SWR hook. Chart anchoring is ONE new StockChart prop (`anchorDate`) composing existing primitives (`computeDefaultLogicalRange` framing + `ChartVLineOverlay` marker + the existing exit pill). Wiring flows VideoDockSlot → TickerPopup → ChartPane (`stockChartProps` spread, already exists).

**Tech Stack:** FastAPI + sqlite (bars_sqlite), React + SWR + vitest, lightweight-charts.

**Spec:** `docs/superpowers/specs/2026-08-11-desk-ticker-chart-moments-design.md`

## Global Constraints

- Worktree: `C:\Users\Patrick\uct-dashboard\.worktrees\desk-ticker-moments`, branch `feat/desk-ticker-moments`. Use ABSOLUTE paths.
- Frontend tests: run FROM `app/` (`cd app && npx vitest run <path relative to app/>`). NEVER `--prefix app --root app` (phantom fails).
- Windows CRLF: never assert multi-line `toContain` blocks that can red on CRLF; assert single lines.
- Commit with explicit paths (`git commit -m "..." -- <paths>`), NEVER `git add -A` (shared repo discipline).
- Partner-owned files are OFF-LIMITS: `OptionsFlow.jsx`, `schwab_router.py`, `live_massive_router.py`, `massive_ws_worker.py`, `massive_processor.py`.
- Backend tests: `python -m pytest tests/<file> -q` from the worktree root.
- No pushes to master. Branch pushes only. Ship gate is the owner's explicit "ship it".
- Daily bars in `bars_sqlite` store `ts` as YYYYMMDD ints; rows are `(ts, o, h, l, c, v)` tuples; close = index 4.
- Every commit message ends with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: Backend — ticker-returns service + endpoint

**Files:**
- Create: `api/services/ticker_returns.py`
- Modify: `api/routers/education.py` (add one GET route next to `get_video_insights`, line ~277)
- Test: `tests/test_ticker_returns.py`

**Interfaces:**
- Produces: `GET /api/education/videos/{video_id}/ticker-returns` (auth: `require_paid`) → `{"anchor_date": "YYYY-MM-DD"|null, "as_of": ISO|null, "returns": {"NVDA": {"since_pct": 14.2, "d5_pct": 3.1|null, "d21_pct": 8.0|null}}}`. Missing video / no created_at → `{"anchor_date": null, "as_of": null, "returns": {}}` (HTTP 200 — mirrors the insights endpoint's render-or-skip contract). Symbols with no basis bar are OMITTED from `returns`.
- `ticker_returns.returns_for_video(video_id: int, now: float | None = None) -> dict` with a 600s in-process TTL cache keyed by video id.
- `ticker_returns.anchor_date_et(created_at: int) -> str` — epoch → ET calendar date.

- [ ] **Step 1: Write the failing tests**

`tests/test_ticker_returns.py`:

```python
"""Since-mention returns for Desk ticker moments (spec 2026-08-11).

bars_sqlite is monkeypatched at ticker_returns' imported name — the sqlite
layer has its own coverage; these tests pin the return MATH, the on-or-before
anchor basis, omission of bar-less symbols, and the TTL cache."""
import pytest

from api.services import ticker_returns


def _mk_bars(closes, start_ymd=20260101):
    # (ts, o, h, l, c, v) daily rows, ts ascending from start_ymd (calendar-naive:
    # sequential ints are fine — the code never date-walks ts, only orders/compares)
    return [(start_ymd + i, c, c, c, c, 1000) for i, c in enumerate(closes)]


def test_anchor_date_et_converts_epoch():
    # 2026-08-09 23:30 UTC == 19:30 ET same day
    assert ticker_returns.anchor_date_et(1786663800) == "2026-08-09"


def test_returns_math_basis_is_on_or_before_anchor(monkeypatch):
    ticker_returns._cache.clear()
    # basis close 100 at/before anchor; after-anchor closes walk up to 121
    basis = _mk_bars([100.0], start_ymd=20260601)
    after = _mk_bars([102.0, 104.0, 106.0, 108.0, 110.0] + [110.0] * 15 + [121.0],
                     start_ymd=20260602)
    monkeypatch.setattr(ticker_returns.bars_sqlite, "get_bars_before",
                        lambda t, tf, n, k: basis)
    monkeypatch.setattr(ticker_returns.bars_sqlite, "get_bars_since",
                        lambda t, tf, k: after)
    monkeypatch.setattr(ticker_returns.edu, "get_video",
                        lambda vid: {"id": vid, "created_at": 1786663800})
    monkeypatch.setattr(ticker_returns.edu, "get_insights",
                        lambda vid: {"ticker_moments": [{"t": 5, "ticker": "NVDA"}]})
    out = ticker_returns.returns_for_video(1)
    assert out["anchor_date"] == "2026-08-09"
    r = out["returns"]["NVDA"]
    assert r["since_pct"] == 21.0          # 100 -> 121
    assert r["d5_pct"] == 10.0             # 100 -> after[4] = 110
    assert r["d21_pct"] == 21.0            # 100 -> after[20] = 121
    assert out["as_of"]


def test_short_history_nulls_d5_d21_and_since_zero_when_no_after(monkeypatch):
    ticker_returns._cache.clear()
    monkeypatch.setattr(ticker_returns.bars_sqlite, "get_bars_before",
                        lambda t, tf, n, k: _mk_bars([50.0]))
    monkeypatch.setattr(ticker_returns.bars_sqlite, "get_bars_since",
                        lambda t, tf, k: [])
    monkeypatch.setattr(ticker_returns.edu, "get_video",
                        lambda vid: {"id": vid, "created_at": 1786663800})
    monkeypatch.setattr(ticker_returns.edu, "get_insights",
                        lambda vid: {"ticker_moments": [{"t": 1, "ticker": "AAPL"}]})
    r = ticker_returns.returns_for_video(2)["returns"]["AAPL"]
    assert r["since_pct"] == 0.0 and r["d5_pct"] is None and r["d21_pct"] is None


def test_symbol_without_basis_omitted_and_dedup(monkeypatch):
    ticker_returns._cache.clear()
    monkeypatch.setattr(ticker_returns.bars_sqlite, "get_bars_before",
                        lambda t, tf, n, k: [] if t == "GHOST" else _mk_bars([10.0]))
    monkeypatch.setattr(ticker_returns.bars_sqlite, "get_bars_since",
                        lambda t, tf, k: _mk_bars([11.0]))
    calls = []
    monkeypatch.setattr(ticker_returns.edu, "get_video",
                        lambda vid: {"id": vid, "created_at": 1786663800})
    monkeypatch.setattr(ticker_returns.edu, "get_insights", lambda vid: {
        "ticker_moments": [{"t": 1, "ticker": "TSLA"}, {"t": 9, "ticker": "TSLA"},
                           {"t": 20, "ticker": "GHOST"}]})
    real_before = ticker_returns._returns_for
    monkeypatch.setattr(ticker_returns, "_returns_for",
                        lambda s, k: calls.append(s) or real_before(s, k))
    out = ticker_returns.returns_for_video(3)["returns"]
    assert "GHOST" not in out and out["TSLA"]["since_pct"] == 10.0
    assert calls.count("TSLA") == 1        # de-duplicated before computing


def test_missing_video_yields_empty_payload(monkeypatch):
    ticker_returns._cache.clear()
    monkeypatch.setattr(ticker_returns.edu, "get_video", lambda vid: None)
    out = ticker_returns.returns_for_video(999)
    assert out == {"anchor_date": None, "as_of": None, "returns": {}}


def test_ttl_cache_serves_then_expires(monkeypatch):
    ticker_returns._cache.clear()
    hits = {"n": 0}

    def counting_before(t, tf, n, k):
        hits["n"] += 1
        return _mk_bars([100.0])
    monkeypatch.setattr(ticker_returns.bars_sqlite, "get_bars_before", counting_before)
    monkeypatch.setattr(ticker_returns.bars_sqlite, "get_bars_since", lambda t, tf, k: [])
    monkeypatch.setattr(ticker_returns.edu, "get_video",
                        lambda vid: {"id": vid, "created_at": 1786663800})
    monkeypatch.setattr(ticker_returns.edu, "get_insights",
                        lambda vid: {"ticker_moments": [{"t": 1, "ticker": "AMD"}]})
    ticker_returns.returns_for_video(7, now=1000.0)
    ticker_returns.returns_for_video(7, now=1100.0)      # inside TTL — cache hit
    assert hits["n"] == 1
    ticker_returns.returns_for_video(7, now=1000.0 + 601.0)  # expired — recompute
    assert hits["n"] == 2
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest tests/test_ticker_returns.py -q`
Expected: FAIL — `ModuleNotFoundError`/`ImportError` on `api.services.ticker_returns`.

- [ ] **Step 3: Implement the service**

`api/services/ticker_returns.py`:

```python
"""Since-mention returns for a Desk video's ticker moments.

anchor_date = the session day: edu_videos.created_at (epoch) converted to an ET
calendar date — the auto-publish pipeline lands minutes after the session ends,
so created_at's ET date IS the session date. This module is the ONE authority
for anchor_date; the frontend never re-derives it (chips, anchored charts and
the follow-along pane all read it from this payload).

Basis close = last daily close ON or BEFORE the anchor (a mention on a Sunday
session anchors to Friday's close). Symbols with no basis bar (IPO'd later,
never in the universe) are omitted — the client renders those chips plain.
Daily bars ts is a YYYYMMDD int (bars_sqlite)."""
import time
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from api.services import bars_sqlite
from api.services import education_service as edu

_ET = ZoneInfo("America/New_York")
_TTL_SECS = 600.0
_cache: dict[int, tuple[float, dict]] = {}


def anchor_date_et(created_at: int | float) -> str:
    return datetime.fromtimestamp(int(created_at), tz=_ET).strftime("%Y-%m-%d")


def _pct(basis: float, close: float) -> float:
    return round((close / basis - 1.0) * 100.0, 2)


def _returns_for(ticker: str, anchor_ymd: int) -> dict | None:
    basis_rows = bars_sqlite.get_bars_before(ticker, "D", 1, anchor_ymd)
    if not basis_rows:
        return None
    basis_c = float(basis_rows[-1][4])
    if basis_c <= 0:
        return None
    after = bars_sqlite.get_bars_since(ticker, "D", anchor_ymd)
    return {
        "since_pct": _pct(basis_c, float(after[-1][4])) if after else 0.0,
        "d5_pct": _pct(basis_c, float(after[4][4])) if len(after) >= 5 else None,
        "d21_pct": _pct(basis_c, float(after[20][4])) if len(after) >= 21 else None,
    }


def returns_for_video(video_id: int, now: float | None = None) -> dict:
    now = time.time() if now is None else now
    hit = _cache.get(video_id)
    if hit and hit[0] > now:
        return hit[1]
    video = edu.get_video(video_id)
    if not video or not video.get("created_at"):
        return {"anchor_date": None, "as_of": None, "returns": {}}
    anchor = anchor_date_et(video["created_at"])
    anchor_ymd = int(anchor.replace("-", ""))
    moments = (edu.get_insights(video_id) or {}).get("ticker_moments") or []
    syms = list(dict.fromkeys(
        m.get("ticker") for m in moments if m.get("ticker")))
    returns = {}
    for sym in syms:
        r = _returns_for(sym, anchor_ymd)
        if r is not None:
            returns[sym] = r
    payload = {
        "anchor_date": anchor,
        "as_of": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "returns": returns,
    }
    _cache[video_id] = (now + _TTL_SECS, payload)
    return payload
```

- [ ] **Step 4: Run service tests**

Run: `python -m pytest tests/test_ticker_returns.py -q`
Expected: 6 passed.

- [ ] **Step 5: Add the router endpoint + its test**

In `api/routers/education.py`, directly AFTER `get_video_insights` (after its `return out`, before `get_related_videos`):

```python
@router.get("/videos/{video_id}/ticker-returns")
def get_video_ticker_returns(video_id: int, _user: dict = Depends(require_paid)):
    """% move of each ticker-moment symbol since the session date — powers the
    Desk chip scorecard, anchored charts, and the follow-along pane. anchor_date
    is derived here (created_at → ET) so the client never re-derives it.
    ~10-min in-process cache per video."""
    from api.services import ticker_returns
    return ticker_returns.returns_for_video(int(video_id))
```

Append to `tests/test_ticker_returns.py` (route-presence pinned off `router.routes` — derived, never typed into a grep):

```python
def test_route_registered_with_paid_auth():
    from api.routers import education
    routes = {r.path: r for r in education.router.routes}
    path = "/videos/{video_id}/ticker-returns"
    assert path in routes, f"ticker-returns route missing; have: {sorted(routes)}"
    # Non-vacuity control: the sibling insights route is in the same table
    assert "/videos/{video_id}/insights" in routes


def test_endpoint_returns_service_payload(monkeypatch):
    ticker_returns._cache.clear()
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.routers import education
    sentinel = {"anchor_date": "2026-08-09", "as_of": "x", "returns": {"NVDA": {"since_pct": 1.0, "d5_pct": None, "d21_pct": None}}}
    monkeypatch.setattr(ticker_returns, "returns_for_video", lambda vid: sentinel)
    app = FastAPI()
    app.include_router(education.router, prefix="/api/education")
    app.dependency_overrides[education.require_paid] = lambda: {"email": "t@t.t"}
    client = TestClient(app)
    resp = client.get("/api/education/videos/5/ticker-returns")
    assert resp.status_code == 200 and resp.json() == sentinel
```

NOTE: if `education.py` imports `require_paid` under a different name/module, mirror EXACTLY how the sibling insights test authenticates (check `tests/test_education_taxonomy.py` for the house override idiom) — the dependency override key must be the same object the route depends on.

- [ ] **Step 6: Run all task tests**

Run: `python -m pytest tests/test_ticker_returns.py -q`
Expected: 8 passed. Also run the neighbors: `python -m pytest tests/test_education_taxonomy.py -q` → still green.

- [ ] **Step 7: Commit**

```bash
git add api/services/ticker_returns.py api/routers/education.py tests/test_ticker_returns.py
git commit -m "feat(desk): ticker-returns endpoint — since-session % per ticker moment

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -- api/services/ticker_returns.py api/routers/education.py tests/test_ticker_returns.py
```

---

### Task 2: StockChart — `anchorDate` (anchored + reveal) and `exitReplayLabel`

**Files:**
- Modify: `app/src/components/StockChart.jsx` — props block (~line 1219), first-load framing effect (~line 7970-8120), phased-commit branch right after it, exit pill (~line 11848), `ChartVLineOverlay` mount (~line 12321)
- Test: `app/src/components/StockChart.anchor.test.jsx` (new)

**Interfaces:**
- Consumes: existing `computeDefaultLogicalRange(barsLen, tf, opts)` (line ~285), `ChartVLineOverlay`, `userViewMovedRef`, the pill.
- Produces (for Tasks 3/5/6): StockChart props `anchorDate: 'YYYY-MM-DD'|null` (frame default zoom ending at the last bar at/before anchor day's end; later bars stay LOADED — this is view-only, bars are never sliced, in contrast to `replayCutoff`), `exitReplayLabel: string|null` (pill text override), and exported pure helper `lastAnchorIdx(bars, anchorDate) -> number` (-1 when no bar qualifies). Pill shows when `(replayCutoff || startMarker || anchorDate) && onExitReplay`. Marker line draws at `startMarker || anchorDate`. Clearing `anchorDate` (non-null → null) re-frames to the canonical present-day default. User pan/zoom stops all anchor re-assertion (`userViewMovedRef` — same contract replay uses).

- [ ] **Step 1: Write the failing pure-helper test**

`app/src/components/StockChart.anchor.test.jsx`:

```jsx
// anchorDate contract (spec 2026-08-11): lastAnchorIdx picks the last bar
// at/before the END of the anchor day, across daily (ISO-string t) and
// intraday (unix-seconds t) series. -1 = anchor precedes all bars.
import { describe, it, expect } from 'vitest'
import { lastAnchorIdx } from './StockChart'

const D = (t) => ({ t, o: 1, h: 1, l: 1, c: 1, v: 1 })

describe('lastAnchorIdx', () => {
  it('daily: picks the anchor-day bar when present', () => {
    const bars = [D('2026-02-09'), D('2026-02-10'), D('2026-02-11'), D('2026-02-12')]
    expect(lastAnchorIdx(bars, '2026-02-11')).toBe(2)
  })
  it('daily: weekend anchor falls back to the prior session', () => {
    const bars = [D('2026-02-06'), D('2026-02-09')] // Fri, Mon
    expect(lastAnchorIdx(bars, '2026-02-08')).toBe(0) // Sunday → Friday
  })
  it('intraday: unix-second bars on the anchor day are included through day end', () => {
    // 2026-02-11 14:30 & 20:00 UTC, then 2026-02-12 14:30 UTC
    const bars = [D(1770820200), D(1770840000), D(1770906600)]
    expect(lastAnchorIdx(bars, '2026-02-11')).toBe(1)
  })
  it('anchor before all bars → -1; empty/absent → -1', () => {
    expect(lastAnchorIdx([D('2026-02-09')], '2026-01-01')).toBe(-1)
    expect(lastAnchorIdx([], '2026-02-09')).toBe(-1)
    expect(lastAnchorIdx(null, '2026-02-09')).toBe(-1)
  })
  it('anchor after all bars → last index (anchored at present is a no-op frame)', () => {
    const bars = [D('2026-02-09'), D('2026-02-10')]
    expect(lastAnchorIdx(bars, '2026-03-01')).toBe(1)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd app && npx vitest run src/components/StockChart.anchor.test.jsx`
Expected: FAIL — `lastAnchorIdx` is not exported.

- [ ] **Step 3: Implement in StockChart.jsx**

3a. Export the helper next to `computeDefaultLogicalRange` (~line 285):

```jsx
// Last bar at/before the END (UTC) of anchor day. Daily bars carry ISO 'YYYY-MM-DD'
// strings; intraday bars carry unix seconds. Exported for its unit tests.
export function lastAnchorIdx(bars, anchorDate) {
  if (!anchorDate || !bars || bars.length === 0) return -1
  const endMs = Date.parse(`${anchorDate}T23:59:59Z`)
  if (!Number.isFinite(endMs)) return -1
  let idx = -1
  for (let i = 0; i < bars.length; i++) {
    const t = bars[i].t
    const ms = typeof t === 'number'
      ? (t < 1e12 ? t * 1000 : t)
      : Date.parse(String(t).length <= 10 ? `${t}T00:00:00Z` : String(t))
    if (!Number.isFinite(ms)) continue
    if (ms <= endMs) idx = i
    else break
  }
  return idx
}
```

3b. Props block (after `startMarker`, ~line 1221):

```jsx
  anchorDate = null,          // 'YYYY-MM-DD' — Desk anchored+reveal: FIRST FRAME uses the default
                              // zoom ending at this day's bar (marker line drawn there); later bars
                              // stay LOADED off-screen right (scroll to reveal). View-only — never
                              // slices data (contrast replayCutoff). User pan/zoom releases it.
  exitReplayLabel = null,     // pill text override ('⟲ Back to today' for anchored charts)
```

3c. A small frame-applier helper INSIDE the component (near the framing effect), used by both the first-load branch and the phased-commit branch:

```jsx
  // Anchored+reveal frame: default zoom width ending at the anchor bar. Passing a
  // VIRTUAL length (aIdx+1) to computeDefaultLogicalRange frames the anchor bar at
  // LAST_CANDLE_POS exactly like the newest bar normally is — later bars run off-screen
  // right. Returns false when no bar qualifies (host falls through to normal framing).
  const applyAnchorFrame = (chart) => {
    if (!anchorDate || !filteredBars || filteredBars.length === 0) return false
    const aIdx = lastAnchorIdx(filteredBars, anchorDate)
    if (aIdx < 0) return false
    const { from, to } = computeDefaultLogicalRange(
      aIdx + 1, resolvedTf,
      { dailyDefaultBars, leftBarPad, rightPadBars, visibleBarsOverride,
        plotWidthPx: plotWidthOf(chart, containerRef.current) })
    try { chart.timeScale().setVisibleLogicalRange({ from, to }) } catch { return false }
    return true
  }
```

3d. First-load framing: in the `!didPreserve` chain (~line 8067), add the anchor branch BEFORE the final `else` (the canonical default), AFTER the `entryDate` branches:

```jsx
        } else if (anchorDate && !userViewMovedRef.current && applyAnchorFrame(chart)) {
          // Anchored+reveal handled — nothing else to frame.
        } else {
```

(i.e. the existing `else {` containing `pendingTfReframeRef`/default becomes the fall-through when the anchor frame doesn't apply.)

3e. Phased loads: bars arrive in phases (IDB cache → network → older-history backfill), each commit re-running the effect with the SAME zoomKey but a new bar count. In the `} else if (!entryDate && !exactDateRange && _preUpdateRange && oldBarCount > 0 && oldBarCount !== filteredBars.length)` branch (~line 8118), FIRST re-assert the anchor:

```jsx
      // Anchored chart: a backfill prepends older bars, shifting the anchor's index —
      // recompute the anchor frame from data instead of preserving relative position.
      // The moment the user moves the view, userViewMovedRef latches and this stops.
      if (anchorDate && !userViewMovedRef.current && applyAnchorFrame(chart)) { /* framed */ } else {
      ...existing branch body unchanged...
      }
```

3f. Clear-to-present. Near the framing effect add:

```jsx
  // "Back to today": anchorDate transitioning non-null → null re-frames to the
  // canonical present-day default (same helper "Reset view" uses).
  const prevAnchorRef = useRef(anchorDate)
  useEffect(() => {
    const prev = prevAnchorRef.current
    prevAnchorRef.current = anchorDate
    const chart = chartRef.current
    if (!prev || anchorDate || !chart || !filteredBars || filteredBars.length === 0) return
    const { from, to } = computeDefaultLogicalRange(
      filteredBars.length, resolvedTf,
      { dailyDefaultBars, leftBarPad, rightPadBars, visibleBarsOverride,
        plotWidthPx: plotWidthOf(chart, containerRef.current) })
    try { chart.timeScale().setVisibleLogicalRange({ from, to }) } catch { /* mid-load */ }
  }, [anchorDate, filteredBars, resolvedTf, dailyDefaultBars, leftBarPad, rightPadBars, visibleBarsOverride])
```

3g. Pill (~line 11848): condition becomes `{(replayCutoff || startMarker || anchorDate) && onExitReplay && (` , label becomes `>{exitReplayLabel || '⟲ Exit Replay Mode'}</button>` and `title={exitReplayLabel ? 'Return the chart to today' : 'Exit replay mode — restore all bars + clear the start-date line'}`.

3h. Marker (~line 12321): both the condition and the date become `startMarker || anchorDate`:

```jsx
      {(startMarker || anchorDate) && bars?.length > 0 && (
        ...
          <ChartVLineOverlay chartRef={chartRef} seriesRef={candleSeriesRef} bars={bars} date={startMarker || anchorDate} color="#c9a84c" />
```

- [ ] **Step 4: Run the helper test + chart suites**

Run: `cd app && npx vitest run src/components/StockChart.anchor.test.jsx src/components/StockChart.smoke.test.jsx src/components/StockChart.gate.test.js`
Expected: all pass. Then the wider chart area: `cd app && npx vitest run src/components/chart src/pages/__tests__ 2>/dev/null || true` — no NEW failures vs baseline.

- [ ] **Step 5: Framing smoke — anchored render**

Append to `StockChart.anchor.test.jsx` a render test FOLLOWING THE EXACT harness idiom of `StockChart.smoke.test.jsx` (same mocks/providers — read it first; do NOT invent a new harness). Assert: rendering with `anchorDate="2026-02-11"`, `onExitReplay={fn}`, `exitReplayLabel="⟲ Back to today"` (a) shows a button with text `⟲ Back to today`, (b) clicking it calls `fn`, (c) rendering WITHOUT `anchorDate` shows no such button. If the smoke harness can't mount the pill layer (it renders the toolbar row — it should), assert (a)/(b) at minimum.

Run: `cd app && npx vitest run src/components/StockChart.anchor.test.jsx`
Expected: PASS.

- [ ] **Step 6: Mutation check (manual, quick)**

Temporarily invert `if (ms <= endMs) idx = i` to `<` in `lastAnchorIdx` → helper tests must FAIL (the daily anchor-day case). Revert. Temporarily drop `anchorDate` from the pill condition → pill test must FAIL. Revert. Both reds prove the tests bite.

- [ ] **Step 7: Commit**

```bash
git add app/src/components/StockChart.jsx app/src/components/StockChart.anchor.test.jsx
git commit -m "feat(chart): anchorDate — anchored+reveal framing, marker + Back-to-today pill

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -- app/src/components/StockChart.jsx app/src/components/StockChart.anchor.test.jsx
```

---

### Task 3: TickerPopup — accept `anchorDate`, own the un-anchor state

**Files:**
- Modify: `app/src/components/TickerPopup.jsx` (props line ~28, `stockChartProps` block ~line 215)
- Test: `app/src/components/TickerPopup.anchor.test.jsx` (new)

**Interfaces:**
- Consumes: StockChart `anchorDate`/`exitReplayLabel`/`onExitReplay` via ChartPane's `stockChartProps` spread (Task 2).
- Produces (for Task 5): `TickerPopup` prop `anchorDate: 'YYYY-MM-DD'|null`. When set, the popup chart opens anchored with a `⟲ Back to today` pill; pressing it un-anchors (chart returns to present). Re-opening the popup re-anchors (state resets on each open). `anchorDate={null}` = today's behavior, byte-identical.

- [ ] **Step 1: Write the failing test**

`app/src/components/TickerPopup.anchor.test.jsx` — mock ChartPane and assert the pass-through + the un-anchor lifecycle. Follow the mock idiom of `app/src/components/screener/ScanToChart.wire.test.jsx` (it already mocks ChartPane and records props); providers: copy whatever wrapper that file uses (Auth/TickerHub contexts).

```jsx
// TickerPopup anchorDate contract (spec 2026-08-11): the popup forwards the
// anchor into ChartPane's stockChartProps with a Back-to-today pill wired to
// un-anchor; reopening restores the anchor. anchorDate=null forwards nothing.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

const paneProps = vi.fn()
vi.mock('./chart/pane/ChartPane', () => ({
  default: (props) => { paneProps(props); return <div data-testid="pane-stub" /> },
}))
import TickerPopup from './TickerPopup'
// + the SAME provider wrapper ScanToChart.wire.test.jsx uses — copy it verbatim.

const lastPane = () => paneProps.mock.calls.at(-1)[0]

describe('TickerPopup anchorDate', () => {
  it('forwards anchorDate + Back-to-today wiring into stockChartProps', async () => {
    render(<Wrapper><TickerPopup sym="NVDA" anchorDate="2026-02-11">NVDA</TickerPopup></Wrapper>)
    fireEvent.click(screen.getByText('NVDA'))
    await screen.findByTestId('pane-stub')
    const scp = lastPane().stockChartProps
    expect(scp.anchorDate).toBe('2026-02-11')
    expect(scp.exitReplayLabel).toBe('⟲ Back to today')
    expect(typeof scp.onExitReplay).toBe('function')
  })
  it('onExitReplay un-anchors; closing + reopening re-anchors', async () => {
    render(<Wrapper><TickerPopup sym="NVDA" anchorDate="2026-02-11">NVDA</TickerPopup></Wrapper>)
    fireEvent.click(screen.getByText('NVDA'))
    await screen.findByTestId('pane-stub')
    act(() => lastPane().stockChartProps.onExitReplay())
    expect(lastPane().stockChartProps.anchorDate).toBeUndefined()
    // close (Escape / overlay per the component's close affordance) then reopen
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByText('NVDA'))
    await screen.findByTestId('pane-stub')
    expect(lastPane().stockChartProps.anchorDate).toBe('2026-02-11')
  })
  it('anchorDate absent → no anchor keys in stockChartProps (existing surfaces untouched)', async () => {
    render(<Wrapper><TickerPopup sym="NVDA">NVDA</TickerPopup></Wrapper>)
    fireEvent.click(screen.getByText('NVDA'))
    await screen.findByTestId('pane-stub')
    const scp = lastPane().stockChartProps
    expect('anchorDate' in scp).toBe(false)
    expect('onExitReplay' in scp).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd app && npx vitest run src/components/TickerPopup.anchor.test.jsx`
Expected: FAIL — `anchorDate` never reaches the stub.

- [ ] **Step 3: Implement**

In `TickerPopup.jsx`:

Props: `export default function TickerPopup({ sym, tvSym, as: Tag = 'span', customChartFn, className, children, markers = null, priceLines = null, stopPrice = null, anchorDate = null, open: openProp, onClose }) {`

State (near `const [tab, setTab]`):

```jsx
  // Anchored+reveal (Desk recordings): open positioned at the session date; the
  // chart's "⟲ Back to today" pill un-anchors. Re-arm on every open so the next
  // look at the recording starts back at the session again.
  const [anchored, setAnchored] = useState(true)
  useEffect(() => { if (modalOpen) setAnchored(true) }, [modalOpen])
```

`stockChartProps` (line ~215) gains, after `onCompareChange: setCompareSymbol,`:

```jsx
                      ...(anchorDate && anchored ? {
                        anchorDate,
                        exitReplayLabel: '⟲ Back to today',
                        onExitReplay: () => setAnchored(false),
                      } : {}),
```

- [ ] **Step 4: Run tests**

Run: `cd app && npx vitest run src/components/TickerPopup.anchor.test.jsx`
Expected: PASS. If the reopen assertion fails because closing unmounts and remounts state anyway, the `useEffect` re-arm still holds — debug against the component's actual close path before touching the design.

- [ ] **Step 5: Commit**

```bash
git add app/src/components/TickerPopup.jsx app/src/components/TickerPopup.anchor.test.jsx
git commit -m "feat(popup): anchorDate pass-through with re-arming Back-to-today

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -- app/src/components/TickerPopup.jsx app/src/components/TickerPopup.anchor.test.jsx
```

---

### Task 4: `useTickerReturns` hook

**Files:**
- Create: `app/src/hooks/useTickerReturns.js`
- Test: `app/src/hooks/useTickerReturns.test.js`

**Interfaces:**
- Consumes: Task 1's endpoint.
- Produces (for Tasks 5/6): `useTickerReturns(videoId) -> { anchorDate: string|null, returns: {SYM: {since_pct, d5_pct, d21_pct}} }` — SWR-cached (5-min dedupe), `{anchorDate: null, returns: {}}` while loading/on error/when videoId is null.

- [ ] **Step 1: Write the failing test**

`app/src/hooks/useTickerReturns.test.js` (mirror the structure of the existing `useVideoInsights` consumers' tests — plain renderHook + fetch stub):

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { useTickerReturns } from './useTickerReturns'

const wrapper = ({ children }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
)

beforeEach(() => { vi.restoreAllMocks() })

describe('useTickerReturns', () => {
  it('null videoId fetches nothing and returns empties', () => {
    const spy = vi.spyOn(global, 'fetch')
    const { result } = renderHook(() => useTickerReturns(null), { wrapper })
    expect(result.current).toEqual({ anchorDate: null, returns: {} })
    expect(spy).not.toHaveBeenCalled()
  })
  it('maps the payload and hits the right URL', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({
      anchor_date: '2026-02-11', as_of: 'x',
      returns: { NVDA: { since_pct: 14.2, d5_pct: 3.1, d21_pct: 8.0 } } }) })
    const { result } = renderHook(() => useTickerReturns(42), { wrapper })
    await waitFor(() => expect(result.current.anchorDate).toBe('2026-02-11'))
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/education/videos/42/ticker-returns', { credentials: 'include' })
    expect(result.current.returns.NVDA.since_pct).toBe(14.2)
  })
  it('error → empties (never throws into render)', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: false })
    const { result } = renderHook(() => useTickerReturns(42), { wrapper })
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(result.current).toEqual({ anchorDate: null, returns: {} })
  })
})
```

- [ ] **Step 2: Run to verify failure** — `cd app && npx vitest run src/hooks/useTickerReturns.test.js` → FAIL (module missing).

- [ ] **Step 3: Implement**

`app/src/hooks/useTickerReturns.js`:

```jsx
// Since-session % for a Desk video's ticker moments + the session anchor date.
// ONE fetch per video (chips, anchored popups and the follow-along pane share
// it via SWR). anchor_date is server-derived — never re-derive it client-side.
import useSWR from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null))

const EMPTY = Object.freeze({ anchorDate: null, returns: Object.freeze({}) })

export function useTickerReturns(videoId) {
  const key = videoId != null ? `/api/education/videos/${videoId}/ticker-returns` : null
  const { data } = useSWR(key, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 300_000,
  })
  if (!data || typeof data !== 'object') return EMPTY
  return {
    anchorDate: data.anchor_date || null,
    returns: data.returns && typeof data.returns === 'object' ? data.returns : {},
  }
}
```

- [ ] **Step 4: Run** — `cd app && npx vitest run src/hooks/useTickerReturns.test.js` → 3 passed.

- [ ] **Step 5: Commit**

```bash
git add app/src/hooks/useTickerReturns.js app/src/hooks/useTickerReturns.test.js
git commit -m "feat(desk): useTickerReturns hook

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -- app/src/hooks/useTickerReturns.js app/src/hooks/useTickerReturns.test.js
```

---

### Task 5: VideoDockSlot — % tags, performance sort, anchor wiring + severed-wire test

**Files:**
- Modify: `app/src/components/video/VideoDockSlot.jsx` (chip block ~lines 511-535, tickersHead ~481-510), `app/src/components/video/VideoDockSlot.module.css`
- Test: `app/src/components/video/VideoDockSlot.returns.test.jsx` (new)

**Interfaces:**
- Consumes: `useTickerReturns` (Task 4), `TickerPopup anchorDate` (Task 3).
- Produces: chips show `+14%`-style tags (green/red) with note+since/1w/1m tooltip; header sort toggle (chronological ⇄ performance, persisted `uct.desk.tickerSort`); every chip's `TickerPopup` carries `anchorDate`.

- [ ] **Step 1: Write the failing tests**

`VideoDockSlot.returns.test.jsx`. Read `VideoDockSlot.test.jsx` FIRST and reuse its scaffolding verbatim (videoStore seeding, provider wrappers, fetch stub). Extend the fetch stub with a `/ticker-returns` route:
`{ anchor_date: '2026-02-11', as_of: 'x', returns: { NVDA: { since_pct: 14.2, d5_pct: 3.1, d21_pct: 8.0 }, AMD: { since_pct: -3.4, d5_pct: null, d21_pct: null } } }`
and an insights stub with moments `NVDA (t=30, note 'breaking out'), AMD (t=90), GHOST (t=120)`.

Mock ChartPane exactly as Task 3's test does (specifier from this file: `vi.mock('../chart/pane/ChartPane', ...)` recording props into `paneProps`).

Tests:

```jsx
it('chips show colored since-session tags; bar-less symbols render plain', ...)
   // NVDA chip contains '+14%' with the positive class, AMD '-3.4%' negative,
   // GHOST chip exists but has NO tag node.
it('tooltip carries note + breakdown', ...)
   // NVDA tag title === 'breaking out · Since session: +14% · 1w: +3.1% · 1m: +8.0%'
it('sort toggle reorders by since_pct desc and persists', ...)
   // default order NVDA,AMD,GHOST (chronological); click toggle → NVDA,AMD,GHOST
   // becomes NVDA(+14.2) first, AMD(-3.4) next, GHOST last (missing = -Infinity);
   // localStorage['uct.desk.tickerSort'] === '1'; toggle back → chronological.
it('THE WIRE: clicking a chip symbol opens the chart WITH the session anchor', ...)
   // click the NVDA symbol button → ChartPane stub mounted →
   // expect(lastPane().stockChartProps.anchorDate).toBe('2026-02-11')
   // This test is the severed-wire rail: it reds if VideoDockSlot stops passing
   // anchorDate OR TickerPopup stops forwarding it.
it('returns fetch failed → chips render exactly as today (no tags, no sort button)', ...)
```

- [ ] **Step 2: Run to verify failure** — `cd app && npx vitest run src/components/video/VideoDockSlot.returns.test.jsx` → FAIL (no tags rendered).

- [ ] **Step 3: Implement in VideoDockSlot.jsx**

3a. Imports + hook + helpers (near the other hooks, ~line 45):

```jsx
import { useTickerReturns } from '../../hooks/useTickerReturns'

  const { anchorDate, returns } = useTickerReturns(current?.id)

  // % formatting: whole numbers ≥10 ('+14%'), one decimal below ('-3.4%').
  const fmtPct = (p) => `${p > 0 ? '+' : p < 0 ? '' : ''}${Math.abs(p) >= 10 ? Math.round(p) : p.toFixed(1)}%`
  const retTitle = (tm, r) => {
    const parts = [`Since session: ${fmtPct(r.since_pct)}`]
    if (Number.isFinite(r.d5_pct)) parts.push(`1w: ${fmtPct(r.d5_pct)}`)
    if (Number.isFinite(r.d21_pct)) parts.push(`1m: ${fmtPct(r.d21_pct)}`)
    return `${tm.note ? `${tm.note} · ` : ''}${parts.join(' · ')}`
  }
```

3b. Sort state (next to `tickersOpen`, same persistence idiom):

```jsx
  const [sortByPerf, setSortByPerf] = useState(() => {
    try { return window.localStorage.getItem('uct.desk.tickerSort') === '1' } catch { return false }
  })
  const toggleSort = useCallback(() => {
    setSortByPerf((s) => {
      const next = !s
      try { window.localStorage.setItem('uct.desk.tickerSort', next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }, [])
  // Sorting reorders the CHIPS; activeTicker stays an index into the CHRONOLOGICAL
  // tickerMoments, so the playing-now highlight compares moment IDENTITY, not index.
  const activeMoment = activeTicker >= 0 ? tickerMoments[activeTicker] : null
  const displayMoments = useMemo(() => {
    if (!sortByPerf) return tickerMoments
    return [...tickerMoments].sort((a, b) =>
      (returns[b.ticker]?.since_pct ?? -Infinity) - (returns[a.ticker]?.since_pct ?? -Infinity))
  }, [tickerMoments, sortByPerf, returns])
  const haveReturns = Object.keys(returns).length > 0
```

3c. Chip render block (~511-535): iterate `displayMoments`, active by identity, add the tag, and thread the anchor:

```jsx
                    {displayMoments.map((tm, i) => (
                      <span
                        key={`${tm.ticker}-${tm.t}-${i}`}
                        className={`${styles.tickerChip} ${tm === activeMoment ? styles.tickerChipActive : ''}`}
                        title={tm.note || tm.ticker}
                      >
                        {/* Symbol → chart ANCHORED at the session date · RS badge ·
                            since-session % · time → seek. */}
                        <TickerPopup sym={tm.ticker} anchorDate={anchorDate} as="button" className={styles.tickerSym}>
                          {tm.ticker}
                        </TickerPopup>
                        <RsBadge sym={tm.ticker} size="sm" />
                        {Number.isFinite(returns[tm.ticker]?.since_pct) && (
                          <span
                            className={`${styles.tickerRet} ${returns[tm.ticker].since_pct >= 0 ? styles.tickerRetPos : styles.tickerRetNeg}`}
                            title={retTitle(tm, returns[tm.ticker])}
                          >
                            {fmtPct(returns[tm.ticker].since_pct)}
                          </span>
                        )}
                        <button
                          className={styles.tickerTime}
                          onClick={() => seekTo(tm.t)}
                          title={`Jump to ${fmtT(tm.t)} in the video`}
                        >
                          {fmtT(tm.t)}
                        </button>
                      </span>
                    ))}
```

3d. Sort toggle in the tickers header (inside `styles.tickersHead`, next to the `+ Watchlist` button):

```jsx
                {haveReturns && (
                  <button
                    type="button"
                    className={styles.tickerSortBtn}
                    onClick={toggleSort}
                    title={sortByPerf ? 'Showing best → worst since the session — click for discussion order' : 'Sort tickers by % move since the session'}
                  >
                    {sortByPerf ? '⇅ Perf' : '⇅ Order'}
                  </button>
                )}
```

3e. `VideoDockSlot.module.css` additions (match the module's existing chip font sizing):

```css
.tickerRet {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 999px;
  letter-spacing: 0.02em;
}
.tickerRetPos { color: #4ade80; background: rgba(74, 222, 128, 0.12); }
.tickerRetNeg { color: #f87171; background: rgba(248, 113, 113, 0.12); }
.tickerSortBtn {
  border: none;
  background: transparent;
  color: var(--desk-muted, #9aa1ad);
  font-size: 11px;
  cursor: pointer;
  padding: 2px 6px;
}
.tickerSortBtn:hover { color: var(--desk-ink, #e7e9ee); }
```

(If the module defines its own muted/ink custom properties under different names, use THOSE — read the file's existing buttons first.)

- [ ] **Step 4: Run** — `cd app && npx vitest run src/components/video/VideoDockSlot.returns.test.jsx src/components/video/VideoDockSlot.test.jsx src/components/video/VideoDockSlot.notebook.test.jsx` → all pass (the two existing files guard against regression).

- [ ] **Step 5: Mutation check** — remove `anchorDate={anchorDate}` from the chip's TickerPopup → the WIRE test must FAIL. Restore. Swap `tm === activeMoment` back to `i === activeTicker` and enable sort in the sort test with a playhead active — highlight test (extend the sort test to pin this if quick) or at minimum confirm the sort test still passes. Restore.

- [ ] **Step 6: Commit**

```bash
git add app/src/components/video/VideoDockSlot.jsx app/src/components/video/VideoDockSlot.module.css app/src/components/video/VideoDockSlot.returns.test.jsx
git commit -m "feat(desk): since-session % tags, perf sort, session-anchored chip charts

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -- app/src/components/video/VideoDockSlot.jsx app/src/components/video/VideoDockSlot.module.css app/src/components/video/VideoDockSlot.returns.test.jsx
```

---

### Task 6: VideoDockSlot — follow-along chart pane

**Files:**
- Modify: `app/src/components/video/VideoDockSlot.jsx`, `app/src/components/video/VideoDockSlot.module.css`
- Test: `app/src/components/video/VideoDockSlot.follow.test.jsx` (new)

**Interfaces:**
- Consumes: `activeTicker`/`tickerMoments` (existing), `anchorDate` (Task 5's hook call), ChartPane (`density="compact"`, `stored={null}`, definite height).
- Produces: a collapsible "Chart follows discussion" section in the theater rail ABOVE "Tickers covered". OFF by default, persisted `uct.desk.followChart`. ChartPane mounts ONLY while open.

- [ ] **Step 1: Write the failing tests**

`VideoDockSlot.follow.test.jsx` (same scaffolding + ChartPane mock as Task 5's test):

```jsx
it('closed by default: no ChartPane mount, toggle visible when moments exist', ...)
it('open: pane mounts with the FIRST moment ticker before playback crosses any', ...)
   // paneProps sym === 'NVDA'; stockChartProps.anchorDate === '2026-02-11';
   // density === 'compact'; stored === null; no onStore prop.
it('symbol follows the playhead', ...)
   // Drive the same mechanism the activeTicker test in VideoDockSlot.test.jsx
   // drives (playhead time updates via the videoStore/subscribe path — reuse its
   // idiom EXACTLY). Cross t=90 → lastPane().sym === 'AMD'.
it('toggle persists (uct.desk.followChart) and unmounts the pane when closed', ...)
it('no ticker moments → section absent entirely', ...)
```

- [ ] **Step 2: Run to verify failure** — `cd app && npx vitest run src/components/video/VideoDockSlot.follow.test.jsx` → FAIL.

- [ ] **Step 3: Implement**

3a. Lazy ChartPane + state (top of file):

```jsx
import { lazy, Suspense } from 'react'   // merge into the existing react import
const ChartPane = lazy(() => import('../chart/pane/ChartPane'))
```

```jsx
  // Follow-along chart: auto-switches to the ticker under discussion. OFF by
  // default — ChartPane is a heavy lazy chunk; it must not load for viewers who
  // never opt in.
  const [followOpen, setFollowOpen] = useState(() => {
    try { return window.localStorage.getItem('uct.desk.followChart') === '1' } catch { return false }
  })
  const toggleFollow = useCallback(() => {
    setFollowOpen((o) => {
      const next = !o
      try { window.localStorage.setItem('uct.desk.followChart', next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }, [])
  const [followTf, setFollowTf] = useState('D')
  const followSym = (activeMoment || tickerMoments[0])?.ticker || null
```

3b. Render, in the right rail DIRECTLY ABOVE the `tickerMoments.length > 0 && (… tickersWrap …)` block:

```jsx
          {tickerMoments.length > 0 && (
            <div className={styles.followWrap}>
              <button
                type="button"
                className={styles.followToggle}
                onClick={toggleFollow}
                aria-expanded={followOpen}
                title="A chart that automatically switches to the ticker being discussed"
              >
                <UIcon name="chart" size={13} />
                <span className={styles.insHead}>Chart follows discussion</span>
                <span className={styles.followState}>{followOpen ? 'On' : 'Off'}</span>
              </button>
              {followOpen && followSym && (
                <div className={styles.followPane}>
                  <Suspense fallback={<div className={styles.followLoading}>Loading chart…</div>}>
                    <ChartPane
                      sym={followSym}
                      tf={followTf}
                      onTfChange={setFollowTf}
                      stored={null}
                      density="compact"
                      stockChartProps={{
                        height: 260,
                        ...(anchorDate ? { anchorDate } : {}),
                      }}
                    />
                  </Suspense>
                </div>
              )}
            </div>
          )}
```

NOTE on `UIcon name="chart"`: check `app/src/components/ui/UIcon` for the actual chart icon name (house rule: UIcon, never a raw emoji in UI chrome). If none fits, omit the icon — do not add an emoji.

3c. CSS:

```css
.followWrap { margin-bottom: 10px; }
.followToggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 2px 0;
  color: inherit;
}
.followState { font-size: 10px; color: var(--desk-muted, #9aa1ad); }
.followPane { height: 280px; margin-top: 6px; }   /* definite height — ChartPane requires one */
.followLoading { font-size: 12px; color: var(--desk-muted, #9aa1ad); padding: 12px 0; }
```

(Same custom-property caveat as Task 5 — mirror the module's real tokens.)

- [ ] **Step 4: Run** — `cd app && npx vitest run src/components/video` → ALL video suites green (106 baseline + new).

- [ ] **Step 5: Commit**

```bash
git add app/src/components/video/VideoDockSlot.jsx app/src/components/video/VideoDockSlot.module.css app/src/components/video/VideoDockSlot.follow.test.jsx
git commit -m "feat(desk): follow-along chart pane — auto-switches with the discussion

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" -- app/src/components/video/VideoDockSlot.jsx app/src/components/video/VideoDockSlot.module.css app/src/components/video/VideoDockSlot.follow.test.jsx
```

---

### Task 7: Verification sweep + build + branch push

**Files:** none new.

- [ ] **Step 1: Frontend sweep** — `cd app && npx vitest run src/components/video src/components/chart src/hooks/useTickerReturns.test.js src/components/StockChart.anchor.test.jsx src/components/TickerPopup.anchor.test.jsx src/components/StockChart.smoke.test.jsx` plus the ChartPane suite `src/components/chart/pane`. Expected: green. If the box is loaded, re-run flaky sets with `--maxWorkers=4` before believing a failure.
- [ ] **Step 2: Backend sweep** — `python -m pytest tests/test_ticker_returns.py tests/test_education_taxonomy.py tests/test_desk_session_insights.py -q` → green.
- [ ] **Step 3: Production build** — `cd app && npx vite build` → completes; note the ChartPane chunk still emits as a shared lazy chunk and the ENTRY chunk size is unchanged vs master (±0.1 kB). A grown entry chunk means the lazy boundary broke (a static ChartPane import leaked into VideoDockSlot's eager path).
- [ ] **Step 4: Test-file count check** — `cd app && npx vitest run src/components/video 2>&1 | tail -5` and confirm the FILE count includes ALL THREE new video test files (a broken import can hide a whole file behind a green run).
- [ ] **Step 5: Live browser pass** — start the sandboxed local backend (per memory: scratch `DATA_DIR`/`AUTH_DB_PATH`, throwaway admin signup, OS-env keys; vendor sockets are guarded off-Railway) + `cd app && npx vite dev`; open a Desk recording with insights, verify on screen: % tags render, sort reorders, chip click opens an ANCHORED chart (marker line + Back-to-today pill + scroll-right reveals), follow-along pane switches tickers as the video plays. OPEN THE ARTIFACT — screenshots for the owner.
- [ ] **Step 6: Push the branch (NOT master)** — `git push origin feat/desk-ticker-moments`.

---

## Self-review notes (already applied)

- Spec coverage: anchored+reveal → Tasks 2/3/5; scorecard → Tasks 1/4/5; follow-along → Task 6; graceful degradation → Task 1 (empty payload) + Task 4 (EMPTY) + Task 5 (`haveReturns` gate); "no client re-derivation of anchor_date" → Task 1 docstring + Task 4 comment; severed-wire rail → Task 5; intraday exact-bar positioning = stretch goal, NOT planned (day-anchoring covers every TF via `lastAnchorIdx`).
- Type consistency: `anchorDate` (camel, FE prop) vs `anchor_date` (snake, API field) is deliberate; `since_pct/d5_pct/d21_pct` used identically in Tasks 1/4/5; `lastAnchorIdx` named identically in Tasks 2's export and tests.
- Known risk called out to implementers: Task 2 step 3d/3e touch a dense effect — keep edits surgical, do NOT reorder existing branches; Task 3's reopen test may need the component's real close affordance (read the file first).
