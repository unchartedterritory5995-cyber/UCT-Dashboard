// ── PAINT LOG (2026-11-19): every `updateChart` pass, its plan, in a 120-entry ring on
// `window.__uctPaints`, so a live measurement can count how many FULL repaints a ticker
// switch costs (a full pass re-sets every series). Read-only diagnostics; nothing reads it.
//
// ⭐ (2026-11-23) THE SAME RECORD FEEDS THE SWITCH-SPEED INSTRUMENT (lib/switchSpeed.js). A chart that is a
// member of a linked group paints under an IDENTITY (`PaintMemberContext`, provided by ChartWidget: the token
// its handoff registered with the group), and each of its passes is handed to ONE listener, which uses it to
// know when every chart of a group has drawn a new symbol. A chart with no identity (every other host) hands
// nothing; with no listener nothing is called. Read by no rendering decision.
import { createContext } from 'react'
import { COVER_ROWS } from '../../data/barStore/coverRows'

/** The identity a chart paints under (an opaque token), or null: this chart is no group's member. */
export const PaintMemberContext = createContext(null)

// ⭐ (2026-11-27, owner: "it loads a small portion of the candles right away and then shortly after the rest") THE VIEW
// A MEMBER SHOWS. The chart painting under a member identity writes the logical width it shows (bars across the plot, the
// right margin included) on every visible-range change, and the member's switch reads it: a new symbol's first paint
// must already hold the bars that view will show (hooks/useSymbolHandoff `viewNeed`). Kept per identity, weakly.
const _views = new WeakMap()
/** The chart painting under `member` shows `span` bars across (the right margin included). */
export function noteMemberView(member, span) {
  if (member && typeof member === 'object' && Number.isFinite(span) && span > 0) _views.set(member, span)
}
/** The logical width the chart painting under `member` last showed, or null (none written yet). */
export function memberViewSpan(member) {
  return member && typeof member === 'object' ? (_views.get(member) ?? null) : null
}
/** The rows the default view assumes besides its visible bars: the longest average's lookback and a margin (COVER_ROWS
 *  is ~200 visible bars plus these). */
export const VIEW_LOOKBACK_ROWS = COVER_ROWS - 200
/**
 * ⭐⭐ (2026-11-27, owner: "I type a random stock and it loads a small portion of the candles right away and then shortly
 * after it loads the rest. That jumpiness is horrible.") THE ROWS A FIRST PAINT NEEDS: what the view this member shows
 * will draw (its logical width, the right margin included: memberViewSpan) plus the lookback the averages draw from, and
 * never fewer than COVER_ROWS (the default view). A view zoomed out to 425 bars needed ~825 rows, and the fixed 600
 * painted it short. Read by the switch (hooks/useSymbolHandoff) and the double buffer's flip (useDoubleBuffer).
 */
export function viewNeed(member) {
  const span = memberViewSpan(member)
  return Number.isFinite(span) && span > 0 ? Math.max(COVER_ROWS, Math.ceil(span) + VIEW_LOOKBACK_ROWS) : COVER_ROWS
}

let _onPaint = null
/** The one listener of member charts' passes: `fn(member, sym, bars, mode)`, or null for none. */
export function onChartPaint(fn) { _onPaint = typeof fn === 'function' ? fn : null }

const _PAINT_LOG_MAX = 120
export function recordPaint(sym, tf, bars, mode, member = null) {
  if (member && _onPaint) {
    try { _onPaint(member, sym, bars, mode) } catch { /* a measurement never costs a paint */ }
  }
  if (typeof window === 'undefined') return
  try {
    const log = window.__uctPaints || (window.__uctPaints = [])
    log.push({ at: Math.round(performance.now()), sym, tf, bars, mode })
    if (log.length > _PAINT_LOG_MAX) log.splice(0, log.length - _PAINT_LOG_MAX)
  } catch { /* diagnostics only */ }
}
