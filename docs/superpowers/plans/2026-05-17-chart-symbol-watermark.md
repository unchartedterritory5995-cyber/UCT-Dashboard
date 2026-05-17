# Chart Symbol Watermark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a TC2000-style, faint, multi-line symbol watermark behind the candles that the user can freely drag anywhere, with one universal server-synced position and adjustable lines/color/opacity/size.

**Architecture:** A custom Lightweight Charts v5 pane primitive paints the stacked text on the chart canvas at the bottom z-order (behind series). A container-level pointer hook provides direct grab-drag + hover highlight without breaking the crosshair. Line content (ticker/company/sector/industry) comes from a new cached `/api/ticker-meta` endpoint. All styling + position live in the existing `chart_settings` blob via `usePreferences`.

**Tech Stack:** React + Vite, Lightweight Charts v5.1.0, SWR, FastAPI, yfinance, Finnhub, vitest, pytest.

**Spec:** `docs/superpowers/specs/2026-05-17-chart-symbol-watermark-design.md`

**Note on StockChart.jsx:** This file is co-edited by a partner via GitHub web UI. Anchor edits to the verbatim code shown here, not to line numbers (they drift). Rebase cleanly; do not touch unrelated changes.

---

### Task 1: Backend — `ticker_meta` service

**Files:**
- Create: `api/services/ticker_meta.py`
- Test: `tests/test_ticker_meta.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_ticker_meta.py
"""Tests for ticker_meta service."""
from unittest.mock import patch, MagicMock
from api.services import ticker_meta


def _yf_info(longName="Tesla Inc", sector="Consumer Cyclical", industry="Auto Manufacturers"):
    return {"longName": longName, "shortName": "Tesla", "sector": sector, "industry": industry}


def test_yfinance_happy_path():
    ticker_meta._mem.clear()
    with patch.object(ticker_meta, "_disk_get", return_value=None), \
         patch.object(ticker_meta, "_disk_put"), \
         patch("yfinance.Ticker") as YF:
        YF.return_value.info = _yf_info()
        out = ticker_meta.get_ticker_meta("TSLA")
    assert out == {"name": "Tesla Inc", "sector": "Consumer Cyclical", "industry": "Auto Manufacturers"}


def test_memory_cache_hit_skips_fetch():
    ticker_meta._mem.clear()
    ticker_meta._mem.set("tmeta_TSLA", {"name": "Cached", "sector": None, "industry": None}, ttl=999)
    with patch("yfinance.Ticker") as YF:
        out = ticker_meta.get_ticker_meta("TSLA")
    YF.assert_not_called()
    assert out["name"] == "Cached"


def test_finnhub_fallback_when_yfinance_fails():
    ticker_meta._mem.clear()
    with patch.object(ticker_meta, "_disk_get", return_value=None), \
         patch.object(ticker_meta, "_disk_put"), \
         patch("yfinance.Ticker", side_effect=Exception("yf down")), \
         patch.object(ticker_meta, "_fh_key", return_value="k"), \
         patch("api.services.ticker_meta.requests.get") as RG:
        RG.return_value.raise_for_status = lambda: None
        RG.return_value.json = lambda: {"name": "Rocket Lab USA", "finnhubIndustry": "Aerospace"}
        out = ticker_meta.get_ticker_meta("RKLB")
    assert out == {"name": "Rocket Lab USA", "sector": None, "industry": "Aerospace"}


def test_total_failure_returns_nulls_and_not_cached():
    ticker_meta._mem.clear()
    with patch.object(ticker_meta, "_disk_get", return_value=None), \
         patch.object(ticker_meta, "_disk_put") as DP, \
         patch("yfinance.Ticker", side_effect=Exception("x")), \
         patch.object(ticker_meta, "_fh_key", return_value=""):
        out = ticker_meta.get_ticker_meta("ZZZZ")
    assert out == {"name": None, "sector": None, "industry": None}
    DP.assert_not_called()
    assert ticker_meta._mem.get("tmeta_ZZZZ") is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:/Users/Patrick/uct-dashboard && python -m pytest tests/test_ticker_meta.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'api.services.ticker_meta'`

- [ ] **Step 3: Write minimal implementation**

```python
# api/services/ticker_meta.py
"""Per-ticker company metadata (name/sector/industry).

Source: yfinance .info (all three) with Finnhub profile2 fallback for
name/industry. In-memory TTLCache + disk-persisted JSON under /data,
24h TTL. Never raises — returns all-null on total failure (uncached)."""
import json
import logging
import os
import time

import requests

from api.services.cache import TTLCache

_logger = logging.getLogger(__name__)
_mem = TTLCache()
_TTL = 86400  # 24h
_CACHE_DIR = os.path.join(os.environ.get("DATA_DIR", "/data"), "ticker_meta_cache")
_FINNHUB_BASE = "https://finnhub.io/api/v1"


def _fh_key() -> str:
    return os.environ.get("FINNHUB_API_KEY", "")


def _disk_path(ticker: str) -> str:
    return os.path.join(_CACHE_DIR, f"{ticker}.json")


def _disk_get(ticker: str):
    try:
        p = _disk_path(ticker)
        if time.time() - os.path.getmtime(p) > _TTL:
            return None
        with open(p, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return None


def _disk_put(ticker: str, data: dict) -> None:
    try:
        os.makedirs(_CACHE_DIR, exist_ok=True)
        tmp = _disk_path(ticker) + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(data, fh)
        os.replace(tmp, _disk_path(ticker))
    except Exception as e:
        _logger.warning("ticker_meta disk write failed for %s: %s", ticker, e)


def _from_yfinance(ticker: str):
    import yfinance as yf
    info = yf.Ticker(ticker).info or {}
    name = info.get("longName") or info.get("shortName")
    return {
        "name": name or None,
        "sector": info.get("sector") or None,
        "industry": info.get("industry") or None,
    }


def _from_finnhub(ticker: str):
    key = _fh_key()
    if not key:
        return {"name": None, "sector": None, "industry": None}
    resp = requests.get(
        f"{_FINNHUB_BASE}/stock/profile2",
        params={"symbol": ticker, "token": key},
        timeout=15,
    )
    resp.raise_for_status()
    j = resp.json() or {}
    return {
        "name": (j.get("name") or None),
        "sector": None,  # Finnhub profile2 has no GICS sector
        "industry": (j.get("finnhubIndustry") or None),
    }


def get_ticker_meta(ticker: str) -> dict:
    ticker = (ticker or "").upper().strip()
    if not ticker:
        return {"name": None, "sector": None, "industry": None}

    key = f"tmeta_{ticker}"
    hit = _mem.get(key)
    if hit is not None:
        return hit

    disk = _disk_get(ticker)
    if disk is not None:
        _mem.set(key, disk, ttl=_TTL)
        return disk

    data = {"name": None, "sector": None, "industry": None}
    try:
        data = _from_yfinance(ticker)
    except Exception as e:
        _logger.info("ticker_meta yfinance failed for %s: %s — trying Finnhub", ticker, e)
        try:
            data = _from_finnhub(ticker)
        except Exception as e2:
            _logger.warning("ticker_meta Finnhub failed for %s: %s", ticker, e2)
            data = {"name": None, "sector": None, "industry": None}

    if any(data.values()):
        _mem.set(key, data, ttl=_TTL)
        _disk_put(ticker, data)
    return data
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd C:/Users/Patrick/uct-dashboard && python -m pytest tests/test_ticker_meta.py -v`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add api/services/ticker_meta.py tests/test_ticker_meta.py
git -c commit.gpgsign=false commit -m "feat: ticker_meta service (yfinance + Finnhub fallback, 24h disk cache)"
```

---

### Task 2: Backend — `/api/ticker-meta/{ticker}` router

**Files:**
- Create: `api/routers/ticker_meta.py`
- Modify: `api/main.py` (add import + `include_router`)
- Test: `tests/test_ticker_meta_router.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_ticker_meta_router.py
from unittest.mock import patch
from fastapi.testclient import TestClient
from api.main import app

