// app/src/data/barStore/coverRows.js — how many rows a held intraday copy needs to draw the view whole.
//
// ⭐ (2026-11-20, the owner's cold path; moved here 2026-11-26 so the typed warm reads the same number) A view needs its
// visible bars (~200 at the default zoom) plus the longest lookback the averages use (200 bars) to draw exactly what the
// whole history would draw there; COVER_ROWS is that with a margin, and the chart's render window (newest >= 600 rows)
// holds no more. ONE authority, two readers: the switch paints a held key with this many rows at once and lets the depth
// join behind the view (hooks/useSymbolHandoff `covers`), and the typed warm asks the server before Enter for a local copy
// with fewer (data/barStore/prefetch `_warmTypedIntraday`), so Enter finds a copy that covers. A leaf: imports nothing.
export const COVER_ROWS = 600
