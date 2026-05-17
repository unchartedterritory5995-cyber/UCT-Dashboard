# Chart Symbol Watermark — Design Spec

**Date:** 2026-05-17
**Status:** Approved (design), pending implementation plan
**Surface:** `app/src/components/StockChart.jsx` (all chart surfaces — every chart in the app renders through this one component)

## Problem

The dashboard's charts show no symbol watermark. The code in `StockChart.jsx` configures one via `chartOpts.watermark = {...}`, but that is the **Lightweight Charts v4** API. The project runs **v5.1.0**, which removed `layout.watermark` and replaced it with primitive plugins (`createTextWatermark` / `createImageWatermark`). The existing block is silently ignored, and it is not wired into any settings UI.

Goal: a TC2000-style symbol watermark — a faint, multi-line stack of text painted **behind the candles** — that the user can freely drag anywhere and adjust (color, opacity, size, which lines show). One **universal** position shared by every symbol and synced across devices.

## Reference

TC2000 renders a centered, faint, decreasing-size stack behind the price bars:

```
TSLA            (huge)
Tesla Inc       (medium)
Consumer Cyclical   (small)
Auto Manufacturers  (smaller)
```

Visual + interaction states were validated with the user via a brainstorming mockup (centered default, hover/grab affordance, moved + fewer-lines, settings panel). Approved.

## Decisions (locked with user)

| Decision | Choice |
|---|---|
| Content | **User-configurable lines** — independent toggles for ticker / company name / sector / industry |
| Rendering | **Approach A** — custom Lightweight Charts v5 pane primitive, drawn behind series (true behind-candles depth) |
| Move UX | **Direct grab** — press inside the watermark anytime and drag; hover highlights it; a plain click passes through to the chart |
| Position scope | **Universal** — one position used by all symbols; stored in server-synced chart settings (not per-symbol localStorage) |
| Settings home | Existing chart settings system — toolbar gear panel + Settings → Chart Settings TileCard (they mirror) |

## Architecture

Seven units, all following existing codebase patterns. No new persistence infra, no new architectural risk.

### 1. `app/src/components/chart/watermarkPrimitive.js` (new)

A Lightweight Charts v5 **pane primitive** attached to the main price pane.

- Holds state: `lines: string[]`, `color: string`, `opacity: number`, `sizeScale: number`, `pos: {x, y}` (normalized 0–1 fraction of the pane).
- `paneViews()` returns a renderer that draws the stacked lines on the **bottom z-order** so series paint over it. Line font sizes follow a fixed ramp scaled by `sizeScale` (line 1 largest, lines 2–4 progressively smaller, matching TC2000).
- Anchor: text block centered on `(x·paneWidth, y·paneHeight)`; default `(0.5, 0.5)`.
- Exposes the current pixel draw-rect (`getRect()`) for the drag layer's hit-testing.
- `applyOptions(partial)` mutates state and requests a redraw. Attached once on chart create, updated via `applyOptions`, detached on unmount — consistent with the existing chart-instance-reuse pattern.

### 2. `app/src/hooks/useWatermarkDrag.js` (new)

A hook that binds pointer handlers to the chart container:

- `pointermove` with no button: if cursor is within `primitive.getRect()`, set **armed** state → primitive brightens (e.g. opacity ×~2.2), `cursor: move`, dashed gold bounding box drawn. Canvas still receives the move, so the crosshair keeps working.
- `pointerdown` inside the rect: `setPointerCapture`, begin drag, suppress chart pan/scroll for the gesture; live-update `primitive.pos` from cursor.
- `pointerup`: commit — write `chart_settings.watermark.{x,y}` via `usePreferences` (debounced ~400ms).
- Movement threshold (~4px): a press-release under threshold is treated as a click and passes through to the chart (no position change).
- Inactive when a drawing tool is selected (defers to drawing tools); active only in cursor mode. Main price pane only.

### 3. `app/src/hooks/useTickerMeta.js` (new)

SWR hook → `GET /api/ticker-meta/{sym}`. Returns `{name, sector, industry}` with null-safe defaults. Deduped/cached by SWR; never throws.

### 4. `api/services/ticker_meta.py` + `api/routers/ticker_meta.py` (new)

`GET /api/ticker-meta/{ticker}` → `{ "name": str|null, "sector": str|null, "industry": str|null }`.

- Primary source: yfinance `.info` (`longName`/`shortName`, `sector`, `industry`) — yfinance is already a dependency used in `massive.py:222` for leverage detection.
- Fallback for `name`/`industry`: Finnhub `stock/profile2` (`FINNHUB_API_KEY` already configured; Finnhub returns `name`, `finnhubIndustry`, no GICS sector).
- Cache: project TTLCache (in-memory) + disk-persisted JSON under the `/data` Railway volume (`ticker_meta_cache.json`), **24h TTL** (this data changes rarely). Disk cache survives redeploys, mirrors the bars-cache pattern.
- On total failure or unknown ticker: return all-null `{name:null, sector:null, industry:null}` quickly (never block the chart). Empty results not cached (retry next request).
- Router registered in `api/main.py` alongside existing routers.

