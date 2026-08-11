# Desk Ticker Chart Moments — Design

**Date:** 2026-08-11
**Owner ask (verbatim):** "in the recordings … it pulls up charts when you click one of the tickers mentioned … What if I am watching a video from 6 months ago or 3 weeks ago? I want the chart to be positioned back at that day that the video is recorded!"

## Goal

Turn the Desk recordings' AI ticker moments (`{t, ticker, note}` per video) into a
time-machine chart experience. Three features ship in v1; two are named fast-follows.

**v1 scope:**
1. **Anchored + reveal popup** — clicking a ticker chip opens the user's own chart
   (TickerPopup → ChartPane) *positioned back at the session date*: the session day's
   bar sits at the right edge with a gold `startMarker` line on it, later bars are
   loaded but off-screen, so scrolling right reveals how the call played out.
   A pill offers "Back to today".
2. **Since-mention scorecard** — each ticker chip shows the % move since the session
   (colored), with a tooltip breakdown; the ticker cloud gains a "sort by performance"
   toggle. Powered by ONE batch endpoint per video (not 50 per-chip fetches).
3. **Follow-along chart** — in the theater view, an opt-in pane whose ChartPane
   automatically switches symbol as the playhead crosses ticker moments (the
   `activeTicker` index already tracks this). Anchored to the session date too.

**Fast-follow (explicitly OUT of v1):** chart→video mention markers on platform
charts; cross-session ticker timeline. Both consume the same data; nothing in v1 may
preclude them.

## What already exists (verified on origin/master 2026-08-11)

- `useVideoInsights(videoId)` → `tickerMoments[{t, ticker, note}]`, SWR-deduped.
- `VideoDockSlot.jsx` ticker chips: symbol wrapped in `TickerPopup` (opens ChartPane),
  `RsBadge`, timestamp button → `seekTo(t)`; `activeTicker` highlights the chip whose
  moment is at/behind the playhead.
- `TickerPopup` renders `ChartPane` with `stockChartProps={{...}}` pass-through.
- `StockChart.jsx` primitives: `startMarker='YYYY-MM-DD'` (gold vertical line),
  `replayCutoff` (strict replay + "Exit Replay Mode" pill via `onExitReplay`),
  `focusDate` (zoom so a date's bar is the last visible candle — currently coupled to
  the Setup-Library `entryDate`/`exactDateRange` book-chart context).

## Architecture

### 1. Anchored + reveal popup

- **Anchor date source (single authority):** the ticker-returns endpoint (feature 2)
  returns `anchor_date`, derived SERVER-SIDE from `edu_videos.created_at` (epoch int)
  converted to an ET calendar date — the auto-publish pipeline lands minutes after a
  session ends, so created_at's ET date IS the session date. NEVER parsed from the
  title; no client-side re-derivation. If the returns fetch hasn't landed or errored,
  chips open a normal unanchored chart (graceful).
- **Wiring:** `VideoDockSlot` passes `anchorDate={anchor_date}` → new `TickerPopup`
  prop `anchorDate` → merged into its `stockChartProps` → StockChart.
- **Chart behavior:** prefer composing existing primitives (`startMarker` +
  `focusDate`-style framing). If `focusDate` cannot anchor standalone (without
  `entryDate`), add ONE new StockChart prop `anchorDate='YYYY-MM-DD'`:
  frame the default zoom so anchor-day's bar is the rightmost visible candle,
  draw the `startMarker` line, do NOT slice later bars (unlike `replayCutoff`),
  show the existing pill mechanism labeled "Back to today" (clears the frame,
  scrolls to present; anchoring is view-only, never data-mutating).
- **Edge cases:** anchor = today/future → no-op (normal chart). No bars at anchor
  (halted/delisted) → chart renders normally, marker only if in range. Intraday TFs:
  v1 anchors by DAY on every TF; exact-bar intraday positioning via the mention `t`
  is a stretch goal, only if it costs nothing structural.

### 2. Since-mention scorecard

- **Endpoint:** `GET /api/education/videos/{video_id}/ticker-returns` (education
  router, same auth posture as the sibling insights endpoint). Response:
  `{"as_of": ISO, "anchor_date": "YYYY-MM-DD", "returns": {"NVDA": {"since_pct": 14.2, "d5_pct": 3.1, "d21_pct": 8.0}}}`.
  - Basis: last close ON or BEFORE anchor_date → latest close (and +5/+21 trading
    days for the tooltip). Reuses the existing daily-bars read layer (bars.db) —
    no new fetcher, no provider calls.
  - Symbols with no bars are OMITTED (frontend renders those chips without a %).
  - In-process TTL cache (~10 min) keyed by video id; one bars pass per video.
- **Frontend:** `useTickerReturns(videoId)` SWR hook (single fetch, shared by chips
  and any future surface). Chip gains a small colored `+14%`-style tag; tooltip =
  mention note + since/1w/1m breakdown. Ticker-cloud header gains a sort toggle
  (chronological ⇄ by performance), localStorage-persisted like `tickersOpen`.

### 3. Follow-along chart

- **Placement:** theater right rail, a collapsible "📈 Chart follows discussion"
  section above "Tickers covered". OFF by default; toggle persisted
  (`uct.desk.followChart`). ChartPane mounts ONLY when ON (it is a heavy lazy chunk).
- **Behavior:** symbol = `tickerMoments[activeTicker].ticker` (falls back to the
  first moment before playback crosses any). Same `stored={null}` / no `onStore`
  contract as TickerPopup (renders the user's own chart, read-only settings, no gear).
  Same `anchorDate` as feature 1. `density="compact"` (skips fundamentals fetch —
  symbol switches every few minutes; a compact pane avoids a fetch storm), fixed
  definite height (ChartPane requires one).
- Auto-switch is playhead-driven only; a user who wants a specific ticker uses the
  chips (popup), so there is no focus-stealing interaction to arbitrate.

## Error handling

- Returns endpoint failure / empty → chips render exactly as today (no % tags,
  sort toggle hidden). Anchoring failure mode is "normal chart", never a blank pane.
- All new UI is additive inside existing conditional blocks (`tickerMoments.length > 0`).

## Testing

- **Backend:** ticker-returns endpoint — known-bars fixture math (since/d5/d21),
  on-or-before anchor basis, missing-symbol omission, TTL cache behavior, auth.
- **Frontend (vitest, run from `app/`):**
  - Chip % render + color + sort toggle (+ persistence).
  - **The wire:** anchor date provably reaches StockChart — a test that FAILS if the
    `VideoDockSlot → TickerPopup → ChartPane → StockChart` pass-through is severed
    (this repo's most repeated defect class: built-tested-green-connected-to-nothing).
  - Follow-along: activeTicker change switches the pane's `sym`; OFF = no ChartPane
    mount; toggle persists.
  - StockChart `anchorDate` (if added): frames anchor at right edge, bars NOT sliced
    (contrast with `replayCutoff`), marker drawn, pill exits to present.
- Mutation checks on the load-bearing assertions (drop the prop, sever the wire,
  swap anchor basis to close-after) — each must red the suite.

## Non-goals / constraints

- No writes to chart settings from any of these surfaces (popup contract unchanged).
- No StockChart changes beyond (at most) the single `anchorDate` prop.
- Partner-owned files (OptionsFlow.jsx, live_massive_router.py, …) untouched.
- Ship gate: build + verify on branch `feat/desk-ticker-moments`; master push only on
  explicit owner "ship it" (and inside the deploy window).
