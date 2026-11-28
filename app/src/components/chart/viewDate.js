// ⭐ (2026-11-27) THE DATE A MEMBER'S VIEW IS ANCHORED AT. A leaf module (no imports), keyed by the same member identity
// as chart/paintLog's noteMemberView (the token a linked chart paints under, PaintMemberContext), kept weakly.
//
// The chart writes it when its date anchor changes: set ONLY by Go-to-date, Go-to-year and the date step buttons;
// cleared (null) by Latest, an empty date Enter, a range button, Reset view and replay; kept across a timeframe change.
// Readers (the switch's viewNeed, the range-at-date request, the typed / linked / neighbour warms) treat a set date as
// "the view ends at rightMs": the rows it needs are those from (rightMs - width - lookback) to rightMs, a window ending
// at the date (like intraday replay's `to=`), never "the N newest rows", and no live stream attaches to it.
//
// Shape: { rightMs, offset, width, tf }
//   rightMs  the right edge of the view, unix milliseconds
//   offset   bars between the anchor bar and the right edge (the right margin, as the chart applied it)
//   width    bars across the view
//   tf       the timeframe the anchor was set on (kept across a timeframe change; readers convert)

const _dates = new WeakMap()

const _finite = (x) => typeof x === 'number' && Number.isFinite(x)

/** The chart painting under `member` anchors its view at `date` ({rightMs, offset, width, tf}), or at none (null). */
export function noteMemberDate(member, date) {
  if (!member || typeof member !== 'object') return
  if (date == null) { _dates.delete(member); return }
  if (typeof date !== 'object' || !_finite(date.rightMs) || !(date.width > 0)) return
  _dates.set(member, Object.freeze({
    rightMs: date.rightMs,
    offset: _finite(date.offset) ? date.offset : 0,
    width: date.width,
    tf: date.tf == null ? null : String(date.tf),
  }))
}

/** The date `member`'s view is anchored at ({rightMs, offset, width, tf}), or null: the view is at the present. */
export function memberViewDate(member) {
  return member && typeof member === 'object' ? (_dates.get(member) ?? null) : null
}