client = TestClient(app)


def test_ticker_meta_endpoint_returns_payload():
    with patch("api.routers.ticker_meta.get_ticker_meta",
               return_value={"name": "Tesla Inc", "sector": "Consumer Cyclical", "industry": "Auto Manufacturers"}):
        r = client.get("/api/ticker-meta/tsla")
    assert r.status_code == 200
    assert r.json() == {"name": "Tesla Inc", "sector": "Consumer Cyclical", "industry": "Auto Manufacturers"}


def test_ticker_meta_endpoint_never_500s_on_service_error():
    with patch("api.routers.ticker_meta.get_ticker_meta", side_effect=Exception("boom")):
        r = client.get("/api/ticker-meta/ZZZZ")
    assert r.status_code == 200
    assert r.json() == {"name": None, "sector": None, "industry": None}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:/Users/Patrick/uct-dashboard && python -m pytest tests/test_ticker_meta_router.py -v`
Expected: FAIL — 404 (route not registered)

- [ ] **Step 3: Write minimal implementation**

Create `api/routers/ticker_meta.py`:

```python
from fastapi import APIRouter

from api.services.ticker_meta import get_ticker_meta

router = APIRouter()


@router.get("/api/ticker-meta/{ticker}")
def ticker_meta(ticker: str):
    try:
        return get_ticker_meta(ticker)
    except Exception:
        return {"name": None, "sector": None, "industry": None}
```

In `api/main.py`, find the existing router import line:

```python
from api.routers import live_prices as live_prices_router
```

Add immediately after it:

```python
from api.routers import ticker_meta as ticker_meta_router
```

Then find the existing registration line:

```python
app.include_router(live_prices_router.router)
```

Add immediately after it:

```python
app.include_router(ticker_meta_router.router)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd C:/Users/Patrick/uct-dashboard && python -m pytest tests/test_ticker_meta_router.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add api/routers/ticker_meta.py api/main.py tests/test_ticker_meta_router.py
git -c commit.gpgsign=false commit -m "feat: GET /api/ticker-meta/{ticker} endpoint"
```

---

### Task 3: Frontend — extend watermark schema in `chartDefaults.js`

**Files:**
- Modify: `app/src/components/chart/chartDefaults.js` (the `watermark:` default + the `mergeChartSettings` watermark line)
- Test: `app/src/components/chart/chartDefaults.test.js`

- [ ] **Step 1: Write the failing test**

```js
// app/src/components/chart/chartDefaults.test.js
import { describe, it, expect } from 'vitest'
import { mergeChartSettings, CHART_DEFAULTS } from './chartDefaults'

