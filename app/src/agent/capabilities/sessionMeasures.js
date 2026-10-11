// ── LATEST-SESSION screen measures: close, volume and dollar volume of the last completed day ──
//
// UCT's Screener snapshot holds a 30-DAY AVERAGE dollar volume and no single-session one, so
// "stocks that trade over $10 million a day" could not be screened as asked. These measures come
// from the server's whole-market daily frame (POST /api/agent/session-stats → services/uct_agent/
// session_stats.py): one bar per ticker for the newest NYSE session whose close has passed (the
// day is named in every answer).
//
// They are SCREEN MEASURES (screener.js registerScreenMeasures): checked after the Screener's own
// filters, on its complete result set. ONE CLOCK: with any of them in a screen, a price condition
// is checked on the same session's close (`supersedes`), so every number is that one day's.
// Read-only; no model call.

import { registerScreenMeasures } from './screener'

const MEASURES = [
  { key: 'dollar_volume_1d', label: 'Dollar Volume (latest session)', unit: '$' },
  { key: 'volume_1d', label: 'Volume (latest session)', unit: '' },
  { key: 'close_1d', label: 'Close (latest session)', unit: '$', supersedes: 'price' },
]

async function resolve(symbols) {
  const r = await fetch('/api/agent/session-stats', {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbols }),
  })
  if (!r.ok) {
    const b = await r.json().catch(() => ({}))
    return { error: typeof b.detail === 'string' ? b.detail : `the latest session's data couldn't be read (${r.status})` }
  }
  const b = await r.json()
  if (!b.session) return { error: b.error || "the latest session's market data isn't available right now" }
  const values = {}
  for (const [t, v] of Object.entries(b.rows || {})) {
    values[t] = { dollar_volume_1d: v.dollar_volume, volume_1d: v.volume, close_1d: v.close }
  }
  return { asOf: b.session, values }
}

let registered = false
export function registerSessionMeasures() {
  if (registered) return
  registered = true
  registerScreenMeasures({ id: 'session', label: 'latest-session data', measures: MEASURES, resolve })
}
