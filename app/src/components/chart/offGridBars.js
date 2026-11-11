// Off-grid intraday bars — the client twin of api/services/intraday_grid.py.
//
// ⛔ An intraday bar's `t` is its BUCKET START. Production served post-market rows
// stamped at a trade time (SPY 5m 16:35:50 beside 16:35:00 — Yahoo's separate live
// row, persisted by the yfinance fallback), and each drew as its own extra candle
// between two real buckets. The server now folds them at every door; this keeps a
// chart clean against anything already cached in IDB / memory before that deploy.
//
// Rule (same as the server): an off-grid bar whose bucket also has an on-grid bar
// is folded into it (open from the earlier, high/low extremes, close from the later,
// volume summed); one with no twin is re-keyed to its bucket start. Bars must be
// ascending (they always are on this path); a clean series is returned AS IS (same
// array, no copy), so memo identities downstream are unchanged.
import { bucketStartUnix, sixtyMinGridFor } from './barTime'

const STEP = { '1': 60, '5': 300, '15': 900, '30': 1800, '60': 3600 }

function offGrid(t, tf) {
  if (tf === '60') return t % 60 !== 0   // grid policy is the session code's; seconds never are
  return t % STEP[tf] !== 0
}

export function foldOffGridBars(bars, tf, { showExtended = true } = {}) {
  const key = String(tf)
  if (!Array.isArray(bars) || bars.length === 0 || !STEP[key]) return bars
  let any = false
  for (let i = 0; i < bars.length; i++) {
    const t = bars[i]?.t
    if (typeof t === 'number' && offGrid(t, key)) { any = true; break }
  }
  if (!any) return bars
  const grid = key === '60' ? sixtyMinGridFor(showExtended ? 'extended' : 'rth') : undefined
  const out = []
  const at = new Map()   // bucket start → index in out
  for (const b of bars) {
    const t = b?.t
    if (typeof t !== 'number') { out.push(b); continue }
    if (!offGrid(t, key)) {
      const j = at.get(t)
      if (j === undefined) { at.set(t, out.length); out.push(b) }
      else out[j] = { ...b, ...foldPair(b, out[j]) }   // on-grid arrived after a snapped twin
      continue
    }
    const start = bucketStartUnix(t, Number(key), { grid })
    const j = at.get(start)
    if (j === undefined) { at.set(start, out.length); out.push({ ...b, t: start }) }
    else out[j] = { ...out[j], ...foldPair(out[j], b) }
  }
  out.sort((a, b) => ((typeof a?.t === 'number' ? a.t : 0) - (typeof b?.t === 'number' ? b.t : 0)))
  return out
}

// `early` then `late` → the merged OHLCV (keeps early's t).
function foldPair(early, late) {
  const hs = [early.h, late.h].filter(x => typeof x === 'number')
  const ls = [early.l, late.l].filter(x => typeof x === 'number')
  return {
    t: early.t,
    o: early.o,
    h: hs.length ? Math.max(...hs) : early.h,
    l: ls.length ? Math.min(...ls) : early.l,
    c: late.c,
    v: (Number(early.v) || 0) + (Number(late.v) || 0),
  }
}
