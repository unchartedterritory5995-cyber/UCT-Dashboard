// "Tell me what joins and leaves" (RS screens unit U13, 2026-11-14). A member turns it on for an
// RS screen and gets one message a day for that screen: what joined it and what left it since the
// previous session, at the screen's standard settings (api/services/screener/rs_screen_alerts.py).
//
// The server says whether the switch may be drawn, and for which screens it is on, inside the
// saved-screens payload the page already fetches: `rs_alerts: { available, subscribed: [starter
// ids] }`, a key that exists only while the feature is on for this member. Nothing more is asked.
//
// ⛔ FAIL CLOSED. The switch is drawn only for `available === true`. A payload without the key
// (the flag is off), `available: false` (the nightly record it reads is off) and anything
// malformed draw nothing: a switch that could never send a message is not offered.

export const RS_ALERT_LABEL = 'Tell me what joins and leaves'
// What the switch does, said once for a pointer (title) and once for a screen reader.
export const rsAlertHint = name => `One message a day for ${name || 'this screen'}, at its standard settings: what joined and what left.`
export const RS_ALERT_FAILED = 'That did not save. Try again.'

// What to draw from the payload's `rs_alerts`, or null: the screens the message is on for.
export function rsAlertsOf(alerts) {
  if (!alerts || typeof alerts !== 'object' || Array.isArray(alerts) || alerts.available !== true) return null
  const ids = Array.isArray(alerts.subscribed) ? alerts.subscribed.filter(x => typeof x === 'string' && x) : []
  return { subscribed: new Set(ids) }
}

// The saved-screens payload with one screen's message turned on or off: a new object, the rest
// untouched. A payload that carries no `rs_alerts` comes back as it was (nothing to turn).
export function withRsAlert(data, starterId, on) {
  const cur = data?.rs_alerts
  if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return data
  const rest = (Array.isArray(cur.subscribed) ? cur.subscribed : []).filter(x => x !== starterId)
  return { ...data, rs_alerts: { ...cur, subscribed: on ? [...rest, starterId] : rest } }
}
