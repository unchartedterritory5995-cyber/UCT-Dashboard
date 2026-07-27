// Live price/volume readouts published by mounted charts, keyed by symbol.
//
// Why this exists: the watchlist and a chart of the same ticker are two
// independent live pipelines — the chart fuses a tick-by-tick developing bar
// (updating sub-second), the watchlist polls /api/live-prices every ~2s with a
// different volume tally. They ALWAYS drifted (different number, different
// timing), so a paying user comparing the two saw two "truths".
//
// Instead a chart publishes the EXACT price + volume it's displaying here, and
// the watchlist row for that symbol mirrors it — a guaranteed, real-time,
// to-the-share match for whatever ticker is charted. Non-charted rows fall back
// to their own feed (there's no chart to disagree with).
//
// A module singleton (like livePriceStore / priceStreamManager) so it works
// across widgets, popped-out windows, and standalone pages without threading
// React context through everything.

const _readouts = new Map()   // SYM -> { price, volume, changePct, ts }
const _subs = new Set()

// A chart that unmounts / freezes stops publishing; after this its readout is
// considered stale and the watchlist reverts to its own feed. Charts publish
// well under 1s, so a mounted live chart always stays fresh.
const STALE_MS = 6000

export function publishChartReadout(sym, data) {
  if (!sym) return
  _readouts.set(String(sym).toUpperCase(), { ...data, ts: Date.now() })
  _subs.forEach(cb => { try { cb() } catch { /* subscriber threw */ } })
}

/** Fresh readout for `sym`, or null if none / stale. */
export function getChartReadout(sym) {
  if (!sym) return null
  const r = _readouts.get(String(sym).toUpperCase())
  if (!r) return null
  if (Date.now() - r.ts > STALE_MS) return null
  return r
}

/** True when any chart has a fresh readout — lets consumers skip work cheaply. */
export function hasFreshReadouts() {
  if (!_readouts.size) return false
  const now = Date.now()
  for (const r of _readouts.values()) if (now - r.ts <= STALE_MS) return true
  return false
}

export function subscribeChartReadouts(cb) {
  _subs.add(cb)
  return () => { _subs.delete(cb) }
}

/** Test-only: clear all readouts + subscribers so specs don't leak into each other. */
export function _resetForTests() {
  _readouts.clear()
  _subs.clear()
}
