import { createContext } from 'react'

// What a host OUTSIDE /charts may add to the /charts widgets it embeds (2026-10-18).
//
// The screener hosts the real Chart widget (one chart, every surface: same toolbar, timeframes,
// drawings, indicators and settings as /charts) and the real News & Catalysts widget under it. It
// adds what those widgets do not know about: the selected row's setup pivot as a price line, and a
// news read that never generates. Rather than second copies, the widgets read this optional
// context. Unset (null) on /charts and every other host, so nothing changes there.
//
//   priceLinesFor(sym) → [{ price, color, title }] | null   lines for the symbol the chart SHOWS
//   symbolDebounceMs   → the wait before a new linked symbol is requested (default 90; the
//                         screener sets 0: its visible rows are already warm in memory)
//   newsPeek           → the News & Catalysts widget shows only what is already written
//                         (?generate=0) and never starts a generation: the screener reads one
//                         feed per row a member steps through
export const ChartHostOverlayContext = createContext(null)
