// app/src/components/chart/engine/fundamentalAsOf.js
//
// ─── AS-OF PROJECTION: A DISCLOSURE ONTO THE CHART'S BARS ───────────────────
//
// ⛔⛔ THIS IS NOT `sym:` AND MUST NEVER BECOME IT. `symbolProjection` joins two
// PRICE series on exact `t` with no forward fill, because a missing price bar
// really is missing. A historical fundamental is a DISCLOSURE: it stays true
// from the instant it became public until the next disclosure replaces it. So
// this operator carries the last known value forward — and ONLY this operator,
// selected ONLY by a fundamental source. `sym:`'s rule is untouched.
//
// THE RULE (mirrors api/services/fundamentals_pit/asof.py exactly):
//   each bar takes the last point whose `t` (the instant the filing became
//   public, unix seconds UTC) is at or before the bar's REFERENCE TIME:
//     daily bar D            D 16:00 ET — the close the bar's price describes
//     weekly / monthly bar   16:00 ET on the bucket's last calendar day
//                            (Friday / month end), capped at `now`
//     intraday bar [a, b)    b — the bar's close
//   "Known by the bar's close" is one rule for every timeframe. A 10-Q accepted
//   16:42 ET therefore reaches the NEXT daily bar, never the one it missed.
//
// ⛔ STALENESS: a point stops applying once its fiscal period is more than
//   `maxPeriodAgeDays` (200) old at the bar. A company that stops filing goes
//   BLANK, not flat — a two-year-old margin is not a current margin.
//
// Points: [{ t: unixSecondsUtc, v: number, pe: 'YYYY-MM-DD' }] ascending by t.
// Bars:   the chart's own bars; `t` is 'YYYY-MM-DD' (D/W/M) or unix seconds
//         (intraday bar START). Returns a column the length of `bars`, NaN where
//         no value applies (the engine's "not computable").

const DAY = 86400
const MAX_PERIOD_AGE_DAYS = 200
const TF_SECONDS = { '1m': 60, '2m': 120, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400 }

const _nyHour = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' })
const _closeCache = new Map()

/** Unix seconds of 16:00 America/New_York on the calendar day `iso` (DST-aware). */
export function closeUtcSeconds(iso) {
  let hit = _closeCache.get(iso)
  if (hit !== undefined) return hit
  const [y, m, d] = iso.split('-').map(Number)
  let s = Date.UTC(y, m - 1, d, 21, 0, 0) / 1000            // 16:00 EST
  if (Number(_nyHour.format(new Date(s * 1000))) === 17) s -= 3600   // EDT
  _closeCache.set(iso, s)
  return s
}

function isoOf(ms) {
  return new Date(ms).toISOString().slice(0, 10)
}

function bucketEnd(iso, tf) {
  const [y, m, d] = iso.split('-').map(Number)
  if (tf === 'W') {
    const dt = new Date(Date.UTC(y, m - 1, d))
    const toFri = (5 - dt.getUTCDay() + 7) % 7
    return isoOf(dt.getTime() + toFri * DAY * 1000)
  }
  if (tf === 'M') return isoOf(Date.UTC(y, m, 0))          // day 0 of next month
  return iso
}

const DAILY_TFS = new Set(['D', 'W', 'M', '1D', '1W', '1M'])
const bucketTf = (tf) => (tf === '1W' ? 'W' : tf === '1M' ? 'M' : tf === '1D' ? 'D' : tf)

/** Seconds per bar for an intraday code: the chart's own codes are minutes as
 *  strings ('1', '5', '15', '30', '60'); '5m' / '1h' spellings are accepted too. */
function intradaySeconds(tf) {
  if (tf in TF_SECONDS) return TF_SECONDS[tf]
  const n = Number(tf)
  return Number.isFinite(n) && n > 0 ? n * 60 : 0
}

/** The instant (unix seconds UTC) a bar's value is "as of".
 *
 *  ⚠️ `barT` IS THE RAW BAR TIME — true UTC seconds for intraday, an ISO day for
 *  D/W/M. The chart shifts intraday times to ET only for DISPLAY (`adjustTime` in
 *  the binder's point conversion); projecting against a shifted time would make a
 *  16:42 ET filing appear hours early. */
export function referenceTime(barT, tf, nowSec = null) {
  if (DAILY_TFS.has(tf)) {
    const iso = typeof barT === 'string' ? barT.slice(0, 10) : isoOf(Number(barT) * 1000)
    const b = bucketTf(tf)
    const ref = closeUtcSeconds(bucketEnd(iso, b))
    return nowSec != null && (b === 'W' || b === 'M') ? Math.min(ref, nowSec) : ref
  }
  return Number(barT) + intradaySeconds(tf)
}

function periodAgeDays(refSec, pe) {
  const [y, m, d] = pe.split('-').map(Number)
  return Math.floor((refSec - Date.UTC(y, m - 1, d) / 1000) / DAY)
}

/**
 * @param {Array<{t:number,v:number,pe:string}>} points  sparse PIT observations
 * @param {Array<{t:string|number}>} bars                the chart's bars
 * @param {string} tf                                    'D' | 'W' | 'M' | '5m' | ...
 * @returns {number[]}
 */
export function projectAsOf(points, bars, tf, { nowSec = null, maxPeriodAgeDays = MAX_PERIOD_AGE_DAYS } = {}) {
  const n = Array.isArray(bars) ? bars.length : 0
  const out = new Array(n).fill(NaN)
  const pts = Array.isArray(points) ? points : []
  if (!n || !pts.length) return out
  // Bars are ascending, so one forward pointer walks the points once: O(n + m).
  let j = -1
  for (let i = 0; i < n; i++) {
    const b = bars[i]
    const t = b && typeof b === 'object' ? b.t : undefined
    if (t === undefined || t === null) continue
    const ref = referenceTime(t, tf, nowSec)
    while (j + 1 < pts.length && pts[j + 1].t <= ref) j++
    if (j < 0) continue
    const p = pts[j]
    if (p.pe && periodAgeDays(ref, p.pe) > maxPeriodAgeDays) continue
    // ⛔ A GAP POINT (`v: null`, method `gap`) says "the newest filed period is
    // unknown" -- it ENDS the previous value; it is never bridged over.
    out[i] = Number.isFinite(p.v) ? p.v : NaN
  }
  return out
}
