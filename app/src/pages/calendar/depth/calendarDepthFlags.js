// Calendar depth (Lane R): one dark flag per surface.
//
// The server sends each key ONLY when that surface is on
// (api/routers/auth.py::_calendar_depth_flags), so absent and false mean the same
// thing here. Each value is read `=== true`: an enablement gate must never default
// to exposed while the payload is still loading.
//
// ⛔ This list mirrors `_CALENDAR_DEPTH_SURFACES` in auth.py; the rail in
// calendarDepthFlags.test.js reads the Python tuple rather than restating it.
export const CALENDAR_DEPTH_KEYS = [
  'earnings_date_status_enabled',    // D-1 / D-2
  'index_rebalance_events_enabled',  // D-3
  'calendar_order_explain_enabled',  // D-10
]

export function readCalendarDepth(d) {
  const out = {}
  for (const k of CALENDAR_DEPTH_KEYS) out[k] = d?.[k] === true
  return out
}
