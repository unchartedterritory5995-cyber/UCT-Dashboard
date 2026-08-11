# Desk Ticker Moments — Phase 2 (fast-follows) Design

**Date:** 2026-08-11 · Completes the owner-approved vision from
`2026-08-11-desk-ticker-chart-moments-design.md` ("chart→video mention markers;
cross-session ticker timeline").

## A. Mentions endpoint (single authority for both features)

`GET /api/education/tickers/{sym}/mentions` (auth `require_paid`) →
`{"mentions": [{"video_id", "youtube_id", "title", "anchor_date", "t", "note"}], "as_of"}`
— newest-first by anchor_date, capped 50 mentions. One row PER MENTION (a video
discussing SYM twice yields two rows). anchor_date derives from
`edu_videos.created_at` via `ticker_returns.anchor_date_et` (the ONE authority,
unchanged). Implementation copies `related_videos_by_ticker`'s documented idiom:
small library (~300 rows) → Python scan over the `ticker_moments` JSON column,
no SQLite JSON queries. Per-sym in-process TTL cache (600s). Unknown/uncovered
sym → `{"mentions": [], ...}` with HTTP 200.

## B. Deep link + cross-session timeline + two nits

1. **Deep link seek:** extend VideosSection's existing `?v=<youtube_id>` deep
   link with `&t=<seconds>` — after `playVideo`, seek to `t` once the player is
   ready. Fires once per mount like the existing handler.
2. **Timeline ("Desk" tab in TickerPopup):** a new view tab beside
   Chart/Fundamentals/Analyst/Ownership listing every session that discussed the
   symbol: `anchor_date · note · session title`, newest first, from a new
   `useTickerMentions(sym)` SWR hook (fetch only while the tab is active; empty
   state "No Desk sessions have covered {SYM} yet."). Row click closes the popup
   and navigates to `/desk?section=videos&v=<youtube_id>&t=<t>`.
3. **Nits:** follow-along mini pane passes `hideLegend: true` (OHLC legend
   overlapped the small canvas); `useTickerReturns` adopts `useTickerMeta`'s
   retry cadence (`errorRetryCount: 4`, `errorRetryInterval: 4000`).

## C. Desk-mention chart markers (the differentiator)

A new category in StockChart's EXISTING marker system (`cs.markers.*`
settings + `/api/chart/markers` merge + `createSeriesMarkers`):
- `cs.markers.desk` toggle rendered in ChartSettingsModal's markers section as
  "Desk mentions", default OFF (opt-in like news).
- When ON, StockChart fetches the mentions endpoint (SWR, same idiom as the
  earnings/news marker fetches — no fetch while OFF) and merges gold
  `◆`-style markers at each mention's anchor_date (one marker per DAY; a day
  with multiple mentions collapses to one marker carrying the first mention).
- Marker click (via the existing `subscribeClick` handler's pattern) navigates
  to `/desk?section=videos&v=<youtube_id>&t=<t>` — every chart becomes a door
  back into "what did the Desk say about this that day."
- Graceful: endpoint error/empty → no markers, never blocks other categories.

## Non-goals
No new chart surfaces; no changes to the anchoring/returns contracts; the
pre-existing ChartDrawingOverlay z 20-22 issue stays out of scope.
