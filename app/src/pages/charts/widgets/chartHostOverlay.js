import { createContext } from 'react'

// What a host OUTSIDE /charts may add to the Chart widget it embeds (2026-10-18).
//
// The screener hosts the real Chart widget (one chart, every surface: same toolbar, timeframes,
// drawings, indicators and settings as /charts), and it adds exactly one thing the widget does not
// know about: the selected row's setup pivot as a price line. Rather than a second chart, the
// widget reads this optional context. Unset (null) on /charts and every other host, so nothing
// changes there.
//
//   priceLinesFor(sym) → [{ price, color, title }] | null   lines for the symbol the chart SHOWS
//   symbolDebounceMs   → the wait before a new linked symbol is requested (default 90; the
//                         screener sets 0: its visible rows are already warm in memory)
export const ChartHostOverlayContext = createContext(null)
