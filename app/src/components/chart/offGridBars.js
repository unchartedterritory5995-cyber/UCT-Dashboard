// Off-grid intraday bars — the client twin of api/services/intraday_grid.py.
//
// ⛔ An intraday bar's `t` is its BUCKET START. Production served post-market rows
// stamped at a trade time (SPY 5m 16:35:50 beside 16:35:00 — Yahoo's separate live
// row, persisted by the yfinance fallback), and each drew as its own extra candle
// between two real buckets. The server now handles them at every door; this keeps a
// chart clean against anything already cached in IDB / memory before that deploy.
//
// Rule (same as the server's serve door): an off-grid bar whose bucket also has an
// on-grid bar is DROPPED — the on-grid bar is the full-bucket aggregate and already
// contains those trades (merging would double-count volume and take another vendor's
// close / wicks). One with no twin is re-keyed to its bucket start (several such fold
// together). A clean series is returned AS IS (same array, no copy), so memo
// identities downstream are unchanged.
import { bucketStartUnix, sixtyMinGridFor, etMinuteOfDay, rthCloseMinuteOf } from './barTime'

const STEP = { '1': 60, '5': 300, '15': 900, '30': 1800, '60': 3600 }
const RTH_OPEN_MIN = 570

// 60m mirrors the server: a start on the session grid (09:30, 10:30 … inside RTH)
// or on the ET clock-hour grid. ET offsets are whole hours, so a UTC :00 is an ET :00.
function offGrid(t, tf) {
  if (tf !== '60') return t % STEP[tf] !== 0
  if (t % 1800 !== 0) return true
  if (t % 3600 === 0) return false
  const m = etMinuteOfDay(t)
  return !(m >= RTH_OPEN_MIN && m < rthCloseMinuteOf(t))
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
  const onGrid = new Set()
  for (const b of bars) if (typeof b?.t === 'number' && !offGrid(b.t, key)) onGrid.add(b.t)
  const out = []
  const lone = new Map()   // bucket start → index in out (snapped strays only)
  for (const b of bars) {
    const t = b?.t
    if (typeof t !== 'number' || !offGrid(t, key)) { out.push(b); continue }
    const start = bucketStartUnix(t, Number(key), { grid })
    if (onGrid.has(start)) continue                 // its bucket row wins untouched
    const j = lone.get(start)
    if (j === undefined) { lone.set(start, out.length); out.push({ ...b, t: start }) }
    else out[j] = foldPair(out[j], b)
  }
  out.sort((a, b) => ((typeof a?.t === 'number' ? a.t : 0) - (typeof b?.t === 'number' ? b.t : 0)))
  return out
}

// Two strays of ONE empty bucket, `early` then `late` → merged OHLCV (keeps early's t).
function foldPair(early, late) {
  const hs = [early.h, late.h].filter(x => typeof x === 'number')
  const ls = [early.l, late.l].filter(x => typeof x === 'number')
  return {
    ...early,
    h: hs.length ? Math.max(...hs) : early.h,
    l: ls.length ? Math.min(...ls) : early.l,
    c: late.c,
    v: (Number(early.v) || 0) + (Number(late.v) || 0),
  }
}