describe('watermark settings', () => {
  it('default watermark has lines/color/sizeScale/x/y', () => {
    expect(CHART_DEFAULTS.watermark).toEqual({
      visible: true, opacity: 0.07, color: '#a8a290', sizeScale: 1.0,
      lines: { ticker: true, company: true, sector: true, industry: false },
      x: 0.5, y: 0.5,
    })
  })

  it('merges partial user watermark over defaults (back-compat with {visible,opacity}-only)', () => {
    const cs = mergeChartSettings(JSON.stringify({ watermark: { visible: false, opacity: 0.12 } }))
    expect(cs.watermark.visible).toBe(false)
    expect(cs.watermark.opacity).toBe(0.12)
    expect(cs.watermark.color).toBe('#a8a290')
    expect(cs.watermark.lines).toEqual({ ticker: true, company: true, sector: true, industry: false })
    expect(cs.watermark.x).toBe(0.5)
  })

  it('deep-merges partial lines (user disables only ticker)', () => {
    const cs = mergeChartSettings(JSON.stringify({ watermark: { lines: { ticker: false } } }))
    expect(cs.watermark.lines).toEqual({ ticker: false, company: true, sector: true, industry: false })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:/Users/Patrick/uct-dashboard/app && npx vitest run src/components/chart/chartDefaults.test.js`
Expected: FAIL — default watermark lacks new keys

- [ ] **Step 3: Write minimal implementation**

In `app/src/components/chart/chartDefaults.js`, replace the line:

```js
  watermark: { visible: true, opacity: 0.07 },
```

with:

```js
  watermark: {
    visible: true,
    opacity: 0.07,
    color: '#a8a290',
    sizeScale: 1.0,
    lines: { ticker: true, company: true, sector: true, industry: false },
    x: 0.5,
    y: 0.5,
  },
```

Then in `mergeChartSettings`, replace the line:

```js
    watermark: { ...CHART_DEFAULTS.watermark, ...(parsed.watermark || {}) },
```

with:

```js
    watermark: {
      ...CHART_DEFAULTS.watermark,
      ...(parsed.watermark || {}),
      lines: { ...CHART_DEFAULTS.watermark.lines, ...((parsed.watermark || {}).lines || {}) },
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd C:/Users/Patrick/uct-dashboard/app && npx vitest run src/components/chart/chartDefaults.test.js`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add app/src/components/chart/chartDefaults.js app/src/components/chart/chartDefaults.test.js
git -c commit.gpgsign=false commit -m "feat: extend watermark chart-settings schema (lines/color/size/position)"
```

---

### Task 4: Frontend — `useTickerMeta` hook

**Files:**
- Create: `app/src/hooks/useTickerMeta.js`
- Test: `app/src/hooks/useTickerMeta.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// app/src/hooks/useTickerMeta.test.jsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import useTickerMeta from './useTickerMeta'

const wrapper = ({ children }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
)

describe('useTickerMeta', () => {
  let origFetch
  beforeEach(() => { origFetch = global.fetch })
  afterEach(() => { global.fetch = origFetch; vi.restoreAllMocks() })

  it('returns null-safe defaults before/without data', () => {
    global.fetch = vi.fn(() => new Promise(() => {}))
    const { result } = renderHook(() => useTickerMeta('TSLA'), { wrapper })
    expect(result.current).toEqual({ name: null, sector: null, industry: null })
  })

  it('returns fetched meta', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ name: 'Tesla Inc', sector: 'Consumer Cyclical', industry: 'Auto Manufacturers' }),
    })
    const { result } = renderHook(() => useTickerMeta('TSLA'), { wrapper })
    await waitFor(() => expect(result.current.name).toBe('Tesla Inc'))
    expect(global.fetch).toHaveBeenCalledWith('/api/ticker-meta/TSLA', expect.objectContaining({ credentials: 'include' }))
  })

  it('null-safe when fetch fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false })
    const { result } = renderHook(() => useTickerMeta('TSLA'), { wrapper })
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(result.current).toEqual({ name: null, sector: null, industry: null })
  })

  it('does not fetch when sym is falsy', () => {
    global.fetch = vi.fn()
    renderHook(() => useTickerMeta(null), { wrapper })
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:/Users/Patrick/uct-dashboard/app && npx vitest run src/hooks/useTickerMeta.test.jsx`
Expected: FAIL — cannot resolve `./useTickerMeta`

- [ ] **Step 3: Write minimal implementation**

```js
// app/src/hooks/useTickerMeta.js
import useSWR from 'swr'

const NULLS = { name: null, sector: null, industry: null }

async function fetcher(url) {
  const r = await fetch(url, { credentials: 'include' })
  if (!r.ok) return NULLS
  try {
    const j = await r.json()
    return { name: j?.name ?? null, sector: j?.sector ?? null, industry: j?.industry ?? null }
  } catch {
    return NULLS
  }
}

// Per-symbol company metadata for the chart watermark. Never throws.
export default function useTickerMeta(sym) {
  const { data } = useSWR(
    sym ? `/api/ticker-meta/${sym}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 3600000 },
  )
  return data || NULLS
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd C:/Users/Patrick/uct-dashboard/app && npx vitest run src/hooks/useTickerMeta.test.jsx`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add app/src/hooks/useTickerMeta.js app/src/hooks/useTickerMeta.test.jsx
git -c commit.gpgsign=false commit -m "feat: useTickerMeta SWR hook"
```

---

### Task 5: Frontend — watermark primitive + pure helpers

**Files:**
- Create: `app/src/components/chart/watermarkPrimitive.js`
- Test: `app/src/components/chart/watermarkPrimitive.test.js`

The pure helpers (`composeWatermarkLines`, `watermarkFontPx`, `computeWatermarkRect`) are unit-tested. The canvas `draw()` is covered by build + manual smoke (Task 7) — Lightweight Charts canvas rendering is not unit-testable in jsdom and the codebase has no precedent for it.

- [ ] **Step 1: Write the failing test**

```js
// app/src/components/chart/watermarkPrimitive.test.js
import { describe, it, expect } from 'vitest'
import { composeWatermarkLines, watermarkFontPx, computeWatermarkRect } from './watermarkPrimitive'

describe('composeWatermarkLines', () => {
  const meta = { name: 'Tesla Inc', sector: 'Consumer Cyclical', industry: 'Auto Manufacturers' }
  it('all lines on → 4 lines in order', () => {
    expect(composeWatermarkLines('TSLA', meta, { ticker: true, company: true, sector: true, industry: true }))
      .toEqual(['TSLA', 'Tesla Inc', 'Consumer Cyclical', 'Auto Manufacturers'])
  })
  it('skips disabled and null lines', () => {
    expect(composeWatermarkLines('TSLA', { name: null, sector: 'X', industry: null },
      { ticker: true, company: true, sector: true, industry: true }))
      .toEqual(['TSLA', 'X'])
  })
  it('ticker always available even with null meta', () => {
    expect(composeWatermarkLines('TSLA', { name: null, sector: null, industry: null },
      { ticker: true, company: true, sector: true, industry: true })).toEqual(['TSLA'])
  })
  it('all toggles off → empty', () => {
    expect(composeWatermarkLines('TSLA', meta, { ticker: false, company: false, sector: false, industry: false }))
      .toEqual([])
  })
})

describe('watermarkFontPx', () => {
  it('line 0 largest, decreasing, scaled by sizeScale', () => {
    expect(watermarkFontPx(0, 1)).toBe(54)
    expect(watermarkFontPx(1, 1)).toBe(20)
    expect(watermarkFontPx(0, 2)).toBe(108)
    expect(watermarkFontPx(3, 1)).toBe(13)
  })
})

describe('computeWatermarkRect', () => {
  it('centers block on normalized pos, clamps inside bounds', () => {
    const r = computeWatermarkRect({ x: 0.5, y: 0.5 }, { width: 1000, height: 400 }, { w: 200, h: 120 })
    expect(r).toEqual({ x: 400, y: 170, w: 200, h: 120 })
  })
  it('clamps so block never leaves the pane', () => {
    const r = computeWatermarkRect({ x: 0, y: 0 }, { width: 1000, height: 400 }, { w: 200, h: 120 })
    expect(r.x).toBe(0)
    expect(r.y).toBe(0)
    const r2 = computeWatermarkRect({ x: 1, y: 1 }, { width: 1000, height: 400 }, { w: 200, h: 120 })
    expect(r2.x).toBe(800)
    expect(r2.y).toBe(280)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:/Users/Patrick/uct-dashboard/app && npx vitest run src/components/chart/watermarkPrimitive.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```js
// app/src/components/chart/watermarkPrimitive.js
// Custom Lightweight Charts v5 pane primitive: draws a faint TC2000-style
// stacked symbol watermark BEHIND the series (bottom z-order). Position is a
// normalized {x,y} fraction of the pane; styling/lines come from chart settings.

const FONT_RAMP = [54, 20, 14, 13]   // px @ sizeScale 1.0, per line index
const LINE_GAP = 6                   // px between lines @ scale 1.0
const FONT_FAMILY = "'Instrument Sans', sans-serif"

export function composeWatermarkLines(sym, meta, lines) {
  const out = []
  if (lines.ticker && sym) out.push(String(sym))
  if (lines.company && meta?.name) out.push(meta.name)
  if (lines.sector && meta?.sector) out.push(meta.sector)
  if (lines.industry && meta?.industry) out.push(meta.industry)
  return out
}

export function watermarkFontPx(lineIndex, sizeScale) {
  const base = FONT_RAMP[Math.min(lineIndex, FONT_RAMP.length - 1)]
  return Math.round(base * (sizeScale || 1))
}

export function computeWatermarkRect(pos, mediaSize, block) {
  const cx = pos.x * mediaSize.width
  const cy = pos.y * mediaSize.height
  let x = cx - block.w / 2
  let y = cy - block.h / 2
  x = Math.max(0, Math.min(x, mediaSize.width - block.w))
  y = Math.max(0, Math.min(y, mediaSize.height - block.h))
  return { x, y, w: block.w, h: block.h }
}

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '#a8a290')
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [168, 162, 144]
}

// Factory → { primitive, setOptions, getRect }.
// opts: { lines:string[], color, opacity, sizeScale, x, y }
export function createWatermarkPrimitive(initial) {
  let opts = { lines: [], color: '#a8a290', opacity: 0.07, sizeScale: 1, x: 0.5, y: 0.5, ...initial }
  let lastRect = null            // {x,y,w,h} in pane media px from last draw
  let armed = false              // hover/drag highlight
  let requestUpdate = null

  function measureBlock(ctx) {
    let w = 0
    let h = 0
    opts.lines.forEach((text, i) => {
      const fp = watermarkFontPx(i, opts.sizeScale)
      ctx.font = `700 ${fp}px ${FONT_FAMILY}`
      w = Math.max(w, ctx.measureText(text).width)
      h += fp + (i > 0 ? LINE_GAP * (opts.sizeScale || 1) : 0)
    })
    return { w, h }
  }

  const paneView = {
    zOrder: () => 'bottom',
    renderer: () => ({
      draw: (target) => {
        if (!opts.lines.length || opts.opacity <= 0) { lastRect = null; return }
        target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
          const block = measureBlock(ctx)
          const rect = computeWatermarkRect({ x: opts.x, y: opts.y }, mediaSize, block)
          lastRect = rect
          const [r, g, b] = hexToRgb(opts.color)
          const alpha = armed ? Math.min(1, opts.opacity * 2.4) : opts.opacity
          ctx.save()
          ctx.textAlign = 'center'
          ctx.textBaseline = 'top'
          ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`
          let cy = rect.y
          opts.lines.forEach((text, i) => {
            const fp = watermarkFontPx(i, opts.sizeScale)
            if (i > 0) cy += LINE_GAP * (opts.sizeScale || 1)
            ctx.font = `700 ${fp}px ${FONT_FAMILY}`
            ctx.fillText(text, rect.x + rect.w / 2, cy)
            cy += fp
          })
          if (armed) {
            ctx.strokeStyle = 'rgba(201,168,76,0.9)'
            ctx.setLineDash([4, 3])
            ctx.lineWidth = 1
            ctx.strokeRect(rect.x - 8, rect.y - 6, rect.w + 16, rect.h + 12)
          }
          ctx.restore()
        })
      },
    }),
  }

  const primitive = {
    paneViews: () => [paneView],
    updateAllViews: () => {},
    attached: (param) => { requestUpdate = param.requestUpdate },
    detached: () => { requestUpdate = null },
  }

  function redraw() { if (requestUpdate) requestUpdate() }

  return {
    primitive,
    setOptions(patch) { opts = { ...opts, ...patch }; redraw() },
    setArmed(v) { if (armed !== v) { armed = v; redraw() } },
    getRect() { return lastRect },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd C:/Users/Patrick/uct-dashboard/app && npx vitest run src/components/chart/watermarkPrimitive.test.js`
Expected: PASS (9 passed)

- [ ] **Step 5: Commit**

```bash
git add app/src/components/chart/watermarkPrimitive.js app/src/components/chart/watermarkPrimitive.test.js
git -c commit.gpgsign=false commit -m "feat: watermark pane primitive + pure helpers"
```

---

### Task 6: Frontend — `useWatermarkDrag` hook

**Files:**
- Create: `app/src/hooks/useWatermarkDrag.js`
- Test: `app/src/hooks/useWatermarkDrag.test.jsx`

Behavior: attaches pointer listeners to a container element. On hover inside the watermark rect → arm (highlight). On pointerdown inside rect (cursor mode only) → drag; move updates the primitive's normalized position; pointerup persists once via `onCommit({x,y})`. A press-release that moves < 4px is a click → no commit, no arming change. Deferred entirely when `getActiveTool()` returns a non-cursor tool.

- [ ] **Step 1: Write the failing test**

```jsx
// app/src/hooks/useWatermarkDrag.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import useWatermarkDrag from './useWatermarkDrag'

function makeEl() {
  const el = document.createElement('div')
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 400, right: 1000, bottom: 400 })
  document.body.appendChild(el)
  el.setPointerCapture = vi.fn()
  el.releasePointerCapture = vi.fn()
  return el
}
function pe(type, x, y) {
  return new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, pointerId: 1 })
}

describe('useWatermarkDrag', () => {
  let el, ctrl, commit, tool
  beforeEach(() => {
    el = makeEl()
    ctrl = { getRect: () => ({ x: 400, y: 170, w: 200, h: 120 }), setArmed: vi.fn(), setOptions: vi.fn() }
    commit = vi.fn()
    tool = 'cursor'
  })
  const setup = () => renderHook(() => useWatermarkDrag({
    containerRef: { current: el }, controllerRef: { current: ctrl },
    getActiveTool: () => tool, onCommit: commit, mediaSize: { width: 1000, height: 400 },
  }))

  it('arms on hover inside rect, disarms outside', () => {
    setup()
    el.dispatchEvent(pe('pointermove', 500, 230))
    expect(ctrl.setArmed).toHaveBeenLastCalledWith(true)
    el.dispatchEvent(pe('pointermove', 10, 10))
    expect(ctrl.setArmed).toHaveBeenLastCalledWith(false)
  })

  it('drag inside rect updates position and commits once on up', () => {
    setup()
    el.dispatchEvent(pe('pointerdown', 500, 230))
    el.dispatchEvent(pe('pointermove', 600, 270))
    el.dispatchEvent(pe('pointerup', 600, 270))
    expect(ctrl.setOptions).toHaveBeenCalled()
    expect(commit).toHaveBeenCalledTimes(1)
    const arg = commit.mock.calls[0][0]
    expect(arg.x).toBeCloseTo(0.6, 1)
    expect(arg.y).toBeCloseTo(0.675, 2)
  })

  it('sub-threshold press = click, no commit', () => {
    setup()
    el.dispatchEvent(pe('pointerdown', 500, 230))
    el.dispatchEvent(pe('pointerup', 502, 231))
    expect(commit).not.toHaveBeenCalled()
  })

  it('defers when a drawing tool is active', () => {
    tool = 'trendline'
    setup()
    el.dispatchEvent(pe('pointerdown', 500, 230))
    el.dispatchEvent(pe('pointermove', 600, 270))
    el.dispatchEvent(pe('pointerup', 600, 270))
    expect(commit).not.toHaveBeenCalled()
    expect(ctrl.setArmed).not.toHaveBeenCalledWith(true)
  })

  it('press outside rect does nothing', () => {
    setup()
    el.dispatchEvent(pe('pointerdown', 10, 10))
    el.dispatchEvent(pe('pointermove', 20, 20))
    el.dispatchEvent(pe('pointerup', 20, 20))
    expect(commit).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:/Users/Patrick/uct-dashboard/app && npx vitest run src/hooks/useWatermarkDrag.test.jsx`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```js
// app/src/hooks/useWatermarkDrag.js
import { useEffect, useRef } from 'react'

const THRESHOLD = 4 // px before a press becomes a drag

// Direct grab-drag + hover-arm for the watermark primitive. Pointer-events
// stay on the chart canvas (crosshair unaffected); we only intercept a press
// that starts inside the watermark rect while in cursor mode.
export default function useWatermarkDrag({ containerRef, controllerRef, getActiveTool, onCommit, mediaSize }) {
  const drag = useRef(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return undefined

    const toolActive = () => {
      const t = getActiveTool && getActiveTool()
      return t && t !== 'cursor'
    }
    const local = (e) => {
      const r = el.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    const inRect = (p) => {
      const c = controllerRef.current
      const rect = c && c.getRect && c.getRect()
      return rect && p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h
    }

    const onMove = (e) => {
      const c = controllerRef.current
      if (!c) return
      if (drag.current) {
        const p = local(e)
        if (!drag.current.moved) {
          if (Math.abs(p.x - drag.current.sx) + Math.abs(p.y - drag.current.sy) < THRESHOLD) return
          drag.current.moved = true
        }
        const ms = mediaSize || { width: el.clientWidth, height: el.clientHeight }
        const nx = Math.max(0, Math.min(1, p.x / ms.width))
        const ny = Math.max(0, Math.min(1, p.y / ms.height))
        drag.current.nx = nx
        drag.current.ny = ny
        c.setOptions({ x: nx, y: ny })
        e.preventDefault()
        return
      }
      if (toolActive()) { c.setArmed(false); return }
      c.setArmed(inRect(local(e)))
    }

    const onDown = (e) => {
      if (toolActive()) return
      const p = local(e)
      if (!inRect(p)) return
      drag.current = { sx: p.x, sy: p.y, moved: false, nx: null, ny: null }
      try { el.setPointerCapture(e.pointerId) } catch { /* ignore */ }
    }

    const onUp = (e) => {
      const c = controllerRef.current
      const d = drag.current
      drag.current = null
      try { el.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
      if (d && d.moved && d.nx != null && c) onCommit({ x: d.nx, y: d.ny })
    }

    el.addEventListener('pointermove', onMove, true)
    el.addEventListener('pointerdown', onDown, true)
    el.addEventListener('pointerup', onUp, true)
    return () => {
      el.removeEventListener('pointermove', onMove, true)
      el.removeEventListener('pointerdown', onDown, true)
      el.removeEventListener('pointerup', onUp, true)
    }
  }, [containerRef, controllerRef, getActiveTool, onCommit, mediaSize])
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd C:/Users/Patrick/uct-dashboard/app && npx vitest run src/hooks/useWatermarkDrag.test.jsx`
Expected: PASS (5 passed)

- [ ] **Step 5: Commit**

```bash
git add app/src/hooks/useWatermarkDrag.js app/src/hooks/useWatermarkDrag.test.jsx
git -c commit.gpgsign=false commit -m "feat: useWatermarkDrag hook (grab-drag + hover-arm, crosshair-safe)"
```

---

### Task 7: Frontend — integrate watermark into `StockChart.jsx`

**Files:**
- Modify: `app/src/components/StockChart.jsx`

No unit test (Lightweight Charts is not unit-tested in this codebase). Verified via build + manual smoke checklist in Task 10.

- [ ] **Step 1: Add imports**

Find the existing import:

```js
import { mergeChartSettings } from './chart/chartDefaults'
```

Add immediately after it:

```js
import { createWatermarkPrimitive, composeWatermarkLines } from './chart/watermarkPrimitive'
import useTickerMeta from '../hooks/useTickerMeta'
import useWatermarkDrag from '../hooks/useWatermarkDrag'
```

- [ ] **Step 2: Remove the dead v4 watermark block**

Find and delete this exact block (it is the `watermark:` key inside the `chartOpts` object literal):

```js
      watermark: cs.watermark.visible && (watermark || sym) ? {
        visible: true,
        text: watermark ?? sym,
        color: `rgba(168,162,144,${cs.watermark.opacity})`,
        fontSize: 48,
        fontFamily: "'Instrument Sans', sans-serif",
        fontWeight: '700',
      } : { visible: false },
```

(Leave the surrounding `timeScale` block and the closing `}` of `chartOpts` intact.)

- [ ] **Step 3: Add the watermark controller ref + ticker meta**

Find the line where the container ref is declared:

```js
  const containerRef = useRef(null)
```

Add immediately after it:

```js
  const wmCtrlRef = useRef(null)        // watermark primitive controller
  const wmAttachedRef = useRef(false)   // guard: primitive attached once
  const tickerMeta = useTickerMeta(sym)
```

- [ ] **Step 4: Attach the primitive and sync it (after chart create/reuse)**

Find this exact block:

```js
    if (!chart) {
      chart = createChart(containerRef.current, { ...chartOpts, autoSize: true })
      chartRef.current = chart
    } else {
      chart.applyOptions(chartOpts)
    }
```

Add immediately after it:

```js
    // ── Symbol watermark (custom v5 pane primitive, behind series) ──
    if (!wmCtrlRef.current) {
      wmCtrlRef.current = createWatermarkPrimitive({ x: cs.watermark.x, y: cs.watermark.y })
    }
    if (!wmAttachedRef.current) {
      try {
        chart.panes()[0].attachPrimitive(wmCtrlRef.current.primitive)
        wmAttachedRef.current = true
      } catch { /* older pane API — primitive optional */ }
    }
    {
      const wmLines = cs.watermark.visible
        ? composeWatermarkLines(watermark ?? sym, tickerMeta, cs.watermark.lines)
        : []
      wmCtrlRef.current.setOptions({
        lines: wmLines,
        color: cs.watermark.color,
        opacity: cs.watermark.opacity,
        sizeScale: cs.watermark.sizeScale,
        x: cs.watermark.x,
        y: cs.watermark.y,
      })
    }
```

- [ ] **Step 5: Add `tickerMeta` to the updateChart dependency array**

Find the `updateChart` callback's dependency array (the `useCallback`/`useMemo` deps list ending the chart-build function — it contains `sym, showVolume, ... watermark, cs, ...`). Add `tickerMeta` to that array so the watermark refreshes when company metadata arrives. Example — if the array is:

```js
  }, [filteredBars, ohlcData, closeData, volData, overlayData, indicatorData, comparisonData, sym, showVolume, mergedMarkers, mergedPriceLines, watermark, cs, adjustTime, resolvedTf])
```

change it to add `tickerMeta`:

```js
  }, [filteredBars, ohlcData, closeData, volData, overlayData, indicatorData, comparisonData, sym, showVolume, mergedMarkers, mergedPriceLines, watermark, cs, adjustTime, resolvedTf, tickerMeta])
```

- [ ] **Step 6: Wire the drag hook**

Find the existing `activeTool` state declaration:

```js
  const [activeTool, setActiveTool] = useState(null)
```

After it, add a ref mirror so the drag hook reads the latest tool without re-binding listeners:

```js
  const activeToolRef = useRef(activeTool)
  activeToolRef.current = activeTool
```

Then, anywhere among the other hook calls in the component body (e.g. directly after the `useTickerMeta(sym)` line is fine), add:

```js
  useWatermarkDrag({
    containerRef,
    controllerRef: wmCtrlRef,
    getActiveTool: () => activeToolRef.current,
    onCommit: ({ x, y }) => {
      const next = mergeChartSettings(prefs.chart_settings)
      next.watermark = { ...next.watermark, x, y }
      next.preset = 'custom'
      setPref('chart_settings', JSON.stringify(next))
    },
  })
```

(Confirm `prefs` and `setPref` are already in scope from the existing `usePreferences()` call near the `cs` memo — they are; reuse them.)

- [ ] **Step 7: Build to verify integration compiles**

Run: `cd C:/Users/Patrick/uct-dashboard/app && npm run build`
Expected: `✓ built in …s` with a `StockChart-*.js` chunk and no errors.

- [ ] **Step 8: Commit**

```bash
git add app/src/components/StockChart.jsx
git -c commit.gpgsign=false commit -m "feat: render draggable symbol watermark in StockChart (remove dead v4 block)"
```

---

### Task 8: Frontend — Watermark controls in chart toolbar panel

**Files:**
- Modify: `app/src/components/chart/ChartToolbar.jsx` (the `update` callback + the watermark UI)

- [ ] **Step 1: Extend the `update` callback to support `watermark.lines.<key>`**

Find this exact block in `ChartSettingsPanel`:

```js
  const update = useCallback((path, value) => {
    const next = { ...cs }
    if (path.includes('.')) {
      const [section, key] = path.split('.')
      next[section] = { ...next[section], [key]: value }
    } else {
      next[path] = value
    }
    next.preset = 'custom'
    onUpdateSettings(next)
  }, [cs, onUpdateSettings])
```

Replace it with:

```js
  const update = useCallback((path, value) => {
    const next = { ...cs }
    const parts = path.split('.')
    if (parts.length === 3) {
      const [section, sub, key] = parts
      next[section] = { ...next[section], [sub]: { ...next[section][sub], [key]: value } }
    } else if (parts.length === 2) {
      const [section, key] = parts
      next[section] = { ...next[section], [key]: value }
    } else {
      next[path] = value
    }
    next.preset = 'custom'
    onUpdateSettings(next)
  }, [cs, onUpdateSettings])
```

- [ ] **Step 2: Replace the inline "Watermark" checkbox with a full Watermark group**

Find this exact block:

```js
          <label className={styles.sCheck}>
            <input type="checkbox" checked={cs.watermark.visible} onChange={e => update('watermark.visible', e.target.checked)} />
            Watermark
          </label>
```

Replace it with:

```js
          <label className={styles.sCheck}>
            <input type="checkbox" checked={cs.watermark.visible} onChange={e => update('watermark.visible', e.target.checked)} />
            Watermark
          </label>
        </div>
      </div>

      {/* ── Watermark ── */}
      <div className={styles.sGroup}>
        <span className={styles.sLabel}>Watermark</span>
        <div className={styles.sRow}>
          <label className={styles.sCheck}>
            <input type="checkbox" checked={cs.watermark.lines.ticker} onChange={e => update('watermark.lines.ticker', e.target.checked)} />
            Ticker
          </label>
          <label className={styles.sCheck}>
            <input type="checkbox" checked={cs.watermark.lines.company} onChange={e => update('watermark.lines.company', e.target.checked)} />
            Company
          </label>
        </div>
        <div className={styles.sRow}>
          <label className={styles.sCheck}>
            <input type="checkbox" checked={cs.watermark.lines.sector} onChange={e => update('watermark.lines.sector', e.target.checked)} />
            Sector
          </label>
          <label className={styles.sCheck}>
            <input type="checkbox" checked={cs.watermark.lines.industry} onChange={e => update('watermark.lines.industry', e.target.checked)} />
            Industry
          </label>
        </div>
        <div className={styles.sRow} style={{ marginTop: 6 }}>
          <ColorPicker label="Color" value={cs.watermark.color} onChange={v => update('watermark.color', v)} />
        </div>
        <div className={styles.sRow} style={{ marginTop: 6, alignItems: 'center' }}>
          <span>Opacity</span>
          <input type="range" min={0} max={0.3} step={0.01} value={cs.watermark.opacity}
            onChange={e => update('watermark.opacity', parseFloat(e.target.value))} />
          <span>{Math.round(cs.watermark.opacity * 100)}%</span>
        </div>
        <div className={styles.sRow} style={{ marginTop: 6, alignItems: 'center' }}>
          <span>Size</span>
          <input type="range" min={0.5} max={2} step={0.1} value={cs.watermark.sizeScale}
            onChange={e => update('watermark.sizeScale', parseFloat(e.target.value))} />
          <span>{cs.watermark.sizeScale.toFixed(1)}×</span>
        </div>
        <div className={styles.sRow} style={{ marginTop: 6 }}>
          <button type="button" className={styles.sMiniSelect}
            onClick={() => { update('watermark.x', 0.5); update('watermark.y', 0.5) }}>
            Reset to center
          </button>
```

(Note: this preserves the original closing tags — the original `</div></div>` that followed the checkbox is now emitted at the end of the new group. Verify after editing that the JSX is balanced by building in Step 4. `ColorPicker` is already imported in this file.)

- [ ] **Step 3: Verify `ColorPicker` import exists**

Run: `cd C:/Users/Patrick/uct-dashboard && grep -n "import ColorPicker" app/src/components/chart/ChartToolbar.jsx`
Expected: a line importing `ColorPicker`. If absent, add `import ColorPicker from './ColorPicker'` near the other imports.

- [ ] **Step 4: Build to verify JSX balance**

Run: `cd C:/Users/Patrick/uct-dashboard/app && npm run build`
Expected: `✓ built` with no JSX/syntax errors.

- [ ] **Step 5: Commit**

```bash
git add app/src/components/chart/ChartToolbar.jsx
git -c commit.gpgsign=false commit -m "feat: full watermark controls in chart toolbar panel"
```

---

### Task 9: Frontend — Watermark controls in Settings → Chart Settings

**Files:**
- Modify: `app/src/pages/Settings.jsx` (the `ChartSettingsSection` `update` callback + the Watermark subsection)

- [ ] **Step 1: Extend the `update` callback for `watermark.lines.<key>`**

Find this exact block in `ChartSettingsSection`:

```js
  const update = useCallback((path, value) => {
    const next = { ...cs }
    if (path.includes('.')) {
      const [section, key] = path.split('.')
      if (section === 'overlays') {
        // overlays.0.color etc
        const [, idx, field] = path.split('.')
        next.overlays = next.overlays.map((o, i) =>
          i === parseInt(idx) ? { ...o, [field]: field === 'period' ? parseInt(value) || o.period : value } : o
        )
      } else {
        next[section] = { ...next[section], [key]: value }
      }
    } else {
      next[path] = value
    }
    next.preset = 'custom'
    setPref('chart_settings', JSON.stringify(next))
  }, [cs, setPref])
```

Replace it with:

```js
  const update = useCallback((path, value) => {
    const next = { ...cs }
    const parts = path.split('.')
    if (parts.length === 3 && parts[0] === 'overlays') {
      const [, idx, field] = parts
      next.overlays = next.overlays.map((o, i) =>
        i === parseInt(idx) ? { ...o, [field]: field === 'period' ? parseInt(value) || o.period : value } : o
      )
    } else if (parts.length === 3) {
      const [section, sub, key] = parts
      next[section] = { ...next[section], [sub]: { ...next[section][sub], [key]: value } }
    } else if (parts.length === 2) {
      const [section, key] = parts
      next[section] = { ...next[section], [key]: value }
    } else {
      next[path] = value
    }
    next.preset = 'custom'
    setPref('chart_settings', JSON.stringify(next))
  }, [cs, setPref])
```

- [ ] **Step 2: Replace the Watermark subsection with the expanded version**

Find this exact block:

```jsx
        {/* ── Watermark ── */}
        <div className={styles.chartSubsection}>
          <span className={styles.chartSubLabel}>Watermark</span>
          <div className={styles.chartRow}>
            <label className={styles.chartToggle}>
              <input type="checkbox" checked={cs.watermark.visible} onChange={e => update('watermark.visible', e.target.checked)} />
              <span>Show ticker watermark</span>
            </label>
          </div>
          <div className={styles.chartRow} style={{ marginTop: 8, alignItems: 'center' }}>
            <span className={styles.chartMiniLabel}>Opacity</span>
            <input
              type="range"
              className={styles.opacitySlider}
              min={0.02}
              max={0.2}
              step={0.01}
              value={cs.watermark.opacity}
              onChange={e => update('watermark.opacity', parseFloat(e.target.value))}
            />
            <span className={styles.chartMiniLabel}>{Math.round(cs.watermark.opacity * 100)}%</span>
          </div>
        </div>
```

Replace it with:

```jsx
        {/* ── Watermark ── */}
        <div className={styles.chartSubsection}>
          <span className={styles.chartSubLabel}>Watermark</span>
          <div className={styles.chartRow}>
            <label className={styles.chartToggle}>
              <input type="checkbox" checked={cs.watermark.visible} onChange={e => update('watermark.visible', e.target.checked)} />
              <span>Show symbol watermark</span>
            </label>
          </div>
          <div className={styles.chartRow} style={{ marginTop: 8, gap: 14, flexWrap: 'wrap' }}>
            <label className={styles.chartToggle}>
              <input type="checkbox" checked={cs.watermark.lines.ticker} onChange={e => update('watermark.lines.ticker', e.target.checked)} />
              <span>Ticker</span>
            </label>
            <label className={styles.chartToggle}>
              <input type="checkbox" checked={cs.watermark.lines.company} onChange={e => update('watermark.lines.company', e.target.checked)} />
              <span>Company</span>
            </label>
            <label className={styles.chartToggle}>
              <input type="checkbox" checked={cs.watermark.lines.sector} onChange={e => update('watermark.lines.sector', e.target.checked)} />
              <span>Sector</span>
            </label>
            <label className={styles.chartToggle}>
              <input type="checkbox" checked={cs.watermark.lines.industry} onChange={e => update('watermark.lines.industry', e.target.checked)} />
              <span>Industry</span>
            </label>
          </div>
          <div className={styles.chartRow} style={{ marginTop: 8 }}>
            <ColorPicker label="Color" value={cs.watermark.color} onChange={v => update('watermark.color', v)} />
          </div>
          <div className={styles.chartRow} style={{ marginTop: 8, alignItems: 'center' }}>
            <span className={styles.chartMiniLabel}>Opacity</span>
            <input
              type="range"
              className={styles.opacitySlider}
              min={0}
              max={0.3}
              step={0.01}
              value={cs.watermark.opacity}
              onChange={e => update('watermark.opacity', parseFloat(e.target.value))}
            />
            <span className={styles.chartMiniLabel}>{Math.round(cs.watermark.opacity * 100)}%</span>
          </div>
          <div className={styles.chartRow} style={{ marginTop: 8, alignItems: 'center' }}>
            <span className={styles.chartMiniLabel}>Size</span>
            <input
              type="range"
              className={styles.opacitySlider}
              min={0.5}
              max={2}
              step={0.1}
              value={cs.watermark.sizeScale}
              onChange={e => update('watermark.sizeScale', parseFloat(e.target.value))}
            />
            <span className={styles.chartMiniLabel}>{cs.watermark.sizeScale.toFixed(1)}×</span>
          </div>
          <div className={styles.chartRow} style={{ marginTop: 8 }}>
            <button
              type="button"
              className={styles.btn}
              onClick={() => { update('watermark.x', 0.5); update('watermark.y', 0.5) }}
            >
              Reset position to center
            </button>
          </div>
        </div>
```

- [ ] **Step 3: Verify `ColorPicker` import exists in Settings.jsx**

Run: `cd C:/Users/Patrick/uct-dashboard && grep -n "import ColorPicker" app/src/pages/Settings.jsx`
Expected: a line importing `ColorPicker` (it is already used by the candle-color controls). If absent, add `import ColorPicker from '../components/chart/ColorPicker'`.

- [ ] **Step 4: Build to verify**

Run: `cd C:/Users/Patrick/uct-dashboard/app && npm run build`
Expected: `✓ built` with no errors; `Settings-*.js` chunk emitted.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/Settings.jsx
git -c commit.gpgsign=false commit -m "feat: full watermark controls in Settings → Chart Settings"
```

---

### Task 10: Final verification + push

**Files:** none (verification only)

- [ ] **Step 1: Run the full backend test suite for the new modules**

Run: `cd C:/Users/Patrick/uct-dashboard && python -m pytest tests/test_ticker_meta.py tests/test_ticker_meta_router.py -v`
Expected: all PASS (6 tests)

- [ ] **Step 2: Run the full frontend test suite**

Run: `cd C:/Users/Patrick/uct-dashboard/app && npm run test`
Expected: all test files pass, including `chartDefaults`, `useTickerMeta`, `watermarkPrimitive`, `useWatermarkDrag`. No new failures vs. baseline.

- [ ] **Step 3: Production build**

Run: `cd C:/Users/Patrick/uct-dashboard/app && npm run build`
Expected: `✓ built in …s`, no errors.

- [ ] **Step 4: Manual smoke checklist** (run `npm run dev` + `uvicorn api.main:app --reload --port 8000`, open a chart)

  - Watermark renders behind candles, faint, centered, multi-line (TSLA / Tesla Inc / Consumer Cyclical) — industry off by default
  - Hover over it → it brightens + dashed gold box appears; move away → returns to faint
  - Press inside it and drag → it follows the cursor and stays where dropped
  - Switch symbol (TSLA → RKLB) → watermark is in the **same spot** with RKLB's text
  - Reload the page → watermark stays at the dragged position (server-synced)
  - Crosshair + OHLC legend still update when hovering over the watermark area (after release)
  - Resize the browser window → watermark stays proportionally placed, never off-screen
  - Toolbar gear + Settings → Chart Settings: toggle each line, change color, opacity, size, "Reset to center" — all reflect live
  - A drawing tool selected (e.g. trendline) → watermark does not arm/drag; drawing works normally
  - Unknown/odd ticker → only the ticker line shows, no console error

- [ ] **Step 5: Rebase and push**

```bash
cd C:/Users/Patrick/uct-dashboard
git pull --rebase origin master
git push origin master
```

Expected: clean rebase over any partner commits, push succeeds (Railway auto-deploys).

---

## Self-Review

**Spec coverage:**
- Rendering (custom v5 pane primitive, behind candles) → Task 5 + Task 7 ✓
- Content & data (configurable lines, /api/ticker-meta, yfinance+Finnhub) → Tasks 1, 2, 4, 5 ✓
- Positioning & drag (normalized universal pos, grab-drag, hover-arm, crosshair-safe, defer on tool) → Task 6 + Task 7 ✓
- Settings & persistence (schema extend, gear panel + Settings TileCard, server-synced) → Tasks 3, 8, 9 ✓
- Edge cases (all-off renders nothing, resize clamp, meta failure, sizeScale/opacity clamp, defer to drawing tools, back-compat) → Tasks 3/5/6 tests + Task 10 manual ✓
- Testing (frontend vitest + backend pytest enumerated) → Tasks 1–6 + Task 10 ✓
- Remove dead v4 watermark block → Task 7 Step 2 ✓

**Placeholder scan:** No TBD/TODO; every code step contains complete code; commands have expected output.

**Type/name consistency:** `createWatermarkPrimitive` → `{ primitive, setOptions, setArmed, getRect }` used consistently in Tasks 5/6/7. `composeWatermarkLines(sym, meta, lines)` signature consistent (Task 5 def, Task 7 use). `useTickerMeta(sym)` returns `{name,sector,industry}` consistent (Task 4 def, Task 7 use). `update(path,value)` 3-part handling consistent across Tasks 8 & 9. `onCommit({x,y})` consistent (Task 6 def, Task 7 use). chart-settings keys (`watermark.lines.{ticker,company,sector,industry}`, `watermark.{color,opacity,sizeScale,x,y}`) consistent across schema (Task 3) and UI (Tasks 8, 9) and render (Task 7).