### 5. `app/src/components/chart/chartDefaults.js` (modify)

Extend the `watermark` schema:

```
watermark: {
  visible: true,
  opacity: 0.07,
  color: '#a8a290',
  sizeScale: 1.0,
  lines: { ticker: true, company: true, sector: true, industry: false },
  x: 0.5,
  y: 0.5,
}
```

Update `mergeChartSettings()` to deep-merge the new `lines` sub-object and scalar fields over defaults (back-compat: old saved settings with only `{visible, opacity}` merge cleanly; missing keys fall to defaults).

### 6. Settings UI (modify) — `ChartToolbar.jsx` gear panel + `Settings.jsx` Chart Settings TileCard

Add a **Watermark** group (mirrored in both surfaces, same as other chart-settings groups):

- "Show watermark" toggle (`visible`)
- Four line toggles: Ticker / Company name / Sector / Industry (`lines.*`)
- Color — existing `ColorPicker` component (`app/src/components/chart/ColorPicker.jsx`)
- Opacity slider (0–0.30, default 0.07)
- Size scale slider (0.5–2.0, default 1.0)
- "Reset to center" button → sets `x=0.5, y=0.5`

### 7. `app/src/components/StockChart.jsx` (modify)

- Remove the dead v4 `chartOpts.watermark` block.
- Attach `watermarkPrimitive` to the main pane on chart create; detach on unmount.
- `useTickerMeta(sym)` → meta; compose `lines` = filter `[sym, meta.name, meta.sector, meta.industry]` by `cs.watermark.lines` toggles and non-null.
- On `lines` / `cs.watermark.*` change → `primitive.applyOptions(...)`.
- Wire `useWatermarkDrag` (container ref, primitive, `usePreferences` setter, active-tool guard).
- On pane/window resize: position is a normalized fraction, so recompute the pixel rect; clamp the rect within pane bounds so the watermark can never leave the viewport.

## Data flow

```
sym ──> useTickerMeta(sym) ──> {name, sector, industry}
                                      │
cs.watermark.lines ───────────────────┤
                                      ▼
                          compose lines[]  ──> primitive.applyOptions({lines})
                                                          │
user hover ──> armed (brighten + box)                     ▼
user drag  ──> primitive.pos live update ──> pointerup ──> usePreferences set chart_settings.watermark.{x,y}
settings panel edits ──> mergeChartSettings ──> primitive.applyOptions(color/opacity/sizeScale/lines)
```

## Error handling & edge cases

- All lines off, or `visible:false`, or `opacity:0` → primitive draws nothing.
- `ticker-meta` failure / unknown ticker → only the ticker line renders; no crash, no console error.
- Resize → recompute from normalized fraction; clamp inside pane bounds.
- `sizeScale` clamped 0.5–2.0; `opacity` clamped 0–0.30 in the UI.
- Drag yields to active drawing tools; only the main price pane carries the watermark (not RSI/MACD/volume sub-panes).
- Back-compat: pre-existing saved chart settings (only `visible`/`opacity`) merge without loss.
- Debounced persistence avoids hammering `POST /api/auth/preferences` during a drag.

## Testing

**Frontend (vitest):**
- Line composition: toggles + null meta → correct ordered `lines[]`
- Hit-test math: point inside/outside `getRect()`
- Position clamp on resize keeps rect within bounds
- `mergeChartSettings` defaults + back-compat with `{visible,opacity}`-only blob
- Drag: pointerdown-move-up updates position and calls the debounced persist; sub-threshold press = click pass-through (no change)
- All lines off / visible false → primitive renders nothing
- `useTickerMeta` null-safe on fetch failure

**Backend (pytest):**
- `/api/ticker-meta/{t}` happy path (yfinance success)
- Cache hit returns without re-fetch
- yfinance failure → Finnhub `profile2` fallback for name
- Unknown ticker → all-null graceful response, not cached
- Disk persistence round-trip (write → reload → served from disk within TTL)

**Manual smoke:**
- Drag watermark on TSLA → switch to RKLB → same spot
- Crosshair/OHLC legend still update when hovering over watermark
- Resize window → watermark stays proportionally placed, never off-screen
- Toggle each line, change color/opacity/size, "Reset to center"

## Out of scope (YAGNI)

- Per-symbol distinct positions (explicitly rejected — universal only)
- Image/logo watermark (the UCT brand mark in the corner is a separate, already-shipped feature)
- Snap-to-grid / preset anchor zones
- Animation/transitions on the watermark
