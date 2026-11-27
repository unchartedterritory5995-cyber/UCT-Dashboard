// app/src/components/chart/viewDate.js
//
// ⭐ (owner, 2026-11-27: scanning charts AT a past date) THE DATE A MEMBER'S CHART WAS SENT TO. The /charts date box
// (Go to date, a year, the step buttons) anchors a widget at a date; every next symbol opens framed there. The widget
// writes the anchor under its member identity (paintLog's PaintMemberContext token), and the loading side reads it:
// a switch's first page must hold the rows the view at that date draws (the range-at-date request, viewNeed).
// Kept per identity, weakly. A leaf.
// ⚠️ The contract the bar-loading change builds on (coordinated 2026-11-27): if its own copy of this file lands first,
// this one is dropped for it at the rebase.
const _dates = new WeakMap()

/**
 * The chart painting under `member` is anchored at a date, or no longer is (`null`).
 * @param {object} member  the member identity (PaintMemberContext)
 * @param {{rightMs: number, offset: number, width: number, tf: string}|null} view  the anchor bar's day (NOON UTC of
 *   its date, so `etDate(rightMs)` is that date), where it sits (`offset` bars right of it: the right edge), the bars
 *   across, the timeframe they are counted in
 */
export function noteMemberDate(member, view) {
  if (!member || typeof member !== 'object') return
  if (view && Number.isFinite(view.rightMs) && view.width > 0) {
    _dates.set(member, { rightMs: view.rightMs, offset: Number.isFinite(view.offset) ? view.offset : 0.5, width: view.width, tf: view.tf ?? null })
  } else _dates.delete(member)
}

/** The date the chart painting under `member` is anchored at, or null (it follows the present). */
export function memberViewDate(member) {
  return member && typeof member === 'object' ? (_dates.get(member) ?? null) : null
}
